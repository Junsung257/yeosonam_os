import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from './supabase';
import {
  buildBlogGenerationDedupMetadata,
  evaluateBlogGenerationDedup,
  inferBlogGenerationContentKind,
  type BlogGenerationContentKind,
  type BlogGenerationDedupCandidate,
  type BlogGenerationDedupExisting,
  type BlogGenerationDedupReport,
} from './blog-generation-dedup';

const BLOG_GENERATION_DEDUP_EXISTING_STATUSES = [
  'published',
  'manually_published',
  'scheduled',
  'draft',
  'pending_review',
  'pending_publication',
  'generating',
] as const;

const BLOG_GENERATION_DEDUP_SELECT =
  'id, title, seo_title, slug, destination, product_id, status, content_type, category';

type BlogGenerationDedupSourceRow = {
  id: string;
  title?: string | null;
  seo_title?: string | null;
  slug?: string | null;
  destination?: string | null;
  product_id?: string | null;
  status?: string | null;
  content_type?: string | null;
  category?: string | null;
};

export interface BlogGenerationDedupClaim {
  report: BlogGenerationDedupReport;
  claimOwner: string;
  claimed: boolean;
}

export class BlogGenerationDedupError extends Error {
  readonly report: BlogGenerationDedupReport;
  readonly statusCode: 409 | 422;

  constructor(report: BlogGenerationDedupReport, statusCode: 409 | 422 = 409) {
    super(`blog_generation_dedup:${report.reason}`);
    this.name = 'BlogGenerationDedupError';
    this.report = report;
    this.statusCode = statusCode;
  }
}

export function isBlogGenerationDedupError(error: unknown): error is BlogGenerationDedupError {
  return error instanceof BlogGenerationDedupError;
}

function mapSourceRow(row: BlogGenerationDedupSourceRow): BlogGenerationDedupExisting {
  return {
    id: row.id,
    title: row.title,
    seoTitle: row.seo_title,
    slug: row.slug,
    destination: row.destination,
    productId: row.product_id,
    status: row.status,
    contentKind: inferBlogGenerationContentKind({
      productId: row.product_id,
      contentType: row.content_type,
      category: row.category,
    }),
  };
}

function queryExistingRows(input: {
  candidate: BlogGenerationDedupCandidate;
}): Array<PromiseLike<{ data: unknown; error: { message: string } | null }>> {
  const baseQuery = () => supabaseAdmin
    .from('content_creatives')
    .select(BLOG_GENERATION_DEDUP_SELECT)
    .eq('channel', 'naver_blog')
    .in('status', [...BLOG_GENERATION_DEDUP_EXISTING_STATUSES]);

  const queries: Array<PromiseLike<{ data: unknown; error: { message: string } | null }>> = [];
  const slug = input.candidate.slug?.trim();
  const title = input.candidate.title.trim();
  if (slug) queries.push(baseQuery().eq('slug', slug).limit(20));
  if (title) {
    queries.push(baseQuery().eq('seo_title', title).limit(20));
    queries.push(baseQuery().eq('title', title).limit(20));
  }
  const destination = input.candidate.destination?.trim() ?? '';
  const productId = input.candidate.productId ?? '';
  const hasDestinationScope = Boolean(destination);
  const hasProductScope = Boolean(productId);
  if (hasDestinationScope) {
    queries.push(baseQuery().eq('destination', destination).limit(500));
  }
  if (hasProductScope) {
    queries.push(baseQuery().eq('product_id', productId).limit(500));
  }
  if (!hasDestinationScope && !hasProductScope) queries.push(baseQuery().limit(500));
  return queries;
}

export async function findBlogGenerationDuplicateReport(input: {
  candidate: BlogGenerationDedupCandidate;
}): Promise<BlogGenerationDedupReport> {
  const results = await Promise.all(queryExistingRows(input));
  const rows = new Map<string, BlogGenerationDedupExisting>();
  for (const result of results) {
    if (result.error) throw new Error(`blog_generation_dedup_lookup_failed:${result.error.message}`);
    for (const raw of Array.isArray(result.data) ? result.data : []) {
      if (!raw || typeof raw !== 'object' || typeof (raw as BlogGenerationDedupSourceRow).id !== 'string') continue;
      const mapped = mapSourceRow(raw as BlogGenerationDedupSourceRow);
      rows.set(mapped.id, mapped);
    }
  }
  return evaluateBlogGenerationDedup(input.candidate, [...rows.values()]);
}

function reportForActiveClaim(input: {
  report: BlogGenerationDedupReport;
  existingCreativeId?: string | null;
}): BlogGenerationDedupReport {
  return {
    ...input.report,
    action: 'block',
    passed: false,
    reason: 'concurrent_generation_claim',
    matches: input.existingCreativeId
      ? [{
          kind: 'title_exact',
          existingId: input.existingCreativeId,
          existingTitle: null,
          existingSlug: null,
          similarity: 1,
          reason: 'another_generation_is_claiming_this_title',
        }, ...input.report.matches]
      : input.report.matches,
  };
}

