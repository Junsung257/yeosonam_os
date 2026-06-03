import { NextRequest } from 'next/server'
import { apiResponse, cacheHeader } from '@/lib/api-response'
import { withAdminGuard } from '@/lib/admin-guard'
import { sanitizeDbError } from '@/lib/error-sanitizer'
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'
import { isValidTransition } from '@/lib/agent-action-machine'
import { executeAction } from '@/lib/agent-action-executor'
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify'

// ── 화이트리스트 ────────────────────────────────────────────────────
const VALID_AGENT_TYPES = ['operations', 'sales', 'marketing', 'finance', 'products', 'system'] as const
const VALID_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const

// ── GET: 액션 목록 조회 ─────────────────────────────────────────────
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ actions: [], total: 0 })
  }

  try {
    const { searchParams } = request.nextUrl
    const status = searchParams.get('status') || 'pending'
    const agentType = searchParams.get('agent_type')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')))
    const offset = (page - 1) * limit
    const countMode = searchParams.get('count') === 'none' ? null : 'exact'
    const compact = searchParams.get('fields') === 'compact'
    const selectColumns = compact
      ? 'id, agent_type, action_type, summary, priority, status, created_at'
      : '*'

    if (compact && status === 'pending' && !agentType && page === 1 && countMode === null) {
      const { data, error } = await supabaseAdmin.rpc('get_pending_agent_actions_compact', { p_limit: limit })
      if (!error && data) {
        return apiResponse(data, { headers: cacheHeader(60) })
      }
    }

    let query = supabaseAdmin
      .from('agent_actions')
      .select(selectColumns, countMode ? { count: countMode } : undefined)

    // status 필터 (쉼표 구분 가능)
    if (status !== 'all') {
      const statuses = status.split(',').map(s => s.trim())
      query = query.in('status', statuses)
    }

    // agent_type 필터
    if (agentType) {
      query = query.eq('agent_type', agentType)
    }

    // 정렬: priority DESC (critical > high > normal > low), created_at DESC
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data, count, error } = await query
    if (error) throw error

    return apiResponse({
      actions: data ?? [],
      total: count ?? 0,
      page,
      limit,
    }, { headers: cacheHeader(60) })
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err) },
      { status: 500 },
    )
  }
}

// ── POST: 새 액션 등록 (에이전트가 기안서 제출) ─────────────────────
export async function POST(request: NextRequest) {
  // 인증 게이트 — 에이전트 액션 제출은 인증된 세션만 허용 (S2 보안 강화)
  const token = request.cookies.get('sb-access-token')?.value
  if (!token) {
    return apiResponse({ error: '인증이 필요합니다.' }, { status: 401 })
  }
  const verified = await verifySupabaseAccessToken(token)
  if (!verified.ok) {
    return apiResponse({ error: '세션이 유효하지 않습니다.' }, { status: 401 })
  }

  if (!isSupabaseConfigured) {
    return apiResponse(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 },
    )
  }

  try {
    const body = await request.json()
    const { agent_type, action_type, summary, payload, requested_by, priority, expires_at } = body

    // 필수 필드 검증
    if (!agent_type || !action_type || !summary) {
      return apiResponse(
        { error: 'agent_type, action_type, summary는 필수입니다.' },
        { status: 400 },
      )
    }

    // agent_type 검증
    if (!VALID_AGENT_TYPES.includes(agent_type)) {
      return apiResponse(
        { error: `잘못된 agent_type: ${agent_type}` },
        { status: 400 },
      )
    }

    // priority 검증
    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return apiResponse(
        { error: `잘못된 priority: ${priority}` },
        { status: 400 },
      )
    }

    const insertData: Record<string, unknown> = {
      agent_type,
      action_type,
      summary,
      payload: payload ?? {},
      requested_by: requested_by || 'jarvis',
      priority: priority || 'normal',
    }
    if (expires_at) insertData.expires_at = expires_at

    const { data, error } = await supabaseAdmin
      .from('agent_actions')
      .insert(insertData)
      .select()

    if (error) throw error

    return apiResponse({ action: data?.[0], success: true })
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err) },
      { status: 500 },
    )
  }
}

// ── PATCH: 상태 변경 (승인/반려) ────────────────────────────────────
const patchHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 },
    )
  }

  try {
    const body = await request.json()
    const { action_id, action, reject_reason, reviewed_by } = body

    if (!action_id || !action) {
      return apiResponse(
        { error: 'action_id와 action(approve|reject)은 필수입니다.' },
        { status: 400 },
      )
    }

    // 현재 상태 조회 (action_type, payload 포함)
    const { data: existing } = await supabaseAdmin
      .from('agent_actions')
      .select('id, status, action_type, payload')
      .eq('id', action_id)
      .limit(1)

    const current = existing?.[0]
    if (!current) {
      return apiResponse({ error: '액션을 찾을 수 없습니다.' }, { status: 404 })
    }

    // 전이 대상 상태 결정
    const targetStatus = action === 'approve' ? 'approved' : 'rejected'

    // 전이 유효성 검증
    if (!isValidTransition(current.status, targetStatus)) {
      return apiResponse(
        { error: `${current.status} → ${targetStatus} 전이가 허용되지 않습니다.` },
        { status: 400 },
      )
    }

    const updateData: Record<string, unknown> = {
      resolved_at: new Date().toISOString(),
      reviewed_by: reviewed_by || 'admin',
    }

    if (action === 'approve') {
       // Hobby plan 대응: 승인 즉시 실행
       const execResult = await executeAction(current.action_type, current.payload || {})
       if (execResult.success) {
         updateData.status = 'executed'
         updateData.result_log = { success: true, data: execResult.data }
       } else {
         updateData.status = 'failed'
         updateData.reject_reason = execResult.error
         updateData.result_log = { success: false, error: execResult.error }
       }
    } else if (action === 'reject') {
       updateData.status = 'rejected'
       if (reject_reason) updateData.reject_reason = reject_reason
    }

    const { data, error } = await supabaseAdmin
      .from('agent_actions')
      .update(updateData)
      .eq('id', action_id)
      .select()

    if (error) throw error

    return apiResponse({ action: data?.[0], success: true })
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err) },
      { status: 500 },
    )
  }
}

export const PATCH = withAdminGuard(patchHandler)
