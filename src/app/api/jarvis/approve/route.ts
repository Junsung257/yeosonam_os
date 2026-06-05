import type { NextRequest } from 'next/server'
import { apiResponse } from '@/lib/api-response'
import { supabaseAdmin } from '@/lib/supabase'
import { executeAction } from '@/lib/agent-action-executor'
import { isAdminRequest, resolveAdminActorLabel } from '@/lib/admin-guard'
import { buildHitlFailurePayload, decideHitlReviewStatus } from '@/lib/jarvis/hitl-execution'

export async function POST(req: NextRequest) {
  try {
    if (!(await isAdminRequest(req))) {
      return apiResponse({ error: 'admin 권한 필요' }, { status: 403 })
    }
    const reviewer = await resolveAdminActorLabel(req)

    const { pendingActionId, approved } = await req.json()

    if (!pendingActionId) {
      return apiResponse({ error: 'pendingActionId 필수' }, { status: 400 })
    }

    // pending_action 가져오기
    const { data: pending } = await supabaseAdmin
      .from('jarvis_pending_actions')
      .select('*')
      .eq('id', pendingActionId)
      .eq('status', 'pending')
      .limit(1)

    const action = pending?.[0]
    if (!action) {
      return apiResponse({ error: '대기 중인 작업을 찾을 수 없습니다' }, { status: 404 })
    }

    if (!approved) {
      // 거절
      const decision = decideHitlReviewStatus({ approved: false })
      await supabaseAdmin
        .from('jarvis_pending_actions')
        .update({
          status: decision.nextStatus,
          approved_at: new Date().toISOString(),
          approved_by: reviewer,
        })
        .eq('id', pendingActionId)
      return apiResponse({ message: decision.message, retryable: decision.retryable })
    }

    // 승인 → 공통 실행 모듈로 위임
    try {
      const result = await executeAction(action.tool_name, action.tool_args)

      if (!result.success) {
        throw new Error(result.error || '실행 실패')
      }

      const decision = decideHitlReviewStatus({ approved: true, executionSuccess: true })
      await supabaseAdmin
        .from('jarvis_pending_actions')
        .update({
          status: decision.nextStatus,
          approved_at: new Date().toISOString(),
          approved_by: reviewer,
        })
        .eq('id', pendingActionId)

      await void(supabaseAdmin.from('jarvis_tool_logs').insert({
        session_id: action.session_id,
        tenant_id: action.tenant_id ?? null,
        agent_type: action.agent_type,
        tool_name: action.tool_name,
        tool_args: action.tool_args,
        result: result.data,
        is_hitl: true,
        pending_action_id: pendingActionId,
      }))

      await supabaseAdmin.from('audit_logs').insert({
        action: action.tool_name,
        target_type: 'jarvis',
        target_id: pendingActionId,
        after_value: action.tool_args,
      })

      return apiResponse({ message: decision.message, retryable: decision.retryable, result: result.data })
    } catch (err: any) {
      // 실행 실패 시 pending_action 은 pending 으로 유지해 재시도 가능하게 둔다.
      const errorMessage = err instanceof Error ? err.message : String(err)
      const decision = decideHitlReviewStatus({ approved: true, executionSuccess: false })
      await supabaseAdmin.from('jarvis_tool_logs').insert({
        session_id: action.session_id,
        tenant_id: action.tenant_id ?? null,
        agent_type: action.agent_type,
        tool_name: action.tool_name,
        tool_args: action.tool_args,
        result: {
          error: errorMessage,
          retryable: decision.retryable,
          next_status: decision.nextStatus,
        },
        is_hitl: true,
        pending_action_id: pendingActionId,
      })

      return apiResponse(buildHitlFailurePayload({
        error: errorMessage,
        toolName: action.tool_name,
        toolArgs: action.tool_args,
        pendingActionId,
      }), { status: 500 })
    }
  } catch (error) {
    console.error('[자비스 승인] 오류:', error)
    return apiResponse(
      {
        error: error instanceof Error ? error.message : '처리 실패',
        errorDetails: { stage: 'approve_route_outer_catch' },
      },
      { status: 500 }
    )
  }
}
