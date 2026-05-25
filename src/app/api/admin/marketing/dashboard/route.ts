import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { ADMIN_CACHE } from '@/lib/admin-cache';

/**
 * GET /api/admin/marketing/dashboard
 *
 * 통합 광고 대시보드 데이터 API
 * 채널별 성과, 전환 퍼널, 트렌드 데이터를 한 번에 반환
 *
 * 응답 구조:
 * {
 *   data: {
 *     channels: ChannelPerformance[],
 *     funnel: FunnelStep[],
 *     trends: TrendPoint[],
 *     totalSpend, totalConversions, attributedRevenue, blendedRoas, avgCpa
 *   }
 * }
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ data: null, mock: true }, { headers: ADMIN_CACHE.noCache });
  }

  const searchParams = request.nextUrl.searchParams;
  const days = parseInt(searchParams.get('days') ?? '30', 10);
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - days);
  const fromStr = dateFrom.toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  // 이전 기간 (전월 대비 비교용)
  const prevDateFrom = new Date(dateFrom);
  prevDateFrom.setDate(prevDateFrom.getDate() - days);
  const prevFromStr = prevDateFrom.toISOString().slice(0, 10);
  const prevToStr = dateFrom.toISOString().slice(0, 10);

  const supabase = supabaseAdmin;

  try {
    // 1. 채널별 성과 — ad_traffic_logs + ad_conversion_logs 집계
    // 현재 기간
    const [currentTraffic, currentConversions, prevTraffic, prevConversions] = await Promise.all([
      supabase
        .from('ad_traffic_logs')
        .select('source, count, current_cpc')
        .gte('created_at', fromStr),
      supabase
        .from('ad_conversion_logs')
        .select('attributed_source, final_sales_price, allocated_ad_spend')
        .gte('created_at', fromStr),
      supabase
        .from('ad_traffic_logs')
        .select('source, count, current_cpc')
        .gte('created_at', prevFromStr)
        .lt('created_at', prevToStr),
      supabase
        .from('ad_conversion_logs')
        .select('attributed_source, final_sales_price, allocated_ad_spend')
        .gte('created_at', prevFromStr)
        .lt('created_at', prevToStr),
    ]);

    // 2. 퍼널 데이터 — engagement_logs + conversion_logs
    const [impressions, clicks, pageViews, checkouts] = await Promise.all([
      supabase
        .from('ad_traffic_logs')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', fromStr),
      supabase
        .from('ad_traffic_logs')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', fromStr)
        .not('gclid', 'is', null)
        .or('fbclid.not.is.null,n_keyword.not.is.null'),
      supabase
        .from('ad_engagement_logs')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'page_view')
        .gte('created_at', fromStr),
      supabase
        .from('ad_engagement_logs')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'checkout_start')
        .gte('created_at', fromStr),
    ]);

    // 3. 트렌드 데이터 — 일별 집계
    const { data: dailyConversions } = await supabase
      .from('ad_conversion_logs')
      .select('created_at, attributed_source, final_sales_price, allocated_ad_spend')
      .gte('created_at', fromStr)
      .order('created_at', { ascending: true });

    // 4. 채널 집계
    const currentRows = (currentConversions.data ?? []) as Array<{
      attributed_source: string | null;
      final_sales_price: number;
      allocated_ad_spend: number;
    }>;
    const prevRows = (prevConversions.data ?? []) as Array<{
      attributed_source: string | null;
      final_sales_price: number;
      allocated_ad_spend: number;
    }>;

    const channelMap = new Map<string, { spend: number; revenue: number; conversions: number; impressions: number; clicks: number }>();
    const prevChannelMap = new Map<string, { spend: number; revenue: number }>();

    for (const row of currentRows) {
      const source = row.attributed_source ?? 'organic';
      const entry = channelMap.get(source) ?? { spend: 0, revenue: 0, conversions: 0, impressions: 0, clicks: 0 };
      entry.spend += row.allocated_ad_spend ?? 0;
      entry.revenue += row.final_sales_price ?? 0;
      entry.conversions += 1;
      channelMap.set(source, entry);
    }

    for (const row of prevRows) {
      const source = row.attributed_source ?? 'organic';
      const entry = prevChannelMap.get(source) ?? { spend: 0, revenue: 0 };
      entry.spend += row.allocated_ad_spend ?? 0;
      entry.revenue += row.final_sales_price ?? 0;
      prevChannelMap.set(source, entry);
    }

    // 트래픽에서 impressions/clicks 보정
    const trafficRows = (currentTraffic.data ?? []) as Array<{ source: string | null }>;
    for (const t of trafficRows) {
      const source = t.source ?? 'organic';
      const entry = channelMap.get(source);
      if (entry) entry.impressions += 1;
    }

    // 5. 채널별 응답 구성
    const CHANNEL_META: Record<string, { label: string; displayOrder: number }> = {
      google: { label: 'Google Ads', displayOrder: 0 },
      naver: { label: 'Naver Ads', displayOrder: 1 },
      facebook: { label: 'Meta Ads', displayOrder: 2 },
      meta: { label: 'Meta Ads', displayOrder: 2 },
      organic: { label: 'Organic', displayOrder: 3 },
      direct: { label: 'Direct', displayOrder: 4 },
    };

    const channels = Array.from(channelMap.entries())
      .map(([channel, stats]) => {
        const meta = CHANNEL_META[channel] ?? { label: channel, displayOrder: 99 };
        const prev = prevChannelMap.get(channel);
        const clicks = stats.clicks || Math.round(stats.impressions * 0.02);
        const ctr = stats.impressions > 0 ? (clicks / stats.impressions) * 100 : 0;
        const cpc = clicks > 0 ? stats.spend / clicks : 0;
        const roas = stats.spend > 0 ? (stats.revenue / stats.spend) * 100 : 0;
        return {
          channel,
          channelLabel: meta.label,
          spend: stats.spend,
          impressions: stats.impressions,
          clicks,
          ctr,
          cpc,
          conversions: stats.conversions,
          revenue: stats.revenue,
          roas,
          prevSpend: prev?.spend,
          prevRevenue: prev?.revenue,
          displayOrder: meta.displayOrder,
        };
      })
      .sort((a, b) => a.displayOrder - b.displayOrder);

    // 6. 퍼널 구성
    const impressionCount = impressions.count ?? 0;
    const clickCount = clicks.count ?? 0;
    const pageViewCount = pageViews.count ?? 0;
    const checkoutCount = checkouts.count ?? 0;
    const bookingCount = currentRows.length;
    const paymentCount = currentRows.filter(r => r.final_sales_price > 0).length;

    const funnel = [
      { label: 'Impression', count: Math.max(impressionCount, 1), rate: 100 },
      { label: 'Click', count: Math.max(clickCount, 1), rate: impressionCount > 0 ? (clickCount / impressionCount) * 100 : 0 },
      { label: 'Page View', count: Math.max(pageViewCount, 1), rate: clickCount > 0 ? (pageViewCount / clickCount) * 100 : 0 },
      { label: 'Checkout', count: Math.max(checkoutCount, 0), rate: pageViewCount > 0 ? (checkoutCount / pageViewCount) * 100 : 0 },
      { label: 'Booking', count: bookingCount, rate: checkoutCount > 0 ? (bookingCount / checkoutCount) * 100 : 0 },
      { label: 'Payment Complete', count: paymentCount, rate: bookingCount > 0 ? (paymentCount / bookingCount) * 100 : 0 },
    ];

    // 7. 트렌드 데이터 — 일별 집계
    const trendMap = new Map<string, TrendPoint>();
    const rawDailyConversions = (dailyConversions?.data ?? []) as Array<{
      created_at: string;
      attributed_source: string | null;
      final_sales_price: number;
      allocated_ad_spend: number;
    }>;

    for (const row of rawDailyConversions) {
      const day = row.created_at.slice(0, 10);
      const existing = trendMap.get(day) ?? { date: day, google_spend: 0, google_revenue: 0, naver_spend: 0, naver_revenue: 0, meta_spend: 0, meta_revenue: 0, organic_revenue: 0 };
      const source = row.attributed_source ?? 'organic';
      if (source === 'google') { existing.google_spend += row.allocated_ad_spend; existing.google_revenue += row.final_sales_price; }
      else if (source === 'naver') { existing.naver_spend += row.allocated_ad_spend; existing.naver_revenue += row.final_sales_price; }
      else if (source === 'facebook' || source === 'meta') { existing.meta_spend += row.allocated_ad_spend; existing.meta_revenue += row.final_sales_price; }
      else { existing.organic_revenue += row.final_sales_price; }
      trendMap.set(day, existing);
    }

    // 빈 날짜 채우기
    const trends: TrendPoint[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const existing = trendMap.get(dateStr);
      trends.push({
        date: dateStr,
        google_spend: existing?.google_spend ?? 0,
        google_revenue: existing?.google_revenue ?? 0,
        naver_spend: existing?.naver_spend ?? 0,
        naver_revenue: existing?.naver_revenue ?? 0,
        meta_spend: existing?.meta_spend ?? 0,
        meta_revenue: existing?.meta_revenue ?? 0,
        organic_revenue: existing?.organic_revenue ?? 0,
      });
    }

    // 8. 통합 KPI
    const totalSpend = channels.reduce((s, c) => s + c.spend, 0);
    const totalConversions = channels.reduce((s, c) => s + c.conversions, 0);
    const attributedRevenue = channels.reduce((s, c) => s + c.revenue, 0);
    const blendedRoas = totalSpend > 0 ? (attributedRevenue / totalSpend) * 100 : 0;
    const avgCpa = totalConversions > 0 ? totalSpend / totalConversions : 0;

    return NextResponse.json({
      data: {
        channels,
        funnel,
        trends,
        totalSpend,
        totalConversions,
        attributedRevenue,
        blendedRoas,
        avgCpa,
      },
    }, { headers: ADMIN_CACHE.analytics });
  } catch (err) {
    console.error('[dashboard] 집계 오류:', err);
    return NextResponse.json({ data: null, error: 'aggregation_error' }, { status: 500, headers: ADMIN_CACHE.noCache });
  }
}

interface TrendPoint {
  date: string;
  google_spend: number;
  google_revenue: number;
  naver_spend: number;
  naver_revenue: number;
  meta_spend: number;
  meta_revenue: number;
  organic_revenue: number;
}
