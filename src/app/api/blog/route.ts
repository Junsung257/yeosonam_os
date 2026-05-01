import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { notifyIndexing } from '@/lib/indexing';
import { runQualityGates } from '@/lib/blog-quality-gate';

/**
 * 공개 블로그 API — 발행된(published) 블로그 글만 반환
 * GET /api/blog          → 목록 (페이지네이션)
 * GET /api/blog?slug=xxx → 단건 조회
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ posts: [] });

  const { searchParams } = request.nextUrl;
  const slug = searchParams.get('slug');
  const id = searchParams.get('id');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit = Math.min(50, parseInt(searchParams.get('limit') ?? '12'));
  const destination = searchParams.get('destination');

  try {
    // 단건 조회 (id) — 관리자 편집용 (status 무관)
    if (id) {
      const { data, error } = await supabaseAdmin
        .from('content_creatives')
        .select('id, slug, seo_title, seo_description, og_image_url, blog_html, angle_type, channel, status, category, tracking_id, tone, published_at, created_at, updated_at, product_id, travel_packages(id, title, destination, price, duration, nights, category)')
        .eq('id', id)
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0) {
        return NextResponse.json({ error: '글을 찾을 수 없습니다' }, { status: 404 });
      }
      return NextResponse.json({ post: data[0] });
    }

    // 관리자 목록 조회 (admin=1): 모든 상태(draft/published/archived) 포함
    if (searchParams.get('admin') === '1') {
      const adminStatus = searchParams.get('status'); // draft|published|archived|null
      let adminQuery = supabaseAdmin
        .from('content_creatives')
        .select('id, slug, seo_title, status, category, published_at, created_at, view_count, topic_source, travel_packages(title, destination)', { count: 'exact' })
        .eq('channel', 'naver_blog')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (adminStatus && adminStatus !== 'all') {
        adminQuery = adminQuery.eq('status', adminStatus);
      }
      const { data, count, error } = await adminQuery;
      if (error) throw error;
      return NextResponse.json({ posts: data || [], total: count ?? 0 });
    }

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

// ── POST: 새 블로그 글 저장 ─────────────────────────────────
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { blog_html, slug, seo_title, seo_description, og_image_url,
      product_id, category, status: reqStatus, angle_type } = body;

    if (!blog_html || !slug) {
      return NextResponse.json({ error: 'blog_html과 slug는 필수입니다.' }, { status: 400 });
    }

    // slug 정규화
    const cleanSlug = slug.toLowerCase()
      .replace(/[^a-z0-9가-힣-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      .substring(0, 200);

    const status = reqStatus === 'published' ? 'published' : 'draft';

    const insertData: Record<string, unknown> = {
      blog_html,
      slug: cleanSlug,
      seo_title: seo_title || null,
      seo_description: seo_description || null,
      og_image_url: og_image_url || null,
      channel: 'naver_blog',
      angle_type: angle_type || 'value',
      status,
      category: category || (product_id ? 'product_intro' : null),
    };

    if (product_id) insertData.product_id = product_id;
    if (status === 'published') insertData.published_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('content_creatives')
      .insert(insertData)
      .select()

    if (error) throw error;

    if (status === 'published') {
      revalidatePath('/blog');
      revalidatePath(`/blog/${cleanSlug}`);

      // 통합 색인 알림 (Google Indexing API + IndexNow + Bing sitemap ping)
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
      notifyIndexing(`${baseUrl}/blog/${cleanSlug}`, baseUrl)
        .then(r => console.log(`[blog POST] indexing notified: google=${r.google}, indexnow=${r.indexnow}`))
        .catch(() => {});
    }

    return NextResponse.json({ post: data?.[0], success: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '저장 실패' }, { status: 500 });
  }
}

// ── PATCH: 블로그 글 수정 ───────────────────────────────────
export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { id, blog_html, slug, seo_title, seo_description, og_image_url, status: reqStatus, category, force_revalidate } = body;

    if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 });

    // force_revalidate: 콘텐츠 변경 없이 캐시만 강제 무효화 + 색인 재요청
    // (ISR이 빈 결과로 stuck 됐을 때 운영자가 수동 복구하는 비상 경로)
    if (force_revalidate === true) {
      const { data: row, error: rowErr } = await supabaseAdmin
        .from('content_creatives')
        .select('slug, status, channel')
        .eq('id', id)
        .limit(1);
      if (rowErr) throw rowErr;
      const target = row?.[0];
      if (!target?.slug) {
        return NextResponse.json({ error: '글을 찾을 수 없거나 slug 없음' }, { status: 404 });
      }
      revalidatePath('/blog');
      revalidatePath(`/blog/${target.slug}`);
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
      const report = await notifyIndexing(`${baseUrl}/blog/${target.slug}`, baseUrl);
      return NextResponse.json({ success: true, force_revalidate: true, slug: target.slug, indexing: report });
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (blog_html !== undefined) updateData.blog_html = blog_html;
    if (slug !== undefined) {
      updateData.slug = slug.toLowerCase()
        .replace(/[^a-z0-9가-힣-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
        .substring(0, 200);
    }
    if (seo_title !== undefined) updateData.seo_title = seo_title;
    if (seo_description !== undefined) updateData.seo_description = seo_description;
    if (og_image_url !== undefined) updateData.og_image_url = og_image_url;
    if (category !== undefined) updateData.category = category;

    // 상태 변경
    let qaReport: Awaited<ReturnType<typeof runQualityGates>> | null = null;
    if (reqStatus === 'published') {
      updateData.status = 'published';
      updateData.published_at = new Date().toISOString();

      // v1.5 quality gate — 수동 발행도 cron 발행과 동일 게이트 통과 검증.
      // 실패해도 차단하지 않음 (어드민의 의도적 발행 존중) — 결과만 quality_gate 컬럼에 저장 + 응답 warnings.
      try {
        const { data: existing } = await supabaseAdmin
          .from('content_creatives')
          .select('blog_html, slug, destination, angle_type, product_id, travel_packages(destination)')
          .eq('id', id)
          .limit(1);
        const row = existing?.[0] as {
          blog_html?: string | null;
          slug?: string | null;
          destination?: string | null;
          angle_type?: string | null;
          product_id?: string | null;
          travel_packages?: { destination?: string | null } | null;
        } | undefined;
        const finalHtml = (blog_html as string | undefined) ?? row?.blog_html ?? '';
        const finalSlugForQa = (updateData.slug as string | undefined) ?? row?.slug ?? '';
        const dest = row?.travel_packages?.destination ?? row?.destination ?? null;
        if (finalHtml && finalSlugForQa) {
          qaReport = await runQualityGates({
            blog_html: finalHtml,
            slug: finalSlugForQa,
            destination: dest,
            angle_type: row?.angle_type ?? null,
            blog_type: row?.product_id ? 'product' : 'info',
            primary_keyword: dest,
            excludeContentCreativeId: id,
          });
          updateData.quality_gate = qaReport;
        }
      } catch (qaErr) {
        console.warn('[blog PATCH] quality gate 실행 실패 (무시):', qaErr);
      }
    } else if (reqStatus === 'draft') {
      updateData.status = 'draft';
    }

    const { data, error } = await supabaseAdmin
      .from('content_creatives')
      .update(updateData)
      .eq('id', id)
      .select()

    if (error) throw error;

    if (reqStatus === 'published') {
      const finalSlug = (updateData.slug as string) || (data?.[0] as any)?.slug;
      revalidatePath('/blog');
      if (finalSlug) revalidatePath(`/blog/${finalSlug}`);

      // 통합 색인 알림 (Google Indexing API + IndexNow)
      if (finalSlug) {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
        notifyIndexing(`${baseUrl}/blog/${finalSlug}`, baseUrl)
          .then(r => console.log(`[blog PATCH] indexing notified: google=${r.google}, indexnow=${r.indexnow}`))
          .catch(() => {});
      }
    }

    return NextResponse.json({
      post: data?.[0],
      success: true,
      // v1.5 게이트 실패 시 어드민 UI에 경고 표시용
      quality_warnings: qaReport && !qaReport.passed
        ? qaReport.gates.filter(g => !g.passed).map(g => ({ gate: g.gate, reason: g.reason }))
        : null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '수정 실패' }, { status: 500 });
  }
}
