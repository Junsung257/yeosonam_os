import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { executeAction } from '@/lib/agent-action-executor'

export async function POST(req: NextRequest) {
  try {
    const { pendingActionId, approved } = await req.json()

    if (!pendingActionId) {
      return NextResponse.json({ error: 'pendingActionId 필수' }, { status: 400 })
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
      return NextResponse.json({ error: '대기 중인 작업을 찾을 수 없습니다' }, { status: 404 })
    }

    if (!approved) {
      // 거절
      await supabaseAdmin
        .from('jarvis_pending_actions')
        .update({ status: 'rejected', approved_at: new Date().toISOString() })
        .eq('id', pendingActionId)
      return NextResponse.json({ message: '취소되었습니다.' })
    }

    // 승인 → 공통 실행 모듈로 위임
    try {
      const result = await executeAction(action.tool_name, action.tool_args)

      if (!result.success) {
        throw new Error(result.error || '실행 실패')
      }

      await supabaseAdmin
        .from('jarvis_pending_actions')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', pendingActionId)

      await supabaseAdmin.from('jarvis_tool_logs').insert({
        session_id: action.session_id,
        agent_type: action.agent_type,
        tool_name: action.tool_name,
        tool_args: action.tool_args,
        result: result.data,
        is_hitl: true,
        pending_action_id: pendingActionId,
      })

      await supabaseAdmin.from('audit_logs').insert({
        action: action.tool_name,
        target_type: 'jarvis',
        target_id: pendingActionId,
        after_value: action.tool_args,
      })

      return NextResponse.json({ message: '실행 완료되었습니다.', result: result.data })
    } catch (err: any) {
      // 실행 실패 시 pending_action status를 failed로 마킹 + 실패 로그 기록
      const errorMessage = err instanceof Error ? err.message : String(err)
      await supabaseAdmin
        .from('jarvis_pending_actions')
        .update({ status: 'rejected', approved_at: new Date().toISOString() })
        .eq('id', pendingActionId)
        .then(() => {}).catch(() => {})
      await supabaseAdmin.from('jarvis_tool_logs').insert({
        session_id: action.session_id,
        agent_type: action.agent_type,
        tool_name: action.tool_name,
        tool_args: action.tool_args,
        result: { error: errorMessage },
        is_hitl: true,
        pending_action_id: pendingActionId,
      }).then(() => {}).catch(() => {})

      return NextResponse.json({
        error: errorMessage,
        errorDetails: {
          toolName: action.tool_name,
          toolArgs: action.tool_args,
          pendingActionId,
        },
      }, { status: 500 })
    }
  } catch (error) {
    console.error('[자비스 승인] 오류:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '처리 실패',
        errorDetails: { stage: 'approve_route_outer_catch' },
      },
      { status: 500 }
    )
  }
}
