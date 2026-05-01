import { supabaseAdmin } from '@/lib/supabase';
import { AgentRunParams, AgentRunResult } from '../types';
import { runDeepSeekAgentLoop } from '../deepseek-agent-loop';

const AFFILIATE_PROMPT = `
## 어필리에이터/인플루언서 전용 규칙

### 권한
- 자비스는 **기안만** 가능. 실제 정산·알림·정책 변경은 사장님 결재함(/admin/jarvis)에서 승인 후 실행.
- 직접 settlements / os_policies UPSERT 금지. 반드시 agent_actions 경유.

### 조회 질의
- "이번달 TOP 인플루언서", "홍길동 성과" → get_affiliate_performance
- "활성 커미션 정책" → list_commission_policies
- "정책 켜면 어떻게 되나" → preview_commission_policy
- 수수료·매출은 만원 단위로 읽기 쉽게 제시
- 이상치 있으면 강조: "⚠️ 클릭 급증 감지"

### 정책 편집 워크플로 (자연어 → 기안)
사용자가 "다음 주 월요일부터 한 달간 부산 출발 +1.5% 캠페인 켜줘" 같이 말하면:
1. preview_commission_policy 로 영향 시뮬레이션 (활성 어필리에이터 N명, 평균 변화)
2. draft_commission_policy 로 agent_actions 에 기안만 생성
3. 사장님 승인 → /admin/jarvis 에서 실제 INSERT
- 캠페인은 ends_at 필수. 종료일 없으면 거부하고 사용자에게 재확인.
- 캡(commission_cap) 변경은 매우 신중히 — 평균 정산액 변동 % 까지 보고.

### 답변 형식
📊 <인플루언서명> 지난 30일:
- 유효 클릭: XXX회 / 고유 방문: XXX명
- 전환: XX건 (매출 XXX만원)
- 수수료: XX만원 (등급 <등급>)

### 주의
- 민감정보(계좌·전화) 노출 금지
- 정산/정책 실행 요청은 draft_* 로 기안만 생성
`;

const AFFILIATE_TOOLS_RAW = [
  {
    name: 'list_affiliates',
    description: '활성 어필리에이터 목록을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        grade_min: { type: 'number', description: '최소 등급 (1~5)' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_affiliate_performance',
    description: '특정 어필리에이터의 지난 N일 성과(클릭·전환·수수료)를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      required: ['affiliate_id'],
      properties: {
        affiliate_id: { type: 'string' },
        days: { type: 'number', description: '조회 기간 (기본 30일)' },
      },
    },
  },
  {
    name: 'detect_anomaly',
    description: '전일 클릭/전환/취소 이상치를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        affiliate_id: { type: 'string', description: '특정 어필리에이터만' },
      },
    },
  },
  {
    name: 'draft_monthly_settlement',
    description: '월별 정산 기안을 agent_actions에 생성합니다. (실행은 사장님 승인 후)',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: { type: 'string', description: 'YYYY-MM (기본 전월)' },
      },
    },
  },
  {
    name: 'list_commission_policies',
    description: '활성 어필리에이터 커미션 정책 목록 (캠페인 + 캡)을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        active_only: { type: 'boolean', description: '활성만(기본 true)' },
      },
    },
  },
  {
    name: 'preview_commission_policy',
    description: '정책 활성화 시 평균 커미션율과 영향 어필리에이터 수를 시뮬레이션합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string', description: '특정 상품 한정 시' },
        sample: { type: 'number', description: '샘플 크기 (기본 20)' },
      },
    },
  },
  {
    name: 'draft_commission_policy',
    description:
      '커미션 캠페인/캡 정책을 agent_actions에 기안만 생성. 실제 적용은 사장님 승인 후. ends_at 필수.',
    input_schema: {
      type: 'object' as const,
      required: ['name', 'action_type', 'rate_or_cap', 'starts_at', 'ends_at', 'reason'],
      properties: {
        name: { type: 'string', description: "예: '부산출발 +1.5% 4월 이벤트'" },
        action_type: {
          type: 'string',
          description: 'commission_campaign_bonus | commission_cap',
        },
        rate_or_cap: {
          type: 'number',
          description: '캠페인이면 가산율(예 0.015), 캡이면 max_rate(예 0.07)',
        },
        starts_at: { type: 'string', description: 'YYYY-MM-DD' },
        ends_at: { type: 'string', description: 'YYYY-MM-DD (캠페인은 필수)' },
        scope: {
          type: 'object',
          description: '{destination?, product_ids?, affiliate_grade_min?}',
        },
        exclusive: {
          type: 'boolean',
          description: '단독 적용 (다른 캠페인 무시) 캠페인 한정',
        },
        reason: { type: 'string', description: '변경 사유 (감사 로그 필수)' },
      },
    },
  },
  {
    name: 'send_content_24h_report',
    description:
      '발행 후 24시간 경과한 어필리에이터 콘텐츠의 클릭/전환 리포트 카톡 푸시 기안.',
    input_schema: {
      type: 'object' as const,
      properties: {
        affiliate_id: { type: 'string', description: '특정 어필리에이터 한정' },
      },
    },
  },
];

