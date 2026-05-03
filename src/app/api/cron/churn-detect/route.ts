/**
 * GET /api/cron/churn-detect
 *
 * Phase 2-B: 취소 위험군 자동 감지
 * ─────────────────────────────────────────────────────────────
 * 로직:
 *   1. 최근 1시간 내 ad_traffic_logs에서 landing_page에
 *      '환불' 또는 'refund' 가 포함된 조회 이벤트 수집
 *   2. 해당 세션의 user_id → bookings.lead_customer_id 역추적
 *   3. booking.status가 'pending' 또는 'waiting_deposit'인 예약 = 위험군
 *   4. Slack #운영 채널에 "취소 위험 고객 N명" 알림 발송
 *
 * Vercel Cron 스케줄: 0 * * * * (매시간 정각 UTC)
 * 수동 테스트: GET /api/cron/churn-detect?secret=CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

// 취소 위험 판정 대상 예약 상태
const RISKY_STATUSES = ['pending', 'waiting_deposit'];

// 환불/취소 관련 키워드 (URL 패스 매칭)
const REFUND_KEYWORDS = ['환불', 'refund', 'cancel', '취소', '위약'];

interface RiskyBooking {
  booking_no: string;
  package_title: string | null;
  status: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  departure_date: string | null;
  viewed_page: string;
  viewed_at: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    // ── Step 1: 최근 1시간 내 환불/취소 관련 페이지 조회 트래픽 수집 ──
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: trafficRows, error: trafficErr } = await supabaseAdmin
      .from('ad_traffic_logs')
      .select('session_id, user_id, landing_page, created_at')
      .gte('created_at', cutoff)
      .not('user_id', 'is', null);

    if (trafficErr) throw trafficErr;

    // 환불 관련 페이지 조회 필터링
    type TrafficRow = {
      session_id: string;
      user_id: string | null;
      landing_page: string | null;
      created_at: string;
    };

    const refundViews = (trafficRows ?? [] as TrafficRow[]).filter((row: TrafficRow) => {
      const page = (row.landing_page ?? '').toLowerCase();
      return REFUND_KEYWORDS.some((kw) => page.includes(kw.toLowerCase()));
    });

    if (refundViews.length === 0) {
      return NextResponse.json({
        ok: true,
        risky_count: 0,
        message: '환불 페이지 조회 없음',
        checked_at: new Date().toISOString(),
      });
    }

    // ── Step 2: user_id 목록 추출 (중복 제거, 최신 조회 기록 유지) ──
    const userMap = new Map<string, { page: string; viewed_at: string }>();
    for (const row of refundViews) {
      const uid = row.user_id as string;
      const existing = userMap.get(uid);
      if (!existing || row.created_at > existing.viewed_at) {
        userMap.set(uid, {
          page: row.landing_page ?? '',
          viewed_at: row.created_at,
        });
      }
    }

    const userIds = Array.from(userMap.keys());

    // ── Step 3: 위험 상태 예약 조회 ──────────────────────────────
    const { data: bookingRows, error: bookingErr } = await supabaseAdmin
      .from('bookings')
      .select(
        'id, booking_no, package_title, status, departure_date, lead_customer_id, customers!lead_customer_id(name, phone)',
      )
      .in('lead_customer_id', userIds)
      .in('status', RISKY_STATUSES)
      .eq('is_deleted', false);

    if (bookingErr) throw bookingErr;

    const riskyBookings: RiskyBooking[] = (bookingRows ?? []).map((b: Record<string, unknown>) => {
      const customersEmbed = b.customers as { name?: string | null; phone?: string | null } | null;
      const uid = b.lead_customer_id as string;
      const viewInfo = userMap.get(uid) ?? { page: '', viewed_at: '' };
      return {
        booking_no: b.booking_no as string,
        package_title: (b.package_title as string | null) ?? null,
        status: (b.status as string | null) ?? null,
        customer_name: customersEmbed?.name ?? null,
        customer_phone: customersEmbed?.phone ?? null,
        departure_date: (b.departure_date as string | null) ?? null,
        viewed_page: viewInfo.page,
        viewed_at: viewInfo.viewed_at,
      };
    });

    if (riskyBookings.length === 0) {
      return NextResponse.json({
        ok: true,
        risky_count: 0,
        refund_page_views: refundViews.length,
        message: '위험 예약 없음 (조회 고객이 pending/waiting_deposit 예약 없음)',
        checked_at: new Date().toISOString(),
      });
    }

    // ── Step 4: Slack 알림 발송 ──────────────────────────────────
    const bookingLines = riskyBookings
      .map((b) => {
        const name = b.customer_name ?? '고객';
        const title = b.package_title ?? '상품 미정';
        const dep = b.departure_date ? `출발 ${b.departure_date}` : '출발일 미정';
        const status = b.status === 'pending' ? '예약접수' : '입금대기';
        const page = b.viewed_page ? ` | 조회: ${b.viewed_page.slice(0, 60)}` : '';
        return `• [${b.booking_no}] ${name} — ${title} (${dep}) [${status}]${page}`;
      })
      .join('\n');

    await sendSlackAlert(
      `🚨 취소 위험 고객 ${riskyBookings.length}명 감지 (최근 1시간 환불 페이지 조회)`,
      {
        위험고객수: riskyBookings.length,
        환불페이지조회수: refundViews.length,
        대상예약:
          riskyBookings.length <= 5
            ? bookingLines
            : bookingLines.split('\n').slice(0, 5).join('\n') + `\n... 외 ${riskyBookings.length - 5}건`,
        어드민링크: '/admin/bookings',
        감지시각: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
      },
    );

    console.log(`[churn-detect] 취소 위험 ${riskyBookings.length}명 감지, Slack 발송 완료`);

    return NextResponse.json({
      ok: true,
      risky_count: riskyBookings.length,
      refund_page_views: refundViews.length,
      risky_bookings: riskyBookings.map((b) => ({
        booking_no: b.booking_no,
        package_title: b.package_title,
        status: b.status,
        departure_date: b.departure_date,
        viewed_page: b.viewed_page,
      })),
      slack_sent: true,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '취소 감지 실패';
    console.error('[churn-detect] 오류:', err);
    await sendSlackAlert(`[churn-detect] 크론 오류: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
