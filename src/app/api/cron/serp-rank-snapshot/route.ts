import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { getSecret } from '@/lib/secret-registry';
import {
  buildNaverVisibilitySnapshot,
  extractBlogSlugFromUrl,
  recordBlogVisibilitySnapshot,
} from '@/lib/blog-visibility-snapshots';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

type DbErrorLike = { code?: string; message?: string };
type RankProvider = 'naver_api' | 'serpapi';

type RankLookup = {
  provider: RankProvider;
  link: string;
  position: number | null;
  organicLength: number;
};

type RankTarget = {
  keyword: string;
  slug?: string | null;
};

function isMissingTable(error: DbErrorLike | null | undefined): boolean {
  return error?.code === 'PGRST205' || /Could not find the table/i.test(error?.message ?? '');
}

function cleanText(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/&[a-zA-Z]+;/g, ' ').trim();
}

function getHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isOwnResult(link: string, baseUrl: string): boolean {
  const ownHost = getHost(baseUrl);
  const resultHost = getHost(link);
  return Boolean(ownHost && resultHost && (resultHost === ownHost || resultHost.endsWith(`.${ownHost}`)));
}

async function insertSerpSnapshot(
  keyword: string,
  lookup: RankLookup,
  baseUrl: string,
) {
  const primary = await supabaseAdmin.from('serp_rank_snapshots').insert({
    keyword,
    engine: 'naver',
    url: lookup.link || `${baseUrl}/blog`,
    position: lookup.position,
    raw: {
      engine: 'naver',
      provider: lookup.provider,
      organic_len: lookup.organicLength,
      own_domain_found: lookup.position !== null,
    },
  });

  if (!isMissingTable(primary.error)) return primary;

  return supabaseAdmin.from('serp_snapshots').insert({
    keyword,
    source: lookup.provider === 'serpapi' ? 'serpapi_naver' : 'naver_api_rank',
    rank: lookup.position,
    title: '',
    url: lookup.link || `${baseUrl}/blog`,
    snippet: null,
    fetched_at: new Date().toISOString(),
  });
}

