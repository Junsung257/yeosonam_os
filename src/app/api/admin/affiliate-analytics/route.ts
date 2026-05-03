import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';
import {
  parseBasis,
  bookingMonthByBasis,
  bookingPassesBasis,
  getBasisMeta,
  generateMonthKeys,
  type KPIBasis,
} from '@/lib/kpi-basis';

/**
 * 어필리에이트 분석 — dual-basis 지원 (2026-04-28 확장).
 *
 * ?basis=commission (default): 예약 생성일 기준, 취소 포함 (어필리에이트 정산 정책)
 * ?basis=accounting:           출발일 기준, 취소 제외 (IFRS 15 / ASC 606 회계)
 *
 * 두 산식은 src/lib/kpi-basis.ts의 단일 정의를 공유. 산식 변경 시 그 한 곳만 수정.
 */
export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) return NextResponse.json({ stats: null });

  const basis: KPIBasis = parseBasis(request.nextUrl.searchParams.get('basis'));
  const basisMeta = getBasisMeta(basis);

  try {
    // 1. 어필리에이트별 링크 통계
    const { data: affiliates } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, referral_code, grade, bonus_rate, commission_rate, booking_count, total_commission, is_active')
      .order('total_commission', { ascending: false }) as any;

    // 2. 링크 통계 (클릭/전환) — basis 무관
    const { data: links } = await supabaseAdmin
      .from('influencer_links')
      .select('affiliate_id, click_count, conversion_count') as any;

    // 3. 어필리에이트 예약 — basis 필터 적용을 위해 created_at + departure_date + status 모두 select
    const { data: bookings } = await supabaseAdmin
      .from('bookings')
      .select('affiliate_id, adult_count, adult_price, child_count, child_price, influencer_commission, created_at, departure_date, status')
      .not('affiliate_id', 'is', null)
      .or('is_deleted.is.null,is_deleted.eq.false') as any;

    // 파트너별 집계
    const linkMap = new Map<string, { clicks: number; conversions: number }>();
    (links || []).forEach((l: any) => {
      const prev = linkMap.get(l.affiliate_id) || { clicks: 0, conversions: 0 };
      linkMap.set(l.affiliate_id, {
        clicks: prev.clicks + (l.click_count || 0),
        conversions: prev.conversions + (l.conversion_count || 0),
      });
    });

    // basis 필터 적용한 예약만 집계 (취소건 등)
    const filteredBookings = (bookings || []).filter((b: any) => bookingPassesBasis(b, basis));

    const bookingMap = new Map<string, { revenue: number; commission: number; count: number }>();
    filteredBookings.forEach((b: any) => {
      const prev = bookingMap.get(b.affiliate_id) || { revenue: 0, commission: 0, count: 0 };
      const revenue = (b.adult_count || 0) * (b.adult_price || 0) + (b.child_count || 0) * (b.child_price || 0);
      bookingMap.set(b.affiliate_id, {
        revenue: prev.revenue + revenue,
        commission: prev.commission + (b.influencer_commission || 0),
        count: prev.count + 1,
      });
    });

    // 월별 추세 — basis가 결정한 dateField 사용
    const monthlyMap = new Map<string, { revenue: number; commission: number; count: number }>();
    filteredBookings.forEach((b: any) => {
      const month = bookingMonthByBasis(b, basis);
      if (!month) return;
      const prev = monthlyMap.get(month) || { revenue: 0, commission: 0, count: 0 };
      const revenue = (b.adult_count || 0) * (b.adult_price || 0) + (b.child_count || 0) * (b.child_price || 0);
      monthlyMap.set(month, {
        revenue: prev.revenue + revenue,
        commission: prev.commission + (b.influencer_commission || 0),
        count: prev.count + 1,
      });
    });

    // 전체 KPI
    let totalClicks = 0, totalConversions = 0, totalRevenue = 0, totalCommission = 0;
    linkMap.forEach(v => { totalClicks += v.clicks; totalConversions += v.conversions; });
    bookingMap.forEach(v => { totalRevenue += v.revenue; totalCommission += v.commission; });

    // 파트너별 데이터
    const partners = (affiliates || []).map((a: any) => {
      const linkStats = linkMap.get(a.id) || { clicks: 0, conversions: 0 };
      const bookingStats = bookingMap.get(a.id) || { revenue: 0, commission: 0, count: 0 };
      return {
        id: a.id,
        name: a.name,
        referral_code: a.referral_code,
        grade: a.grade,
        is_active: a.is_active,
        commission_rate: a.commission_rate,
        clicks: linkStats.clicks,
        conversions: linkStats.conversions,
        conversion_rate: linkStats.clicks > 0 ? Math.round((linkStats.conversions / linkStats.clicks) * 1000) / 10 : 0,
        revenue: bookingStats.revenue,
        commission: bookingStats.commission,
        booking_count: bookingStats.count,
        avg_commission: bookingStats.count > 0 ? Math.round(bookingStats.commission / bookingStats.count) : 0,
      };
    });

    // 월별 데이터 — 최근 6개월 윈도우, 빈 달은 0으로 채움
    const windowKeys = generateMonthKeys(6);
    const monthly = windowKeys.map(month => ({
      month,
      ...(monthlyMap.get(month) || { revenue: 0, commission: 0, count: 0 }),
    }));

    return NextResponse.json({
      basis,
      basisMeta: {
        id: basisMeta.id,
        label: basisMeta.label,
        shortLabel: basisMeta.shortLabel,
        description: basisMeta.description,
      },
      kpi: {
        totalClicks,
        totalConversions,
        conversionRate: totalClicks > 0 ? Math.round((totalConversions / totalClicks) * 1000) / 10 : 0,
        totalRevenue,
        totalCommission,
        partnerCount: (affiliates || []).length,
        activeCount: (affiliates || []).filter((a: any) => a.is_active).length,
      },
      partners,
      monthly,
    });
  } catch (err) {
    console.error('[Affiliate Analytics]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}
