import { revalidatePath } from 'next/cache';
import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  applyBlogPublishQualityToUpdate,
  blogPublishQualityWarnings,
  prepareBlogForPublish,
  resolveBlogDestination,
} from '@/lib/blog-publish-quality';
import { enqueueBlogIndexingJob } from '@/lib/blog-indexing-outbox';

const BLOG_SELECT = 'slug, blog_html, seo_title, seo_description, destination, angle_type, product_id, travel_packages(destination)';

type BlogPublishRow = {
  slug?: string | null;
  blog_html?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  destination?: string | null;
  angle_type?: string | null;
  product_id?: string | null;
  travel_packages?: { destination?: string | null } | Array<{ destination?: string | null }> | null;
};

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB not configured' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { creative_id, action } = body;

    if (!creative_id) {
      return apiResponse({ error: 'creative_id required' }, { status: 400 });
    }

    const status =
      action === 'archive' ? 'archived' :
      action === 'manually_published' ? 'manually_published' :
      'published';
    const updateData: Record<string, unknown> = { status };

    let row: BlogPublishRow | null = null;

    if (status === 'published' || status === 'manually_published') {
      const { data: creative, error: creativeError } = await supabaseAdmin
        .from('content_creatives')
        .select(BLOG_SELECT)
        .eq('id', creative_id)
        .limit(1);
      if (creativeError) throw creativeError;
      row = (creative?.[0] ?? null) as BlogPublishRow | null;
      if (!row?.blog_html || !row.slug) {
        return apiResponse({ error: 'blog_html or slug is missing' }, { status: 400 });
      }

      const destination = resolveBlogDestination(row);
      const prepared = await prepareBlogForPublish({
        id: creative_id,
        blog_html: row.blog_html,
        slug: row.slug,
        seo_title: row.seo_title ?? null,
        seo_description: row.seo_description ?? null,
        destination,
        angle_type: row.angle_type ?? null,
        product_id: row.product_id ?? null,
        primary_keyword: destination || row.seo_title || row.slug,
        excludeContentCreativeId: creative_id,
      });
      const qaReport = prepared.report;
      if (!qaReport.passed) {
        return apiResponse({
          error: 'Blog publish quality gate failed',
          summary: qaReport.summary,
          quality_warnings: blogPublishQualityWarnings(qaReport),
          blog_quality_score: qaReport.blogQualityScore,
          quality_gate: qaReport.qualityGate,
          seo_score: qaReport.seoScore,
          readability: qaReport.readability,
        }, { status: 422 });
      }

      updateData.published_at = new Date().toISOString();
      updateData.blog_html = prepared.blogHtml;
      applyBlogPublishQualityToUpdate(updateData, qaReport);
    }

    const { error } = await supabaseAdmin
      .from('content_creatives')
      .update(updateData)
      .eq('id', creative_id);

    if (error) throw error;

    if (status === 'published' || status === 'manually_published') {
      revalidatePath('/blog');

      const slug = row?.slug;
      const destination = row ? resolveBlogDestination(row) : null;
      if (slug) revalidatePath(`/blog/${slug}`);
      if (destination) {
        revalidatePath(`/blog/destination/${encodeURIComponent(destination)}`);
      }

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';
      if (slug) {
        void enqueueBlogIndexingJob({
          slug,
          baseUrl,
          contentCreativeId: creative_id,
          source: 'content_hub_publish',
        }).then((result) => {
          if (!result.ok) console.warn('[content-hub/publish] indexing enqueue failed:', result.error);
        });
      }
    }

    return apiResponse({ ok: true, status });
  } catch (err) {
    console.error('[content-hub/publish] failed:', sanitizeDbError(err));
    return apiResponse({ error: sanitizeDbError(err, 'Publish failed') }, { status: 500 });
  }
}
