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
import { isCustomerPubliclyOpenable } from '@/lib/package-public-eligibility';
import { isPublicPublicationState } from '@/lib/package-publication/types';
import { fetchAndMergeCurrentPublicPackageCardSnapshots } from '@/lib/package-publication/snapshot-projection';
import { requireAdminRequest } from '@/lib/admin-guard';
import { getInformationalReviewBlockReason } from '@/lib/blog-publication-review-policy';
import {
  evaluateBlogInformationClaimPublishGate,
  toBlogInformationClaimValidationMeta,
} from '@/lib/blog-information-claim-publish-gate';
import { loadPublicBlogCatalog } from '@/lib/blog-public-catalog';
import { buildBlogContentBrief } from '@/lib/blog-content-brief';
import {
  ensureBlogInformationRepresentativeForPublish,
} from '@/lib/blog-information-representative-repository';
import {
  buildBlogInformationRepresentativeKey,
  readBlogInformationRepresentativeIdentity,
  type BlogInformationRepresentativeIdentity,
} from '@/lib/blog-information-representative';
import { publishBlogInformationAtomically } from '@/lib/blog-information-atomic-publication';
import { createBlogInformationContentFingerprint } from '@/lib/blog-information-review-workflow';
import {
  findBlogGenerationDuplicateReport,
  insertBlogCreativeWithDedup,
  isBlogGenerationDedupError,
} from '@/lib/blog-generation-dedup-repository';

type AbortableQuery<T> = {
  abortSignal: (signal: AbortSignal) => PromiseLike<T>;
};

const BLOG_PUBLIC_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400';
const BLOG_STALE_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=300, stale-if-error=86400';
const CONTENT_CREATIVE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidContentCreativeId(id: string): boolean {
  return CONTENT_CREATIVE_ID_RE.test(id);
}

type BlogListPayload = {
  posts: unknown[];
  total: number;
  page: number;
  totalPages: number;
  stale?: boolean;
  staleReason?: string;
};

const lastGoodBlogLists = new Map<string, BlogListPayload>();

function isBlogApiPublicSnapshotCandidate(row: Record<string, unknown>): boolean {
  const publicationState = typeof row.publication_state === 'string' ? row.publication_state : null;
  return isPublicPublicationState(publicationState) && isCustomerPubliclyOpenable(row);
}

async function attachPublicPackageSnapshotToBlogPost<T extends Record<string, unknown>>(post: T): Promise<T> {
  const productId = typeof post.product_id === 'string' ? post.product_id : null;
  if (!productId) return { ...post, travel_packages: null };

  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('id, destination, status, publication_state, package_revision, audit_status, audit_report, updated_at, optional_tours, itinerary_data')
    .eq('id', productId)
    .in('publication_state', ['approved', 'published'])
    .limit(1);
  if (error) throw error;

  const candidate = ((data ?? []) as Array<Record<string, unknown>>).find(isBlogApiPublicSnapshotCandidate);
  if (!candidate) return { ...post, travel_packages: null };

  const publicRows = await fetchAndMergeCurrentPublicPackageCardSnapshots(supabaseAdmin, [candidate]);
  return {
    ...post,
    travel_packages: publicRows[0] ?? null,
  };
}

function blogListCacheKey(page: number, limit: number, destination: string | null): string {
  return JSON.stringify({ page, limit, destination: destination || '' });
}

function staleBlogListResponse(key: string, reason: string) {
  const cached = lastGoodBlogLists.get(key);
  if (!cached) return null;
  return apiResponse({
    ...cached,
    stale: true,
    staleReason: reason,
  }, {
    headers: {
      'Cache-Control': BLOG_STALE_CACHE_CONTROL,
      'X-Data-State': 'stale',
    },
  });
}

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
  const timeoutError = new Error(`${label} query timed out after ${timeoutMs}ms`);
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      query.abortSignal(controller.signal),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(timeoutError);
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    console.warn(`[api/blog] ${label} query timed out or failed`, error instanceof Error ? error.message : error);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
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

