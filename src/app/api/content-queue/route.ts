import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * VA 콘텐츠 검수 API
 * GET  — 검수 대기 목록 (draft 블로그)
 * POST — 승인(publish) / 반려(reject)
 */

// GET: 검수 큐 조회
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ queue: [] });

  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') || 'draft'; // draft | published | archived
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '50'));

  try {
    const { data, error, count } = await supabaseAdmin
      .from('content_creatives')
      .select(
        'id, slug, seo_title, seo_description, og_image_url, blog_html, angle_type, channel, status, tracking_id, tone, created_at, updated_at, published_at, product_id, travel_packages(id, title, destination)',
        { count: 'exact' },
      )
      .eq('channel', 'naver_blog')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // 대기 건수 (draft)
    const { count: pendingCount } = await supabaseAdmin
      .from('content_creatives')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'naver_blog')
      .eq('status', 'draft');

    return NextResponse.json({
      queue: data || [],
      total: count ?? 0,
      pending_count: pendingCount ?? 0,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}

// POST: 승인(publish) 또는 반려(archive)
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { creative_id, action, slug, seo_title, seo_description, og_image_url, reject_reason } = body as {
      creative_id: string;
      action: 'approve' | 'reject';
      slug?: string;
      seo_title?: string;
      seo_description?: string;
      og_image_url?: string;
      reject_reason?: string;
    };

    if (!creative_id || !action) {
      return NextResponse.json({ error: 'creative_id, action 필수' }, { status: 400 });
    }

    if (action === 'approve') {
      // 승인: slug 필수 + 형식 검증
      if (!slug) {
        return NextResponse.json({ error: '발행하려면 slug가 필수입니다' }, { status: 400 });
      }
      if (!/^[a-z0-9가-힣]+(?:-[a-z0-9가-힣]+)*$/.test(slug) || slug.length > 200) {
        return NextResponse.json({ error: 'slug는 영소문자/숫자/한글과 하이픈만 허용 (200자 이내)' }, { status: 400 });
      }

      const updateData: Record<string, unknown> = {
        status: 'published',
        published_at: new Date().toISOString(),
        slug,
      };
      if (seo_title) updateData.seo_title = seo_title;
      if (seo_description) updateData.seo_description = seo_description;
      if (og_image_url) updateData.og_image_url = og_image_url;

      const { error } = await supabaseAdmin
        .from('content_creatives')
        .update(updateData)
        .eq('id', creative_id);

      if (error) throw error;

      // 캐시 즉시 갱신: 블로그 목록 + 해당 글 + 목적지 카테고리
      revalidatePath('/blog');
      if (slug) revalidatePath(`/blog/${slug}`);

      // 목적지 카테고리 페이지도 재검증
      const { data: creative } = await supabaseAdmin
        .from('content_creatives')
        .select('product_id, travel_packages(destination)')
        .eq('id', creative_id)
        .limit(1);
      const dest = (creative?.[0] as any)?.travel_packages?.destination;
      if (dest) revalidatePath(`/blog/destination/${encodeURIComponent(dest)}`);

      // 통합 색인 알림 (Google Indexing API + IndexNow + Bing sitemap)
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
      const { notifyIndexing } = await import('@/lib/indexing');
      notifyIndexing(`${baseUrl}/blog/${slug}`, baseUrl)
        .then(r => console.log(`[content-queue approve] indexing notified: google=${r.google}, indexnow=${r.indexnow}`))
        .catch(() => {});

      return NextResponse.json({ ok: true, status: 'published' });
    }

    if (action === 'reject') {
      // 반려: archived 상태로 변경
      const { error } = await supabaseAdmin
        .from('content_creatives')
        .update({
          status: 'archived',
          extra_prompt: reject_reason ? `[반려사유] ${reject_reason}` : undefined,
        })
        .eq('id', creative_id);

      if (error) throw error;
      return NextResponse.json({ ok: true, status: 'archived' });
    }

    return NextResponse.json({ error: '유효하지 않은 action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '처리 실패' }, { status: 500 });
  }
}
