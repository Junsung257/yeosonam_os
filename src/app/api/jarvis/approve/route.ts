import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

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

    // 승인 → 실제 실행
    try {
      const result = await executeApprovedAction(action)

      await supabaseAdmin
        .from('jarvis_pending_actions')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', pendingActionId)

      await supabaseAdmin.from('jarvis_tool_logs').insert({
        session_id: action.session_id,
        agent_type: action.agent_type,
        tool_name: action.tool_name,
        tool_args: action.tool_args,
        result,
        is_hitl: true,
        pending_action_id: pendingActionId,
      })

      await supabaseAdmin.from('audit_logs').insert({
        action: action.tool_name,
        target_type: 'jarvis',
        target_id: pendingActionId,
        after_value: action.tool_args,
      })

      return NextResponse.json({ message: '실행 완료되었습니다.', result })
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
  } catch (error) {
    console.error('[자비스 승인] 오류:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '처리 실패' },
      { status: 500 }
    )
  }
}

async function executeApprovedAction(pending: any) {
  const { tool_name, tool_args } = pending

  switch (tool_name) {
    case 'create_booking': {
      const { data, error } = await supabaseAdmin
        .from('bookings')
        .insert(tool_args)
        .select()
      if (error) throw error
      return data?.[0]
    }
    case 'update_booking_status': {
      const { booking_id, status, reason } = tool_args
      const updateData: any = { status }
      if (reason) updateData.status_reason = reason
      const { error } = await supabaseAdmin
        .from('bookings')
        .update(updateData)
        .eq('id', booking_id)
      if (error) throw error
      return { updated: true, booking_id, status }
    }
    case 'create_customer': {
      const { data, error } = await supabaseAdmin
        .from('customers')
        .insert(tool_args)
        .select()
      if (error) throw error
      return data?.[0]
    }
    case 'update_customer': {
      const { customer_id, ...updateFields } = tool_args
      const { error } = await supabaseAdmin
        .from('customers')
        .update(updateFields)
        .eq('id', customer_id)
      if (error) throw error
      return { updated: true, customer_id }
    }
    case 'match_payment': {
      const { error } = await supabaseAdmin
        .from('bank_transactions')
        .update({ booking_id: tool_args.booking_id, match_status: 'manual' })
        .eq('id', tool_args.transaction_id)
      if (error) throw error
      return { matched: true }
    }
    case 'send_booking_guide': {
      // 안내문 발송 로직 — message_logs에 기록
      await supabaseAdmin.from('message_logs').insert({
        booking_id: tool_args.booking_id,
        event_type: tool_args.guide_type || 'BOOKING_GUIDE',
        channel: 'jarvis',
        status: 'sent',
        content: `자비스를 통해 안내문 발송`,
      })
      return { sent: true }
    }
    case 'update_package_status': {
      const { error } = await supabaseAdmin
        .from('travel_packages')
        .update({ status: tool_args.status })
        .eq('id', tool_args.package_id)
      if (error) throw error
      return { updated: true }
    }
    case 'create_settlement': {
      const { data, error } = await supabaseAdmin
        .from('settlements')
        .insert(tool_args)
        .select()
      if (error) throw error
      return data?.[0]
    }
    case 'update_rfq_status': {
      const { rfq_id, status, reason } = tool_args
      const updateData: any = { status }
      if (reason) updateData.status_reason = reason
      const { error } = await supabaseAdmin
        .from('rfqs')
        .update(updateData)
        .eq('id', rfq_id)
      if (error) throw error
      return { updated: true }
    }
    case 'update_policy': {
      const { id, ...updateFields } = tool_args
      const { error } = await supabaseAdmin
        .from('os_policies')
        .update(updateFields)
        .eq('id', id)
      if (error) throw error
      return { updated: true }
    }
    default:
      throw new Error(`실행 미구현: ${tool_name}`)
  }
}
