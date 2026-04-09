import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * 공개 블로그 API — 발행된(published) 블로그 글만 반환
 * GET /api/blog          → 목록 (페이지네이션)
 * GET /api/blog?slug=xxx → 단건 조회
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ posts: [] });

  const { searchParams } = request.nextUrl;
  const slug = searchParams.get('slug');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit = Math.min(50, parseInt(searchParams.get('limit') ?? '12'));
  const destination = searchParams.get('destination');

  try {
    // 단건 조회 (slug)
    if (slug) {
      const { data, error } = await supabaseAdmin
        .from('content_creatives')
        .select('id, slug, seo_title, seo_description, og_image_url, blog_html, angle_type, channel, published_at, created_at, product_id, tracking_id, travel_packages(id, title, destination, price, duration, nights, category)')
        .eq('slug', slug)
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0) {
        return NextResponse.json({ error: '글을 찾을 수 없습니다' }, { status: 404 });
      }

      return NextResponse.json({ post: data[0] });
    }

    // 목록 조회
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('content_creatives')
      .select('id, slug, seo_title, seo_description, og_image_url, angle_type, published_at, product_id, travel_packages(id, title, destination, price, duration, category)', { count: 'exact' })
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (destination) query = query.eq('travel_packages.destination', destination);

    const { data, error, count } = await query;
    if (error) throw error;

    return NextResponse.json({
      posts: data || [],
      total: count ?? 0,
      page,
      totalPages: Math.ceil((count ?? 0) / limit),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
