import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'
import { isValidTransition } from '@/lib/agent-action-machine'
import { executeAction } from '@/lib/agent-action-executor'

// ── 화이트리스트 ────────────────────────────────────────────────────
const VALID_AGENT_TYPES = ['operations', 'sales', 'marketing', 'finance', 'products', 'system'] as const
const VALID_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const

// ── GET: 액션 목록 조회 ─────────────────────────────────────────────
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ actions: [], total: 0 })
  }

  try {
    const { searchParams } = request.nextUrl
    const status = searchParams.get('status') || 'pending'
    const agentType = searchParams.get('agent_type')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')))
    const offset = (page - 1) * limit

    let query = supabaseAdmin
      .from('agent_actions')
      .select('*', { count: 'exact' })

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

    return NextResponse.json({
      actions: data ?? [],
      total: count ?? 0,
      page,
      limit,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    )
  }
}

// ── POST: 새 액션 등록 (에이전트가 기안서 제출) ─────────────────────
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 },
    )
  }

  try {
    const body = await request.json()
    const { agent_type, action_type, summary, payload, requested_by, priority, expires_at } = body

    // 필수 필드 검증
    if (!agent_type || !action_type || !summary) {
      return NextResponse.json(
        { error: 'agent_type, action_type, summary는 필수입니다.' },
        { status: 400 },
      )
    }

    // agent_type 검증
    if (!VALID_AGENT_TYPES.includes(agent_type)) {
      return NextResponse.json(
        { error: `잘못된 agent_type: ${agent_type}` },
        { status: 400 },
      )
    }

    // priority 검증
    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return NextResponse.json(
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

    return NextResponse.json({ action: data?.[0], success: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '등록 실패' },
      { status: 500 },
    )
  }
}

// ── PATCH: 상태 변경 (승인/반려) ────────────────────────────────────
export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 },
    )
  }

  try {
    const body = await request.json()
    const { action_id, action, reject_reason, reviewed_by } = body

    if (!action_id || !action) {
      return NextResponse.json(
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
      return NextResponse.json({ error: '액션을 찾을 수 없습니다.' }, { status: 404 })
    }

    // 전이 대상 상태 결정
    let targetStatus = action === 'approve' ? 'approved' : 'rejected'

    // 전이 유효성 검증
    if (!isValidTransition(current.status, targetStatus)) {
      return NextResponse.json(
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

    return NextResponse.json({ action: data?.[0], success: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '상태 변경 실패' },
      { status: 500 },
    )
  }
}
