import { supabaseAdmin } from '@/lib/supabase'
import { MARKETING_PROMPT } from '../prompts'
import type { AgentRunParams } from '../types'
import { runDeepSeekAgentLoop } from '../deepseek-agent-loop'
import { getScopedClient, type JarvisContext } from '@/lib/jarvis'

// ============================================================
// Marketing Agent — Phase 2 확장 (블로그·콘텐츠·브랜드까지 풀 커버)
// ============================================================

const MARKETING_TOOLS_RAW = [
  // ── 카드뉴스/SNS ──
  {
    name: 'generate_card_news',
    description: '패키지 기반 카드뉴스를 자동 생성합니다. (승인 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['package_id'],
      properties: {
        package_id: { type: 'string', description: '패키지 ID' },
        style: { type: 'string', description: '스타일 (감성/실용/프리미엄)' },
        slide_count: { type: 'number', description: '슬라이드 수 (기본 5)' },
      },
    },
  },
  {
    name: 'generate_sns_copy',
    description: 'SNS 카피를 생성합니다. DB 저장 없이 바로 반환.',
    input_schema: {
      type: 'object' as const,
      properties: {
        package_id: { type: 'string' },
        platform: { type: 'string', description: 'instagram/blog/threads' },
        tone: { type: 'string', description: '톤 (감성/유머/정보)' },
        topic: { type: 'string', description: '자유 주제 (패키지 없을 때)' },
      },
    },
  },
  // ── 광고/캠페인 ──
  {
    name: 'get_ad_performance',
    description: '광고 성과를 조회합니다 (ROAS, 클릭, 전환).',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        platform: { type: 'string', description: 'meta/naver/google' },
      },
    },
  },
  {
    name: 'list_campaigns',
    description: '캠페인 목록을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'active/paused/completed' },
        platform: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_keyword_performance',
    description: '키워드별 광고 성과를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keyword: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  // ── 블로그 (신규 확장) ──
  {
    name: 'propose_blog_draft',
    description: '블로그 초안을 기안합니다. (승인 필요) agent_actions에 기록.',
    input_schema: {
      type: 'object' as const,
      required: ['topic'],
      properties: {
        topic: { type: 'string', description: '블로그 주제' },
        destination: { type: 'string', description: '여행지 (태깅)' },
        package_id: { type: 'string', description: '연관 상품 ID' },
        angle: { type: 'string', description: '앵글 (정보/감성/비교/체크리스트)' },
        target_length: { type: 'number', description: '목표 글자 수 (기본 2000)' },
      },
    },
  },
  {
    name: 'list_blog_posts',
    description: '블로그 게시글 목록 조회',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'draft/published/scheduled' },
        category: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_blog_performance',
    description: '블로그 성과 조회 (조회수, 공유수, 전환)',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        post_id: { type: 'string' },
      },
    },
  },
  // ── 콘텐츠 허브/검수 (신규) ──
  {
    name: 'list_content_hub_items',
    description: '콘텐츠 허브 아이템 목록 조회',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'draft/review/approved/published' },
        type: { type: 'string', description: 'blog/card_news/video/infographic' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'list_content_queue',
    description: '콘텐츠 검수 큐 조회 (승인 대기 중인 콘텐츠)',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'pending/in_review/approved/rejected' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'approve_content',
    description: '콘텐츠 검수 승인 처리합니다. (HITL 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['id'],
      properties: {
        id: { type: 'string', description: '콘텐츠 큐 ID' },
        feedback: { type: 'string', description: '승인 코멘트' },
      },
    },
  },
  // ── 브랜드/크리에이티브 (신규) ──
  {
    name: 'list_brand_kits',
    description: '브랜드 키트 목록 조회',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'list_creatives',
    description: '크리에이티브 소재 목록 조회',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string' },
        format: { type: 'string', description: 'image/video/carousel' },
        limit: { type: 'number' },
      },
    },
  },
  // ── TMP/밴드 (신규) ──
  {
    name: 'list_tmp_pipeline',
    description: 'TMP 파이프라인 상태 조회',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'pending/processing/completed/failed' },
        limit: { type: 'number' },
      },
    },
  },
  // ── 콘텐츠 갭/성과 (신규) ──
  {
    name: 'get_content_gaps',
    description: '콘텐츠 갭 분석 결과 조회 (누락된 여행지/주제)',
    input_schema: {
      type: 'object' as const,
      properties: {
        destination: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_content_analytics',
    description: '콘텐츠 성과 대시보드 조회 (총 발행, 조회수, 전환율)',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_from: { type: 'string' },
        date_to: { type: 'string' },
      },
    },
  },
  // ── 신규: 키워드 성과 + 최적화 (Phase 3) ──
  {
    name: 'get_keyword_stats',
    description: '키워드별 광고 성과 통계 조회 (클릭, 노출, CTR, CPC, 전환)',
    input_schema: {
      type: 'object' as const,
      properties: {
        keyword: { type: 'string', description: '검색어 (부분일치)' },
        platform: { type: 'string', description: 'naver/google/meta' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        limit: { type: 'number' },
        order_by: { type: 'string', description: 'clicks/impressions/cost/conversions/date' },
      },
    },
  },
  {
    name: 'get_optimization_logs',
    description: '자동 최적화 실행 로그 조회',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' },
        status: { type: 'string', description: 'success/failed/running' },
        date_from: { type: 'string' },
      },
    },
  },
  {
    name: 'get_ad_budget_summary',
    description: '광고비 지출 요약 조회 (기간별/플랫폼별)',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        group_by: { type: 'string', description: 'day/platform/campaign' },
        platform: { type: 'string' },
      },
    },
  },
  {
    name: 'run_ad_optimization',
    description: '광고 최적화 루프를 실행합니다. (HITL 필요)',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string', description: 'naver/google/meta (비우면 전체)' },
        dry_run: { type: 'boolean', description: 'true면 실제 변경 없이 시뮬레이션' },
      },
    },
  },
  {
    name: 'get_content_performance_summary',
    description: '콘텐츠 허브 전체 성과 요약 (발행수, 조회수, 전환율)',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_from: { type: 'string' },
        date_to: { type: 'string' },
      },
    },
  },
  {
    name: 'list_admin_alerts_marketing',
    description: '마케팅 관련 관리자 알림/경고 조회',
    input_schema: {
      type: 'object' as const,
      properties: {
        severity: { type: 'string', description: 'low/medium/high/critical' },
        limit: { type: 'number' },
      },
    },
  },
]

