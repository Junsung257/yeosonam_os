/**
 * Rule: doc_missing_d3
 * ============================================================================
 * 트리거: has_sent_docs=false AND 출발일 ≤ D-3 AND 예약 활성
 * 자동 해결:
 *   - has_sent_docs=true 로 전환
 *   - 예약 취소
 *   - 출발일 지남 (음수) → 수동 영역
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { TaskRule, DetectedTask, AutoResolveDecision } from '@/types/booking-tasks';
import {
  LIVE_STATUSES,
  PAID_STATUSES,
  daysUntil,
  extractCustomerName,
  todayKST,
  addDays,
  BOOKING_SELECT_MIN,
} from '../helpers';

export const docMissingD3: TaskRule = {
  id: 'doc_missing_d3',
  taskType: 'doc_missing_d3',
  priority: 1,
  cooldownDays: 2,

  async detect({ now }) {
    const today = todayKST(now);
    const d3 = addDays(today, 3);

    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select(BOOKING_SELECT_MIN)
      .gte('departure_date', today)
      .lte('departure_date', d3)
      .eq('has_sent_docs', false)
      .in('status', [...LIVE_STATUSES, ...PAID_STATUSES])
      .eq('is_deleted', false)
      .limit(500);

    if (error) {
      console.warn('[doc_missing_d3] query error', error.message);
      return [];
    }

    const seeds: DetectedTask[] = [];
    for (const b of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      const d = daysUntil(b.departure_date as string, now);
      if (d === null) continue;

      const priorityOverride = d <= 1 ? 0 : 1;

      seeds.push({
        bookingId: b.id as string,
        title: `출발 확정서 미발송 — D${d <= 0 ? '-day' : '-' + d}`,
        context: {
          customer_name: extractCustomerName(b),
          booking_no: b.booking_no,
          package_title: b.package_title,
          departure_date: b.departure_date,
          days_until: d,
        },
        priorityOverride,
      });
    }
    return seeds;
  },

  async evaluateStale(openTasks) {
    if (openTasks.length === 0) return [];
    const ids = [...new Set(openTasks.map(t => t.booking_id))];

    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('id, status, has_sent_docs, is_deleted')
      .in('id', ids);
    if (error) return [];

    const map = new Map(
      ((data ?? []) as unknown as Array<Record<string, unknown>>).map(b => [b.id as string, b]),
    );
    const decisions: AutoResolveDecision[] = [];
    for (const t of openTasks) {
      const b = map.get(t.booking_id);
      if (!b) {
        decisions.push({ taskId: t.id, reason: 'booking_deleted' });
        continue;
      }
      if (b.status === 'cancelled' || b.is_deleted) {
        decisions.push({ taskId: t.id, reason: 'booking_cancelled' });
        continue;
      }
      if (b.has_sent_docs === true) {
        decisions.push({ taskId: t.id, reason: 'docs_sent' });
      }
    }
    return decisions;
  },
};
