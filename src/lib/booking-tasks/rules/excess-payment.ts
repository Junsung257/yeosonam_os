/**
 * Rule: excess_payment
 * ============================================================================
 * 트리거: total_paid_out > total_cost + FEE_TOLERANCE (5,000원)
 *         즉 atomic_booking_ledger RPC 에서 payment_status='초과지급(경고)' 세팅된 예약
 *
 * 의미:
 *   - 랜드사에 원가보다 많이 송금한 상태. 환불 또는 수수료 정산 필요
 *   - 수동 처리 후 total_paid_out 조정 or total_cost 수정되면 자동 해결
 *
 * 해결:
 *   - total_paid_out <= total_cost + FEE_TOLERANCE 로 복귀
 *   - 예약 취소
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { TaskRule, DetectedTask, AutoResolveDecision } from '@/types/booking-tasks';
import { isOverpaid, fmtKRW, extractCustomerName, BOOKING_SELECT_MIN } from '../helpers';

export const excessPayment: TaskRule = {
  id: 'excess_payment',
  taskType: 'excess_payment',
  priority: 1, // high (돈 문제)
  cooldownDays: 7,

  async detect() {
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select(BOOKING_SELECT_MIN)
      .eq('payment_status', '초과지급(경고)')
      .neq('status', 'cancelled')
      .eq('is_deleted', false)
      .limit(500);

    if (error) {
      console.warn('[excess_payment] query error', error.message);
      return [];
    }

    const seeds: DetectedTask[] = [];
    for (const b of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      if (!isOverpaid(b.total_paid_out as number, b.total_cost as number)) continue;
      const excess = (b.total_paid_out as number) - (b.total_cost as number);
      seeds.push({
        bookingId: b.id as string,
        title: `초과지급 ${fmtKRW(excess)} 환불/정산 필요`,
        context: {
          customer_name: extractCustomerName(b),
          booking_no: b.booking_no,
          total_cost: b.total_cost,
          total_paid_out: b.total_paid_out,
          excess,
        },
      });
    }
    return seeds;
  },

  async evaluateStale(openTasks) {
    if (openTasks.length === 0) return [];

    const bookingIds = [...new Set(openTasks.map(t => t.booking_id))];
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('id, status, payment_status, total_cost, total_paid_out, is_deleted')
      .in('id', bookingIds);

    if (error) return [];

    const bookingMap = new Map(
      ((data ?? []) as unknown as Array<Record<string, unknown>>).map(b => [b.id as string, b]),
    );
    const decisions: AutoResolveDecision[] = [];
    for (const t of openTasks) {
      const b = bookingMap.get(t.booking_id);
      if (!b) {
        decisions.push({ taskId: t.id, reason: 'booking_deleted' });
        continue;
      }
      if (b.status === 'cancelled' || b.is_deleted) {
        decisions.push({ taskId: t.id, reason: 'booking_cancelled' });
        continue;
      }
      if (!isOverpaid(b.total_paid_out as number, b.total_cost as number)) {
        decisions.push({ taskId: t.id, reason: 'payout_normalized' });
      }
    }
    return decisions;
  },
};
