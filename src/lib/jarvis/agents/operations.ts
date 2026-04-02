import { supabaseAdmin } from '@/lib/supabase'
import { OPERATIONS_PROMPT } from '../prompts'
import { AgentRunParams, AgentRunResult } from '../types'
import { runGeminiAgentLoop } from '../gemini-agent-loop'
import { convertTools } from '../gemini-tool-format'

const OPERATIONS_TOOLS_RAW = [
  {
    name: 'search_bookings',
    description: '예약 목록을 조회합니다. 상태, 날짜, 고객명으로 필터링 가능합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: '예약 상태 (pending/deposit_paid/fully_paid 등)' },
        customer_name: { type: 'string', description: '고객명 검색어' },
        departure_from: { type: 'string', description: '출발일 시작 (YYYY-MM-DD)' },
        departure_to: { type: 'string', description: '출발일 끝 (YYYY-MM-DD)' },
        limit: { type: 'number', description: '조회 개수 (기본 10)' }
      }
    }
  },
  {
    name: 'get_booking_detail',
    description: '예약 상세 정보를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        booking_id: { type: 'string', description: '예약 ID (UUID)' },
        booking_no: { type: 'string', description: '예약 번호 (B-001 형식)' }
      }
    }
  },
  {
    name: 'create_booking',
    description: '신규 예약을 생성합니다. (승인 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['package_id', 'lead_customer_id', 'departure_date', 'adult_count'],
      properties: {
        package_id: { type: 'string' },
        lead_customer_id: { type: 'string' },
        departure_date: { type: 'string' },
        adult_count: { type: 'number' },
        child_count: { type: 'number' },
        infant_count: { type: 'number' },
        departing_location_id: { type: 'string' }
      }
    }
  },
  {
    name: 'update_booking_status',
    description: '예약 상태를 변경합니다. (승인 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['booking_id', 'status'],
      properties: {
        booking_id: { type: 'string' },
        status: { type: 'string', description: 'pending/waiting_deposit/deposit_paid/waiting_balance/fully_paid/cancelled' },
        reason: { type: 'string', description: '변경 사유' }
      }
    }
  },
  {
    name: 'search_customers',
    description: '고객을 이름, 전화번호, 등급으로 검색합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: '검색어 (이름 또는 전화번호)' },
        grade: { type: 'string', description: '등급 필터' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'create_customer',
    description: '신규 고객을 등록합니다. (승인 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['name', 'phone'],
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        birth_date: { type: 'string' },
        passport_no: { type: 'string' },
        memo: { type: 'string' }
      }
    }
  },
  {
    name: 'update_customer',
    description: '고객 정보를 수정합니다. (승인 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['customer_id'],
      properties: {
        customer_id: { type: 'string' },
        name: { type: 'string' },
        phone: { type: 'string' },
        grade: { type: 'string' },
        memo: { type: 'string' }
      }
    }
  },
  {
    name: 'list_unmatched_payments',
    description: '입금 매칭이 안 된 거래 목록을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: { limit: { type: 'number' } }
    }
  },
  {
    name: 'match_payment',
    description: '입금 거래를 예약에 매칭합니다. (승인 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['transaction_id', 'booking_id'],
      properties: {
        transaction_id: { type: 'string' },
        booking_id: { type: 'string' },
        match_type: { type: 'string', description: 'deposit 또는 balance' }
      }
    }
  },
  {
    name: 'send_booking_guide',
    description: '예약 안내문을 발송합니다. (승인 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['booking_id'],
      properties: {
        booking_id: { type: 'string' },
        guide_type: { type: 'string', description: 'deposit_notice/balance_notice/travel_guide' }
      }
    }
  },
]

const OPERATIONS_TOOLS = convertTools(OPERATIONS_TOOLS_RAW)

async function executeTool(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'search_bookings': {
      let query = supabaseAdmin
        .from('bookings')
        .select('id, booking_no, status, departure_date, adult_count, total_price, paid_amount, created_at')
        .order('created_at', { ascending: false })
        .limit(args.limit || 10)
      if (args.status) query = query.eq('status', args.status)
      if (args.departure_from) query = query.gte('departure_date', args.departure_from)
      if (args.departure_to) query = query.lte('departure_date', args.departure_to)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'get_booking_detail': {
      let query = supabaseAdmin
        .from('bookings')
        .select('*')
      if (args.booking_id) query = query.eq('id', args.booking_id)
      if (args.booking_no) query = query.eq('booking_no', args.booking_no)
      const { data, error } = await query.limit(1)
      if (error) throw error
      return data?.[0] || null
    }
    case 'search_customers': {
      let query = supabaseAdmin
        .from('customers')
        .select('id, name, phone, grade, status, mileage, booking_count')
        .limit(args.limit || 10)
      if (args.query) {
        query = query.or(`name.ilike.%${args.query}%,phone.ilike.%${args.query}%`)
      }
      if (args.grade) query = query.eq('grade', args.grade)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'list_unmatched_payments': {
      const { data, error } = await supabaseAdmin
        .from('bank_transactions')
        .select('*')
        .eq('match_status', 'unmatched')
        .order('created_at', { ascending: false })
        .limit(args.limit || 20)
      if (error) throw error
      return data
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

export async function runOperationsAgent(params: AgentRunParams): Promise<AgentRunResult> {
  return runGeminiAgentLoop({
    agentType: 'operations',
    systemPrompt: OPERATIONS_PROMPT,
    tools: OPERATIONS_TOOLS,
    executeTool,
    contextExtractor: (toolName, result) => {
      if (toolName === 'search_customers' && result?.[0]) {
        return { customerId: result[0].id, customerName: result[0].name }
      }
      return {}
    },
  }, params)
}
