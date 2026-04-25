/**
 * Rule: claim_keyword_reply
 * ============================================================================
 * 트리거: 최근 24h 내 message_logs 중 inbound(고객 발신) 이면서
 *         클레임 키워드 포함 + 이후 outbound(운영자 발신) 메시지 없음
 *
 * 자동 해결:
 *   - 이후 outbound 메시지가 생기면 (= 운영자가 응답) auto_resolve
 *   - 예약 취소
 *
 * 키워드: "환불", "취소", "화", "실망", "불만", "항의", "컴플레인", "사기"
 *
 * 설계 포인트:
 *   - priority=0 (urgent) — 클레임은 가장 빠르게 쳐내야 함
 *   - cooldownDays=1 — 응답 후에도 새 클레임 오면 바로 재감지
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { TaskRule, DetectedTask, AutoResolveDecision } from '@/types/booking-tasks';
import { extractCustomerName } from '../helpers';

const CLAIM_KEYWORDS = ['환불', '취소', '화나', '화가', '실망', '불만', '항의', '컴플레인', '사기', '어이없'];
const SCAN_WINDOW_HOURS = 24;

interface MsgLog {
  id: string;
  booking_id: string | null;
  event_type: string | null;
  log_type: string | null;        // 'inbound' | 'outbound' | 'scheduler' | 'system'
  title: string | null;
  content: string | null;
  created_at: string;
}

function hasClaimKeyword(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const kw of CLAIM_KEYWORDS) {
    if (text.includes(kw)) return kw;
  }
  return null;
}

export const claimKeywordReply: TaskRule = {
  id: 'claim_keyword_reply',
  taskType: 'claim_keyword_reply',
  priority: 0, // URGENT
  cooldownDays: 1,

  async detect({ now }) {
    const since = new Date(now.getTime() - SCAN_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    // 최근 24h 인바운드 메시지만 1차 필터
    const { data, error } = await supabaseAdmin
      .from('message_logs')
      .select('id, booking_id, event_type, log_type, title, content, created_at')
      .eq('log_type', 'inbound')
      .gte('created_at', since)
      .not('booking_id', 'is', null)
      .limit(500);

    if (error) {
      console.warn('[claim_keyword_reply] query error', error.message);
      return [];
    }

    const seeds: DetectedTask[] = [];
    const perBookingLatest = new Map<string, { kw: string; msg: MsgLog }>();

    for (const m of (data ?? []) as unknown as MsgLog[]) {
      if (!m.booking_id) continue;
      const combined = [m.title, m.content].filter(Boolean).join(' ');
      const kw = hasClaimKeyword(combined);
      if (!kw) continue;

      // 같은 예약에 여러 건이면 가장 최신만
      const prev = perBookingLatest.get(m.booking_id);
      if (!prev || m.created_at > prev.msg.created_at) {
        perBookingLatest.set(m.booking_id, { kw, msg: m });
      }
    }

    if (perBookingLatest.size === 0) return [];

    // 해당 예약들에서 "이후 outbound 응답이 이미 있는지" 필터
    const bookingIds = [...perBookingLatest.keys()];
    const { data: outbounds } = await supabaseAdmin
      .from('message_logs')
      .select('booking_id, created_at')
      .in('booking_id', bookingIds)
      .eq('log_type', 'outbound')
      .gte('created_at', since);

    const latestOutbound = new Map<string, string>();
    for (const o of (outbounds ?? []) as unknown as Array<{ booking_id: string; created_at: string }>) {
      const prev = latestOutbound.get(o.booking_id);
      if (!prev || o.created_at > prev) latestOutbound.set(o.booking_id, o.created_at);
    }

    // booking 정보 JOIN
    const { data: bookings } = await supabaseAdmin
      .from('bookings')
      .select('id, booking_no, package_title, customers!lead_customer_id(name)')
      .in('id', bookingIds);
    const bookingMap = new Map(
      ((bookings ?? []) as unknown as Array<Record<string, unknown>>).map(b => [b.id as string, b]),
    );

    for (const [bookingId, { kw, msg }] of perBookingLatest) {
      const ob = latestOutbound.get(bookingId);
      if (ob && ob >= msg.created_at) continue; // 이미 응답함

      const b = bookingMap.get(bookingId);
      seeds.push({
        bookingId,
        title: `⚠️ 클레임 키워드 "${kw}" — 미응답`,
        context: {
          customer_name: b ? extractCustomerName(b) : '이름 미상',
          booking_no: b?.booking_no,
          package_title: b?.package_title,
          keyword: kw,
          message_id: msg.id,
          message_title: msg.title,
          excerpt: (msg.content ?? '').slice(0, 200),
          received_at: msg.created_at,
        },
        fingerprintSalt: msg.id, // 메시지 단위로 구분 — 새 메시지는 새 Task
      });
    }
    return seeds;
  },

  async evaluateStale(openTasks) {
    if (openTasks.length === 0) return [];

    const decisions: AutoResolveDecision[] = [];

    // 각 Task 의 context.message_id 이후 outbound 가 생겼는지 확인
    // message_id 기준으로 booking 별 최신 outbound 조회
    const bookingIds = [...new Set(openTasks.map(t => t.booking_id))];
    const { data: outbounds } = await supabaseAdmin
      .from('message_logs')
      .select('booking_id, created_at')
      .in('booking_id', bookingIds)
      .eq('log_type', 'outbound')
      .order('created_at', { ascending: false });

    const latestOutPerBooking = new Map<string, string>();
    for (const o of (outbounds ?? []) as unknown as Array<{ booking_id: string; created_at: string }>) {
      if (!latestOutPerBooking.has(o.booking_id)) {
        latestOutPerBooking.set(o.booking_id, o.created_at);
      }
    }

    // 예약 상태도 확인 (취소 체크)
    const { data: bookings } = await supabaseAdmin
      .from('bookings')
      .select('id, status, is_deleted')
      .in('id', bookingIds);
    const statusMap = new Map(
      ((bookings ?? []) as unknown as Array<Record<string, unknown>>).map(b => [b.id as string, b]),
    );

    for (const t of openTasks) {
      const b = statusMap.get(t.booking_id);
      if (!b || b.status === 'cancelled' || b.is_deleted) {
        decisions.push({ taskId: t.id, reason: 'booking_cancelled' });
        continue;
      }
      const receivedAt = (t.context as { received_at?: string }).received_at;
      const latestOut = latestOutPerBooking.get(t.booking_id);
      if (latestOut && receivedAt && latestOut > receivedAt) {
        decisions.push({ taskId: t.id, reason: 'operator_responded' });
      }
    }
    return decisions;
  },
};
