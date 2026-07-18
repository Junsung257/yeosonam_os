import { NextRequest, NextResponse } from 'next/server';
import { cacheHeader } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
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
import {
  evaluateBlogInformationClaimPublishGate,
  toBlogInformationClaimValidationMeta,
} from '@/lib/blog-information-claim-publish-gate';
import {
  buildBlogInformationRepresentativeKey,
  readBlogInformationRepresentativeIdentity,
} from '@/lib/blog-information-representative';
import { publishBlogInformationAtomically } from '@/lib/blog-information-atomic-publication';
import { createBlogInformationContentFingerprint } from '@/lib/blog-information-review-workflow';

const BLOG_SELECT = 'id, slug, seo_title, seo_description, og_image_url, blog_html, angle_type, channel, status, tracking_id, tone, created_at, updated_at, published_at, product_id, destination, review_status, category, content_type, topic_source, generation_meta, travel_packages(id, title, destination)';

const getHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) return NextResponse.json({ queue: [] });

  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') || 'draft';
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '50'));

  try {
    const { data, error, count } = await supabaseAdmin
      .from('content_creatives')
      .select(BLOG_SELECT, { count: 'exact' })
      .eq('channel', 'naver_blog')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const { count: pendingCount } = await supabaseAdmin
      .from('content_creatives')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'naver_blog')
      .eq('status', 'draft');

    return NextResponse.json({
      queue: data || [],
      total: count ?? 0,
      pending_count: pendingCount ?? 0,
    }, { headers: cacheHeader(60) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Query failed' }, { status: 500 });
  }
};

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB not configured' }, { status: 503 });

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
      return NextResponse.json({ error: 'creative_id and action are required' }, { status: 400 });
    }

    if (action === 'approve') {
      if (!slug) {
        return NextResponse.json({ error: 'slug is required before publishing' }, { status: 400 });
      }
      if (!/^[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*$/u.test(slug) || slug.length > 200) {
        return NextResponse.json({ error: 'slug format is invalid' }, { status: 400 });
      }

      const { data: existing, error: existingError } = await supabaseAdmin
        .from('content_creatives')
        .select(BLOG_SELECT)
        .eq('id', creative_id)
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
        review_status?: string | null;
        category?: string | null;
        content_type?: string | null;
        topic_source?: string | null;
        generation_meta?: Record<string, unknown> | null;
        travel_packages?: { destination?: string | null } | Array<{ destination?: string | null }> | null;
      } | undefined;
      if (!row?.blog_html) {
        return NextResponse.json({ error: 'blog_html is missing' }, { status: 400 });
      }

      const reviewBlock = getInformationalReviewBlockReason({
        productId: row.product_id ?? null,
        reviewStatus: row.review_status ?? null,
        title: seo_title ?? row.seo_title ?? null,
        category: row.category ?? null,
        contentType: row.content_type ?? null,
        topic: row.topic_source ?? null,
      });
      const changesReviewedHighRiskContent = reviewBlock == null
        && row.product_id == null
        && row.review_status === 'approved'
        && getInformationalReviewBlockReason({
          reviewStatus: 'none',
          title: row.seo_title ?? null,
          category: row.category ?? null,
          contentType: row.content_type ?? null,
          topic: row.topic_source ?? null,
        }) === 'high_risk_human_review_required'
        && [seo_title, seo_description].some((value) => value !== undefined);
      if (reviewBlock || changesReviewedHighRiskContent) {
        return NextResponse.json({
          error: 'Human review approval is required before publishing this informational draft',
          review_reason: reviewBlock ?? 'reviewed_content_changed',
        }, { status: 409 });
      }

      const finalTitle = seo_title ?? row.seo_title ?? null;
      const finalDescription = seo_description ?? row.seo_description ?? null;
      const destination = resolveBlogDestination(row);
      const prepared = await prepareBlogForPublish({
        id: creative_id,
        blog_html: row.blog_html,
        slug,
        seo_title: finalTitle,
        seo_description: finalDescription,
        destination,
        angle_type: row.angle_type ?? null,
        product_id: row.product_id ?? null,
        primary_keyword: destination || finalTitle || slug,
        excludeContentCreativeId: creative_id,
      });
      const qaReport = prepared.report;
      if (!qaReport.passed) {
        return NextResponse.json({
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
        contentKey: slug,
        markdown: prepared.blogHtml,
        productId: row.product_id ?? null,
        reviewStatus: row.review_status ?? null,
        expectedScope: { destination: row.destination ?? undefined },
      });
      if (!claimReport.passed) {
        return NextResponse.json({
          error: 'Informational claim evidence gate failed',
          claim_validation: claimReport,
        }, { status: 422 });
      }
      const identity = row.product_id
        ? null
        : readBlogInformationRepresentativeIdentity(row.generation_meta ?? null);
      if (!row.product_id && !identity) {
        throw new Error('blog_information_representative_identity_missing');
      }
      const claimValidationMeta = toBlogInformationClaimValidationMeta(claimReport);
      const publishedAt = new Date().toISOString();

      const updateData: Record<string, unknown> = {
        status: row.product_id ? 'published' : 'draft',
        published_at: row.product_id ? publishedAt : null,
        slug,
        blog_html: prepared.blogHtml,
        generation_meta: {
          ...(row.generation_meta || {}),
          information_claim_validation: claimValidationMeta,
          ...(identity ? {
            information_representative: {
              representative_key: buildBlogInformationRepresentativeKey(identity),
              status: 'pending_publication',
              canonical_slug: null,
            },
          } : {}),
        },
      };
      if (seo_title) updateData.seo_title = seo_title;
      if (seo_description) updateData.seo_description = seo_description;
      if (og_image_url) updateData.og_image_url = og_image_url;
      applyBlogPublishQualityToUpdate(updateData, qaReport);

      const { error } = await supabaseAdmin
        .from('content_creatives')
        .update(updateData)
        .eq('id', creative_id);

      if (error) throw error;

      if (identity) {
        await publishBlogInformationAtomically({
          creativeId: creative_id,
          contentFingerprint: createBlogInformationContentFingerprint({
            blogHtml: prepared.blogHtml,
            seoTitle: finalTitle,
            seoDescription: finalDescription,
            slug,
          }),
          validationMeta: { information_claim_validation: claimValidationMeta },
          qualityGate: qaReport.qualityGate,
          publishedAt,
          identity,
          reservationOwner: `content_queue_approve:${creative_id}`,
        });
      }

      revalidatePublicBlogCache(slug, destination);

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';
      if (row.product_id) {
        void enqueueBlogIndexingJob({
          slug,
          baseUrl,
          contentCreativeId: creative_id,
          source: 'content_queue_approve',
        }).then((result) => {
          if (!result.ok) console.warn('[content-queue approve] indexing enqueue failed:', result.error);
        });
      }

      return NextResponse.json({ ok: true, status: 'published', seo_score: qaReport.seoScore.score });
    }

    if (action === 'reject') {
      const { error } = await supabaseAdmin
        .from('content_creatives')
        .update({
          status: 'archived',
          extra_prompt: reject_reason ? `[rejected] ${reject_reason}` : undefined,
        })
        .eq('id', creative_id);

      if (error) throw error;
      return NextResponse.json({ ok: true, status: 'archived' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Processing failed' }, { status: 500 });
  }
};

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
