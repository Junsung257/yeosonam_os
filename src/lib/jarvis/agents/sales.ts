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
]

const SALES_TOOLS = SALES_TOOLS_RAW as any

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
