import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/supabase';
import { enqueueBlogIndexingJob } from '@/lib/blog-indexing-outbox';
import {
  applyBlogPublishQualityToUpdate,
  blogPublishQualityWarnings,
  prepareBlogForPublish,
  resolveBlogDestination,
  type BlogPublishQualityReport,
} from '@/lib/blog-publish-quality';
import { apiResponse } from '@/lib/api-response';
import { revalidatePublicBlogCache } from '@/lib/revalidate-blog-cache';

type AbortableQuery<T> = {
  abortSignal: (signal: AbortSignal) => PromiseLike<T>;
};

const BLOG_PUBLIC_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400';
const BLOG_DEGRADED_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120, stale-if-error=600';

function isAbortLikeError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    return error.name === 'AbortError' || /abort|timeout|timed out|connection timeout/i.test(error.message);
  }
  const message = typeof error === 'object' ? JSON.stringify(error) : String(error);
  return /abort|timeout|timed out|connection timeout/i.test(message);
}

async function runApiBlogQuery<T>(label: string, query: AbortableQuery<T>, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await query.abortSignal(controller.signal);
  } catch (error) {
    console.warn(`[api/blog] ${label} query timed out or failed`, error instanceof Error ? error.message : error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 200);
}

function qualityGateFailedResponse(report: BlogPublishQualityReport) {
  return apiResponse({
    error: 'Blog publish quality gate failed',
    summary: report.summary,
    quality_warnings: blogPublishQualityWarnings(report),
    blog_quality_score: report.blogQualityScore,
    quality_gate: report.qualityGate,
    seo_score: report.seoScore,
    readability: report.readability,
  }, { status: 422 });
}

