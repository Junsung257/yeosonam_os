import { supabaseAdmin } from '@/lib/supabase'
import { FINANCE_PROMPT } from '../prompts'
import { AgentRunParams, AgentRunResult } from '../types'
import { runGeminiAgentLoop } from '../gemini-agent-loop'
import { convertTools } from '../gemini-tool-format'

const FINANCE_TOOLS_RAW = [
  {
    name: 'get_dashboard_kpi',
    description: '대시보드 KPI를 조회합니다 (월매출, 예약수, 캐시플로).',
    input_schema: {
      type: 'object' as const,
      properties: {
        month: { type: 'string', description: '조회 월 (YYYY-MM, 기본 이번달)' }
      }
    }
  },
  {
    name: 'get_cashflow_forecast',
    description: '6개월 캐시플로 예측을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        months: { type: 'number', description: '예측 기간 (기본 6개월)' }
      }
    }
  },
  {
    name: 'list_ledger',
    description: '통합 장부를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_from: { type: 'string', description: '시작일 (YYYY-MM-DD)' },
        date_to: { type: 'string', description: '종료일 (YYYY-MM-DD)' },
        category: { type: 'string', description: '카테고리 (수입/지출)' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'get_tax_summary',
    description: '세무 현황을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        year: { type: 'number', description: '조회 연도' },
        quarter: { type: 'number', description: '분기 (1-4)' }
      }
    }
  },
  {
    name: 'list_settlements',
    description: '정산 목록을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: '정산 상태 (pending/completed)' },
        target_type: { type: 'string', description: '정산 대상 (land_operator/affiliate)' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'create_settlement',
    description: '정산을 실행합니다. (승인 필요, 위험도 높음)',
    input_schema: {
      type: 'object' as const,
      required: ['target_id', 'target_type', 'amount'],
      properties: {
        target_id: { type: 'string', description: '정산 대상 ID' },
        target_type: { type: 'string', description: 'land_operator 또는 affiliate' },
        amount: { type: 'number', description: '정산 금액' },
        period_from: { type: 'string' },
        period_to: { type: 'string' },
        memo: { type: 'string' }
      }
    }
  },
  {
    name: 'list_pending_settlements',
    description: '정산 확정이 안 된 예약 목록을 조회합니다. 출발일 기준 N일 이상 지난 건만 필터 가능. 읽기 전용.',
    input_schema: {
      type: 'object' as const,
      properties: {
        days_after_departure: { type: 'number', description: '출발 후 최소 N일 경과 (기본 7)' },
        limit: { type: 'number', description: '최대 개수 (기본 50)' }
      }
    }
  },
  {
    name: 'propose_bulk_confirm_settlements',
    description: '선택한 예약들의 정산을 일괄 확정 처리합니다. agent_actions 승인 큐 경유 (위험도 보통).',
    input_schema: {
      type: 'object' as const,
      required: ['booking_ids', 'reason'],
      properties: {
        booking_ids: { type: 'array', items: { type: 'string' }, description: '확정할 예약 ID 배열' },
        reason: { type: 'string', description: '일괄 확정 사유 (예: 출발 1주일 지나고 장부 대조 완료)' }
      }
    }
  },
]

const FINANCE_TOOLS = convertTools(FINANCE_TOOLS_RAW)

