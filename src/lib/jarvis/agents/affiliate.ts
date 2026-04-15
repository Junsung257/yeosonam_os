import { supabaseAdmin } from '@/lib/supabase';
import { AgentRunParams, AgentRunResult } from '../types';
import { runGeminiAgentLoop } from '../gemini-agent-loop';
import { convertTools } from '../gemini-tool-format';

const AFFILIATE_PROMPT = `
## 어필리에이터/인플루언서 전용 규칙

### 권한
- 자비스는 **기안만** 가능. 실제 정산·알림은 사장님 결재함(/admin/jarvis)에서 승인 후 실행.
- 직접 settlements UPSERT 금지. 반드시 agent_actions 경유.

### 조회 질의
- "이번달 TOP 인플루언서", "홍길동 성과" → get_affiliate_performance 호출
- 수수료·매출은 만원 단위로 읽기 쉽게 제시
- 이상치 있으면 강조: "⚠️ 클릭 급증 감지"

### 답변 형식
📊 <인플루언서명> 지난 30일:
- 유효 클릭: XXX회 / 고유 방문: XXX명
- 전환: XX건 (매출 XXX만원)
- 수수료: XX만원 (등급 <등급>)

### 주의
- 민감정보(계좌·전화) 노출 금지
- 정산 실행 요청은 draft_monthly_settlement로 기안만 생성
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
];

const AFFILIATE_TOOLS = convertTools(AFFILIATE_TOOLS_RAW);

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
      let query = supabaseAdmin
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

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export async function runAffiliateAgent(params: AgentRunParams): Promise<AgentRunResult> {
  return runGeminiAgentLoop(
    {
      agentType: 'finance',
      systemPrompt: AFFILIATE_PROMPT,
      tools: AFFILIATE_TOOLS,
      executeTool,
    },
    params,
  );
}
