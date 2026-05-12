import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { sendReviewRequest } from '@/lib/solapi-review';

/**
 * Solapi 리뷰 자동요청 — 출발일 D+7 예약 대상 알림톡 발송
 *
 * 스케줄 (vercel.json 메인 세션이 통합):
 *   path: /api/cron/solapi-review-request
 *   schedule: "0 1 * * *"   # UTC 01:00 → KST 10:00
 *
 * 흐름:
 *   1) bookings 에서 departure_date = today - 7 AND status in (completed/confirmed/in_progress)
 *   2) solapi_review_sent_log 에 이미 행 있으면 skip (멱등성)
 *   3) customers JOIN 으로 전화번호 확보 → sendReviewRequest 호출
 *   4) 결과를 solapi_review_sent_log 에 ON CONFLICT DO NOTHING 으로 적재
 *
 * env:
 *   SOLAPI_API_KEY / SOLAPI_API_SECRET / KAKAO_CHANNEL_ID / KAKAO_SENDER_NUMBER
 *   KAKAO_TEMPLATE_REVIEW_REQUEST
 *   CRON_SECRET (isCronAuthorized)
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const TARGET_BOOKING_STATUSES = ['completed', 'confirmed', 'in_progress'];
const MAX_PER_RUN = 200;

interface BookingRow {
  id: string;
  package_title: string | null;
  departure_date: string | null;
  lead_customer_id: string | null;
  status: string | null;
  customers?: { id?: string; name?: string | null; phone?: string | null } | null;
}

function toDateString(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function runSolapiReviewRequest(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const errors: string[] = [];

  // D+7: 출발일이 오늘로부터 정확히 7일 전인 예약
  const target = new Date();
  target.setUTCHours(0, 0, 0, 0);
  target.setUTCDate(target.getUTCDate() - 7);
  const targetDate = toDateString(target);

  // 1) 후보 예약 조회 (customers JOIN 으로 phone 확보)
  const { data: bookings, error: bErr } = await supabaseAdmin
    .from('bookings')
    .select('id, package_title, departure_date, lead_customer_id, status, customers!lead_customer_id(id,name,phone)')
    .eq('departure_date', targetDate)
    .in('status', TARGET_BOOKING_STATUSES)
    .or('is_deleted.is.null,is_deleted.eq.false')
    .limit(MAX_PER_RUN);

  if (bErr) {
    errors.push(`bookings 조회 실패: ${bErr.message}`);
    return { date: targetDate, candidates: 0, sent: 0, skipped: 0, failed: 0, errors };
  }

  const rows = (bookings || []) as unknown as BookingRow[];
  if (rows.length === 0) {
    return { date: targetDate, candidates: 0, sent: 0, skipped: 0, failed: 0, errors };
  }

  // 2) 이미 발송된 예약 ID 필터 (멱등성)
  const bookingIds = rows.map((r) => r.id);
  const { data: existingLog } = await supabaseAdmin
    .from('solapi_review_sent_log')
    .select('booking_id, status')
    .in('booking_id', bookingIds);

  const alreadyHandled = new Set(
    ((existingLog || []) as Array<{ booking_id: string; status: string }>)
      .filter((l) => l.status !== 'failed') // 실패만 재시도 허용
      .map((l) => l.booking_id),
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const logRows: Array<Record<string, unknown>> = [];

  for (const b of rows) {
    if (alreadyHandled.has(b.id)) {
      skipped += 1;
      continue;
    }

    const customer = b.customers || null;
    const phone = customer?.phone?.trim() || '';
    const customerName = customer?.name?.trim() || '고객';
    const productTitle = b.package_title?.trim() || '여행 상품';

    if (!phone) {
      logRows.push({
        booking_id: b.id,
        customer_id: customer?.id || b.lead_customer_id || null,
        phone: null,
        template_id: process.env.KAKAO_TEMPLATE_REVIEW_REQUEST || null,
        status: 'skipped',
        response: { reason: 'no_phone' },
        error_message: '연락처 없음',
      });
      skipped += 1;
      continue;
    }

    const result = await sendReviewRequest({
      bookingId: b.id,
      phone,
      customerName,
      productTitle,
    });

    if (result.status === 'sent') sent += 1;
    else if (result.status === 'skipped') skipped += 1;
    else {
      failed += 1;
      errors.push(`booking ${b.id}: ${result.errorMessage || 'unknown'}`);
    }

    logRows.push({
      booking_id: b.id,
      customer_id: customer?.id || b.lead_customer_id || null,
      phone,
      template_id: result.templateId || null,
      status: result.status,
      response: result.response,
      error_message: result.errorMessage || null,
    });
  }

  // 3) 로그 일괄 적재 (booking_id UNIQUE → 중복은 무시)
  if (logRows.length > 0) {
    const { error: logErr } = await supabaseAdmin
      .from('solapi_review_sent_log')
      .upsert(logRows, { onConflict: 'booking_id', ignoreDuplicates: true });
    if (logErr) {
      errors.push(`solapi_review_sent_log upsert 실패: ${logErr.message}`);
    }
  }

  return {
    date: targetDate,
    candidates: rows.length,
    sent,
    skipped,
    failed,
    errors,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('solapi-review-request', runSolapiReviewRequest);