function degradedBlogListResponse(reason: string, page: number, limit: number) {
  return apiResponse({
    posts: [],
    total: 0,
    page,
    totalPages: 0,
    degraded: true,
    reason,
  }, {
    headers: {
      'Cache-Control': BLOG_DEGRADED_CACHE_CONTROL,
      'X-Data-State': 'degraded',
    },
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const slug = searchParams.get('slug');
  const id = searchParams.get('id');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit = Math.min(50, parseInt(searchParams.get('limit') ?? '12'));
  const destination = searchParams.get('destination');

  if (!isSupabaseConfigured || !isSupabaseAdminConfigured) {
    if (!id && !slug && searchParams.get('admin') !== '1') {
      return degradedBlogListResponse('Blog database is not configured', page, limit);
    }
    return apiResponse({ error: 'Blog database is not configured' }, { status: 503 });
  }

  try {
    if (id) {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(id)) {
        return apiResponse({ error: 'Post not found' }, { status: 404 });
      }
      const { data, error } = await runApiBlogQuery('id', supabaseAdmin
        .from('content_creatives')
        .select('id, slug, seo_title, seo_description, og_image_url, blog_html, angle_type, channel, status, category, tracking_id, tone, published_at, created_at, updated_at, product_id, travel_packages(id, title, destination, price, duration, nights, category)')
        .eq('id', id)
        .limit(1));

      if (error) throw error;
      if (!data || data.length === 0) {
        return apiResponse({ error: 'Post not found' }, { status: 404 });
      }
      return apiResponse({ post: data[0] });
    }

    if (searchParams.get('admin') === '1') {
      const adminStatus = searchParams.get('status');
      let adminQuery = supabaseAdmin
        .from('content_creatives')
        .select('id, slug, seo_title, status, category, published_at, created_at, view_count, topic_source, travel_packages(title, destination)', { count: 'exact' })
        .eq('channel', 'naver_blog')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (adminStatus && adminStatus !== 'all') {
        adminQuery = adminQuery.eq('status', adminStatus);
      }
      const { data, count, error } = await runApiBlogQuery('admin', adminQuery);
      if (error) throw error;
      return apiResponse({ posts: data || [], total: count ?? 0 });
    }

    if (slug) {
      const { data, error } = await runApiBlogQuery('slug', supabaseAdmin
        .from('content_creatives')
        .select('id, slug, seo_title, seo_description, og_image_url, angle_type, channel, published_at, created_at, product_id, tracking_id, travel_packages(id, title, destination, price, duration, nights, category)')
        .eq('slug', slug)
        .eq('status', 'published')
        .eq('channel', 'naver_blog')
        .not('slug', 'is', null)
        .limit(1));

      if (error) throw error;
      if (!data || data.length === 0) {
        return apiResponse({ error: 'Post not found' }, { status: 404 });
      }

      return apiResponse({ post: data[0] }, {
        headers: { 'Cache-Control': BLOG_PUBLIC_CACHE_CONTROL },
      });
    }

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

    const { data, error, count } = await runApiBlogQuery('list', query);
    if (error) throw error;

    return apiResponse({
      posts: data || [],
      total: count ?? 0,
      page,
      totalPages: Math.ceil((count ?? 0) / limit),
    }, {
      headers: { 'Cache-Control': BLOG_PUBLIC_CACHE_CONTROL },
    });
  } catch (err) {
    if (isAbortLikeError(err)) {
      if (!id && !slug && searchParams.get('admin') !== '1') {
        return degradedBlogListResponse('Blog database request timed out', page, limit);
      }
      return apiResponse(
        { error: 'Blog database request timed out' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return apiResponse(
      { error: err instanceof Error ? err.message : 'Query failed' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return apiResponse({ error: 'DB not configured' }, { status: 503 });

  try {
    const body = await request.json();
    const {
      blog_html,
      slug,
      seo_title,
      seo_description,
      og_image_url,
      product_id,
      category,
      status: reqStatus,
      angle_type,
    } = body;

    if (!blog_html || !slug) {
      return apiResponse({ error: 'blog_html and slug are required' }, { status: 400 });
    }

    const cleanSlug = normalizeSlug(slug);
    const status = reqStatus === 'published' ? 'published' : 'draft';

    let destinationForQa: string | null = null;
    if (product_id) {
      const { data: packageRows, error: packageError } = await supabaseAdmin
        .from('travel_packages')
        .select('destination')
        .eq('id', product_id)
        .limit(1);
      if (packageError) throw packageError;
      destinationForQa = packageRows?.[0]?.destination ?? null;
    }

    let qaReport: BlogPublishQualityReport | null = null;
    let finalBlogHtml = blog_html;
    if (status === 'published') {
      const prepared = await prepareBlogForPublish({
        blog_html,
        slug: cleanSlug,
        seo_title: seo_title || null,
        seo_description: seo_description || null,
        destination: destinationForQa,
        angle_type: angle_type || null,
        product_id: product_id || null,
        primary_keyword: destinationForQa || seo_title || cleanSlug,
      });
      qaReport = prepared.report;
      if (!qaReport.passed) {
        return qualityGateFailedResponse(qaReport);
      }
      finalBlogHtml = prepared.blogHtml;
    }

    const insertData: Record<string, unknown> = {
      blog_html: finalBlogHtml,
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
    if (qaReport) applyBlogPublishQualityToUpdate(insertData, qaReport);

    const { data, error } = await supabaseAdmin
      .from('content_creatives')
      .insert(insertData)
      .select();

    if (error) throw error;

    if (status === 'published') {
      revalidatePublicBlogCache(cleanSlug);

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';
      const contentCreativeId = (data?.[0] as { id?: string } | undefined)?.id ?? null;
      void enqueueBlogIndexingJob({
        slug: cleanSlug,
        baseUrl,
        contentCreativeId,
        source: 'api_blog_post',
      }).then((result) => {
        if (!result.ok) console.warn('[blog POST] indexing enqueue failed:', result.error);
      });
    }

    return apiResponse({ post: data?.[0], success: true }, { status: 201 });
  } catch (err) {
    return apiResponse({ error: err instanceof Error ? err.message : 'Save failed' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return apiResponse({ error: 'DB not configured' }, { status: 503 });

  try {
    const body = await request.json();
    const { id, blog_html, slug, seo_title, seo_description, og_image_url, status: reqStatus, category, force_revalidate } = body;

    if (!id) return apiResponse({ error: 'id required' }, { status: 400 });

    if (force_revalidate === true) {
      const { data: row, error: rowErr } = await supabaseAdmin
        .from('content_creatives')
        .select('slug, status, channel')
        .eq('id', id)
        .limit(1);
      if (rowErr) throw rowErr;
      const target = row?.[0];
      if (!target?.slug) {
        return apiResponse({ error: 'Post not found or slug missing' }, { status: 404 });
      }
      revalidatePublicBlogCache(target.slug);
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';
      const queued = await enqueueBlogIndexingJob({
        slug: target.slug,
        baseUrl,
        contentCreativeId: id,
        source: 'api_blog_force_revalidate',
      });
      return apiResponse({ success: true, force_revalidate: true, slug: target.slug, indexing_queued: queued });
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (blog_html !== undefined) updateData.blog_html = blog_html;
    if (slug !== undefined) updateData.slug = normalizeSlug(slug);
    if (seo_title !== undefined) updateData.seo_title = seo_title;
    if (seo_description !== undefined) updateData.seo_description = seo_description;
    if (og_image_url !== undefined) updateData.og_image_url = og_image_url;
    if (category !== undefined) updateData.category = category;

    let qaReport: BlogPublishQualityReport | null = null;
    if (reqStatus === 'published') {
      updateData.status = 'published';
      updateData.published_at = new Date().toISOString();

      try {
        const { data: existing, error: existingError } = await supabaseAdmin
          .from('content_creatives')
          .select('blog_html, slug, seo_title, seo_description, destination, angle_type, product_id, travel_packages(destination)')
          .eq('id', id)
          .limit(1);
        if (existingError) throw existingError;
        const row = existing?.[0] as {
          blog_html?: string | null;
          slug?: string | null;
          seo_title?: string | null;
          seo_description?: string | null;
          destination?: string | null;
          angle_type?: string | null;
          product_id?: string | null;
          travel_packages?: { destination?: string | null } | Array<{ destination?: string | null }> | null;
        } | undefined;
        const finalHtml = (blog_html as string | undefined) ?? row?.blog_html ?? '';
        const finalSlug = (updateData.slug as string | undefined) ?? row?.slug ?? '';
        const finalTitle = (seo_title as string | undefined) ?? row?.seo_title ?? null;
        const finalDescription = (seo_description as string | undefined) ?? row?.seo_description ?? null;
        const destination = row ? resolveBlogDestination(row) : null;

        if (!finalHtml || !finalSlug) {
          return apiResponse({ error: 'Blog quality gate input missing' }, { status: 400 });
        }

        const prepared = await prepareBlogForPublish({
          blog_html: finalHtml,
          slug: finalSlug,
          seo_title: finalTitle,
          seo_description: finalDescription,
          destination,
          angle_type: row?.angle_type ?? null,
          product_id: row?.product_id ?? null,
          primary_keyword: destination || finalTitle || finalSlug,
          excludeContentCreativeId: id,
        });
        qaReport = prepared.report;
        updateData.blog_html = prepared.blogHtml;
        applyBlogPublishQualityToUpdate(updateData, qaReport);
      } catch (qaErr) {
        console.warn('[blog PATCH] quality gate failed to run:', qaErr);
        return apiResponse({
          error: 'Blog quality gate failed to run',
          detail: qaErr instanceof Error ? qaErr.message : String(qaErr),
        }, { status: 500 });
      }

      if (!qaReport.passed) {
        return qualityGateFailedResponse(qaReport);
      }
    } else if (reqStatus === 'draft') {
      updateData.status = 'draft';
    }

    const { data, error } = await supabaseAdmin
      .from('content_creatives')
      .update(updateData)
      .eq('id', id)
      .select();

    if (error) throw error;

    if (reqStatus === 'published') {
      const finalSlug = (updateData.slug as string) || (data?.[0] as Record<string, unknown>)?.slug as string;
      revalidatePublicBlogCache(finalSlug || null);

      if (finalSlug) {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';
        void enqueueBlogIndexingJob({
          slug: finalSlug,
          baseUrl,
          contentCreativeId: id,
          source: 'api_blog_patch',
        }).then((result) => {
          if (!result.ok) console.warn('[blog PATCH] indexing enqueue failed:', result.error);
        });
      }
    }

    return apiResponse({
      post: data?.[0],
      success: true,
      quality_warnings: blogPublishQualityWarnings(qaReport),
    });
  } catch (err) {
    return apiResponse({ error: err instanceof Error ? err.message : 'Update failed' }, { status: 500 });
  }
}
