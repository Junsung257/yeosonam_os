import { supabaseAdmin } from '@/lib/supabase'
import { SALES_PROMPT } from '../prompts'
import { AgentRunParams, AgentRunResult } from '../types'
import { runDeepSeekAgentLoop } from '../deepseek-agent-loop'

const SALES_TOOLS_RAW = [
  {
    name: 'list_affiliates',
    description: '제휴 파트너 목록을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: '상태 (active/inactive)' },
        type: { type: 'string', description: '타입 (influencer/agency/corporate)' },
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'get_affiliate_performance',
    description: '제휴 파트너 성과를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        affiliate_id: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' }
      }
    }
  },
  {
    name: 'create_settlement',
    description: '제휴 정산을 실행합니다. (승인 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['target_id', 'target_type', 'amount'],
      properties: {
        target_id: { type: 'string' },
        target_type: { type: 'string' },
        amount: { type: 'number' },
        period_from: { type: 'string' },
        period_to: { type: 'string' },
        memo: { type: 'string' }
      }
    }
  },
  {
    name: 'list_rfqs',
    description: '단체 RFQ 목록을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'open/in_progress/closed/cancelled' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'update_rfq_status',
    description: 'RFQ 상태를 변경합니다. (승인 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['rfq_id', 'status'],
      properties: {
        rfq_id: { type: 'string' },
        status: { type: 'string' },
        reason: { type: 'string' }
      }
    }
  },
  {
    name: 'list_tenants',
    description: '파트너(테넌트) 목록을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  // ── Phase 2 신규: 커미션 시뮬레이션/제휴링크/인플루언서 등급 ──
  {
    name: 'simulate_commission',
    description: '인플루언서/제휴사 커미션을 시뮬레이션합니다. (읽기 전용) — 등급·매출 기반 예상 커미션',
    input_schema: {
      type: 'object' as const,
      required: ['affiliate_id', 'estimated_revenue'],
      properties: {
        affiliate_id: { type: 'string', description: '제휴사/인플루언서 ID' },
        estimated_revenue: { type: 'number', description: '예상 매출 금액' },
        custom_rate: { type: 'number', description: '커스텀 커미션율 (지정 안 하면 등급 기본율 사용)' },
      },
    },
  },
  {
    name: 'generate_affiliate_link',
    description: '제휴 추적 링크를 생성합니다. (HITL 필요) — 쿠키 기반 어트리뷰션',
    input_schema: {
      type: 'object' as const,
      required: ['affiliate_id', 'landing_url'],
      properties: {
        affiliate_id: { type: 'string' },
        landing_url: { type: 'string', description: '제휴사가 홍보할 랜딩 페이지 URL' },
        campaign_name: { type: 'string', description: '캠페인명 (선택)' },
        utm_source: { type: 'string', description: 'utm_source (기본: affiliate)' },
      },
    },
  },
  {
    name: 'update_influencer_tier',
    description: '인플루언서 등급을 변경합니다. (HITL 필요, 위험도 높음)',
    input_schema: {
      type: 'object' as const,
      required: ['affiliate_id', 'new_tier'],
      properties: {
        affiliate_id: { type: 'string' },
        new_tier: { type: 'string', description: 'Bronze / Silver / Gold / Diamond' },
        reason: { type: 'string', description: '등급 변경 사유' },
      },
    },
  },
  {
    name: 'list_commission_history',
    description: '제휴사/인플루언서 커미션 지급 이력을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        affiliate_id: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        status: { type: 'string', description: 'pending/paid/cancelled' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'get_rfq_detail',
    description: '단체 RFQ 상세 정보를 조회합니다. (제안·메모 포함)',
    input_schema: {
      type: 'object' as const,
      required: ['rfq_id'],
      properties: {
        rfq_id: { type: 'string' },
      },
    },
  },
  {
    name: 'create_rfq_proposal',
    description: 'RFQ에 대한 견적 제안서를 제출합니다. (HITL 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['rfq_id', 'proposal_text', 'estimated_cost'],
      properties: {
        rfq_id: { type: 'string' },
        proposal_text: { type: 'string', description: '견적 제안 내용' },
        estimated_cost: { type: 'number', description: '예상 견적 금액' },
        valid_until: { type: 'string', description: '견적 유효기간 (YYYY-MM-DD)' },
      },
    },
  },
]

const SALES_TOOLS = SALES_TOOLS_RAW as unknown[]

