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
import { revalidatePublicBlogCache } from '@/lib/revalidate-blog-cache';
import { getInformationalReviewBlockReason } from '@/lib/blog-publication-review-policy';
import { evaluateBlogInformationClaimPublishGate } from '@/lib/blog-information-claim-publish-gate';
import { ensureBlogInformationRepresentativeForPublish } from '@/lib/blog-information-representative-repository';
import { requireAdminRequest } from '@/lib/admin-guard';
import { isContentHubAction, resolveContentHubStatusTransition } from '@/lib/content-hub-status-transition';

const BLOG_SELECT = 'status, slug, blog_html, seo_title, seo_description, destination, angle_type, product_id, review_status, category, content_type, topic_source, generation_meta, travel_packages(destination)';

type BlogPublishRow = {
  status: string;
  slug?: string | null;
  blog_html?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  destination?: string | null;
  angle_type?: string | null;
  product_id?: string | null;
  review_status?: string | null;
  category?: string | null;
  content_type?: string | null;
  topic_source?: string | null;
  generation_meta?: Record<string, unknown> | null;
  travel_packages?: { destination?: string | null } | Array<{ destination?: string | null }> | null;
};

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB not configured' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { creative_id, action } = body;

    if (!creative_id) {
      return apiResponse({ error: 'creative_id required' }, { status: 400 });
    }
    if (!isContentHubAction(action)) {
      return apiResponse({ error: 'invalid content-hub action' }, { status: 400 });
    }

    const { data: creative, error: creativeError } = await supabaseAdmin
      .from('content_creatives')
      .select(BLOG_SELECT)
      .eq('id', creative_id)
      .limit(1);
    if (creativeError) throw creativeError;
    const row = (creative?.[0] ?? null) as BlogPublishRow | null;
    if (!row) {
      return apiResponse({ error: 'content creative not found' }, { status: 404 });
    }

    const transition = resolveContentHubStatusTransition(row.status, action);
    if (!transition.ok) {
      return apiResponse({
        error: 'content-hub status transition is not allowed',
        current_status: row.status,
        action,
      }, { status: 409 });
    }

    const status = transition.targetStatus;
    const updateData: Record<string, unknown> = { status };

    if (status === 'published' || status === 'manually_published') {
      if (!row?.blog_html || !row.slug) {
        return apiResponse({ error: 'blog_html or slug is missing' }, { status: 400 });
      }

      const reviewBlock = getInformationalReviewBlockReason({
        productId: row.product_id ?? null,
        reviewStatus: row.review_status ?? null,
        title: row.seo_title ?? null,
        category: row.category ?? null,
        contentType: row.content_type ?? null,
        topic: row.topic_source ?? null,
      });
      if (reviewBlock) {
        return apiResponse({
          error: 'Human review approval is required before publishing this informational draft',
          review_reason: reviewBlock,
        }, { status: 409 });
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

      const claimReport = await evaluateBlogInformationClaimPublishGate({
        creativeId: creative_id,
        contentKey: row.slug,
        markdown: prepared.blogHtml,
        productId: row.product_id ?? null,
        reviewStatus: row.review_status ?? null,
      });
      if (!claimReport.passed) {
        return apiResponse({
          error: 'Informational claim evidence gate failed',
          claim_validation: claimReport,
        }, { status: 422 });
      }
      const representative = await ensureBlogInformationRepresentativeForPublish({
        creativeId: creative_id,
        slug: row.slug,
        title: row.seo_title ?? row.slug,
        markdown: prepared.blogHtml,
        productId: row.product_id ?? null,
        generationMeta: row.generation_meta ?? null,
      });
      if (representative) {
        updateData.generation_meta = {
          ...(row.generation_meta || {}),
          information_representative: {
            representative_key: representative.representativeKey,
            status: 'active',
            canonical_slug: representative.canonicalSlug,
          },
        };
      }

      updateData.published_at = new Date().toISOString();
      updateData.blog_html = prepared.blogHtml;
      applyBlogPublishQualityToUpdate(updateData, qaReport);
    }

    const { data: updated, error } = await supabaseAdmin
      .from('content_creatives')
      .update(updateData)
      .eq('id', creative_id)
      .eq('status', row.status)
      .select('id')
      .limit(1);

    if (error) throw error;
    if (!updated?.length) {
      return apiResponse(
        { error: 'content creative status changed during publish; retry with current state' },
        { status: 409 },
      );
    }

    if (status === 'published' || status === 'manually_published') {
      const slug = row?.slug;
      const destination = row ? resolveBlogDestination(row) : null;
      revalidatePublicBlogCache(slug ?? null, destination);

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
