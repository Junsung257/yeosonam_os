/**
 * Rule: low_margin
 * ============================================================================
 * 트리거: 신규(최근 7일) 예약 중 마진율 < 5% (MIN_MARGIN)
 * 자동 해결:
 *   - 마진율 ≥ 5% 회복 (원가 인하 또는 판매가 인상)
 *   - 예약 취소
 *
 * 설계 포인트:
 *   - 이미 만들어진 오래된 예약에는 발동 안 함 (7일 윈도우)
 *   - cooldown 7일 — 한번 알려주고 조치했으면 일주일간 조용
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { TaskRule, DetectedTask, AutoResolveDecision } from '@/types/booking-tasks';
import { calcMarginRate, fmtKRW, extractCustomerName, BOOKING_SELECT_MIN, LIVE_STATUSES, PAID_STATUSES } from '../helpers';

const MIN_MARGIN = 0.05;          // 5%
const FRESH_WINDOW_DAYS = 7;

export const lowMargin: TaskRule = {
  id: 'low_margin',
  taskType: 'low_margin',
  priority: 1, // high (돈 문제)
  cooldownDays: 7,

  async detect({ now }) {
    const since = new Date(now.getTime() - FRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select(BOOKING_SELECT_MIN + ', created_at')
      .gte('created_at', since)
      .in('status', [...LIVE_STATUSES, ...PAID_STATUSES])
      .eq('is_deleted', false)
      .limit(500);

    if (error) {
      console.warn('[low_margin] query error', error.message);
      return [];
    }

    const seeds: DetectedTask[] = [];
    for (const b of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      const margin = calcMarginRate(b.total_price as number, b.total_cost as number);
      if (margin === null) continue;        // total_price=0 등 비정상 데이터
      if (margin >= MIN_MARGIN) continue;

      const marginKRW = (b.total_price as number ?? 0) - (b.total_cost as number ?? 0);
      seeds.push({
        bookingId: b.id as string,
        title: `마진율 ${(margin * 100).toFixed(1)}% (${fmtKRW(marginKRW)}) — 원가 재확인`,
        context: {
          customer_name: extractCustomerName(b),
          booking_no: b.booking_no,
          package_title: b.package_title,
          total_price: b.total_price,
          total_cost: b.total_cost,
          margin_rate: margin,
          margin_krw: marginKRW,
          threshold: MIN_MARGIN,
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
      .select('id, status, total_price, total_cost, is_deleted')
      .in('id', bookingIds);

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
      const margin = calcMarginRate(b.total_price as number, b.total_cost as number);
      if (margin !== null && margin >= MIN_MARGIN) {
        decisions.push({ taskId: t.id, reason: 'margin_recovered' });
      }
    }
    return decisions;
  },
};