async function executeTool(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'get_dashboard_kpi': {
      const month = args.month || new Date().toISOString().slice(0, 7)
      const startDate = `${month}-01`
      const endDate = `${month}-31`
      const { data: bookings } = await supabaseAdmin
        .from('bookings')
        .select('total_price, paid_amount, status')
        .gte('created_at', startDate)
        .lte('created_at', endDate)
      const totalRevenue = bookings?.reduce((sum: number, b: any) => sum + (b.paid_amount || 0), 0) || 0
      const bookingCount = bookings?.length || 0
      const fullyPaidCount = bookings?.filter((b: any) => b.status === 'fully_paid').length || 0
      return { month, totalRevenue, bookingCount, fullyPaidCount }
    }
    case 'get_cashflow_forecast': {
      const { data } = await supabaseAdmin
        .from('bookings')
        .select('total_price, paid_amount, departure_date')
        .gte('departure_date', new Date().toISOString().slice(0, 10))
        .order('departure_date', { ascending: true })
        .limit(100)
      const upcoming = data?.reduce((sum: number, b: any) => sum + ((b.total_price || 0) - (b.paid_amount || 0)), 0) || 0
      return { upcomingReceivables: upcoming, bookingsCount: data?.length || 0 }
    }
    case 'list_ledger': {
      let query = supabaseAdmin
        .from('ledger')
        .select('*')
        .order('date', { ascending: false })
        .limit(args.limit || 20)
      if (args.date_from) query = query.gte('date', args.date_from)
      if (args.date_to) query = query.lte('date', args.date_to)
      if (args.category) query = query.eq('category', args.category)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'get_tax_summary': {
      const year = args.year || new Date().getFullYear()
      const { data } = await supabaseAdmin
        .from('settlements')
        .select('amount, tax_amount, status, created_at')
        .gte('created_at', `${year}-01-01`)
        .lte('created_at', `${year}-12-31`)
      const totalSettled = data?.reduce((sum: number, s: any) => sum + (s.amount || 0), 0) || 0
      const totalTax = data?.reduce((sum: number, s: any) => sum + (s.tax_amount || 0), 0) || 0
      return { year, totalSettled, totalTax, settlementCount: data?.length || 0 }
    }
    case 'list_settlements': {
      let query = supabaseAdmin
        .from('settlements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(args.limit || 20)
      if (args.status) query = query.eq('status', args.status)
      if (args.target_type) query = query.eq('target_type', args.target_type)
      if (args.date_from) query = query.gte('created_at', args.date_from)
      if (args.date_to) query = query.lte('created_at', args.date_to)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'list_pending_settlements': {
      const daysAfter = typeof args.days_after_departure === 'number' ? args.days_after_departure : 7
      const cutoff = new Date(Date.now() - daysAfter * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const { data, error } = await supabaseAdmin
        .from('bookings')
        .select('id, booking_no, package_title, departure_date, paid_amount, total_paid_out, total_price, total_cost, status, customers!lead_customer_id(name)')
        .is('settlement_confirmed_at', null)
        .neq('status', 'cancelled')
        .not('departure_date', 'is', null)
        .lte('departure_date', cutoff)
        .order('departure_date', { ascending: true })
        .limit(args.limit || 50)
      if (error) throw error
      return {
        days_after_departure: daysAfter,
        count: data?.length ?? 0,
        bookings: (data ?? []).map((b: any) => ({
          id: b.id,
          booking_no: b.booking_no,
          customer: b.customers?.name,
          departure_date: b.departure_date,
          paid: b.paid_amount,
          out: b.total_paid_out,
          net: (b.paid_amount || 0) - (b.total_paid_out || 0),
          // 장부 입력 여부 → 일괄 확정 시 accrual(장부) vs cash(통장) 기준 결정에 활용
          expected_mode: (b.total_cost || 0) > 0 ? 'accrual' : 'cash',
          status: b.status,
        })),
      }
    }
    case 'propose_bulk_confirm_settlements': {
      if (!Array.isArray(args.booking_ids) || args.booking_ids.length === 0) {
        throw new Error('booking_ids 배열 필수')
      }
      if (!args.reason) throw new Error('reason 필수')

      const { data: sample } = await supabaseAdmin
        .from('bookings')
        .select('id, booking_no, departure_date, paid_amount, total_paid_out')
        .in('id', args.booking_ids.slice(0, 200))

      const summary = `[일괄 정산확정] ${args.booking_ids.length}건 — ${args.reason}`

      const { data: action, error } = await supabaseAdmin
        .from('agent_actions')
        .insert({
          agent_type: 'finance',
          action_type: 'bulk_confirm_settlements',
          summary,
          payload: {
            booking_ids: args.booking_ids,
            reason: args.reason,
            sample: (sample ?? []).slice(0, 10),
            total: args.booking_ids.length,
          },
          requested_by: 'jarvis',
          priority: 'normal',
        })
        .select()

      if (error) throw error
      return { proposed: true, action_id: action?.[0]?.id, summary, total: args.booking_ids.length }
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

// V2 (gemini-agent-loop-v2.ts) 공유 export
export { FINANCE_TOOLS, FINANCE_TOOLS_RAW }
export { executeTool as executeFinanceTool }

export async function runFinanceAgent(params: AgentRunParams): Promise<AgentRunResult> {
  return runGeminiAgentLoop({
    agentType: 'finance',
    systemPrompt: FINANCE_PROMPT,
    tools: FINANCE_TOOLS,
    executeTool,
  }, params)
}
