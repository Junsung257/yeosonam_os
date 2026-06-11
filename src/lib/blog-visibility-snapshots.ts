type SupabaseLike = {
  from: (table: string) => {
    insert: (row: Record<string, unknown> | Record<string, unknown>[]) => {
      select?: (columns?: string) => unknown;
      then?: unknown;
    } | PromiseLike<{ error?: { code?: string; message?: string } | null }>;
    upsert?: (
      row: Record<string, unknown> | Record<string, unknown>[],
      options?: Record<string, unknown>,
    ) => PromiseLike<{ error?: { code?: string; message?: string } | null }>;
  };
};

export type BlogVisibilityPlatform = 'google' | 'naver';
export type BlogRequestStatus = 'not_requested' | 'requested' | 'request_failed' | 'unknown';
export type BlogIndexStatus =
  | 'unknown'
  | 'inspectable'
  | 'indexed'
  | 'not_indexed'
  | 'blocked'
  | 'verification_unavailable';
export type BlogVisibilityStatus = 'unknown' | 'visible' | 'not_visible' | 'ranking_confirmed';

export type BlogVisibilitySnapshotInput = {
  slug: string;
  url: string;
  platform: BlogVisibilityPlatform;
  request_status: BlogRequestStatus;
  index_status: BlogIndexStatus;
  visibility_status?: BlogVisibilityStatus;
  best_rank?: number | null;
  best_query?: string | null;
  source: string;
  confidence?: number;
  evidence?: Record<string, unknown>;
};

export type GoogleInspectionEvidence = {
  [key: string]: unknown;
  verdict?: string | null;
  coverage_state?: string | null;
  indexing_state?: string | null;
  page_fetch_state?: string | null;
  last_crawl_time?: string | null;
  google_canonical?: string | null;
  user_canonical?: string | null;
};

function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === 'PGRST205' || /Could not find the table|relation .* does not exist/i.test(error?.message ?? '');
}

function normalizeRank(value: unknown): number | null {
  const rank = Number(value);
  return Number.isFinite(rank) && rank > 0 ? rank : null;
}

export function normalizeBlogBaseUrl(value?: string | null): string {
  const raw = value || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com';
  return raw.replace(/\/$/, '');
}

export function blogUrlForSlug(slug: string, baseUrl?: string | null): string {
  return `${normalizeBlogBaseUrl(baseUrl)}/blog/${slug}`;
}

export function extractBlogSlugFromUrl(url: string): string | null {
  const match = url.match(/\/blog\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function googleInspectionToIndexStatus(evidence: GoogleInspectionEvidence): BlogIndexStatus {
  const verdict = String(evidence.verdict || '').toUpperCase();
  const coverage = String(evidence.coverage_state || '').toLowerCase();
  const fetchState = String(evidence.page_fetch_state || '').toLowerCase();

  if (
    coverage.includes('robots') ||
    coverage.includes('blocked') ||
    fetchState.includes('robots') ||
    fetchState.includes('blocked')
  ) {
    return 'blocked';
  }

  if (verdict === 'PASS' && !coverage.includes('not on google') && !coverage.includes('not indexed')) {
    return 'indexed';
  }

  if (
    verdict === 'FAIL' ||
    verdict === 'NEUTRAL' ||
    coverage.includes('not on google') ||
    coverage.includes('not indexed') ||
    coverage.includes('아직 알려지지 않은') ||
    coverage.includes('unknown to google')
  ) {
    return 'not_indexed';
  }

  return 'inspectable';
}

export function visibilityStatusFromRank(rank: unknown): BlogVisibilityStatus {
  return normalizeRank(rank) ? 'ranking_confirmed' : 'not_visible';
}

export function buildGoogleVisibilitySnapshot(input: {
  slug: string;
  url?: string | null;
  baseUrl?: string | null;
  requestStatus?: BlogRequestStatus;
  evidence?: GoogleInspectionEvidence;
  rank?: number | null;
  query?: string | null;
  source?: string;
}): BlogVisibilitySnapshotInput {
  const rank = normalizeRank(input.rank);
  const evidence = input.evidence || {};
  const indexStatus = googleInspectionToIndexStatus(evidence);
  return {
    slug: input.slug,
    url: input.url || blogUrlForSlug(input.slug, input.baseUrl),
    platform: 'google',
    request_status: input.requestStatus || 'requested',
    index_status: indexStatus,
    visibility_status: rank ? 'ranking_confirmed' : indexStatus === 'indexed' ? 'visible' : 'not_visible',
    best_rank: rank,
    best_query: rank ? input.query || '__page__' : null,
    source: input.source || 'gsc_url_inspection',
    confidence: rank ? 0.95 : indexStatus === 'indexed' ? 0.9 : indexStatus === 'not_indexed' ? 0.85 : 0.6,
    evidence,
  };
}

export function buildNaverVisibilitySnapshot(input: {
  slug: string;
  url?: string | null;
  baseUrl?: string | null;
  requestStatus?: BlogRequestStatus;
  indexNowOk?: boolean | null;
  rank?: number | null;
  query?: string | null;
  source?: string;
  evidence?: Record<string, unknown>;
}): BlogVisibilitySnapshotInput {
  const rank = normalizeRank(input.rank);
  const requestStatus =
    input.requestStatus || (input.indexNowOk === false ? 'request_failed' : input.indexNowOk === true ? 'requested' : 'unknown');

  return {
    slug: input.slug,
    url: input.url || blogUrlForSlug(input.slug, input.baseUrl),
    platform: 'naver',
    request_status: requestStatus,
    index_status: 'verification_unavailable',
    visibility_status: rank ? 'ranking_confirmed' : 'unknown',
    best_rank: rank,
    best_query: rank ? input.query || null : null,
    source: input.source || (rank ? 'naver_rank_history' : 'indexnow_request'),
    confidence: rank ? 0.9 : requestStatus === 'requested' ? 0.55 : 0.35,
    evidence: input.evidence || {},
  };
}

export async function recordBlogVisibilitySnapshot(
  supabase: SupabaseLike,
  input: BlogVisibilitySnapshotInput,
): Promise<{ ok: true } | { ok: false; error: string; skipped?: boolean }> {
  if (!input.slug || !input.url) return { ok: false, error: 'slug/url missing' };

  const row = {
    slug: input.slug,
    url: input.url,
    platform: input.platform,
    request_status: input.request_status,
    index_status: input.index_status,
    visibility_status: input.visibility_status || 'unknown',
    best_rank: input.best_rank ?? null,
    best_query: input.best_query ?? null,
    source: input.source,
    confidence: input.confidence ?? 0.5,
    evidence: input.evidence || {},
  };

  const result = await Promise.resolve(supabase.from('blog_visibility_snapshots').insert(row) as any);
  if (result?.error) {
    if (isMissingTableError(result.error)) return { ok: false, skipped: true, error: result.error.message || 'missing table' };
    return { ok: false, error: result.error.message || 'insert failed' };
  }
  return { ok: true };
}
