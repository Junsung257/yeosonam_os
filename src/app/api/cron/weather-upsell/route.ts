/**
 * GET /api/cron/weather-upsell
 *
 * Phase 2-C: 날씨 기반 업셀링 알림
 * ─────────────────────────────────────────────────────────────
 * 로직:
 *   1. 출발일 = today + 3일, status IN (deposit_paid, waiting_balance, fully_paid) 예약 조회
 *   2. 각 예약의 departure_region → 위도/경도 매핑
 *   3. Open-Meteo API로 출발+3일째 강수확률(precipitation_probability_max) 조회
 *   4. 80% 이상이면 Slack 알림 (실내 스파/선택관광 업셀 제안)
 *
 * Vercel Cron 스케줄: 0 0 * * * (매일 00:00 UTC = 09:00 KST)
 * 수동 테스트: GET /api/cron/weather-upsell?secret=CRON_SECRET
 *
 * Open-Meteo API: 무료, 인증 불필요
 *   https://api.open-meteo.com/v1/forecast
 *     ?latitude={lat}&longitude={lon}
 *     &daily=precipitation_probability_max
 *     &timezone=Asia/Seoul
 *     &forecast_days=4
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { sendSlackAlert } from '@/lib/slack-alert';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

// ── 여행지별 위도/경도 매핑 ─────────────────────────────────────
// departure_region (bookings) 혹은 package 목적지명 일부로 매칭
const DESTINATION_COORDS: Record<string, { lat: number; lon: number; label: string }> = {
  // 동남아
  다낭: { lat: 16.05, lon: 108.22, label: '다낭' },
  danang: { lat: 16.05, lon: 108.22, label: '다낭' },
  호이안: { lat: 15.88, lon: 108.33, label: '호이안' },
  호치민: { lat: 10.82, lon: 106.63, label: '호치민' },
  하노이: { lat: 21.03, lon: 105.85, label: '하노이' },
  방콕: { lat: 13.75, lon: 100.52, label: '방콕' },
  bangkok: { lat: 13.75, lon: 100.52, label: '방콕' },
  파타야: { lat: 12.93, lon: 100.88, label: '파타야' },
  푸켓: { lat: 7.88, lon: 98.39, label: '푸켓' },
  치앙마이: { lat: 18.79, lon: 98.98, label: '치앙마이' },
  발리: { lat: -8.34, lon: 115.09, label: '발리' },
  bali: { lat: -8.34, lon: 115.09, label: '발리' },
  싱가포르: { lat: 1.35, lon: 103.82, label: '싱가포르' },
  singapore: { lat: 1.35, lon: 103.82, label: '싱가포르' },
  코타키나발루: { lat: 5.98, lon: 116.07, label: '코타키나발루' },
  나트랑: { lat: 12.24, lon: 109.19, label: '나트랑' },
  nha_trang: { lat: 12.24, lon: 109.19, label: '나트랑' },
  세부: { lat: 10.32, lon: 123.9, label: '세부' },
  보라카이: { lat: 11.97, lon: 121.92, label: '보라카이' },
  마닐라: { lat: 14.6, lon: 120.98, label: '마닐라' },
  // 일본
  오사카: { lat: 34.69, lon: 135.5, label: '오사카' },
  osaka: { lat: 34.69, lon: 135.5, label: '오사카' },
  도쿄: { lat: 35.69, lon: 139.69, label: '도쿄' },
  tokyo: { lat: 35.69, lon: 139.69, label: '도쿄' },
  후쿠오카: { lat: 33.59, lon: 130.4, label: '후쿠오카' },
  삿포로: { lat: 43.06, lon: 141.35, label: '삿포로' },
  나고야: { lat: 35.18, lon: 136.91, label: '나고야' },
  오키나와: { lat: 26.21, lon: 127.68, label: '오키나와' },
  // 중국
  상하이: { lat: 31.23, lon: 121.47, label: '상하이' },
  베이징: { lat: 39.9, lon: 116.4, label: '베이징' },
  장가계: { lat: 29.13, lon: 110.48, label: '장가계' },
  계림: { lat: 25.27, lon: 110.29, label: '계림' },
  황산: { lat: 29.71, lon: 118.32, label: '황산' },
  서안: { lat: 34.27, lon: 108.95, label: '서안' },
  // 유럽
  파리: { lat: 48.85, lon: 2.35, label: '파리' },
  paris: { lat: 48.85, lon: 2.35, label: '파리' },
  런던: { lat: 51.51, lon: -0.13, label: '런던' },
  로마: { lat: 41.9, lon: 12.5, label: '로마' },
  바르셀로나: { lat: 41.39, lon: 2.17, label: '바르셀로나' },
  // 기타
  두바이: { lat: 25.2, lon: 55.27, label: '두바이' },
  하와이: { lat: 21.31, lon: -157.86, label: '하와이' },
  괌: { lat: 13.44, lon: 144.79, label: '괌' },
  사이판: { lat: 15.18, lon: 145.75, label: '사이판' },
};

const RAIN_THRESHOLD = 80; // 강수확률 임계값 (%)

// ── Open-Meteo API 호출 ─────────────────────────────────────────
async function fetchPrecipitationProb(
  lat: number,
  lon: number,
  targetDate: string, // YYYY-MM-DD
): Promise<number | null> {
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('daily', 'precipitation_probability_max');
    url.searchParams.set('timezone', 'Asia/Seoul');
    url.searchParams.set('forecast_days', '4');

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as {
      daily?: {
        time?: string[];
        precipitation_probability_max?: (number | null)[];
      };
    };

    const times = json.daily?.time ?? [];
    const probs = json.daily?.precipitation_probability_max ?? [];
    const idx = times.indexOf(targetDate);
    if (idx === -1) return null;

    return probs[idx] ?? null;
  } catch {
    return null;
  }
}

// ── departure_region / package_title에서 좌표 매핑 ──────────────
function resolveCoords(
  departureRegion: string | null,
  packageTitle: string | null,
): { lat: number; lon: number; label: string } | null {
  const candidates = [departureRegion ?? '', packageTitle ?? ''].join(' ').toLowerCase();
  for (const [key, coords] of Object.entries(DESTINATION_COORDS)) {
    if (candidates.includes(key.toLowerCase())) {
      return coords;
    }
  }
  return null;
}

// ── 날짜 헬퍼 ──────────────────────────────────────────────────
function addDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    // ── Step 1: 출발일 = today + 3일인 예약 조회 ──────────────────
    const today = new Date();
    const targetDate = addDays(today, 3); // YYYY-MM-DD

    const { data: bookingRows, error: bookingErr } = await supabaseAdmin
      .from('bookings')
      .select(
        'id, booking_no, package_title, departure_date, departure_region, status, lead_customer_id, customers!lead_customer_id(name, phone)',
      )
      .eq('departure_date', targetDate)
      .in('status', ['deposit_paid', 'waiting_balance', 'fully_paid'])
      .eq('is_deleted', false);

    if (bookingErr) throw bookingErr;

    if (!bookingRows || bookingRows.length === 0) {
      return NextResponse.json({
        ok: true,
        checked_date: targetDate,
        booking_count: 0,
        message: `${targetDate} 출발 예약 없음`,
        checked_at: new Date().toISOString(),
      });
    }

    // ── Step 2: 여행지별 강수확률 조회 (지역 중복 제거) ────────────
    type BookingRow = {
      id: string;
      booking_no: string;
      package_title: string | null;
      departure_date: string | null;
      departure_region: string | null;
      status: string | null;
      lead_customer_id: string | null;
      customers: { name?: string | null; phone?: string | null } | null;
    };

    const rows = bookingRows as BookingRow[];

    // 좌표 캐시 (같은 목적지 중복 API 호출 방지)
    const coordCache = new Map<string, number | null>();

    const results: {
      booking_no: string;
      package_title: string | null;
      departure_date: string | null;
      departure_region: string | null;
      customer_name: string | null;
      destination_label: string;
      rain_prob: number | null;
      rain_alert: boolean;
    }[] = [];

    for (const b of rows) {
      const coords = resolveCoords(b.departure_region, b.package_title);

      if (!coords) {
        results.push({
          booking_no: b.booking_no,
          package_title: b.package_title,
          departure_date: b.departure_date,
          departure_region: b.departure_region,
          customer_name: b.customers?.name ?? null,
          destination_label: b.departure_region ?? '목적지 미확인',
          rain_prob: null,
          rain_alert: false,
        });
        continue;
      }

      const cacheKey = `${coords.lat},${coords.lon}`;
      let rainProb: number | null;

      if (coordCache.has(cacheKey)) {
        rainProb = coordCache.get(cacheKey) ?? null;
      } else {
        rainProb = await fetchPrecipitationProb(coords.lat, coords.lon, targetDate);
        coordCache.set(cacheKey, rainProb);
        // Rate Limit 방어: Open-Meteo는 관대하나 목적지 수가 많을 때 방어
        await new Promise((r) => setTimeout(r, 200));
      }

      results.push({
        booking_no: b.booking_no,
        package_title: b.package_title,
        departure_date: b.departure_date,
        departure_region: b.departure_region,
        customer_name: b.customers?.name ?? null,
        destination_label: coords.label,
        rain_prob: rainProb,
        rain_alert: rainProb !== null && rainProb >= RAIN_THRESHOLD,
      });
    }

    // ── Step 3: 비 예보 80%+ 필터링 ────────────────────────────
    const alertBookings = results.filter((r) => r.rain_alert);

    if (alertBookings.length === 0) {
      return NextResponse.json({
        ok: true,
        checked_date: targetDate,
        booking_count: rows.length,
        alert_count: 0,
        message: '강수확률 80% 이상 예약 없음',
        results: results.map((r) => ({
          booking_no: r.booking_no,
          destination: r.destination_label,
          rain_prob: r.rain_prob,
        })),
        checked_at: new Date().toISOString(),
      });
    }

    // ── Step 4: Slack 알림 발송 ──────────────────────────────────
    const alertLines = alertBookings
      .map((b) => {
        const prob = b.rain_prob !== null ? `${b.rain_prob}%` : '측정불가';
        const name = b.customer_name ?? '고객';
        return `• [${b.booking_no}] ${name} — ${b.destination_label} (${b.departure_date}) 강수확률 ${prob}`;
      })
      .join('\n');

    await sendSlackAlert(
      `🌧️ 출발 3일 전 비 예보 — 업셀 기회 ${alertBookings.length}건 (${targetDate} 출발)`,
      {
        대상건수: alertBookings.length,
        총예약수: rows.length,
        강수임계값: `${RAIN_THRESHOLD}%`,
        업셀제안: '실내 스파 / 우비 키트 / 실내 관광지 대체 옵션',
        대상예약: alertLines,
        어드민링크: '/admin/bookings',
        기준일: targetDate,
      },
    );

    console.log(
      `[weather-upsell] ${targetDate} 출발 ${rows.length}건 조회, 비 예보 ${alertBookings.length}건 Slack 발송`,
    );

    return NextResponse.json({
      ok: true,
      checked_date: targetDate,
      booking_count: rows.length,
      alert_count: alertBookings.length,
      slack_sent: true,
      alerts: alertBookings.map((b) => ({
        booking_no: b.booking_no,
        destination: b.destination_label,
        rain_prob: b.rain_prob,
        departure_date: b.departure_date,
      })),
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[weather-upsell] 오류:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : '날씨 업셀 크론 실패',
      },
      { status: 500 },
    );
  }
}
