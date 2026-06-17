import { NextRequest } from 'next/server';
import { isAdminRequest } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { notifyIndexingBatch } from '@/lib/indexing';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { revalidatePublicBlogCache } from '@/lib/revalidate-blog-cache';

type BulkReindexBody = {
  batchSize?: number;
  dryRun?: boolean;
  since?: string;
};

type BlogPostForReindex = {
  id: string;
  slug: string;
  published_at: string;
};

type BulkReindexResult = {
  slug: string;
  google: string;
  indexnow: string;
  google_error?: string;
  indexnow_error?: string;
};

/**
 * POST /api/blog/bulk-reindex
 *
 * Revalidates published blog pages and sends batched indexing notifications.
 * Normal blog URLs use Google Search Console sitemap submit plus IndexNow.
 */
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return apiResponse({ error: 'admin 권한 필요' }, { status: 403 });
  }
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB 미설정' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as BulkReindexBody;
  const batchSize = Math.min(200, Math.max(1, Number(body.batchSize) || 200));
  const dryRun = body.dryRun === true;
  const since = body.since;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';

  try {
    let query = supabaseAdmin
      .from('content_creatives')
      .select('id, slug, published_at')
      .eq('status', 'published')
      .eq('channel', 'naver_blog')
      .not('slug', 'is', null)
      .order('published_at', { ascending: false })
      .limit(batchSize);

    if (since) query = query.gte('published_at', since);

    const { data, error } = await query;
    if (error) throw error;

    const posts = (data || []) as BlogPostForReindex[];

    if (dryRun) {
      return apiResponse({
        dryRun: true,
        found: posts.length,
        slugs: posts.map((post) => post.slug),
      });
    }

    if (posts.length === 0) {
      return apiResponse({
        processed: 0,
        google_success: 0,
        indexnow_success: 0,
        results: [] as BulkReindexResult[],
      });
    }

    for (const post of posts) {
      revalidatePublicBlogCache(post.slug);
    }

    const urls = posts.map((post) => `${baseUrl}/blog/${post.slug}`);
    const reports = await notifyIndexingBatch(urls, baseUrl);
    const reportRows = reports.map((report, idx) => ({
      url: report.url,
      content_creative_id: posts[idx]?.id ?? null,
      google_status: report.google,
      google_error: report.google_error ?? null,
      indexnow_status: report.indexnow,
      indexnow_error: report.indexnow_error ?? null,
      sitemap_pings: report.sitemap_pings,
      duration_ms: report.duration_ms,
    }));
    const { error: reportError } = await supabaseAdmin
      .from('indexing_reports')
      .insert(reportRows);

    const results: BulkReindexResult[] = reports.map((report, idx) => ({
      slug: posts[idx]?.slug ?? report.url,
      google: report.google,
      indexnow: report.indexnow,
      google_error: report.google_error,
      indexnow_error: report.indexnow_error,
    }));

    return apiResponse({
      processed: results.length,
      google_success: results.filter((result) => result.google === 'success').length,
      indexnow_success: results.filter((result) => result.indexnow === 'success').length,
      report_persisted: !reportError,
      report_persist_error: reportError?.message ?? null,
      results,
    });
  } catch (err) {
    return apiResponse(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
