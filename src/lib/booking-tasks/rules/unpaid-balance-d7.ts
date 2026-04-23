/**
 * Rule: unpaid_balance_d7
 * ============================================================================
 * 트리거: 잔금 > 0 AND 출발일 ≤ D-7 AND 예약 활성 상태
 * 자동 해결:
 *   - 잔금 = 0 (payment_status='완납')
 *   - 예약 취소
 *   - 출발일 지남 (D-1 이하로 떨어지면 상위 룰 or 수동 처리 영역)
 *
 * 설계 포인트:
 *   - D-1/D-2 로 갈수록 priority 자동 승급 (0=urgent)
 *   - fingerprintSalt 에 주차(week) 포함 — 매주 새 Task 허용
 *     → 주 1회 재알림, cooldown 3일로 중복은 막음
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { TaskRule, DetectedTask, AutoResolveDecision } from '@/types/booking-tasks';
import {
  LIVE_STATUSES,
  calcBalance,
  daysUntil,
  fmtKRW,
  todayKST,
  addDays,
  extractCustomerName,
  BOOKING_SELECT_MIN,
} from '../helpers';

export const unpaidBalanceD7: TaskRule = {
  id: 'unpaid_balance_d7',
  taskType: 'unpaid_balance_d7',
  priority: 1, // 기본 high. D-3 이하면 urgent 로 승급
  cooldownDays: 3,

  async detect({ now }) {
    const today = todayKST(now);
    const d7 = addDays(today, 7);

    // SQL 1차 필터: 출발 [오늘, 오늘+7] + 활성 상태
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select(BOOKING_SELECT_MIN)
      .gte('departure_date', today)
      .lte('departure_date', d7)
      .in('status', [...LIVE_STATUSES])
      .eq('is_deleted', false)
      .limit(500);

    if (error) {
      console.warn('[unpaid_balance_d7] query error', error.message);
      return [];
    }

    const seeds: DetectedTask[] = [];
    for (const b of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      const balance = calcBalance(b.total_price as number, b.paid_amount as number);
      if (balance <= 0) continue; // 이미 완납

      const d = daysUntil(b.departure_date as string, now);
      if (d === null) continue;

      // D-N 기반 priority 승급
      const priorityOverride = d <= 3 ? 0 : d <= 5 ? 1 : 1;

      seeds.push({
        bookingId: b.id as string,
        title: `잔금 ${fmtKRW(balance)} 미수 · 출발 D${d <= 0 ? '-day' : '-' + d}`,
        context: {
          customer_name: extractCustomerName(b),
          booking_no: b.booking_no,
          package_title: b.package_title,
          departure_date: b.departure_date,
          balance,
          total_price: b.total_price,
          paid_amount: b.paid_amount,
          days_until: d,
        },
        priorityOverride,
      });
    }
    return seeds;
  },

  async evaluateStale(openTasks) {
    if (openTasks.length === 0) return [];

    const bookingIds = [...new Set(openTasks.map(t => t.booking_id))];
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('id, status, total_price, paid_amount, departure_date, is_deleted')
      .in('id', bookingIds);

    if (error) {
      console.warn('[unpaid_balance_d7/stale] query error', error.message);
      return [];
    }

    const bookingMap = new Map(
      ((data ?? []) as unknown as Array<Record<string, unknown>>).map(b => [b.id as string, b]),
    );

    const decisions: AutoResolveDecision[] = [];
    for (const t of openTasks) {
      const b = bookingMap.get(t.booking_id);
      if (!b) {
        // 예약이 사라짐 (삭제) → 자동 종결
        decisions.push({ taskId: t.id, reason: 'booking_deleted' });
        continue;
      }
      if (b.status === 'cancelled' || b.is_deleted) {
        decisions.push({ taskId: t.id, reason: 'booking_cancelled' });
        continue;
      }
      const balance = calcBalance(b.total_price as number, b.paid_amount as number);
      if (balance <= 0) {
        decisions.push({ taskId: t.id, reason: 'balance_paid' });
      }
      // 출발일 지났는데 여전히 미수면 상위 수동 처리 영역 → 자동 종결 안 함
    }
    return decisions;
  },
};