function unavailableBlogResponse(reason: string) {
  return apiResponse({
    error: 'Public blog data is temporarily unavailable',
    detail: reason,
  }, {
    status: 503,
    headers: {
      'Cache-Control': 'no-store',
      'X-Data-State': 'unavailable',
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
      return unavailableBlogResponse('Blog database is not configured');
    }
    return apiResponse(
      { error: 'Blog database is not configured' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    if (id) {
      const authError = await requireAdminRequest(request);
      if (authError) return authError;
      if (!isValidContentCreativeId(id)) {
        return apiResponse({ error: 'Post not found' }, { status: 404 });
      }
      const { data, error } = await runApiBlogQuery('id', supabaseAdmin
        .from('content_creatives')
        .select('id, slug, seo_title, seo_description, og_image_url, blog_html, angle_type, channel, status, category, tracking_id, tone, published_at, created_at, updated_at, product_id, destination')
        .eq('id', id)
        .limit(1));

      if (error) throw error;
      if (!data || data.length === 0) {
        return apiResponse({ error: 'Post not found' }, { status: 404 });
      }
      const post = await attachPublicPackageSnapshotToBlogPost(data[0] as Record<string, unknown>);
      return apiResponse({ post });
    }

    if (searchParams.get('admin') === '1') {
      const authError = await requireAdminRequest(request);
      if (authError) return authError;
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
      const post = (await loadPublicBlogCatalog()).find(row => row.slug === slug);
      if (!post) {
        return apiResponse({ error: 'Post not found' }, { status: 404 });
      }

      return apiResponse({ post }, {
        headers: { 'Cache-Control': BLOG_PUBLIC_CACHE_CONTROL },
      });
    }

    const offset = (page - 1) * limit;
    const cacheKey = blogListCacheKey(page, limit, destination);
    const catalog = await loadPublicBlogCatalog();
    const matchingPosts = destination
      ? catalog.filter(post => post.destination === destination)
      : catalog;
    const posts = matchingPosts.slice(offset, offset + limit);
    const total = matchingPosts.length;
    const payload: BlogListPayload = {
      posts,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
    lastGoodBlogLists.set(cacheKey, payload);

    return apiResponse(payload, {
      headers: { 'Cache-Control': BLOG_PUBLIC_CACHE_CONTROL },
    });
  } catch (err) {
    if (isAbortLikeError(err)) {
      if (!id && !slug && searchParams.get('admin') !== '1') {
        const stale = staleBlogListResponse(blogListCacheKey(page, limit, destination), 'Blog database request timed out');
        if (stale) return stale;
        return unavailableBlogResponse('Blog database request timed out');
      }
      return apiResponse(
        { error: 'Blog database request timed out' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!id && searchParams.get('admin') !== '1') {
      return unavailableBlogResponse(err instanceof Error ? err.message : 'Public blog query failed');
    }
    return apiResponse(
      { error: err instanceof Error ? err.message : 'Query failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

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

    if (status === 'published') {
      const reviewBlock = getInformationalReviewBlockReason({
        productId: product_id || null,
        title: seo_title || cleanSlug,
        category: category || null,
      });
      if (reviewBlock) {
        return apiResponse({
          error: 'Human review approval is required before publishing this informational draft',
          review_reason: reviewBlock,
        }, { status: 409 });
      }
    }

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
    let informationIdentity: BlogInformationRepresentativeIdentity | null = null;
    let claimValidationMeta: Record<string, unknown> | null = null;
    const representativeOwner = `api_blog_post:${cleanSlug}`;
    let informationGenerationMeta: Record<string, unknown> | null = null;
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
      const claimReport = await evaluateBlogInformationClaimPublishGate({
        contentKey: cleanSlug,
        markdown: prepared.blogHtml,
        productId: product_id || null,
        expectedScope: { destination: destinationForQa || undefined },
      });
      if (!claimReport.passed) {
        return apiResponse({
          error: 'Informational claim evidence gate failed',
          claim_validation: claimReport,
        }, { status: 422 });
      }
      claimValidationMeta = toBlogInformationClaimValidationMeta(claimReport);
      finalBlogHtml = prepared.blogHtml;
      if (!product_id) {
        const contentBrief = buildBlogContentBrief({
          topic: seo_title || cleanSlug,
          primaryKeyword: seo_title || cleanSlug,
          category: category || null,
        });
        if (!contentBrief.passed) {
          return apiResponse({
            error: 'Informational representative identity is incomplete',
            issues: contentBrief.issues,
          }, { status: 422 });
        }
        informationIdentity = {
          destinationId: contentBrief.plan.destinationId ?? 'global',
          intent: contentBrief.plan.intent,
          audience: contentBrief.plan.audience,
          locale: contentBrief.plan.locale,
        };
        informationGenerationMeta = {
          content_brief: {
            intent_type: contentBrief.plan.intent,
            destination_id: contentBrief.plan.destinationId ?? 'global',
            audience: contentBrief.plan.audience,
            locale: contentBrief.plan.locale,
          },
          information_representative: {
            status: 'pending_publication',
            canonical_slug: null,
          },
          information_claim_validation: claimValidationMeta,
        };
      }
    }

    const insertData: Record<string, unknown> = {
      blog_html: finalBlogHtml,
      slug: cleanSlug,
      title: seo_title || cleanSlug,
      description: seo_description || seo_title || cleanSlug,
      seo_title: seo_title || null,
      seo_description: seo_description || null,
      og_image_url: og_image_url || null,
      channel: 'naver_blog',
      angle_type: angle_type || 'value',
      status: status === 'published' ? 'draft' : status,
      category: category || (product_id ? 'product_intro' : null),
      content_type: product_id ? 'package_intro' : 'guide',
      destination: destinationForQa,
      ...(informationGenerationMeta ? { generation_meta: informationGenerationMeta } : {}),
    };

    if (product_id) insertData.product_id = product_id;
    if (qaReport) applyBlogPublishQualityToUpdate(insertData, qaReport);

    let data: Record<string, unknown>[];
    try {
      const inserted = await insertBlogCreativeWithDedup({
        row: insertData,
        claimOwner: `api-blog-post:${cleanSlug}`,
        allowReviewDraft: status !== 'published',
      });
      data = [inserted.data];
    } catch (error) {
      if (isBlogGenerationDedupError(error)) {
        return apiResponse({
          error: error.report.action === 'review'
            ? '유사한 블로그 제목이 있어 검수 후 생성할 수 있습니다.'
            : '동일한 블로그 제목 또는 슬러그가 이미 존재합니다.',
          blog_generation_dedup: error.report,
        }, { status: error.statusCode });
      }
      throw error;
    }

    if (status === 'published') {
      const contentCreativeId = (data?.[0] as { id?: string } | undefined)?.id ?? null;
      if (!contentCreativeId) throw new Error('Published draft insert did not return an id');
      if (informationGenerationMeta && claimValidationMeta) {
        informationGenerationMeta.information_claim_validation = claimValidationMeta;
      }
      const publishedAt = new Date().toISOString();
      if (!product_id) {
        if (!informationIdentity || !qaReport || !claimValidationMeta) {
          throw new Error('Informational atomic publication inputs are incomplete');
        }
        const publication = await publishBlogInformationAtomically({
          creativeId: contentCreativeId,
          contentFingerprint: createBlogInformationContentFingerprint({
            blogHtml: finalBlogHtml,
            seoTitle: seo_title || null,
            seoDescription: seo_description || null,
            slug: cleanSlug,
          }),
          validationMeta: { information_claim_validation: claimValidationMeta },
          qualityGate: qaReport.qualityGate,
          publishedAt,
          identity: informationIdentity,
          reservationOwner: representativeOwner,
        });
        data[0] = {
          ...(data[0] as Record<string, unknown>),
          status: 'published',
          published_at: publication.publishedAt,
        };
        revalidatePublicBlogCache(cleanSlug);
        return apiResponse({ post: data[0], success: true }, { status: 201 });
      }
      const { data: publishedRows, error: publishError } = await supabaseAdmin
        .from('content_creatives')
        .update({
          status: 'published',
          published_at: publishedAt,
          ...(informationGenerationMeta ? { generation_meta: informationGenerationMeta } : {}),
        })
        .eq('id', contentCreativeId)
        .select();
      if (publishError) throw publishError;
      if (publishedRows?.[0]) data[0] = publishedRows[0];
      revalidatePublicBlogCache(cleanSlug);

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com';
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
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) return apiResponse({ error: 'DB not configured' }, { status: 503 });

  try {
    const body = await request.json();
    const { id, blog_html, slug, seo_title, seo_description, og_image_url, status: reqStatus, category, force_revalidate } = body;

    if (!id) return apiResponse({ error: 'id required' }, { status: 400 });

    if (force_revalidate === true) {
      const { data: row, error: rowErr } = await supabaseAdmin
        .from('content_creatives')
        .select('slug, status, channel, product_id, review_status, seo_title, category, content_type, blog_html, destination, generation_meta')
        .eq('id', id)
        .limit(1);
      if (rowErr) throw rowErr;
      const target = row?.[0];
      if (!target?.slug) {
        return apiResponse({ error: 'Post not found or slug missing' }, { status: 404 });
      }
      const reviewBlock = getInformationalReviewBlockReason({
        productId: target.product_id ?? null,
        reviewStatus: target.review_status ?? null,
        title: target.seo_title ?? null,
        category: target.category ?? null,
        contentType: target.content_type ?? null,
      });
      if (target.status !== 'published' || reviewBlock) {
        return apiResponse({
          error: 'Only an approved published article can be reindexed',
          review_reason: reviewBlock,
        }, { status: 409 });
      }
      const claimReport = await evaluateBlogInformationClaimPublishGate({
        creativeId: id,
        contentKey: target.slug,
        markdown: target.blog_html ?? '',
        productId: target.product_id ?? null,
        reviewStatus: target.review_status ?? null,
        intentType: readBlogInformationRepresentativeIdentity(target.generation_meta ?? null)?.intent ?? null,
        expectedScope: { destination: target.destination ?? undefined },
      });
      if (!claimReport.passed) {
        return apiResponse({
          error: 'Informational claim evidence gate failed',
          claim_validation: claimReport,
        }, { status: 422 });
      }
      const representative = await ensureBlogInformationRepresentativeForPublish({
        creativeId: id,
        slug: target.slug,
        title: target.seo_title ?? target.slug,
        markdown: target.blog_html ?? '',
        productId: target.product_id ?? null,
        generationMeta: target.generation_meta ?? null,
      });
      const { error: representativeMetaError } = await supabaseAdmin
        .from('content_creatives')
        .update({
          generation_meta: {
            ...(target.generation_meta || {}),
            information_claim_validation: toBlogInformationClaimValidationMeta(claimReport),
            ...(representative ? {
              information_representative: {
                representative_key: representative.representativeKey,
                status: 'active',
                canonical_slug: representative.canonicalSlug,
              },
            } : {}),
          },
        })
        .eq('id', id);
      if (representativeMetaError) throw representativeMetaError;
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
    if (seo_title !== undefined) {
      updateData.seo_title = seo_title;
      updateData.title = seo_title;
    }
    if (seo_description !== undefined) {
      updateData.seo_description = seo_description;
      updateData.description = seo_description;
    }
    if (og_image_url !== undefined) updateData.og_image_url = og_image_url;
    if (category !== undefined) updateData.category = category;

    const changesPublicContract = [blog_html, slug, seo_title, seo_description, category]
      .some((value) => value !== undefined);
    if (changesPublicContract && reqStatus !== 'published') {
      updateData.status = 'draft';
      updateData.published_at = null;
      updateData.quality_gate = null;
    }

    let qaReport: BlogPublishQualityReport | null = null;
    let informationPublicationInput: {
      identity: BlogInformationRepresentativeIdentity;
      contentFingerprint: string;
      validationMeta: Record<string, unknown>;
      qualityGate: object;
      publishedAt: string;
    } | null = null;
    let publishingProduct = false;
    if (reqStatus === 'published') {
      const requestedPublishedAt = new Date().toISOString();

      try {
        const { data: existing, error: existingError } = await supabaseAdmin
          .from('content_creatives')
          .select('blog_html, slug, seo_title, seo_description, destination, angle_type, product_id, review_status, topic_source, category, content_type, generation_meta, status')
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
          review_status?: string | null;
          topic_source?: string | null;
          category?: string | null;
          content_type?: string | null;
          generation_meta?: Record<string, unknown> | null;
          status?: string | null;
        } | undefined;
        const finalHtml = (blog_html as string | undefined) ?? row?.blog_html ?? '';
        const finalSlug = (updateData.slug as string | undefined) ?? row?.slug ?? '';
        const finalTitle = (seo_title as string | undefined) ?? row?.seo_title ?? null;
        const finalDescription = (seo_description as string | undefined) ?? row?.seo_description ?? null;
        const destination = row ? resolveBlogDestination(row) : null;

        const reviewBlock = getInformationalReviewBlockReason({
          productId: row?.product_id ?? null,
          reviewStatus: row?.review_status ?? null,
          title: finalTitle,
          category: category ?? row?.category ?? null,
          contentType: row?.content_type ?? null,
          topic: row?.topic_source ?? null,
        });
        const changesReviewedHighRiskContent = reviewBlock == null
          && row?.product_id == null
          && row?.review_status === 'approved'
          && getInformationalReviewBlockReason({
            productId: null,
            reviewStatus: 'none',
            title: finalTitle,
            category: category ?? row?.category ?? null,
            contentType: row?.content_type ?? null,
            topic: row?.topic_source ?? null,
          }) === 'high_risk_human_review_required'
          && [blog_html, seo_title, seo_description].some((value) => value !== undefined);
        if (reviewBlock || changesReviewedHighRiskContent) {
          return apiResponse({
            error: 'Human review approval is required before publishing this informational draft',
            review_status: row?.review_status,
            review_reason: reviewBlock ?? 'reviewed_content_changed',
          }, { status: 409 });
        }

        if (!finalHtml || !finalSlug) {
          return apiResponse({ error: 'Blog quality gate input missing' }, { status: 400 });
        }

        const generationDedup = await findBlogGenerationDuplicateReport({
          candidate: {
            title: finalTitle || finalSlug,
            slug: finalSlug,
            destination,
            productId: row?.product_id ?? null,
            contentKind: row?.product_id ? 'product' : 'information',
            allowExistingCreativeId: id,
          },
        });
        if (generationDedup.action !== 'allow') {
          return apiResponse({
            error: generationDedup.action === 'review'
              ? '유사한 블로그 제목이 있어 검수 후 발행할 수 있습니다.'
              : '동일한 블로그 제목 또는 슬러그가 이미 존재합니다.',
            blog_generation_dedup: generationDedup,
          }, { status: generationDedup.action === 'review' ? 422 : 409 });
        }

        const prepared = await prepareBlogForPublish({
          blog_html: finalHtml,
          slug: finalSlug,
          seo_title: finalTitle,
          seo_description: finalDescription,
          destination,
          angle_type: row?.angle_type ?? null,
          category: category ?? row?.category ?? null,
          content_type: row?.content_type ?? null,
          product_id: row?.product_id ?? null,
          primary_keyword: finalTitle || destination || finalSlug,
          generation_meta: row?.generation_meta ?? null,
          excludeContentCreativeId: id,
          preserveBody: row?.status === 'published'
            && blog_html === undefined
            && slug === undefined
            && category === undefined,
        });
        qaReport = prepared.report;
        updateData.blog_html = prepared.blogHtml;
        applyBlogPublishQualityToUpdate(updateData, qaReport);
        publishingProduct = Boolean(row?.product_id);
        updateData.status = publishingProduct ? 'published' : 'draft';
        updateData.published_at = publishingProduct ? requestedPublishedAt : null;
        const identity = row?.product_id
          ? null
          : readBlogInformationRepresentativeIdentity(row?.generation_meta ?? null);
        const claimReport = await evaluateBlogInformationClaimPublishGate({
          creativeId: id,
          contentKey: finalSlug,
          markdown: prepared.blogHtml,
          productId: row?.product_id ?? null,
          reviewStatus: row?.review_status ?? null,
          intentType: identity?.intent ?? null,
          expectedScope: { destination: destination || undefined },
        });
        if (!claimReport.passed) {
          return apiResponse({
            error: 'Informational claim evidence gate failed',
            claim_validation: claimReport,
          }, { status: 422 });
        }
        if (!row?.product_id && !identity) {
          throw new Error('blog_information_representative_identity_missing');
        }
        const claimValidationMeta = toBlogInformationClaimValidationMeta(claimReport);
        updateData.generation_meta = {
          ...(row?.generation_meta || {}),
          information_claim_validation: claimValidationMeta,
          ...(identity ? {
            information_representative: {
              representative_key: buildBlogInformationRepresentativeKey(identity),
              status: 'pending_publication',
              canonical_slug: null,
            },
          } : {}),
        };
        if (identity) {
          informationPublicationInput = {
            identity,
            contentFingerprint: createBlogInformationContentFingerprint({
              blogHtml: prepared.blogHtml,
              seoTitle: finalTitle,
              seoDescription: finalDescription,
              slug: finalSlug,
            }),
            validationMeta: { information_claim_validation: claimValidationMeta },
            qualityGate: qaReport.qualityGate,
            publishedAt: requestedPublishedAt,
          };
        }
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
      if (informationPublicationInput) {
        const publication = await publishBlogInformationAtomically({
          creativeId: id,
          ...informationPublicationInput,
          reservationOwner: `api_blog_patch:${id}`,
        });
        if (data?.[0]) {
          data[0] = {
            ...(data[0] as Record<string, unknown>),
            status: 'published',
            published_at: publication.publishedAt,
          } as typeof data[0];
        }
      }
      revalidatePublicBlogCache(finalSlug || null);

      if (finalSlug && publishingProduct) {
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
