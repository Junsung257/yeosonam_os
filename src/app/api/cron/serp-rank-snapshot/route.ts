import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { getSecret } from '@/lib/secret-registry';

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

  const keywords = [...new Set((rows ?? []).map((r: { primary_keyword: string | null }) => r.primary_keyword).filter(Boolean))] as string[];

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://yeosonam.com').replace(/\/$/, '');
  const inserted: string[] = [];
  const providers: Record<string, RankProvider> = {};
  const errors: string[] = [];

  for (const kw of keywords) {
    try {
      const lookup = await lookupRank(kw, baseUrl);
      const { error: insErr } = await insertSerpSnapshot(kw, lookup, baseUrl);
      if (insErr) {
        errors.push(`serp snapshot(${kw}): ${insErr.message}`);
        continue;
      }
      inserted.push(kw);
      providers[kw] = lookup.provider;
      await new Promise(resolve => setTimeout(resolve, lookup.provider === 'serpapi' ? 600 : 250));
    } catch (e) {
      errors.push(`${kw}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    ok: true,
    sampled: inserted.length,
    keywords: inserted,
    providers,
    errors,
  };
}

export const GET = withCronLogging('serp-rank-snapshot', runSerpRankSnapshot);
