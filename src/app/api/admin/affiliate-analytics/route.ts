import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ stats: null });

  try {
    // 1. 어필리에이트별 링크 통계
    const { data: affiliates } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, referral_code, grade, bonus_rate, commission_rate, booking_count, total_commission, is_active')
      .order('total_commission', { ascending: false }) as any;

    // 2. 링크 통계 (클릭/전환)
    const { data: links } = await supabaseAdmin
      .from('influencer_links')
      .select('affiliate_id, click_count, conversion_count') as any;

    // 3. 어필리에이트 예약 통계
    const { data: bookings } = await supabaseAdmin
      .from('bookings')
      .select('affiliate_id, adult_count, adult_price, child_count, child_price, influencer_commission, created_at')
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

    const bookingMap = new Map<string, { revenue: number; commission: number; count: number }>();
    (bookings || []).forEach((b: any) => {
      const prev = bookingMap.get(b.affiliate_id) || { revenue: 0, commission: 0, count: 0 };
      const revenue = (b.adult_count || 0) * (b.adult_price || 0) + (b.child_count || 0) * (b.child_price || 0);
      bookingMap.set(b.affiliate_id, {
        revenue: prev.revenue + revenue,
        commission: prev.commission + (b.influencer_commission || 0),
        count: prev.count + 1,
      });
    });

    // 월별 추세 (최근 6개월)
    const monthlyMap = new Map<string, { revenue: number; commission: number; count: number }>();
    (bookings || []).forEach((b: any) => {
      const month = (b.created_at || '').slice(0, 7);
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

    // 월별 데이터 (정렬)
    const monthly = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, data]) => ({ month, ...data }));

    return NextResponse.json({
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
