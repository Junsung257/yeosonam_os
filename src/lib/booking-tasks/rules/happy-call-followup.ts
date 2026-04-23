/**
 * Rule: happy_call_followup
 * ============================================================================
 * 트리거: HAPPY_CALL 로그 존재 + 7일 경과 + REVIEW_REQUEST 로그 없음
 * 자동 해결:
 *   - REVIEW_REQUEST 이벤트 로그 생김 (운영자가 발송)
 *
 * 설계 포인트:
 *   - priority=2 (normal) — 급한 일 아님
 *   - cooldownDays=7 — 한번 해결하면 일주일 조용
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { TaskRule, DetectedTask, AutoResolveDecision } from '@/types/booking-tasks';
import { extractCustomerName } from '../helpers';

const FOLLOWUP_AFTER_DAYS = 7;

interface MsgLog {
  booking_id: string | null;
  event_type: string | null;
  created_at: string;
}

export const happyCallFollowup: TaskRule = {
  id: 'happy_call_followup',
  taskType: 'happy_call_followup',
  priority: 2,
  cooldownDays: 7,

  async detect({ now }) {
    const since = new Date(now.getTime() - FOLLOWUP_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // HAPPY_CALL 이 7일 전 ~ 30일 전 사이에 있는 것 (너무 오래된 것까지 파지 않도록)
    const until = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('message_logs')
      .select('booking_id, event_type, created_at')
      .eq('event_type', 'HAPPY_CALL')
      .gte('created_at', until)
      .lte('created_at', since)
      .not('booking_id', 'is', null)
      .limit(500);

    if (error) {
      console.warn('[happy_call_followup] query error', error.message);
      return [];
    }

    if (!data || data.length === 0) return [];

    const bookingIds = [...new Set(((data as unknown) as MsgLog[]).map(m => m.booking_id!).filter(Boolean))];

    // 이미 REVIEW_REQUEST 발송된 예약 제외
    const { data: reviews } = await supabaseAdmin
      .from('message_logs')
      .select('booking_id')
      .eq('event_type', 'REVIEW_REQUEST')
      .in('booking_id', bookingIds);
    const reviewedSet = new Set(
      ((reviews ?? []) as unknown as Array<{ booking_id: string }>).map(r => r.booking_id),
    );

    const pendingIds = bookingIds.filter(id => !reviewedSet.has(id));
    if (pendingIds.length === 0) return [];

    const { data: bookings } = await supabaseAdmin
      .from('bookings')
      .select('id, booking_no, package_title, departure_date, customers!lead_customer_id(name)')
      .in('id', pendingIds)
      .eq('is_deleted', false)
      .neq('status', 'cancelled');
    const bookingMap = new Map(
      ((bookings ?? []) as unknown as Array<Record<string, unknown>>).map(b => [b.id as string, b]),
    );

    const seeds: DetectedTask[] = [];
    for (const id of pendingIds) {
      const b = bookingMap.get(id);
      if (!b) continue;
      seeds.push({
        bookingId: id,
        title: `해피콜 후속 — 리뷰 요청 미발송`,
        context: {
          customer_name: extractCustomerName(b),
          booking_no: b.booking_no,
          package_title: b.package_title,
          departure_date: b.departure_date,
        },
      });
    }
    return seeds;
  },

  async evaluateStale(openTasks) {
    if (openTasks.length === 0) return [];
    const ids = [...new Set(openTasks.map(t => t.booking_id))];

    // 상태 체크
    const { data: bookings } = await supabaseAdmin
      .from('bookings')
      .select('id, status, is_deleted')
      .in('id', ids);
    const statusMap = new Map(
      ((bookings ?? []) as unknown as Array<Record<string, unknown>>).map(b => [b.id as string, b]),
    );

    // REVIEW_REQUEST 생겼는지 확인
    const { data: reviews } = await supabaseAdmin
      .from('message_logs')
      .select('booking_id')
      .eq('event_type', 'REVIEW_REQUEST')
      .in('booking_id', ids);
    const reviewedSet = new Set(
      ((reviews ?? []) as unknown as Array<{ booking_id: string }>).map(r => r.booking_id),
    );

    const decisions: AutoResolveDecision[] = [];
    for (const t of openTasks) {
      const b = statusMap.get(t.booking_id);
      if (!b || b.status === 'cancelled' || b.is_deleted) {
        decisions.push({ taskId: t.id, reason: 'booking_cancelled' });
        continue;
      }
      if (reviewedSet.has(t.booking_id)) {
        decisions.push({ taskId: t.id, reason: 'review_requested' });
      }
    }
    return decisions;
  },
};