const MARKETING_TOOLS = MARKETING_TOOLS_RAW as any

async function executeTool(toolName: string, args: any, ctx?: JarvisContext): Promise<any> {
  const sb = ctx ? getScopedClient(ctx) : supabaseAdmin

  switch (toolName) {
    // ── SNS 카피 ──
    case 'generate_sns_copy': {
      if (args.package_id) {
        const { data } = await sb.from('travel_packages').select('title, destination, base_price, highlights, duration_days').eq('id', args.package_id).limit(1)
        return { package: data?.[0], platform: args.platform || 'instagram', tone: args.tone || '감성' }
      }
      return { topic: args.topic, platform: args.platform || 'instagram', tone: args.tone || '감성' }
    }

    // ── 광고 성과 ──
    case 'get_ad_performance': {
      let query = sb.from('ad_performances').select('*').order('date', { ascending: false }).limit(30)
      if (args.date_from) query = query.gte('date', args.date_from)
      if (args.date_to) query = query.lte('date', args.date_to)
      if (args.platform) query = query.eq('platform', args.platform)
      const { data, error } = await query
      if (error) throw error
      const totalSpend = data?.reduce((s: number, d: any) => s + (d.spend || 0), 0) || 0
      const totalRevenue = data?.reduce((s: number, d: any) => s + (d.revenue || 0), 0) || 0
      const totalClicks = data?.reduce((s: number, d: any) => s + (d.clicks || 0), 0) || 0
      const totalConversions = data?.reduce((s: number, d: any) => s + (d.conversions || 0), 0) || 0
      return { totalSpend, totalRevenue, roas: totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : 0, totalClicks, totalConversions, days: data?.length }
    }

    // ── 캠페인 ──
    case 'list_campaigns': {
      let query = sb.from('campaigns').select('id, name, platform, status, budget, spend, impressions, clicks, conversions, created_at').order('created_at', { ascending: false }).limit(args.limit || 10)
      if (args.status) query = query.eq('status', args.status)
      if (args.platform) query = query.eq('platform', args.platform)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── 키워드 ──
    case 'get_keyword_performance': {
      let query = sb.from('search_keywords').select('*').order('clicks', { ascending: false }).limit(args.limit || 20)
      if (args.keyword) query = query.ilike('keyword', `%${args.keyword}%`)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── 블로그 기안 ──
    case 'propose_blog_draft': {
      if (!args.topic) throw new Error('topic 필수')
      const summary = `[블로그 초안 기안] ${args.destination ? `[${args.destination}] ` : ''}${args.topic}${args.angle ? ` (${args.angle})` : ''}`
      const { data, error } = await sb.from('agent_actions').insert({
        agent_type: 'marketing',
        action_type: 'blog_draft',
        summary,
        payload: { topic: args.topic, destination: args.destination ?? null, package_id: args.package_id ?? null, angle: args.angle ?? null, target_length: args.target_length ?? 2000 },
        requested_by: 'jarvis',
        priority: 'normal',
      }).select()
      if (error) throw error
      return { proposed: true, action_id: data?.[0]?.id, summary, next_step: '관리자가 /admin/blog 에서 승인 후 발행' }
    }

    // ── 블로그 목록 ──
    case 'list_blog_posts': {
      let query = sb.from('blog_posts').select('id, title, category, status, view_count, created_at').order('created_at', { ascending: false }).limit(args.limit || 20)
      if (args.status) query = query.eq('status', args.status)
      if (args.category) query = query.eq('category', args.category)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── 블로그 성과 ──
    case 'get_blog_performance': {
      let query = sb.from('blog_performances').select('*').order('date', { ascending: false }).limit(30)
      if (args.date_from) query = query.gte('date', args.date_from)
      if (args.date_to) query = query.lte('date', args.date_to)
      if (args.post_id) query = query.eq('post_id', args.post_id)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── 콘텐츠 허브 ──
    case 'list_content_hub_items': {
      let query = sb.from('content_hub_items').select('*').order('created_at', { ascending: false }).limit(args.limit || 20)
      if (args.status) query = query.eq('status', args.status)
      if (args.type) query = query.eq('type', args.type)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── 콘텐츠 검수 큐 ──
    case 'list_content_queue': {
      let query = sb.from('content_review_queue').select('*').order('created_at', { ascending: false }).limit(args.limit || 20)
      if (args.status) query = query.eq('status', args.status)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── 콘텐츠 승인 ──
    case 'approve_content': {
      const { data, error } = await sb.from('content_review_queue').update({
        status: 'approved',
        feedback: args.feedback,
        reviewed_at: new Date().toISOString(),
      }).eq('id', args.id).select().single()
      if (error) throw error
      return data
    }

    // ── 브랜드 키트 ──
    case 'list_brand_kits': {
      const { data, error } = await sb.from('brand_kits').select('*').order('name').limit(args.limit || 20)
      if (error) throw error
      return data
    }

    // ── 크리에이티브 ──
    case 'list_creatives': {
      let query = sb.from('creatives').select('*').order('created_at', { ascending: false }).limit(args.limit || 20)
      if (args.campaign_id) query = query.eq('campaign_id', args.campaign_id)
      if (args.format) query = query.eq('format', args.format)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── TMP 파이프라인 ──
    case 'list_tmp_pipeline': {
      let query = sb.from('tmp_pipeline').select('*').order('created_at', { ascending: false }).limit(args.limit || 20)
      if (args.status) query = query.eq('status', args.status)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── 콘텐츠 갭 ──
    case 'get_content_gaps': {
      let query = sb.from('content_gaps').select('*').order('priority', { ascending: false }).limit(args.limit || 20)
      if (args.destination) query = query.eq('destination', args.destination)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── 콘텐츠 성과 ──
    case 'get_content_analytics': {
      let query = sb.from('content_analytics').select('*').order('date', { ascending: false }).limit(30)
      if (args.date_from) query = query.gte('date', args.date_from)
      if (args.date_to) query = query.lte('date', args.date_to)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── 신규 Phase 3: 키워드 통계 ──
    case 'get_keyword_stats': {
      let query = sb.from('keyword_performances').select('*').order(args.order_by || 'date', { ascending: false }).limit(args.limit || 30)
      if (args.keyword) query = query.ilike('keyword', `%${args.keyword}%`)
      if (args.platform) query = query.eq('platform', args.platform)
      if (args.date_from) query = query.gte('date', args.date_from)
      if (args.date_to) query = query.lte('date', args.date_to)
      const { data, error } = await query
      if (error) throw error
      const summary = {
        totalKeywords: data?.length || 0,
        totalClicks: data?.reduce((s: number, d: any) => s + (d.clicks || 0), 0) || 0,
        totalImpressions: data?.reduce((s: number, d: any) => s + (d.impressions || 0), 0) || 0,
        totalCost: data?.reduce((s: number, d: any) => s + (d.cost || 0), 0) || 0,
        totalConversions: data?.reduce((s: number, d: any) => s + (d.conversions || 0), 0) || 0,
        avgCtr: data?.length ? (data.reduce((s: number, d: any) => s + (d.ctr || 0), 0) / data.length).toFixed(2) : 0,
        avgCpc: data?.length ? (data.reduce((s: number, d: any) => s + (d.cpc || 0), 0) / data.length).toFixed(2) : 0,
      }
      return { summary, details: data }
    }

    // ── 최적화 로그 ──
    case 'get_optimization_logs': {
      let query = sb.from('optimization_logs').select('*').order('created_at', { ascending: false }).limit(args.limit || 20)
      if (args.status) query = query.eq('status', args.status)
      if (args.date_from) query = query.gte('created_at', args.date_from)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── 광고비 요약 ──
    case 'get_ad_budget_summary': {
      let query = sb.from('ad_performances').select('*').order('date', { ascending: false }).limit(90)
      if (args.date_from) query = query.gte('date', args.date_from)
      if (args.date_to) query = query.lte('date', args.date_to)
      if (args.platform) query = query.eq('platform', args.platform)
      const { data, error } = await query
      if (error) throw error

      // 그룹화
      const groupBy = args.group_by || 'day'
      let grouped: Record<string, any> = {}
      for (const row of data || []) {
        const key = groupBy === 'platform' ? row.platform
          : groupBy === 'campaign' ? row.campaign_name || '기타'
          : row.date
        if (!grouped[key]) grouped[key] = { key, spend: 0, revenue: 0, clicks: 0, conversions: 0 }
        grouped[key].spend += row.spend || 0
        grouped[key].revenue += row.revenue || 0
        grouped[key].clicks += row.clicks || 0
        grouped[key].conversions += row.conversions || 0
      }
      const totalSpend = Object.values(grouped).reduce((s: number, g: any) => s + g.spend, 0)
      const totalRevenue = Object.values(grouped).reduce((s: number, g: any) => s + g.revenue, 0)
      return {
        totalSpend,
        totalRevenue,
        roas: totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : '0',
        period: `${args.date_from || '최근'} ~ ${args.date_to || '최근'}`,
        breakdown: Object.values(grouped),
      }
    }

    // ── 광고 최적화 실행 ──
    case 'run_ad_optimization': {
      const { data, error } = await sb.from('agent_actions').insert({
        agent_type: 'marketing',
        action_type: 'ad_optimization',
        summary: `광고 최적화 실행: ${args.platform || '전체'}${args.dry_run ? ' (시뮬레이션)' : ''}`,
        payload: { platform: args.platform || null, dry_run: args.dry_run || false },
        requested_by: 'jarvis',
        priority: 'high',
      }).select()
      if (error) throw error
      return {
        action_id: data?.[0]?.id,
        requested: true,
        dry_run: args.dry_run || false,
        platform: args.platform || 'all',
        next_step: args.dry_run
          ? '시뮬레이션 결과는 곧 확인 가능합니다'
          : '관리자 승인 후 최적화가 실행됩니다',
      }
    }

    // ── 콘텐츠 성과 요약 ──
    case 'get_content_performance_summary': {
      let query = sb.from('content_analytics').select('*').order('date', { ascending: false }).limit(30)
      if (args.date_from) query = query.gte('date', args.date_from)
      if (args.date_to) query = query.lte('date', args.date_to)
      const { data, error } = await query
      if (error) throw error
      const totalViews = data?.reduce((s: number, d: any) => s + (d.views || 0), 0) || 0
      const totalShares = data?.reduce((s: number, d: any) => s + (d.shares || 0), 0) || 0
      const totalConversions = data?.reduce((s: number, d: any) => s + (d.conversions || 0), 0) || 0
      return {
        totalPosts: data?.length || 0,
        totalViews,
        totalShares,
        totalConversions,
        conversionRate: totalViews > 0 ? ((totalConversions / totalViews) * 100).toFixed(2) + '%' : '0%',
        details: data,
      }
    }

    // ── 마케팅 알림 ──
    case 'list_admin_alerts_marketing': {
      let query = sb.from('admin_alerts').select('*').order('created_at', { ascending: false }).limit(args.limit || 20)
      if (args.severity) query = query.eq('severity', args.severity)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

export { MARKETING_TOOLS, MARKETING_TOOLS_RAW }
export { executeTool as executeMarketingTool }

export async function runMarketingAgent(params: AgentRunParams): Promise<any> {
  return runDeepSeekAgentLoop({
    agentType: 'marketing',
    systemPrompt: MARKETING_PROMPT,
    tools: MARKETING_TOOLS,
    executeTool: (name, args) => executeTool(name, args),
  }, params)
}
