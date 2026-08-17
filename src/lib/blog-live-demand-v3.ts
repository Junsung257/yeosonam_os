import type { BlogDemandSignalInput } from './blog-autopublish-policy-v3';
import {
  fetchNaverKeywordDemandV3,
  fetchNaverTrendDemandV3,
  type SerpDemandSignalV3,
} from './blog-serp-research-v3';

export interface BlogLiveDemandEnrichmentV3 {
  signal: BlogDemandSignalInput;
  acceptedProviders: string[];
  errors: string[];
}

interface BlogLiveDemandDependenciesV3 {
  fetchKeywordDemand?: (query: string) => Promise<SerpDemandSignalV3[]>;
  fetchTrendDemand?: (query: string) => Promise<SerpDemandSignalV3[]>;
}

function positive(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

/**
 * Adds only observed provider values to a queue demand signal. Naver Search
 * result presence is deliberately not accepted as demand, DataLab remains a
 * relative index, and Search Ads "< 10" buckets remain unknown/null.
 */
export async function enrichBlogDemandWithNaverV3(
  base: BlogDemandSignalInput,
  query: string | null | undefined,
  dependencies: BlogLiveDemandDependenciesV3 = {},
): Promise<BlogLiveDemandEnrichmentV3> {
  const normalizedQuery = String(query ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!normalizedQuery) return { signal: { ...base }, acceptedProviders: [], errors: [] };

  const [keywordOutcome, trendOutcome] = await Promise.allSettled([
    (dependencies.fetchKeywordDemand ?? fetchNaverKeywordDemandV3)(normalizedQuery),
    (dependencies.fetchTrendDemand ?? fetchNaverTrendDemandV3)(normalizedQuery),
  ]);
  const keywordSignals = keywordOutcome.status === 'fulfilled' ? keywordOutcome.value : [];
  const trendSignals = trendOutcome.status === 'fulfilled' ? trendOutcome.value : [];
  const monthlyTotal = keywordSignals
    .filter((signal) => signal.metric === 'monthly_total_searches')
    .reduce((max, signal) => Math.max(max, positive(signal.value)), 0);
  const trendScore = trendSignals
    .filter((signal) => signal.metric === 'relative_trend_index')
    .reduce((max, signal) => Math.max(max, positive(signal.value)), 0);
  const acceptedProviders: string[] = [];
  const hasNaverSearchAdsDemand = keywordSignals.some((signal) => positive(signal.value) > 0);
  if (hasNaverSearchAdsDemand) acceptedProviders.push('search_volume:naver_search_ads');
  if (trendScore > 0) acceptedProviders.push('search_trend:naver_datalab');

  return {
    signal: {
      ...base,
      naver: base.naver === true || hasNaverSearchAdsDemand,
      monthlySearchVolume: Math.max(positive(base.monthlySearchVolume), monthlyTotal) || null,
      trendScore: Math.max(positive(base.trendScore), trendScore) || null,
    },
    acceptedProviders,
    errors: [
      ...(keywordOutcome.status === 'rejected'
        ? [`naver_search_ads:${keywordOutcome.reason instanceof Error ? keywordOutcome.reason.message : String(keywordOutcome.reason)}`]
        : []),
      ...(trendOutcome.status === 'rejected'
        ? [`naver_datalab:${trendOutcome.reason instanceof Error ? trendOutcome.reason.message : String(trendOutcome.reason)}`]
        : []),
    ],
  };
}