export async function claimBlogGenerationDedup(input: {
  candidate: BlogGenerationDedupCandidate;
  claimOwner?: string;
  claimReview?: boolean;
}): Promise<BlogGenerationDedupClaim> {
  const claimOwner = input.claimOwner?.trim() || `blog-generation:${randomUUID()}`;
  const report = await findBlogGenerationDuplicateReport(input);
  if (report.action === 'block' || (report.action === 'review' && input.claimReview === false)) {
    return { report, claimOwner, claimed: false };
  }

  const { data, error } = await supabaseAdmin.rpc('claim_blog_generation_dedup', {
    p_dedup_key: report.dedupKey,
    p_normalized_title: report.titleKey,
    p_claim_owner: claimOwner,
    p_content_kind: input.candidate.contentKind ?? 'unknown',
    p_destination: input.candidate.destination ?? null,
    p_ttl_seconds: 3600,
    p_allow_existing_creative_id: input.candidate.allowExistingCreativeId ?? null,
  });
  if (error) throw new Error(`blog_generation_dedup_claim_failed:${error.message}`);

  const claim = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  if (claim.claimed !== true) {
    return {
      report: reportForActiveClaim({
        report,
        existingCreativeId: typeof claim.existing_creative_id === 'string'
          ? claim.existing_creative_id
          : null,
      }),
      claimOwner,
      claimed: false,
    };
  }
  return { report, claimOwner, claimed: true };
}

export async function releaseBlogGenerationDedup(input: {
  dedupKey: string;
  claimOwner: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from('blog_generation_dedup_claims')
    .delete()
    .eq('dedup_key', input.dedupKey)
    .eq('claim_owner', input.claimOwner)
    .eq('claim_status', 'reserved');
  if (error) throw new Error(`blog_generation_dedup_release_failed:${error.message}`);
}

export async function bindBlogGenerationDedup(input: {
  dedupKey: string;
  claimOwner: string;
  creativeId: string;
  action: BlogGenerationDedupReport['action'];
}): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('blog_generation_dedup_claims')
    .update({
      claim_status: input.action === 'review' ? 'review' : 'bound',
      content_creative_id: input.creativeId,
      expires_at: '9999-12-31T23:59:59.000Z',
      updated_at: new Date().toISOString(),
    })
    .eq('dedup_key', input.dedupKey)
    .eq('claim_owner', input.claimOwner)
    .eq('claim_status', 'reserved')
    .select('dedup_key');
  if (error) throw new Error(`blog_generation_dedup_bind_failed:${error.message}`);
  if (!data?.length) throw new Error('blog_generation_dedup_bind_owner_mismatch');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function withBlogGenerationDedupMetadata(
  row: Record<string, unknown>,
  claim: BlogGenerationDedupClaim,
): Record<string, unknown> {
  return {
    ...row,
    generation_meta: {
      ...asRecord(row.generation_meta),
      blog_generation_dedup: buildBlogGenerationDedupMetadata({
        report: claim.report,
        claimOwner: claim.claimOwner,
      }),
    },
  };
}

export async function insertBlogCreativeWithDedup(input: {
  row: Record<string, unknown>;
  claimOwner?: string;
  allowReviewDraft?: boolean;
}): Promise<{
  data: Record<string, unknown>;
  dedup: BlogGenerationDedupClaim;
}> {
  const title = typeof input.row.seo_title === 'string' && input.row.seo_title.trim()
    ? input.row.seo_title.trim()
    : typeof input.row.title === 'string' && input.row.title.trim()
      ? input.row.title.trim()
      : String(input.row.slug ?? '').trim();
  const candidate: BlogGenerationDedupCandidate = {
    title,
    slug: typeof input.row.slug === 'string' ? input.row.slug : null,
    destination: typeof input.row.destination === 'string' ? input.row.destination : null,
    productId: typeof input.row.product_id === 'string' ? input.row.product_id : null,
    contentKind: inferBlogGenerationContentKind({
      productId: typeof input.row.product_id === 'string' ? input.row.product_id : null,
      contentType: typeof input.row.content_type === 'string' ? input.row.content_type : null,
      category: typeof input.row.category === 'string' ? input.row.category : null,
    }),
  };
  const claim = await claimBlogGenerationDedup({
    candidate,
    claimOwner: input.claimOwner,
    claimReview: input.allowReviewDraft !== false,
  });
  if (!claim.claimed || claim.report.action === 'block') throw new BlogGenerationDedupError(claim.report);
  if (claim.report.action === 'review' && input.allowReviewDraft === false) {
    throw new BlogGenerationDedupError(claim.report, 422);
  }

  const rowWithMeta = withBlogGenerationDedupMetadata(input.row, claim);
  const { data, error } = await supabaseAdmin
    .from('content_creatives')
    .insert(rowWithMeta)
    .select()
    .single();
  if (error) {
    try {
      await releaseBlogGenerationDedup({ dedupKey: claim.report.dedupKey, claimOwner: claim.claimOwner });
    } catch (releaseError) {
      console.warn('[blog-generation-dedup] failed to release claim after insert error', releaseError);
    }
    if ((error as { code?: string }).code === '23505') {
      const raceReport: BlogGenerationDedupReport = {
        ...claim.report,
        action: 'block',
        passed: false,
        reason: 'slug_or_content_unique_constraint_race',
      };
      throw new BlogGenerationDedupError(raceReport);
    }
    throw error;
  }
  const creative = data as Record<string, unknown> | null;
  if (!creative || typeof creative.id !== 'string') {
    try {
      await releaseBlogGenerationDedup({ dedupKey: claim.report.dedupKey, claimOwner: claim.claimOwner });
    } catch (releaseError) {
      console.warn('[blog-generation-dedup] failed to release claim without creative id', releaseError);
    }
    throw new Error('blog_generation_dedup_insert_missing_creative_id');
  }
  const creativeId = creative.id;
  await bindBlogGenerationDedup({
    dedupKey: claim.report.dedupKey,
    claimOwner: claim.claimOwner,
    creativeId,
    action: claim.report.action,
  });
  return { data: creative, dedup: claim };
}
