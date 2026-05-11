import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { ADMIN_CACHE } from '@/lib/admin-cache';

// LTV 코호트 분석 — UTM 채널별 평생 결제액 집계
// bookings.utm_source 기준으로 cohort 분류
//
// 감사: docs/audits/2026-05-11-admin-perf-audit.md
// 개선: 페이지네이션 가드(limit) + CDN 5분 캐시. 5분 stale 허용 (코호트는 실시간 X).

const LTV_BOOKING_LIMIT = 5000;
const CACHE_HEADERS = ADMIN_CACHE.analytics;

export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ cohorts: [] });

  try {
    // 완료된 예약만 (fully_paid + deposit_paid 이상). 최근순 limit 가드.
    const { data: bookings, error } = await supabaseAdmin
      .from('bookings')
      .select(
        'lead_customer_id, utm_source, utm_medium, utm_campaign, total_price, paid_amount, created_at, status',
      )
      .in('status', ['deposit_paid', 'waiting_balance', 'fully_paid'])
      .eq('is_deleted', false)
      .not('lead_customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(LTV_BOOKING_LIMIT);

    if (error) throw error;
    if (!bookings?.length) {
      return NextResponse.json({ cohorts: [] }, { headers: CACHE_HEADERS });
    }

    // 고객별 첫 예약 채널 결정 (첫 예약의 utm_source)
    type BookingRow = {
      lead_customer_id: string;
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      total_price: number;
      paid_amount: number | null;
      created_at: string;
      status: string;
    };

    const customerFirstChannel = new Map<string, string>();
    const customerRevenue = new Map<string, number>();
    const customerBookingCount = new Map<string, number>();

    // 고객별 첫 예약 날짜 기준 정렬
    const sorted = [...(bookings as BookingRow[])].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    for (const b of sorted) {
      const cid = b.lead_customer_id;
      if (!customerFirstChannel.has(cid)) {
        const ch = b.utm_source ?? b.utm_medium ?? 'direct';
        customerFirstChannel.set(cid, normalizeChannel(ch));
      }
      const rev = customerRevenue.get(cid) ?? 0;
      customerRevenue.set(cid, rev + (b.paid_amount ?? b.total_price ?? 0));
      customerBookingCount.set(cid, (customerBookingCount.get(cid) ?? 0) + 1);
    }

    // 채널별 집계
    const channelStats = new Map<
      string,
      { customerCount: number; totalRevenue: number; totalBookings: number }
    >();

    for (const [cid, channel] of customerFirstChannel.entries()) {
      const s = channelStats.get(channel) ?? {
        customerCount: 0,
        totalRevenue: 0,
        totalBookings: 0,
      };
      s.customerCount++;
      s.totalRevenue += customerRevenue.get(cid) ?? 0;
      s.totalBookings += customerBookingCount.get(cid) ?? 0;
      channelStats.set(channel, s);
    }

    const cohorts = [...channelStats.entries()]
      .map(([channel, s]) => ({
        channel,
        customerCount: s.customerCount,
        totalRevenue: s.totalRevenue,
        avgLtv: Math.round(s.totalRevenue / s.customerCount),
        avgBookingsPerCustomer:
          Math.round((s.totalBookings / s.customerCount) * 10) / 10,
        totalBookings: s.totalBookings,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    return NextResponse.json(
      {
        cohorts,
        totalCustomers: customerFirstChannel.size,
        bookingLimit: LTV_BOOKING_LIMIT,
        sampledBookings: bookings.length,
      },
      { headers: CACHE_HEADERS },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

function normalizeChannel(raw: string): string {
  const s = raw.toLowerCase().trim();
  if (!s || s === 'none' || s === '(none)') return 'direct';
  if (s.includes('kakao') || s.includes('카카오')) return 'kakao';
  if (s.includes('naver') || s.includes('네이버')) return 'naver';
  if (s.includes('instagram') || s.includes('insta') || s.includes('ig'))
    return 'instagram';
  if (s.includes('facebook') || s.includes('fb') || s.includes('meta'))
    return 'facebook';
  if (s.includes('google')) return 'google';
  if (s.includes('blog') || s.includes('블로그')) return 'blog';
  if (s.includes('referral') || s.includes('소개')) return 'referral';
  if (s.includes('organic') || s.includes('search')) return 'organic';
  return s;
}
