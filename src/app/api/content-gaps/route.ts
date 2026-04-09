import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 콘텐츠 갭 분석 API — "블로그가 없는 고전환 상품" 자동 감지
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ gaps: [] });

  try {
    // 1. active 상품 목록 (예약 건수 포함)
    const { data: packages } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, duration, price, status, seats_held, seats_confirmed')
      .in('status', ['active', 'approved'])
      .order('created_at', { ascending: false })
      .limit(200);

    if (!packages?.length) return NextResponse.json({ gaps: [], stats: { total: 0, withContent: 0, withoutContent: 0, highPriority: 0 } });

    // 2. 각 상품별 발행된 콘텐츠 수 조회
    const pkgIds = packages.map((p: Record<string, unknown>) => p.id as string);
    const { data: contentData } = await supabaseAdmin
      .from('content_creatives')
      .select('product_id, channel, status')
      .in('product_id', pkgIds)
      .eq('status', 'published');

    // 상품별 채널 현황 집계
    const contentMap = new Map<string, Set<string>>();
    (contentData || []).forEach((c: { product_id: string; channel: string }) => {
      if (!contentMap.has(c.product_id)) contentMap.set(c.product_id, new Set());
      contentMap.get(c.product_id)!.add(c.channel);
    });

    // 3. 예약 건수 조회 (상품별)
    const { data: bookingCounts } = await supabaseAdmin
      .from('bookings')
      .select('package_id')
      .in('package_id', pkgIds);

    const bookingMap = new Map<string, number>();
    (bookingCounts || []).forEach((b: { package_id: string }) => {
      bookingMap.set(b.package_id, (bookingMap.get(b.package_id) || 0) + 1);
    });

    // 4. 갭 분석 결과 생성
    interface GapRow { id: string; title: string; destination: string | null; duration: number | null; price: number | null; status: string; bookings: number; has_blog: boolean; has_card_news: boolean; has_ad_copy: boolean; content_count: number; channels: string[] }

    const gaps: GapRow[] = packages.map((pkg: Record<string, unknown>) => {
      const id = pkg.id as string;
      const channels = contentMap.get(id) || new Set<string>();
      const bookings = bookingMap.get(id) || 0;
      return {
        id,
        title: pkg.title as string,
        destination: (pkg.destination as string) || null,
        duration: (pkg.duration as number) || null,
        price: (pkg.price as number) || null,
        status: pkg.status as string,
        bookings,
        has_blog: channels.has('naver_blog'),
        has_card_news: channels.has('instagram_card'),
        has_ad_copy: channels.has('google_search'),
        content_count: channels.size,
        channels: [...channels],
      };
    });

    // 고전환(예약 있음) + 콘텐츠 없는 상품 우선 정렬
    gaps.sort((a, b) => {
      if (a.content_count === 0 && b.content_count > 0) return -1;
      if (a.content_count > 0 && b.content_count === 0) return 1;
      return b.bookings - a.bookings;
    });

    const withContent = gaps.filter(g => g.content_count > 0).length;

    return NextResponse.json({
      gaps,
      stats: {
        total: gaps.length,
        withContent,
        withoutContent: gaps.length - withContent,
        highPriority: gaps.filter(g => g.content_count === 0 && g.bookings > 0).length,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}
