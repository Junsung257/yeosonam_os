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
  {
    name: 'find_duplicate_customers',
    description: '중복 가능성 높은 고객을 검색합니다. 이름·전화번호 유사도 기반, 읽기 전용.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: '검색할 이름 (선택)' },
        phone: { type: 'string', description: '검색할 전화번호 (선택)' },
        scan_all: { type: 'boolean', description: 'true면 전체 고객 테이블에서 중복 클러스터 탐색' },
        limit: { type: 'number', description: '결과 개수 (기본 20)' }
      }
    }
  },
  {
    name: 'propose_merge_customers',
    description: '두 고객을 병합할 기안서를 agent_actions 승인 큐에 제출합니다. 실제 병합은 승인 후 실행됩니다.',
    input_schema: {
      type: 'object' as const,
      required: ['primary_id', 'duplicate_id', 'reason'],
      properties: {
        primary_id: { type: 'string', description: '살릴 고객 ID (상세 이력이 많은 쪽)' },
        duplicate_id: { type: 'string', description: '병합될(삭제될) 고객 ID' },
        reason: { type: 'string', description: '병합 사유' }
      }
    }
  },
  {
    name: 'get_recent_errors',
    description: '최근 자비스 실패/거절 작업을 조회합니다. 사장님이 "최근 뭐 에러났어?" 같은 질문 시 사용.',
    input_schema: {
      type: 'object' as const,
      properties: {
        hours: { type: 'number', description: '몇 시간 이내 (기본 24)' },
        limit: { type: 'number', description: '결과 개수 (기본 10)' }
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
    case 'find_duplicate_customers': {
      const { findDuplicateCustomers } = await import('@/lib/supabase')
      const { normalizeName, nameSimilarity, NAME_MATCH_THRESHOLD } = await import('@/lib/customer-name')
      const limit = args.limit || 20

      // 모드 1: 특정 이름/전화로 중복 탐색
      if (!args.scan_all && (args.name || args.phone)) {
        const result = await findDuplicateCustomers({ name: args.name, phone: args.phone })
        return { mode: 'targeted', ...result }
      }

      // 모드 2: 전체 스캔 — 이름 prefix 그룹핑으로 클러스터 탐색
      const { data: all } = await supabaseAdmin
        .from('customers')
        .select('id, name, phone, booking_count, total_spent, created_at')
        .is('deleted_at', null)
        .limit(2000)

      const rows = (all ?? []) as Array<{
        id: string; name: string; phone: string | null;
        booking_count: number | null; total_spent: number | null; created_at: string;
      }>

      // prefix 2자로 버킷 분리 → O(N) 아닌 O(N × bucket_size)
      const buckets = new Map<string, typeof rows>()
      for (const c of rows) {
        const key = normalizeName(c.name).slice(0, 2)
        if (!key) continue
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key)!.push(c)
      }

      const clusters: Array<{
        primary: typeof rows[number];
        duplicates: Array<typeof rows[number] & { similarity: number }>;
      }> = []

      for (const bucket of buckets.values()) {
        if (bucket.length < 2) continue
        for (let i = 0; i < bucket.length; i++) {
          const dups: Array<typeof rows[number] & { similarity: number }> = []
          for (let j = i + 1; j < bucket.length; j++) {
            const sim = nameSimilarity(bucket[i].name, bucket[j].name)
            if (sim >= NAME_MATCH_THRESHOLD) {
              dups.push({ ...bucket[j], similarity: sim })
            }
          }
          if (dups.length > 0) {
            clusters.push({ primary: bucket[i], duplicates: dups })
          }
        }
      }

      // primary 후보 추천: booking_count + total_spent 큰 쪽
      clusters.sort((a, b) =>
        (b.duplicates.length) - (a.duplicates.length)
        || ((b.primary.booking_count || 0) + (b.primary.total_spent || 0) / 10000)
         - ((a.primary.booking_count || 0) + (a.primary.total_spent || 0) / 10000),
      )

      return { mode: 'scan_all', clusters: clusters.slice(0, limit), total_found: clusters.length }
    }
    case 'get_recent_errors': {
      const hours = args.hours || 24
      const limit = args.limit || 10
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

      // agent_actions 실패/거절 + jarvis_tool_logs 에러 결과 둘 다 조회
      const [actionsRes, logsRes] = await Promise.all([
        supabaseAdmin
          .from('agent_actions')
          .select('id, action_type, summary, status, reject_reason, result_log, created_at')
          .in('status', ['rejected', 'failed'])
          .gte('created_at', cutoff)
          .order('created_at', { ascending: false })
          .limit(limit),
        supabaseAdmin
          .from('jarvis_tool_logs')
          .select('id, tool_name, tool_args, result, executed_at')
          .gte('executed_at', cutoff)
          .order('executed_at', { ascending: false })
          .limit(limit * 2),
      ])

      const failedActions = actionsRes.data ?? []
      // tool_logs에서 result.error 있는 것만 필터
      const toolErrors = ((logsRes.data ?? []) as any[]).filter(l => l.result && l.result.error)

      return {
        window_hours: hours,
        failed_action_count: failedActions.length,
        failed_actions: failedActions,
        tool_error_count: toolErrors.length,
        tool_errors: toolErrors.slice(0, limit),
      }
    }
    case 'propose_merge_customers': {
      // 사전 검증 (기안서 제출 전 기본 체크)
      if (!args.primary_id || !args.duplicate_id) {
        throw new Error('primary_id와 duplicate_id 필수')
      }
      if (args.primary_id === args.duplicate_id) {
        throw new Error('동일 고객 병합 불가')
      }

      const { data: pair } = await supabaseAdmin
        .from('customers')
        .select('id, name, phone, booking_count, total_spent, deleted_at')
        .in('id', [args.primary_id, args.duplicate_id])

      const primary = (pair ?? []).find((c: any) => c.id === args.primary_id) as any
      const duplicate = (pair ?? []).find((c: any) => c.id === args.duplicate_id) as any
      if (!primary || !duplicate) throw new Error('고객 조회 실패')

      const summary = `[병합 제안] ${duplicate.name}(${duplicate.booking_count || 0}건) → ${primary.name}(${primary.booking_count || 0}건) | 사유: ${args.reason}`

      const { data: action, error } = await supabaseAdmin
        .from('agent_actions')
        .insert({
          agent_type: 'operations',
          action_type: 'merge_customers',
          summary,
          payload: {
            primary_id: args.primary_id,
            duplicate_id: args.duplicate_id,
            primary_snapshot: primary,
            duplicate_snapshot: duplicate,
            reason: args.reason,
          },
          requested_by: 'jarvis',
          priority: 'normal',
        })
        .select()

      if (error) throw error
      return { proposed: true, action_id: action?.[0]?.id, summary }
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
