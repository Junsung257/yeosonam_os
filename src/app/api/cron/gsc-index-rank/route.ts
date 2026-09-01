import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import {
  isGSCApiConfigured,
  fetchPageLevelMetrics,
  inspectUrlIndexState,
  extractBlogSlugFromUrl,
} from '@/lib/gsc-api';
import {
  buildGoogleVisibilitySnapshot,
  googleInspectionToIndexStatus,
  recordBlogVisibilitySnapshot,
} from '@/lib/blog-visibility-snapshots';
import {
  buildUrlInspectionQuotaState,
  isUrlInspectionQuotaError,
  readUrlInspectionQuotaConfig,
  type UrlInspectionQuotaState,
} from '@/lib/gsc-url-inspection-quota';
import { PUBLIC_BLOG_READ_SOURCE } from '@/lib/blog-public-eligibility';
import {
  BLOG_AUTOPILOT_PIPELINE_VERSION,
  BLOG_AUTOPILOT_SCHEMA_MIGRATION_VERSION,
  BLOG_SEARCH_CLASSIFICATION_VERSION,
  readBlogDeploymentCommitShaV4,
  resolveBlogSearchLifecycleStatus,
  resolveProviderReceiptStatus,
} from '@/lib/blog-autopilot-v4-contract';

/**
 * GSC 색인/순위 추적 — 발행된 블로그 글의 page-level aggregate + URL Inspection
 *
 * 스케줄 (vercel.json 메인 세션이 통합):
 *   path: /api/cron/gsc-index-rank
 *   schedule: "30 2 * * *"   # UTC 02:30 → KST 11:30
 *
 * 기존 /api/cron/rank-tracking 과의 분담:
 *   - rank-tracking: page+query 차원, 5계단 하락 경보
 *   - gsc-index-rank (본 크론): page-only 평균 순위(`source='gsc-page'`, `query='__page__'`)
 *     + 색인 누락 검출 (URL Inspection API)
 *
 * env:
 *   GSC_SERVICE_ACCOUNT_JSON (신규, 권장) / GOOGLE_SERVICE_ACCOUNT_JSON (fallback)
 *   GSC_SITE_URL (e.g. 'https://yeosonam.com/')
 *   CRON_SECRET (isCronAuthorized)
 */

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const PAGE_LOOKBACK_DAYS = 7;       // 최근 7일 평균
const PAGE_AGGREGATE_QUERY_KEY = '__page__';

type RankHistoryRow = {
  slug: string;
  query: string;
  date: string;
  position: number;
  impressions: number;
  clicks: number;
  ctr: number;
  page_url: string;
  source: string;
};

function toDateString(d: Date): string {
  return d.toISOString().split('T')[0];
}

function cleanOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    if (value.startsWith('sc-domain:')) return null;
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.hostname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function getCanonicalInspectionBaseUrl(): string {
  return (
    cleanOrigin(process.env.BLOG_CANONICAL_ORIGIN)
    || cleanOrigin(process.env.NEXT_PUBLIC_BASE_URL)
    || cleanOrigin(process.env.NEXT_PUBLIC_SITE_URL)
    || 'https://www.yeosonam.com'
  );
}

function getGscSiteUrlCandidates(siteUrl: string, canonicalBaseUrl: string): string[] {
  const candidates = new Set<string>();
  const add = (value: string | undefined | null) => {
    if (!value) return;
    candidates.add(value.startsWith('sc-domain:') ? value : value.replace(/\/?$/, '/'));
  };

  add(siteUrl);
  add(process.env.GSC_SITE_URL);
  add(`${canonicalBaseUrl}/`);

  try {
    const host = new URL(canonicalBaseUrl).hostname.replace(/^www\./, '');
    add(`sc-domain:${host}`);
    add(`https://${host}/`);
  } catch {
    add('sc-domain:yeosonam.com');
    add('https://yeosonam.com/');
  }

  return Array.from(candidates);
}

