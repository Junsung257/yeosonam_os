import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  blogUrlForSlug,
  buildGoogleVisibilitySnapshot,
  buildNaverVisibilitySnapshot,
  extractBlogSlugFromUrl,
  recordBlogVisibilitySnapshot,
  type BlogRequestStatus,
} from '../src/lib/blog-visibility-snapshots';

type CreativeRow = {
  id: string;
  slug: string | null;
  published_at: string | null;
};

type IndexingReportRow = {
  url: string | null;
  content_creative_id: string | null;
  google_status: string | null;
  google_error: string | null;
  indexnow_status: string | null;
  indexnow_error: string | null;
  sitemap_pings: Array<{ provider?: string; ok?: boolean }> | null;
  reported_at: string | null;
  google_index_verdict?: string | null;
  google_coverage_state?: string | null;
  google_indexing_state?: string | null;
  google_last_crawl_time?: string | null;
  google_page_fetch_state?: string | null;
  google_canonical?: string | null;
  user_canonical?: string | null;
};

type RankHistoryRow = {
  slug: string | null;
  query: string | null;
  position: number | null;
  impressions: number | null;
  clicks: number | null;
  source: string | null;
  date: string | null;
  page_url: string | null;
};

function loadEnv(file: string): void {
  const envPath = path.join(process.cwd(), file);
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2] ?? '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

async function fetchAll<T>(
  supabase: any,
  table: string,
  columns: string,
  apply?: (query: any) => any,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (apply) query = apply(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data || []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function latestByDate<T>(rows: T[], getDate: (row: T) => string | null | undefined): T | null {
  return [...rows]
    .filter(row => !!getDate(row))
    .sort((a, b) => String(getDate(b)).localeCompare(String(getDate(a))))[0] ?? null;
}

function bestRank(rows: RankHistoryRow[]): RankHistoryRow | null {
  return [...rows]
    .filter(row => Number.isFinite(Number(row.position)) && Number(row.position) > 0)
    .sort((a, b) => Number(a.position) - Number(b.position))[0] ?? null;
}

function googleRequestStatus(report: IndexingReportRow | null): BlogRequestStatus {
  if (!report) return 'not_requested';
  return report.google_status === 'failed' ? 'request_failed' : 'requested';
}

async function main(): Promise<void> {
  loadEnv('.env.local');
  loadEnv('.env.prod');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://yeosonam.com').replace(/\/$/, '');
  const days = Math.max(1, Number(process.argv.find(arg => arg.startsWith('--days='))?.split('=')[1] || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const sinceDate = since.slice(0, 10);

  const [creatives, reports, ranks] = await Promise.all([
    fetchAll<CreativeRow>(
      supabase,
      'content_creatives',
      'id, slug, published_at',
      query => query.eq('channel', 'naver_blog').eq('status', 'published').not('slug', 'is', null),
    ),
    fetchAll<IndexingReportRow>(
      supabase,
      'indexing_reports',
      'url, content_creative_id, google_status, google_error, indexnow_status, indexnow_error, sitemap_pings, reported_at, google_index_verdict, google_coverage_state, google_indexing_state, google_last_crawl_time, google_page_fetch_state, google_canonical, user_canonical',
      query => query.gte('reported_at', since),
    ),
    fetchAll<RankHistoryRow>(
      supabase,
      'rank_history',
      'slug, query, position, impressions, clicks, source, date, page_url',
      query => query.gte('date', sinceDate),
    ),
  ]);

  let inserted = 0;
  let failed = 0;

  for (const creative of creatives) {
    if (!creative.slug) continue;
    const slug = creative.slug;
    const urlForPost = blogUrlForSlug(slug, baseUrl);
    const matchingReports = reports.filter((report) => {
      const reportSlug = report.url ? extractBlogSlugFromUrl(report.url) : null;
      return report.content_creative_id === creative.id || reportSlug === slug;
    });
    const latestReport = latestByDate(matchingReports, report => report.reported_at);
    const slugRanks = ranks.filter(row => row.slug === slug);
    const googleRank = bestRank(slugRanks.filter(row => String(row.source || '').startsWith('gsc')));
    const naverRank = bestRank(slugRanks.filter(row => String(row.source || '').startsWith('naver')));
    const naverIndexNowOk =
      latestReport?.indexnow_status === 'success' ||
      (latestReport?.sitemap_pings || []).some(ping => ping.provider === 'naver_indexnow' && ping.ok === true);

    const googleResult = await recordBlogVisibilitySnapshot(
      supabase,
      buildGoogleVisibilitySnapshot({
        slug,
        url: latestReport?.url || googleRank?.page_url || urlForPost,
        requestStatus: googleRequestStatus(latestReport),
        evidence: {
          request_status: latestReport?.google_status ?? null,
          request_error: latestReport?.google_error ?? null,
          verdict: latestReport?.google_index_verdict ?? null,
          coverage_state: latestReport?.google_coverage_state ?? null,
          indexing_state: latestReport?.google_indexing_state ?? null,
          last_crawl_time: latestReport?.google_last_crawl_time ?? null,
          page_fetch_state: latestReport?.google_page_fetch_state ?? null,
          google_canonical: latestReport?.google_canonical ?? null,
          user_canonical: latestReport?.user_canonical ?? null,
        },
        rank: googleRank?.position ?? null,
        query: googleRank?.query ?? null,
        source: googleRank ? 'gsc_page_rank_history_backfill' : 'indexing_reports_backfill',
      }),
    );

    const naverResult = await recordBlogVisibilitySnapshot(
      supabase,
      buildNaverVisibilitySnapshot({
        slug,
        url: naverRank?.page_url || latestReport?.url || urlForPost,
        indexNowOk: naverIndexNowOk,
        rank: naverRank?.position ?? null,
        query: naverRank?.query ?? null,
        source: naverRank ? 'naver_rank_history_backfill' : 'indexnow_reports_backfill',
        evidence: {
          request_status: latestReport?.indexnow_status ?? null,
          request_error: latestReport?.indexnow_error ?? null,
          sitemap_pings: latestReport?.sitemap_pings ?? [],
        },
      }),
    );

    for (const result of [googleResult, naverResult]) {
      if (result.ok) inserted += 1;
      else failed += 1;
    }
  }

  console.log(JSON.stringify({
    ok: failed === 0,
    checked_posts: creatives.length,
    indexing_reports: reports.length,
    rank_history_rows: ranks.length,
    inserted_snapshots: inserted,
    failed_snapshots: failed,
    days,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