async function executeTool(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'list_affiliates': {
      let query = supabaseAdmin
        .from('affiliates')
        .select('id, name, code, type, tier, status, total_revenue, total_commission, created_at')
        .order('created_at', { ascending: false })
        .limit(args.limit || 10)
      if (args.status) query = query.eq('status', args.status)
      if (args.type) query = query.eq('type', args.type)
      if (args.query) query = query.ilike('name', `%${args.query}%`)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'get_affiliate_performance': {
      if (!args.affiliate_id) throw new Error('affiliate_id 필수')
      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('*')
        .eq('id', args.affiliate_id)
        .limit(1)
      let bookingQuery = supabaseAdmin
        .from('bookings')
        .select('id, total_price, status, created_at')
        .eq('affiliate_id', args.affiliate_id)
      if (args.date_from) bookingQuery = bookingQuery.gte('created_at', args.date_from)
      if (args.date_to) bookingQuery = bookingQuery.lte('created_at', args.date_to)
      const { data: bookings } = await bookingQuery
      return {
        affiliate: affiliate?.[0],
        bookings: bookings?.length || 0,
        totalRevenue: bookings?.reduce((s: number, b: any) => s + (b.total_price || 0), 0) || 0,
      }
    }
    case 'list_rfqs': {
      let query = supabaseAdmin
        .from('rfqs')
        .select('id, title, status, group_size, destination, travel_date, budget, created_at')
        .order('created_at', { ascending: false })
        .limit(args.limit || 10)
      if (args.status) query = query.eq('status', args.status)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'list_tenants': {
      let query = supabaseAdmin
        .from('tenants')
        .select('id, name, slug, status, plan, created_at')
        .order('created_at', { ascending: false })
        .limit(args.limit || 10)
      if (args.status) query = query.eq('status', args.status)
      if (args.query) query = query.ilike('name', `%${args.query}%`)
      const { data, error } = await query
      if (error) throw error
      return data
    }

    // ── Phase 2 신규 Tool ──
    case 'simulate_commission': {
      const { data: affiliate } = await supabaseAdmin.from('affiliates').select('id, name, tier, commission_rate').eq('id', args.affiliate_id).limit(1)
      if (!affiliate?.[0]) throw new Error('제휴사를 찾을 수 없습니다')
      const a = affiliate[0] as { id: string; name: string; tier: string; commission_rate: number | null }
      const rate = args.custom_rate ?? (a.commission_rate ?? { Bronze: 0.03, Silver: 0.04, Gold: 0.06, Diamond: 0.08 }[a.tier] ?? 0.05)
      return { affiliate_name: a.name, tier: a.tier, rate, estimated_revenue: args.estimated_revenue, estimated_commission: Math.round(args.estimated_revenue * rate), note: '※ 추정치입니다. 실제 정산은 정책 기준을 따릅니다.' }
    }
    case 'generate_affiliate_link': {
      const summary = `[제휴링크 생성] ${args.affiliate_id} → ${args.landing_url}`
      const { data: action, error } = await supabaseAdmin.from('agent_actions').insert({ agent_type: 'sales', action_type: 'create_affiliate_link', summary, payload: { ...args, requested_at: new Date().toISOString() }, requested_by: 'jarvis', priority: 'normal' }).select()
      if (error) throw error
      return { proposed: true, action_id: action?.[0]?.id, summary }
    }
    case 'update_influencer_tier': {
      if (!['Bronze', 'Silver', 'Gold', 'Diamond'].includes(args.new_tier)) throw new Error(`유효하지 않은 등급: ${args.new_tier}`)
      const { data: before } = await supabaseAdmin.from('affiliates').select('tier, commission_rate').eq('id', args.affiliate_id).single()
      const tierRates: Record<string, number> = { Bronze: 0.03, Silver: 0.04, Gold: 0.06, Diamond: 0.08 }
      const baseRate = tierRates[args.new_tier]
      const summary = `[인플루언서 등급 변경] ID:${args.affiliate_id} ${(before as Record<string, unknown>)?.tier} → ${args.new_tier} (커미션 ${(((before as Record<string, unknown>)?.commission_rate as number) ?? 0) * 100}% → ${(baseRate ?? 0) * 100}%) | 사유: ${args.reason}`
      const { data: action, error } = await supabaseAdmin.from('agent_actions').insert({ agent_type: 'sales', action_type: 'update_influencer_tier', summary, payload: { affiliate_id: args.affiliate_id, before_tier: (before as Record<string, unknown>)?.tier, after_tier: args.new_tier, reason: args.reason }, requested_by: 'jarvis', priority: 'high' }).select()
      if (error) throw error
      return { proposed: true, action_id: action?.[0]?.id, summary }
    }
    case 'list_commission_history': {
      let query = supabaseAdmin.from('commission_history').select('*').order('created_at', { ascending: false }).limit(args.limit || 20)
      if (args.affiliate_id) query = query.eq('affiliate_id', args.affiliate_id)
      if (args.date_from) query = query.gte('created_at', args.date_from)
      if (args.date_to) query = query.lte('created_at', args.date_to)
      if (args.status) query = query.eq('status', args.status)
      const { data, error } = await query
      if (error) throw error
      return data ?? []
    }
    case 'get_rfq_detail': {
      const { data, error } = await supabaseAdmin.from('rfqs').select('*, rfq_proposals(*)').eq('id', args.rfq_id).limit(1)
      if (error) throw error
      return data?.[0] ?? null
    }
    case 'create_rfq_proposal': {
      const summary = `[RFQ 제안] ${args.rfq_id} — ${args.estimated_cost?.toLocaleString()}원 | ${args.proposal_text?.slice(0, 50)}...`
      const { data: action, error } = await supabaseAdmin.from('agent_actions').insert({ agent_type: 'sales', action_type: 'submit_rfq_proposal', summary, payload: { ...args, requested_at: new Date().toISOString() }, requested_by: 'jarvis', priority: 'normal' }).select()
      if (error) throw error
      return { proposed: true, action_id: action?.[0]?.id, summary }
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

// V2 (gemini-agent-loop-v2.ts) 공유 export
export { SALES_TOOLS, SALES_TOOLS_RAW }
export { executeTool as executeSalesTool }

export async function runSalesAgent(params: AgentRunParams): Promise<AgentRunResult> {
  return runDeepSeekAgentLoop({
    agentType: 'sales',
    systemPrompt: SALES_PROMPT,
    tools: SALES_TOOLS,
    executeTool,
  }, params)
}