async function inspectCanonicalUrl(siteUrlCandidates: string[], url: string) {
  const errors: string[] = [];
  for (const candidateSiteUrl of siteUrlCandidates) {
    const result = await inspectUrlIndexState(candidateSiteUrl, url);
    if (!result.error) return { result, siteUrl: candidateSiteUrl, errors };
    errors.push(`${candidateSiteUrl}: ${result.error}`);
    if (isUrlInspectionQuotaError(result.error)) break;
  }
  return {
    result: {
      url,
      verdict: null,
      coverageState: null,
      indexingState: null,
      lastCrawlTime: null,
      pageFetchState: null,
      robotsTxtState: null,
      googleCanonical: null,
      userCanonical: null,
      error: errors.join(' | '),
    },
    siteUrl: siteUrlCandidates[0] ?? null,
    errors,
  };
}

async function countUrlInspectionReportsSince(sinceIso: string): Promise<{
  count: number;
  error?: string;
}> {
  const { count, error } = await supabaseAdmin
    .from('indexing_reports')
    .select('id', { count: 'exact', head: true })
    .in('google_status', ['indexed', 'not_indexed'])
    .gte('reported_at', sinceIso);

  if (error) return { count: 0, error: error.message };
  return { count: count ?? 0 };
}

async function buildUrlInspectionQuotaForRun(requestedLimit: number): Promise<{
  quota: UrlInspectionQuotaState;
  errors: string[];
}> {
  const now = new Date();
  const last10m = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [recent10m, recent24h] = await Promise.all([
    countUrlInspectionReportsSince(last10m),
    countUrlInspectionReportsSince(last24h),
  ]);
  const errors = [
    recent10m.error ? `URL Inspection 10분 사용량 조회 실패: ${recent10m.error}` : null,
    recent24h.error ? `URL Inspection 24시간 사용량 조회 실패: ${recent24h.error}` : null,
  ].filter((v): v is string => Boolean(v));

  return {
    quota: buildUrlInspectionQuotaState({
      requestedLimit,
      last10mCount: recent10m.count,
      last24hCount: recent24h.count,
      ...readUrlInspectionQuotaConfig(),
    }),
    errors,
  };
}

function buildRankHistoryRows(
  metrics: Array<{ page: string; impressions: number; clicks: number; position: number }>,
  endDate: string,
  baseUrl: string,
): RankHistoryRow[] {
  const grouped = new Map<string, {
    slug: string;
    impressions: number;
    clicks: number;
    weightedPosition: number;
    positionWeight: number;
  }>();

  for (const m of metrics) {
    const slug = extractBlogSlugFromUrl(m.page);
    if (!slug) continue;

    const impressions = Number.isFinite(m.impressions) ? Math.max(0, m.impressions) : 0;
    const clicks = Number.isFinite(m.clicks) ? Math.max(0, m.clicks) : 0;
    const position = Number.isFinite(m.position) ? Math.max(0, m.position) : 0;
    const positionWeight = impressions > 0 ? impressions : 1;
    const existing = grouped.get(slug) ?? {
      slug,
      impressions: 0,
      clicks: 0,
      weightedPosition: 0,
      positionWeight: 0,
    };

    existing.impressions += impressions;
    existing.clicks += clicks;
    existing.weightedPosition += position * positionWeight;
    existing.positionWeight += positionWeight;
    grouped.set(slug, existing);
  }

  return Array.from(grouped.values()).map((row) => ({
    slug: row.slug,
    query: PAGE_AGGREGATE_QUERY_KEY,
    date: endDate,
    position: row.positionWeight > 0 ? row.weightedPosition / row.positionWeight : 0,
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.impressions > 0 ? row.clicks / row.impressions : 0,
    page_url: `${baseUrl}/blog/${row.slug}`,
    source: 'gsc-page',
  }));
}

