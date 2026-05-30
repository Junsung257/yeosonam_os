/**
 * 예약 워크플로와 booking_tasks 인박스 연동 (deposit_notice 게이트 등).
 */

import { supabaseAdmin } from '@/lib/supabase';

const TASK_TYPE = 'deposit_notice_gate';
const SEAT_CHECK_TASK_TYPE = 'seat_check_required';

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
  } satisfies Record<string, unknown> as never);

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
    } satisfies Record<string, unknown> as never)
    .eq('booking_id', bookingId)
    .eq('task_type', TASK_TYPE)
    .in('status', ['open', 'snoozed']);
}

export async function enqueueSeatCheckRequiredTask(
  bookingId: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  const fingerprint = `${SEAT_CHECK_TASK_TYPE}:${bookingId}`;
  const { error } = await supabaseAdmin.from('booking_tasks').insert({
    booking_id: bookingId,
    task_type: SEAT_CHECK_TASK_TYPE,
    title: '랜드사 좌석 가능 여부 확인 필요',
    context: {
      automation: 'landing_booking_request',
      created: new Date().toISOString(),
      ...context,
    },
    fingerprint,
    priority: 1,
    status: 'open',
    created_by: 'system:landing_booking_request',
  } satisfies Record<string, unknown> as never);

  if (error) {
    if ((error as { code?: string }).code === '23505') return;
    console.warn('[booking_tasks] seat_check_required enqueue:', error.message);
  }
}

export async function resolveSeatCheckRequiredTasks(bookingId: string): Promise<void> {
  const now = new Date().toISOString();
  await supabaseAdmin
    .from('booking_tasks')
    .update({
      status: 'resolved',
      resolved_at: now,
      resolved_by: 'user:admin',
      resolution: 'seat_available',
      updated_at: now,
    } satisfies Record<string, unknown> as never)
    .eq('booking_id', bookingId)
    .eq('task_type', SEAT_CHECK_TASK_TYPE)
    .in('status', ['open', 'snoozed']);
}
