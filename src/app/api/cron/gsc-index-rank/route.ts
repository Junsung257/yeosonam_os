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
  recordBlogVisibilitySnapshot,
} from '@/lib/blog-visibility-snapshots';

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
const MAX_INSPECT_PER_RUN = 25;     // URL Inspection 일일 한도 보호
const PAGE_AGGREGATE_QUERY_KEY = '__page__';

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

  // 2) rank_history 에 source='gsc-page' / query='__page__' 로 upsert
  //    date 컬럼은 aggregate 의 endDate 기준 (1행 = 1페이지 = 1주 평균)
  let inserted = 0;
  if (metrics.length > 0) {
    const rows = metrics
      .map((m) => {
        const slug = extractBlogSlugFromUrl(m.page);
        if (!slug) return null;
        return {
          slug,
          query: PAGE_AGGREGATE_QUERY_KEY,
          date: endDate,
          position: m.position,
          impressions: m.impressions,
          clicks: m.clicks,
          ctr: m.ctr,
          page_url: m.page,
          source: 'gsc-page',
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

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
    .from('content_creatives')
    .select('id, slug, published_at')
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .not('slug', 'is', null)
    .order('published_at', { ascending: false })
    .limit(200);

  if (pErr) {
    errors.push(`content_creatives 조회 실패: ${pErr.message}`);
  }

  const candidates = ((published || []) as Array<{ id: string; slug: string | null }>)
    .filter((r): r is { id: string; slug: string } => Boolean(r.slug))
    .filter((r) => !seenSlugs.has(r.slug))
    .slice(0, MAX_INSPECT_PER_RUN);

  const baseUrl = getCanonicalInspectionBaseUrl();
  const siteUrlCandidates = getGscSiteUrlCandidates(siteUrl, baseUrl);
  let inspected = 0;
  let notIndexed = 0;
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
      continue;
    }
    const isIndexed = r.verdict === 'PASS' && r.coverageState?.toLowerCase().includes('index');
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
    inspected,
    not_indexed: notIndexed,
    inspections: inspectionResults,
    errors,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('gsc-index-rank', runGscIndexRank);