async function runGscIndexRank(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }
  if (!isGSCApiConfigured()) {
    return {
      skipped: true,
      reason: 'GSC 미설정 (GSC_SERVICE_ACCOUNT_JSON 필요)',
      errors: [] as string[],
    };
  }

  const siteUrl =
    process.env.GSC_SITE_URL
    || process.env.NEXT_PUBLIC_BASE_URL
    || 'https://www.yeosonam.com/';
  const errors: string[] = [];
  const baseUrl = getCanonicalInspectionBaseUrl();

  // GSC 는 보통 1~2일 지연 → endDate = today-2
  const endDateObj = new Date();
  endDateObj.setUTCHours(0, 0, 0, 0);
  endDateObj.setUTCDate(endDateObj.getUTCDate() - 2);
  const endDate = toDateString(endDateObj);

  const startDateObj = new Date(endDateObj);
  startDateObj.setUTCDate(startDateObj.getUTCDate() - (PAGE_LOOKBACK_DAYS - 1));
  const startDate = toDateString(startDateObj);

  // 1) /blog/ 경로 page-level metrics 집계
  const metrics = await fetchPageLevelMetrics(siteUrl, startDate, endDate, {
    pageContains: '/blog/',
    rowLimit: 1000,
  });
  const selectedGscSiteUrl = metrics[0]?.gscSiteUrl ?? siteUrl;

  // 2) rank_history 에 source='gsc-page' / query='__page__' 로 upsert
  //    date 컬럼은 aggregate 의 endDate 기준 (1행 = 1페이지 = 1주 평균)
  let inserted = 0;
  if (metrics.length > 0) {
    const rows = buildRankHistoryRows(metrics, endDate, baseUrl);

    if (rows.length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from('rank_history')
        .upsert(rows, { onConflict: 'slug,query,date,source', ignoreDuplicates: false });
      if (upErr) errors.push(`rank_history upsert 실패: ${upErr.message}`);
      else inserted = rows.length;

      await Promise.allSettled(rows.map((row) => recordBlogVisibilitySnapshot(
        supabaseAdmin,
        buildGoogleVisibilitySnapshot({
          slug: String(row.slug),
          url: String(row.page_url || ''),
          requestStatus: 'requested',
          evidence: {
            impressions: row.impressions,
            clicks: row.clicks,
            ctr: row.ctr,
            date: row.date,
            source: row.source,
          },
          rank: Number(row.position),
          query: PAGE_AGGREGATE_QUERY_KEY,
          source: 'gsc_page_rank_history',
        }),
      )));
    }
  }

  // 3) 색인 상태 점검 — 발행됐는데 GSC 데이터 없는 슬러그 우선 검사
  const seenSlugs = new Set(
    metrics
      .map((m) => extractBlogSlugFromUrl(m.page))
      .filter((s): s is string => !!s),
  );

  const { data: published, error: pErr } = await supabaseAdmin
    .from(PUBLIC_BLOG_READ_SOURCE)
    .select('id, slug, published_at')
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .not('slug', 'is', null)
    .order('published_at', { ascending: false })
    .limit(200);

  if (pErr) {
    errors.push(`content_creatives 조회 실패: ${pErr.message}`);
  }

  const rawCandidates = ((published || []) as Array<{ id: string; slug: string | null }>)
    .filter((r): r is { id: string; slug: string } => Boolean(r.slug))
    .filter((r) => !seenSlugs.has(r.slug));

  const { quota: inspectionQuota, errors: quotaErrors } = await buildUrlInspectionQuotaForRun(
    rawCandidates.length,
  );
  errors.push(...quotaErrors);
  const candidates = rawCandidates.slice(0, inspectionQuota.effectiveLimit);

  const siteUrlCandidates = getGscSiteUrlCandidates(siteUrl, baseUrl);
  let inspected = 0;
  let notIndexed = 0;
  let inspectionStoppedByQuota = false;
  const inspectionResults: Array<Record<string, unknown>> = [];

  const inspectionReportRows: Array<Record<string, unknown>> = [];

  for (const candidate of candidates) {
    const slug = candidate.slug;
    const url = `${baseUrl}/blog/${slug}`;
    const inspectedResult = await inspectCanonicalUrl(siteUrlCandidates, url);
    const r = inspectedResult.result;
    inspected += 1;
    if (r.error) {
      errors.push(`URL Inspection 실패 (${slug}): ${r.error}`);
      if (isUrlInspectionQuotaError(r.error)) {
        inspectionStoppedByQuota = true;
        errors.push(`URL Inspection 쿼터/속도 제한 감지: ${inspectionQuota.retryAfterMinutes}분 후 재시도`);
        break;
      }
      continue;
    }
    const indexStatus = googleInspectionToIndexStatus({
      verdict: r.verdict,
      coverage_state: r.coverageState,
      page_fetch_state: r.pageFetchState,
    });
    const isIndexed = indexStatus === 'indexed';
    const providerReceiptStatus = resolveProviderReceiptStatus({ verificationOnly: true });
    const searchLifecycleStatus = resolveBlogSearchLifecycleStatus({
      requestStatus: 'requested',
      providerReceiptStatus,
      indexStatus,
      coverageState: r.coverageState,
      pageFetchState: r.pageFetchState,
      lastCrawlTime: r.lastCrawlTime,
    });
    if (!isIndexed) notIndexed += 1;
    inspectionReportRows.push({
      url,
      content_creative_id: candidate.id,
      google_status: isIndexed ? 'indexed' : 'not_indexed',
      google_error: null,
      indexnow_status: 'skipped',
      indexnow_error: null,
      sitemap_pings: inspectedResult.siteUrl
        ? [{ provider: 'gsc_url_inspection_site_url', ok: true, siteUrl: inspectedResult.siteUrl }]
        : [],
      google_index_verdict: r.verdict,
      google_coverage_state: r.coverageState,
      google_indexing_state: r.indexingState,
      google_last_crawl_time: r.lastCrawlTime,
      google_page_fetch_state: r.pageFetchState,
      google_canonical: r.googleCanonical,
      user_canonical: r.userCanonical,
      search_lifecycle_status: searchLifecycleStatus,
      provider_receipt_status: providerReceiptStatus,
      classification_version: BLOG_SEARCH_CLASSIFICATION_VERSION,
      provider_raw_response: r.raw ?? {},
      pipeline_version: BLOG_AUTOPILOT_PIPELINE_VERSION,
      deployment_commit_sha: readBlogDeploymentCommitShaV4(),
      schema_migration_version: BLOG_AUTOPILOT_SCHEMA_MIGRATION_VERSION,
    });
    await recordBlogVisibilitySnapshot(
      supabaseAdmin,
      buildGoogleVisibilitySnapshot({
        slug,
        url,
        requestStatus: 'requested',
        evidence: {
          verdict: r.verdict,
          coverage_state: r.coverageState,
          indexing_state: r.indexingState,
          last_crawl_time: r.lastCrawlTime,
          page_fetch_state: r.pageFetchState,
          google_canonical: r.googleCanonical,
          user_canonical: r.userCanonical,
          inspected_site_url: inspectedResult.siteUrl,
        },
        source: 'gsc_url_inspection',
      }),
    );
    inspectionResults.push({
      slug,
      verdict: r.verdict,
      coverage_state: r.coverageState,
      indexing_state: r.indexingState,
      last_crawl_time: r.lastCrawlTime,
      page_fetch_state: r.pageFetchState,
      google_canonical: r.googleCanonical,
      user_canonical: r.userCanonical,
      inspected_site_url: inspectedResult.siteUrl,
    });
  }

  if (inspectionReportRows.length > 0) {
    const { error: reportErr } = await supabaseAdmin
      .from('indexing_reports')
      .insert(inspectionReportRows);
    if (reportErr) errors.push(`indexing_reports inspection insert 실패: ${reportErr.message}`);
  }

  return {
    startDate,
    endDate,
    fetched: metrics.length,
    inserted,
    siteUrl: selectedGscSiteUrl,
    fallback_used: selectedGscSiteUrl !== siteUrl,
    inspected,
    not_indexed: notIndexed,
    inspection_candidate_count: rawCandidates.length,
    inspection_skipped_quota: rawCandidates.length > 0 && !inspectionQuota.allowed,
    inspection_stopped_by_quota: inspectionStoppedByQuota,
    inspection_quota: inspectionQuota,
    inspections: inspectionResults,
    errors,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('gsc-index-rank', runGscIndexRank, {
  handlerTimeoutMs: 285_000,
  sideEffectTimeoutMs: 10_000,
});