async function lookupWithNaverApi(keyword: string, baseUrl: string): Promise<RankLookup> {
  const clientId = getSecret('NAVER_CLIENT_ID');
  const clientSecret = getSecret('NAVER_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error('NAVER_CLIENT_ID/SECRET missing');
  }

  const endpoints = ['webkr', 'blog'] as const;
  const candidates: Array<{ link: string; position: number }> = [];
  let organicLength = 0;

  for (const endpoint of endpoints) {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/${endpoint}.json?query=${encodeURIComponent(keyword)}&display=100&sort=sim`,
      {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
        signal: AbortSignal.timeout(12_000),
      },
    );

    if (!res.ok) {
      throw new Error(`Naver Search API HTTP ${res.status}`);
    }

    const data = (await res.json()) as { items?: Array<{ link?: string }> };
    const items = Array.isArray(data.items) ? data.items : [];
    for (const [index, item] of items.entries()) {
      const link = cleanText(String(item.link ?? ''));
      if (link) candidates.push({ link, position: organicLength + index + 1 });
    }
    organicLength += items.length;
  }

  const ownResult = candidates.find(item => isOwnResult(item.link, baseUrl));
  return {
    provider: 'naver_api',
    link: ownResult?.link ?? '',
    position: ownResult?.position ?? null,
    organicLength,
  };
}

async function lookupWithSerpApi(keyword: string, baseUrl: string): Promise<RankLookup> {
  const serpApiKey = getSecret('SERPAPI_KEY');

  if (!serpApiKey) {
    throw new Error('SERPAPI_KEY missing');
  }

  const url = `https://serpapi.com/search.json?engine=naver&q=${encodeURIComponent(keyword)}&api_key=${serpApiKey}`;
  const res = await fetch(url, { next: { revalidate: 0 }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`SerpAPI HTTP ${res.status}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  const organic = Array.isArray(json.organic_results)
    ? json.organic_results
    : Array.isArray(json.web_results)
      ? json.web_results
      : [];

  const candidates = organic.map((item, index) => {
    const result = item as { position?: number; link?: string };
    return {
      position: typeof result.position === 'number' ? result.position : index + 1,
      link: typeof result.link === 'string' ? result.link : '',
    };
  });
  const ownResult = candidates.find(item => isOwnResult(item.link, baseUrl));

  return {
    provider: 'serpapi',
    link: ownResult?.link ?? '',
    position: ownResult?.position ?? null,
    organicLength: organic.length,
  };
}

async function lookupRank(keyword: string, baseUrl: string): Promise<RankLookup> {
  const preferredProvider = process.env.SERP_RANK_PROVIDER === 'serpapi' ? 'serpapi' : 'naver_api';

  if (preferredProvider === 'serpapi') {
    try {
      return await lookupWithSerpApi(keyword, baseUrl);
    } catch {
      return lookupWithNaverApi(keyword, baseUrl);
    }
  }

  try {
    return await lookupWithNaverApi(keyword, baseUrl);
  } catch (naverError) {
    if (process.env.SERP_RANK_FALLBACK_SERPAPI === 'true' && getSecret('SERPAPI_KEY')) {
      return lookupWithSerpApi(keyword, baseUrl);
    }
    throw naverError;
  }
}

async function runSerpRankSnapshot(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase not configured', errors: [] as string[] };
  }

  const serpApiEnabled =
    process.env.SERP_RANK_PROVIDER === 'serpapi' ||
    process.env.SERP_RANK_FALLBACK_SERPAPI === 'true';

  if (!getSecret('NAVER_CLIENT_ID') && !serpApiEnabled) {
    return {
      skipped: true,
      reason: 'Free Naver Search API provider not configured',
      required: ['NAVER_CLIENT_ID/NAVER_CLIENT_SECRET'],
      optional: ['SERP_RANK_PROVIDER=serpapi', 'SERP_RANK_FALLBACK_SERPAPI=true'],
      errors: [] as string[],
    };
  }

  if (serpApiEnabled && !getSecret('NAVER_CLIENT_ID') && !getSecret('SERPAPI_KEY')) {
    return {
      skipped: true,
      reason: 'No rank provider configured',
      required: ['NAVER_CLIENT_ID/NAVER_CLIENT_SECRET', 'SERPAPI_KEY'],
      errors: [] as string[],
    };
  }

  const { data: rows } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('primary_keyword, destination')
    .eq('status', 'queued')
    .not('primary_keyword', 'is', null)
    .order('priority', { ascending: false })
    .limit(8);

  const { data: publishedRows } = await supabaseAdmin
    .from('content_creatives')
    .select('slug, seo_title, destination, target_ad_keywords, published_at')
    .eq('channel', 'naver_blog')
    .eq('status', 'published')
    .not('slug', 'is', null)
    .order('published_at', { ascending: false })
    .limit(16);

  const targets: RankTarget[] = [];
  for (const row of publishedRows ?? []) {
    const keywords = Array.isArray((row as any).target_ad_keywords) ? (row as any).target_ad_keywords : [];
    const keyword = String(keywords[0] || (row as any).destination || (row as any).seo_title || '').trim();
    if (keyword && (row as any).slug) {
      targets.push({ keyword, slug: String((row as any).slug) });
    }
    if (targets.length >= 6) break;
  }
  for (const row of rows ?? []) {
    const keyword = String((row as { primary_keyword?: string | null }).primary_keyword || '').trim();
    if (keyword) targets.push({ keyword });
    if (targets.length >= 8) break;
  }

  const seenKeywords = new Set<string>();
  const uniqueTargets = targets.filter((target) => {
    const key = target.slug ? `${target.slug}:${target.keyword}` : target.keyword;
    if (seenKeywords.has(key)) return false;
    seenKeywords.add(key);
    return true;
  }).slice(0, 8);

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com').replace(/\/$/, '');
  const inserted: string[] = [];
  const providers: Record<string, RankProvider> = {};
  const errors: string[] = [];
  const rankHistoryRows: Array<Record<string, unknown>> = [];
  const today = new Date().toISOString().split('T')[0];

  for (const target of uniqueTargets) {
    const kw = target.keyword;
    try {
      const lookup = await lookupRank(kw, baseUrl);
      const { error: insErr } = await insertSerpSnapshot(kw, lookup, baseUrl);
      if (insErr) {
        errors.push(`serp snapshot(${kw}): ${insErr.message}`);
        continue;
      }
      inserted.push(kw);
      providers[kw] = lookup.provider;
      const slug = target.slug || (lookup.link ? extractBlogSlugFromUrl(lookup.link) : null);
      if (slug) {
        rankHistoryRows.push({
          slug,
          query: kw,
          date: today,
          position: lookup.position,
          impressions: 0,
          clicks: 0,
          ctr: 0,
          page_url: lookup.link || `${baseUrl}/blog/${slug}`,
          source: `naver-${lookup.provider}`,
        });
        await recordBlogVisibilitySnapshot(
          supabaseAdmin,
          buildNaverVisibilitySnapshot({
            slug,
            url: lookup.link || `${baseUrl}/blog/${slug}`,
            rank: lookup.position,
            query: kw,
            source: `naver_${lookup.provider}_rank`,
            evidence: {
              organic_length: lookup.organicLength,
              own_domain_found: lookup.position !== null,
              provider: lookup.provider,
            },
          }),
        );
      }
      await new Promise(resolve => setTimeout(resolve, lookup.provider === 'serpapi' ? 600 : 250));
    } catch (e) {
      errors.push(`${kw}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (rankHistoryRows.length > 0) {
    const { error: rankErr } = await supabaseAdmin
      .from('rank_history')
      .upsert(rankHistoryRows, { onConflict: 'slug,query,date,source', ignoreDuplicates: false });
    if (rankErr) errors.push(`rank_history naver upsert failed: ${rankErr.message}`);
  }

  return {
    ok: true,
    sampled: inserted.length,
    keywords: inserted,
    providers,
    rank_history_rows: rankHistoryRows.length,
    errors,
  };
}

export const GET = withCronLogging('serp-rank-snapshot', runSerpRankSnapshot);
