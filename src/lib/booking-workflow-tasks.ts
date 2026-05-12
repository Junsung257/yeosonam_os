/**
 * 예약 워크플로와 booking_tasks 인박스 연동 (deposit_notice 게이트 등).
 */

import { supabaseAdmin } from '@/lib/supabase';

const TASK_TYPE = 'deposit_notice_gate';

export async function enqueueDepositNoticeGateTask(bookingId: string): Promise<void> {
  const fingerprint = `${TASK_TYPE}:${bookingId}`;
  const { error } = await supabaseAdmin.from('booking_tasks').insert({
    booking_id: bookingId,
    task_type: TASK_TYPE,
    title: '계약금 안내 전 운영자 승인 필요',
    context: { automation: 'assisted_tier', created: new Date().toISOString() },
    fingerprint,
    priority: 1,
    status: 'open',
    created_by: 'system:booking_automation',
  } as never);

  if (error) {
    if ((error as { code?: string }).code === '23505') return;
    console.warn('[booking_tasks] deposit_notice_gate enqueue:', error.message);
  }
}

export async function resolveDepositNoticeGateTasks(bookingId: string): Promise<void> {
  const now = new Date().toISOString();
  await supabaseAdmin
    .from('booking_tasks')
    .update({
      status: 'auto_resolved',
      auto_resolve_reason: 'deposit_gate_cleared',
      resolved_at: now,
      resolved_by: 'system:booking_automation',
      updated_at: now,
    } as never)
    .eq('booking_id', bookingId)
    .eq('task_type', TASK_TYPE)
    .in('status', ['open', 'snoozed']);
}