const AFFILIATE_TOOLS = AFFILIATE_TOOLS_RAW;

async function executeTool(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'list_affiliates': {
      let query = supabaseAdmin
        .from('affiliates')
        .select('id, name, referral_code, grade, commission_rate, booking_count')
        .eq('is_active', true)
        .order('booking_count', { ascending: false })
        .limit(args.limit || 20);
      if (args.grade_min) query = query.gte('grade', args.grade_min);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }

    case 'get_affiliate_performance': {
      const days = args.days || 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const { data: aff } = await supabaseAdmin
        .from('affiliates')
        .select('id, name, referral_code, grade, commission_rate')
        .eq('id', args.affiliate_id)
        .maybeSingle();
      if (!aff) return { error: 'affiliate not found' };

      const { data: touchpoints } = await supabaseAdmin
        .from('affiliate_touchpoints')
        .select('session_id, is_duplicate, is_bot')
        .eq('referral_code', aff.referral_code)
        .gte('clicked_at', since);

      const clean = (touchpoints || []).filter((t: any) => !t.is_bot && !t.is_duplicate);
      const uniqueSessions = new Set(clean.map((t: any) => t.session_id)).size;

      const { data: bookings } = await supabaseAdmin
        .from('bookings')
        .select('id, status, total_price, influencer_commission')
        .eq('affiliate_id', aff.id)
        .gte('created_at', since);

      const conversions = (bookings || []).filter((b: any) =>
        ['confirmed', 'completed', 'fully_paid'].includes(b.status),
      );
      const revenue = conversions.reduce((s: number, b: any) => s + (b.total_price || 0), 0);
      const commission = conversions.reduce(
        (s: number, b: any) => s + (b.influencer_commission || 0),
        0,
      );

      return {
        affiliate: aff,
        period_days: days,
        clicks: clean.length,
        unique_visitors: uniqueSessions,
        conversions: conversions.length,
        revenue,
        commission,
      };
    }

    case 'detect_anomaly': {
      const query = supabaseAdmin
        .from('agent_actions')
        .select('id, summary, payload, priority, created_at')
        .eq('action_type', 'notify_affiliate_anomaly')
        .in('status', ['pending', 'approved'])
        .order('created_at', { ascending: false })
        .limit(20);
      const { data, error } = await query;
      if (error) throw error;
      if (args.affiliate_id) {
        return (data || []).filter((a: any) => a.payload?.affiliate_id === args.affiliate_id);
      }
      return data;
    }

    case 'draft_monthly_settlement': {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      const res = await fetch(`${baseUrl}/api/cron/affiliate-settlement-draft`, { method: 'GET' });
      return await res.json();
    }

    case 'list_commission_policies': {
      const activeOnly = args.active_only !== false;
      let q = supabaseAdmin
        .from('os_policies')
        .select('id, name, description, action_type, action_config, target_scope, starts_at, ends_at, is_active, priority')
        .eq('category', 'commission')
        .order('priority', { ascending: true });
      if (activeOnly) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }

    case 'preview_commission_policy': {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      const params = new URLSearchParams();
      if (args.product_id) params.set('product_id', args.product_id);
      if (args.sample) params.set('sample', String(args.sample));
      const res = await fetch(`${baseUrl}/api/policies/preview?${params}`, {
        method: 'GET',
        headers: {
          // 서버-to-서버 admin 인증 (route handler 가 isAdmin 체크)
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
        },
      });
      return await res.json();
    }

    case 'draft_commission_policy': {
      const {
        name,
        action_type,
        rate_or_cap,
        starts_at,
        ends_at,
        scope,
        exclusive,
        reason,
      } = args;

      // 검증: 캠페인은 ends_at 필수
      if (action_type === 'commission_campaign_bonus' && !ends_at) {
        return { error: '캠페인은 종료일(ends_at) 필수입니다. 사장님께 재확인 요청.' };
      }
      if (!['commission_campaign_bonus', 'commission_cap'].includes(action_type)) {
        return { error: 'action_type 은 commission_campaign_bonus 또는 commission_cap 만 허용' };
      }

      const action_config: Record<string, unknown> =
        action_type === 'commission_cap'
          ? { max_rate: Number(rate_or_cap) }
          : { rate: Number(rate_or_cap), ...(exclusive ? { exclusive: true } : {}) };

      const payload = {
        category: 'commission',
        name,
        action_type,
        action_config,
        target_scope: scope || { all: true },
        starts_at,
        ends_at: ends_at || null,
        is_active: false, // 사장님 승인 후 활성
        priority: action_type === 'commission_cap' ? 999 : 100,
        _reason: reason,
      };

      const { data: action, error } = await supabaseAdmin
        .from('agent_actions')
        .insert({
          action_type: 'create_commission_policy',
          status: 'pending',
          priority: action_type === 'commission_cap' ? 'high' : 'normal',
          summary: `[커미션 정책 기안] ${name} (${action_type === 'commission_cap' ? `캡 ${rate_or_cap * 100}%` : `+${rate_or_cap * 100}%`})`,
          payload,
        } as never)
        .select()
        .single();
      if (error) throw error;
      return action;
    }

    case 'send_content_24h_report': {
      // 발행 후 24h 경과 콘텐츠 = published_at IS NOT NULL AND published_at < now()-24h
      // 미발행 draft 도 같이 (created_at 기준)
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      let q = supabaseAdmin
        .from('content_distributions')
        .select('id, affiliate_id, product_id, platform, status, created_at')
        .not('affiliate_id', 'is', null)
        .lt('created_at', since)
        .gt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .limit(50);
      if (args.affiliate_id) q = q.eq('affiliate_id', args.affiliate_id);
      const { data: contents, error } = await q;
      if (error) throw error;

      // 콘텐츠별 예약 매칭
      const contentIds = (contents || []).map((c: { id: string }) => c.id);
      const { data: bookings } = await supabaseAdmin
        .from('bookings')
        .select('content_creative_id, total_price, influencer_commission')
        .in('content_creative_id', contentIds.length > 0 ? contentIds : ['00000000-0000-0000-0000-000000000000']);

      type ReportRow = {
        content_id: string;
        affiliate_id: string;
        platform: string;
        bookings: number;
        revenue: number;
        commission: number;
      };

      const reportRows: ReportRow[] = (contents || []).map((c: { id: string; affiliate_id: string; platform: string }) => {
        const matched = (bookings || []).filter(
          (b: { content_creative_id: string }) => b.content_creative_id === c.id,
        );
        return {
          content_id: c.id,
          affiliate_id: c.affiliate_id,
          platform: c.platform,
          bookings: matched.length,
          revenue: matched.reduce((s: number, b: { total_price: number }) => s + (Number(b.total_price) || 0), 0),
          commission: matched.reduce((s: number, b: { influencer_commission: number }) => s + (Number(b.influencer_commission) || 0), 0),
        };
      });

      // 어필리에이터별 그룹핑하여 agent_action 기안
      const byAff = new Map<string, ReportRow[]>();
      for (const r of reportRows) {
        const arr = byAff.get(r.affiliate_id) || [];
        arr.push(r);
        byAff.set(r.affiliate_id, arr);
      }

      const drafts: unknown[] = [];
      for (const [affiliate_id, rows] of byAff.entries()) {
        const totalBookings = rows.reduce((s: number, r: ReportRow) => s + r.bookings, 0);
        const totalCommission = rows.reduce((s: number, r: ReportRow) => s + r.commission, 0);
        if (totalBookings === 0) continue; // 0건이면 스팸 방지

        const { data: draft } = await supabaseAdmin
          .from('agent_actions')
          .insert({
            action_type: 'send_alimtalk',
            status: 'pending',
            priority: 'normal',
            summary: `[24h 콘텐츠 리포트] 콘텐츠 ${rows.length}개 / 예약 ${totalBookings}건 / 커미션 ${Math.round(totalCommission / 10000)}만원`,
            payload: {
              affiliate_id,
              template: 'content_24h_report',
              data: { rows, totalBookings, totalCommission },
            },
          } as never)
          .select()
          .single();
        drafts.push(draft);
      }

      return { drafts_count: drafts.length, drafts };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export async function runAffiliateAgent(params: AgentRunParams): Promise<AgentRunResult> {
  return runDeepSeekAgentLoop(
    {
      agentType: 'finance',
      systemPrompt: AFFILIATE_PROMPT,
      tools: AFFILIATE_TOOLS,
      executeTool,
    },
    params,
  );
}
