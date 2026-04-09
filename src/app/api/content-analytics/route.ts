import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 콘텐츠 성과 분석 API
 * GET /api/content-analytics — 발행된 블로그 글별 트래픽/전환/ROAS 데이터
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ analytics: [] });

  const { searchParams } = request.nextUrl;
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '50'));
  const destination = searchParams.get('destination');

  try {
    // content_roas_summary 뷰에서 조회
    let query = supabaseAdmin
      .from('content_roas_summary')
      .select('*')
      .order('traffic_count', { ascending: false })
      .limit(limit);

    if (destination) query = query.eq('destination', destination);

    const { data: viewData, error: viewError } = await query;

    // 뷰가 사용 가능하면 바로 반환
    if (!viewError && viewData) {
      // 집계 KPI 계산
      const totalTraffic = viewData.reduce((s: number, r: Record<string, number>) => s + (r.traffic_count || 0), 0);
      const totalFirstConv = viewData.reduce((s: number, r: Record<string, number>) => s + (r.first_touch_conversions || 0), 0);
      const totalRevenue = viewData.reduce((s: number, r: Record<string, number>) => s + (r.first_touch_revenue || 0), 0);
      const totalProfit = viewData.reduce((s: number, r: Record<string, number>) => s + (r.first_touch_profit || 0), 0);

      return NextResponse.json({
        analytics: viewData,
        kpi: {
          total_published: viewData.length,
          total_traffic: totalTraffic,
          total_first_touch_conversions: totalFirstConv,
          total_revenue: totalRevenue,
          total_profit: totalProfit,
          avg_conversion_rate: totalTraffic > 0 ? ((totalFirstConv / totalTraffic) * 100).toFixed(2) : '0.00',
        },
      });
    }

    // 뷰 실패 시 fallback: 기본 콘텐츠 목록만 반환
    const { data: creatives } = await supabaseAdmin
      .from('content_creatives')
      .select('id, slug, seo_title, angle_type, product_id, published_at, travel_packages(title, destination)')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(limit);

    return NextResponse.json({
      analytics: (creatives || []).map((c: Record<string, unknown>) => ({
        creative_id: c.id,
        slug: c.slug,
        seo_title: c.seo_title,
        angle_type: c.angle_type,
        product_id: c.product_id,
        package_title: c.travel_packages ? (c.travel_packages as Record<string, unknown>).title : null,
        destination: c.travel_packages ? (c.travel_packages as Record<string, unknown>).destination : null,
        published_at: c.published_at,
        traffic_count: 0,
        first_touch_conversions: 0,
        first_touch_revenue: 0,
        first_touch_cost: 0,
        first_touch_profit: 0,
        last_touch_conversions: 0,
        last_touch_revenue: 0,
      })),
      kpi: {
        total_published: (creatives || []).length,
        total_traffic: 0,
        total_first_touch_conversions: 0,
        total_revenue: 0,
        total_profit: 0,
        avg_conversion_rate: '0.00',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
