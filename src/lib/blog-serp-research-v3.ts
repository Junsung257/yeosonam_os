import { fetchNaverDataLabTrends } from './keyword-research';
import { fetchNaverKeywordTool, parseNaverKeywordMetric } from './search-ads-api';
import { getSecret } from './secret-registry';
import { supabaseAdmin } from './supabase';
import type { BlogContentArchetypeV3 } from './blog-content-brief-v3';

export const BLOG_SERP_RESEARCH_VERSION = 'naver-first-serp-v3.1.0';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const BLOG_SERP_BENCHMARK_QUERIES_V3 = [
  '다낭 여행', '세부 여행', '몽골 여행', '발리 여행',
  '다낭 가볼만한곳', '세부 호텔 추천', '다낭 호텔 추천', '보홀 신혼여행',
  '나트랑 여행', '보라카이 가볼만한곳', '다낭 여행 비용', '다낭 4박5일 여행 코스',
  '다낭 10월 날씨', '다낭 10월 우기', '다낭 10월 옷차림', '다낭 비오는날 가볼만한곳',
  '세부 가족여행 호텔 추천', '세부시티 막탄 숙소 어디', '7월 몽골 여행 준비물', '몽골 7월 옷차림',
  '석가장 날씨', '호화호특 날씨', '보라카이 7월 날씨', '발리 7월 날씨',
] as const;

export const BLOG_SERP_INITIAL_OPERATING_CANDIDATES_V3 = [
  '다낭 10월 날씨',
  '다낭 가볼만한곳',
  '세부 호텔 추천',
] as const;

export function prioritizeBlogSerpInitialCandidatesV3<
  T extends { primary_keyword?: string | null; topic?: string | null },
>(rows: T[]): T[] {
  const normalizedPriority = new Map(
    BLOG_SERP_INITIAL_OPERATING_CANDIDATES_V3.map((query, index) => [normalizeSerpQueryV3(query), index]),
  );
  return rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((left, right) => {
      const leftKey = normalizeSerpQueryV3(left.row.primary_keyword || left.row.topic);
      const rightKey = normalizeSerpQueryV3(right.row.primary_keyword || right.row.topic);
      const leftPriority = normalizedPriority.get(leftKey) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = normalizedPriority.get(rightKey) ?? Number.MAX_SAFE_INTEGER;
      return leftPriority - rightPriority || left.originalIndex - right.originalIndex;
    })
    .map(({ row }) => row);
}

export type SerpResearchModeV3 = 'fresh' | 'cached' | 'fallback_only' | 'unavailable';

export type SearchDecisionIntent =
  | 'weather_travel_viability'
  | 'destination_overview'
  | 'attraction_selection'
  | 'hotel_area_selection'
  | 'route_decision'
  | 'itinerary_execution'
  | 'budget_decision'
  | 'current_change'
  | 'traveler_fit'
  | 'direct_answer';

export interface KeywordClusterV3 {
  primaryQuery: string;
  secondaryQueries: string[];
  tier: 'broad' | 'mid' | 'longtail';
  destination: string | null;
}

export interface SerpFeatureSummary {
  editorialResultCount: number;
  naverBlogCount: number;
  naverWebCount: number;
  hotelPackLikely: boolean;
  localPackLikely: boolean;
  videoIntentLikely: boolean;
}

export interface DecisionCoverage {
  purpose: string;
  resultCount: number;
  resultShare: number;
  role: 'common' | 'observed';
}

export interface DecisionGap {
  purpose: string;
  reason: string;
  observedResultCount: number;
}

export interface SerpProvenance {
  provider: 'naver_search_api' | 'naver_search_ads' | 'naver_datalab' | 'google_search_console' | 'cache';
  status: 'used' | 'empty' | 'unconfigured' | 'error';
  sourceReference: string;
  observedAt: string;
  detail?: string;
}

export interface SerpDemandSignalV3 {
  provider: 'naver_search_ads' | 'naver_datalab' | 'google_search_console';
  metric: 'monthly_pc_searches' | 'monthly_mobile_searches' | 'monthly_total_searches' | 'relative_trend_index' | 'impressions';
  value: number;
  unit: 'searches_per_month' | 'relative_index_0_100' | 'impressions_90d';
  valueKind: 'provider_estimate' | 'relative_index' | 'observed';
  sourceReference: string;
}

export interface SerpEditorialResultV3 {
  sampleRank: number;
  providerRank: number;
  source: 'naver_blog' | 'naver_web';
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt: string | null;
}

export interface CompetitorPhraseMatchV3 {
  url: string;
  tokenCount: number;
  phrase: string;
}

export interface SerpResearchPacketV3 {
  version: typeof BLOG_SERP_RESEARCH_VERSION;
  queryCluster: KeywordClusterV3;
  mode: SerpResearchModeV3;
  serpFeatures: SerpFeatureSummary;
  intent: SearchDecisionIntent;
  consensus: DecisionCoverage[];
  contentGaps: DecisionGap[];
  archetypeCandidates: BlogContentArchetypeV3[];
  demandSignals: SerpDemandSignalV3[];
  verifiedDemand: boolean;
  confidence: number;
  provenance: SerpProvenance[];
  researchedAt: string;
  expiresAt: string;
  results: SerpEditorialResultV3[];
}

interface NaverSearchItem {
  title?: unknown;
  description?: unknown;
  link?: unknown;
  postdate?: unknown;
}

interface NaverSearchPayload {
  items?: NaverSearchItem[];
}

interface GscAggregateRow {
  impressions?: unknown;
}

export interface BlogSerpResearchV3Dependencies {
  now?: () => Date;
  fetchNaverResults?: (query: string) => Promise<SerpEditorialResultV3[]>;
  fetchNaverKeywordDemand?: (query: string) => Promise<SerpDemandSignalV3[]>;
  fetchNaverTrend?: (query: string) => Promise<SerpDemandSignalV3[]>;
  fetchGscDemand?: (query: string) => Promise<SerpDemandSignalV3[]>;
  readCached?: (normalizedQuery: string, nowIso: string) => Promise<SerpResearchPacketV3 | null>;
  persist?: (packet: SerpResearchPacketV3) => Promise<void>;
}

const clean = (value: unknown): string => String(value ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(?:nbsp|amp|quot|lt|gt);/gi, ' ')
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim();

export function normalizeSerpQueryV3(value: unknown): string {
  return clean(value).toLowerCase();
}

export function parseNaverSearchCount(value: unknown): number | null {
  return parseNaverKeywordMetric(value);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = normalizeSerpQueryV3(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isEditorialUrl(url: string): boolean {
  const domain = domainOf(url);
  if (!domain) return false;
  return !/(?:shopping|smartstore|map|booking|flight|pay)\.naver\.com$/.test(domain)
    && !/(?:youtube\.com|youtu\.be|instagram\.com|tiktok\.com)$/.test(domain);
}

function inferDestination(query: string): string | null {
  const stop = /^(여행|날씨|우기|옷차림|준비물|가볼만한곳|호텔|숙소|추천|비용|예산|코스|일정|가이드|관광)$/;
  return clean(query)
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/(?:1[0-2]|[1-9])\s*월/g, ' ')
    .split(/[\s,/|]+/)
    .find((token) => token.length >= 2 && !stop.test(token)) ?? null;
}

export function inferSearchDecisionIntentV3(query: string): SearchDecisionIntent {
  const text = clean(query);
  if (/변경|시행|중단|재개|ETIAS|ETA|ESTA|규정|정책/i.test(text)) return 'current_change';
  if (/날씨|우기|건기|옷차림|기온|강수|태풍/i.test(text)) return 'weather_travel_viability';
  if (/호텔|리조트|숙소|어디.*묵|막탄|세부시티/i.test(text)) return 'hotel_area_selection';
  if (/가볼만한곳|관광지|명소|액티비티/i.test(text)) return 'attraction_selection';
  if (/공항.*(?:에서|부터)|가는\s*법|이동|교통/i.test(text)) return 'route_decision';
  if (/비용|예산|경비|가격/i.test(text)) return 'budget_decision';
  if (/\d+박\s*\d+일|일정|코스|동선/i.test(text)) return 'itinerary_execution';
  if (/부모님|가족|아이|커플|신혼|혼자|시니어/i.test(text)) return 'traveler_fit';
  if (/^[^\s]+\s*여행$/i.test(text) || /여행\s*(?:정보|가이드|준비)?$/i.test(text)) return 'destination_overview';
  return 'direct_answer';
}

function queryTier(query: string): KeywordClusterV3['tier'] {
  const count = clean(query).split(/\s+/).filter(Boolean).length;
  if (count <= 2) return 'broad';
  if (count >= 5 || /(?:1[0-2]|[1-9])\s*월|\d+박\s*\d+일|가족|부모님|비오는날/i.test(query)) return 'longtail';
  return 'mid';
}

function sectionRolePatterns(): Array<[string, RegExp]> {
  return [
    ['여행 가능 여부를 먼저 답하기', /가능|괜찮|가도|여행하기|추천\s*시기|한눈에/i],
    ['변동성과 위험 설명', /우기|비|강수|태풍|스콜|변동|주의/i],
    ['옷차림과 준비 판단', /옷차림|준비물|복장|우산|우비/i],
    ['우천·실패 대안 제시', /비오는\s*날|우천|대안|실내|플랜\s*b/i],
    ['지역을 먼저 선택', /지역|위치|막탄|세부시티|어디.*숙소/i],
    ['여행자 유형별 선택', /가족|커플|신혼|아이|부모님|혼자|유형/i],
    ['선택지 장단점 비교', /비교|장단점|vs|추천|베스트|순위/i],
    ['이동·동선 설명', /동선|이동|교통|공항|소요\s*시간|거리/i],
    ['비용과 추가 조건', /비용|예산|가격|요금|추가\s*비용/i],
    ['예약·운영 조건 확인', /예약|운영\s*시간|입장|티켓|체크인/i],
    ['일정 흐름과 휴식', /일정|코스|day\s*\d|휴식|시간대/i],
  ];
}

function desiredPurposes(intent: SearchDecisionIntent): string[] {
  switch (intent) {
    case 'weather_travel_viability':
      return ['여행 가능 여부를 먼저 답하기', '변동성과 위험 설명', '옷차림과 준비 판단', '우천·실패 대안 제시'];
    case 'hotel_area_selection':
      return ['지역을 먼저 선택', '여행자 유형별 선택', '선택지 장단점 비교', '이동·동선 설명', '예약·운영 조건 확인'];
    case 'attraction_selection':
      return ['여행자 유형별 선택', '이동·동선 설명', '비용과 추가 조건', '예약·운영 조건 확인'];
    case 'route_decision':
      return ['선택지 장단점 비교', '이동·동선 설명', '비용과 추가 조건', '예약·운영 조건 확인'];
    case 'itinerary_execution':
      return ['일정 흐름과 휴식', '이동·동선 설명', '우천·실패 대안 제시', '예약·운영 조건 확인'];
    case 'budget_decision':
      return ['비용과 추가 조건', '선택지 장단점 비교', '여행자 유형별 선택'];
    case 'traveler_fit':
      return ['여행자 유형별 선택', '이동·동선 설명', '우천·실패 대안 제시'];
    case 'current_change':
      return ['여행 가능 여부를 먼저 답하기', '변동성과 위험 설명', '예약·운영 조건 확인'];
    default:
      return ['여행 가능 여부를 먼저 답하기', '이동·동선 설명', '예약·운영 조건 확인'];
  }
}

function archetypesFor(intent: SearchDecisionIntent): BlogContentArchetypeV3[] {
  switch (intent) {
    case 'weather_travel_viability': return ['direct_answer', 'seasonal_calendar', 'mistake_prevention'];
    case 'hotel_area_selection': return ['neighborhood_selector', 'decision_comparison', 'traveler_type_plan'];
    case 'attraction_selection': return ['traveler_type_plan', 'decision_comparison', 'itinerary_timeline'];
    case 'route_decision': return ['route_walkthrough', 'decision_comparison', 'mistake_prevention'];
    case 'itinerary_execution': return ['itinerary_timeline', 'traveler_type_plan'];
    case 'budget_decision': return ['budget_scenarios', 'decision_comparison'];
    case 'current_change': return ['current_change_explainer', 'direct_answer'];
    case 'traveler_fit': return ['traveler_type_plan', 'decision_comparison'];
    case 'destination_overview': return ['direct_answer', 'decision_comparison'];
    default: return ['direct_answer', 'decision_comparison'];
  }
}

function analyzeDecisionCoverage(results: SerpEditorialResultV3[], intent: SearchDecisionIntent): {
  consensus: DecisionCoverage[];
  gaps: DecisionGap[];
} {
  const patterns = sectionRolePatterns();
  const counts = new Map(patterns.map(([purpose]) => [purpose, 0]));
  for (const result of results) {
    const text = `${result.title} ${result.snippet}`;
    for (const [purpose, pattern] of patterns) {
      if (pattern.test(text)) counts.set(purpose, (counts.get(purpose) ?? 0) + 1);
    }
  }
  const denominator = Math.max(1, results.length);
  const consensus = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([purpose, resultCount]) => ({
      purpose,
      resultCount,
      resultShare: Number((resultCount / denominator).toFixed(3)),
      role: resultCount / denominator >= 0.5 ? 'common' as const : 'observed' as const,
    }))
    .sort((a, b) => b.resultCount - a.resultCount || a.purpose.localeCompare(b.purpose, 'ko'));
  const gaps = desiredPurposes(intent)
    .filter((purpose) => (counts.get(purpose) ?? 0) < Math.max(2, Math.ceil(results.length * 0.3)))
    .map((purpose) => ({
      purpose,
      reason: '검색 질문을 완결하는 데 필요하지만 분석 표본에서 충분히 해결되지 않은 결정 항목',
      observedResultCount: counts.get(purpose) ?? 0,
    }));
  return { consensus, gaps };
}

async function fetchNaverVertical(query: string, source: 'naver_blog' | 'naver_web'): Promise<SerpEditorialResultV3[]> {
  const clientId = getSecret('NAVER_CLIENT_ID');
  const clientSecret = getSecret('NAVER_CLIENT_SECRET');
  if (!clientId || !clientSecret) return [];
  const endpoint = source === 'naver_blog' ? 'blog' : 'webkr';
  const response = await fetch(
    `https://openapi.naver.com/v1/search/${endpoint}.json?query=${encodeURIComponent(query)}&display=10&sort=sim`,
    {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`naver_search_${source}_http_${response.status}`);
  const payload = await response.json() as NaverSearchPayload;
  return (payload.items ?? [])
    .map((item, index) => {
      const url = clean(item.link);
      return {
        sampleRank: 0,
        providerRank: index + 1,
        source,
        title: clean(item.title),
        url,
        domain: domainOf(url),
        snippet: clean(item.description).slice(0, 360),
        publishedAt: /^\d{8}$/.test(clean(item.postdate))
          ? `${clean(item.postdate).slice(0, 4)}-${clean(item.postdate).slice(4, 6)}-${clean(item.postdate).slice(6, 8)}T00:00:00.000Z`
          : null,
      } satisfies SerpEditorialResultV3;
    })
    .filter((item) => item.title && item.url && isEditorialUrl(item.url));
}

export async function fetchNaverEditorialResultsV3(query: string): Promise<SerpEditorialResultV3[]> {
  const settled = await Promise.allSettled([
    fetchNaverVertical(query, 'naver_blog'),
    fetchNaverVertical(query, 'naver_web'),
  ]);
  const blog = settled[0].status === 'fulfilled' ? settled[0].value : [];
  const web = settled[1].status === 'fulfilled' ? settled[1].value : [];
  const merged: SerpEditorialResultV3[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < 10 && merged.length < 10; index += 1) {
    for (const result of [blog[index], web[index]]) {
      if (!result) continue;
      const key = result.url.toLowerCase().replace(/\/$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...result, sampleRank: merged.length + 1 });
      if (merged.length >= 10) break;
    }
  }
  return merged;
}

export async function fetchNaverKeywordDemandV3(query: string): Promise<SerpDemandSignalV3[]> {
  const rows = await fetchNaverKeywordTool([query.replace(/\s+/g, '')]);
  const normalized = normalizeSerpQueryV3(query).replace(/\s+/g, '');
  const exact = rows.find((row) => normalizeSerpQueryV3(row.relKeyword).replace(/\s+/g, '') === normalized);
  if (!exact) return [];
  const pc = parseNaverSearchCount(exact.monthlyPcQcCnt);
  const mobile = parseNaverSearchCount(exact.monthlyMobileQcCnt);
  if (pc === null && mobile === null) return [];
  const sourceReference = 'https://api.searchad.naver.com/keywordstool';
  return [
    ...(pc === null ? [] : [{
      provider: 'naver_search_ads' as const,
      metric: 'monthly_pc_searches' as const,
      value: pc,
      unit: 'searches_per_month' as const,
      valueKind: 'provider_estimate' as const,
      sourceReference,
    }]),
    ...(mobile === null ? [] : [{
      provider: 'naver_search_ads' as const,
      metric: 'monthly_mobile_searches' as const,
      value: mobile,
      unit: 'searches_per_month' as const,
      valueKind: 'provider_estimate' as const,
      sourceReference,
    }]),
    ...(pc === null || mobile === null ? [] : [{
      provider: 'naver_search_ads' as const,
      metric: 'monthly_total_searches' as const,
      value: pc + mobile,
      unit: 'searches_per_month' as const,
      valueKind: 'provider_estimate' as const,
      sourceReference,
    }]),
  ];
}

export async function fetchNaverTrendDemandV3(query: string): Promise<SerpDemandSignalV3[]> {
  const trend = (await fetchNaverDataLabTrends([query])).get(query);
  if (!trend || trend.score < 0) return [];
  return [{
    provider: 'naver_datalab',
    metric: 'relative_trend_index',
    value: trend.score,
    unit: 'relative_index_0_100',
    valueKind: 'relative_index',
    sourceReference: 'https://openapi.naver.com/v1/datalab/search',
  }];
}

export async function fetchGscDemandV3(query: string): Promise<SerpDemandSignalV3[]> {
  try {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const result = await supabaseAdmin
      .from('blog_search_performance')
      .select('impressions')
      .eq('provider', 'google_search_console')
      .eq('query', query)
      .gte('metric_date', since)
      .limit(5000);
    if (result.error) return [];
    const impressions = (result.data as GscAggregateRow[] | null ?? [])
      .reduce((sum, row) => sum + Math.max(0, Number(row.impressions) || 0), 0);
    if (impressions <= 0) return [];
    return [{
      provider: 'google_search_console',
      metric: 'impressions',
      value: impressions,
      unit: 'impressions_90d',
      valueKind: 'observed',
      sourceReference: 'public.blog_search_performance',
    }];
  } catch {
    return [];
  }
}

async function readCachedPacketV3(normalizedQuery: string, nowIso: string): Promise<SerpResearchPacketV3 | null> {
  try {
    const result = await supabaseAdmin
      .from('blog_serp_research_runs')
      .select('serp_features,expires_at')
      .eq('query_normalized', normalizedQuery)
      .in('status', ['completed', 'partial'])
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error || !result.data) return null;
    const features = result.data.serp_features as Record<string, unknown> | null;
    const packet = features?.packet as SerpResearchPacketV3 | undefined;
    if (!packet || packet.version !== BLOG_SERP_RESEARCH_VERSION) return null;
    return { ...packet, mode: 'cached' };
  } catch {
    return null;
  }
}

async function persistPacketV3(packet: SerpResearchPacketV3): Promise<void> {
  const primaryProvider = packet.provenance.find((entry) => entry.status === 'used')?.provider ?? 'fallback';
  const provider = primaryProvider === 'cache' ? 'fallback' : primaryProvider;
  try {
    const runResult = await supabaseAdmin
      .from('blog_serp_research_runs')
      .insert({
        query: packet.queryCluster.primaryQuery,
        query_normalized: normalizeSerpQueryV3(packet.queryCluster.primaryQuery),
        provider,
        engine: 'naver-first',
        locale: 'ko-KR',
        device: 'mobile',
        mode: packet.mode,
        status: packet.mode === 'unavailable' ? 'failed' : (packet.results.length >= 6 ? 'completed' : 'partial'),
        serp_features: { packet },
        related_queries: packet.queryCluster.secondaryQueries,
        demand_signals: packet.demandSignals,
        expires_at: packet.expiresAt,
        completed_at: packet.researchedAt,
      })
      .select('id')
      .single();
    if (runResult.error || !runResult.data?.id) return;
    const runId = String(runResult.data.id);
    if (packet.results.length > 0) {
      await supabaseAdmin.from('serp_snapshots').insert(packet.results.map((result) => ({
        research_run_id: runId,
        keyword: packet.queryCluster.primaryQuery,
        source: result.source,
        rank: result.sampleRank,
        original_rank: result.providerRank,
        result_type: 'editorial',
        domain: result.domain,
        is_editorial: true,
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        published_at: result.publishedAt,
        fetched_at: packet.researchedAt,
      })));
    }
    if (packet.demandSignals.length > 0) {
      const observedFrom = new Date(new Date(packet.researchedAt).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const observedTo = packet.researchedAt.slice(0, 10);
      await supabaseAdmin.from('blog_keyword_demand_observations').insert(packet.demandSignals.map((signal) => ({
        research_run_id: runId,
        query: packet.queryCluster.primaryQuery,
        query_normalized: normalizeSerpQueryV3(packet.queryCluster.primaryQuery),
        provider: signal.provider,
        metric_name: signal.metric,
        metric_value: signal.value,
        unit: signal.unit,
        value_kind: signal.valueKind,
        observed_from: observedFrom,
        observed_to: observedTo,
        source_reference: signal.sourceReference,
        expires_at: packet.expiresAt,
        raw: { research_version: packet.version },
      })));
    }
    await supabaseAdmin.from('serp_analysis').upsert({
      keyword: packet.queryCluster.primaryQuery,
      source: 'naver_first',
      avg_title_len: packet.results.length
        ? packet.results.reduce((sum, result) => sum + result.title.length, 0) / packet.results.length
        : 0,
      power_words: [],
      year_inclusion_rate: 0,
      bracket_rate: 0,
      entities: [],
      recommended_title_pattern: null,
      intent: packet.intent,
      recommended_archetypes: packet.archetypeCandidates,
      structure_consensus: packet.consensus,
      content_gaps: packet.contentGaps,
      confidence: packet.confidence,
      analysis_version: packet.version,
      raw: { research_run_id: runId, mode: packet.mode, demand_signals: packet.demandSignals },
      fetched_at: packet.researchedAt,
    }, { onConflict: 'keyword' });
  } catch {
    // A deployment can run before the additive migration is applied. Research
    // remains usable in-memory and publishing policy still fails closed on demand.
  }
}

export async function researchSerpNaverFirstV3(input: {
  primaryQuery: string;
  secondaryQueries?: string[];
  persist?: boolean;
}, dependencies: BlogSerpResearchV3Dependencies = {}): Promise<SerpResearchPacketV3> {
  const now = dependencies.now?.() ?? new Date();
  const researchedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS).toISOString();
  const primaryQuery = clean(input.primaryQuery);
  const normalized = normalizeSerpQueryV3(primaryQuery);
  const cachedReader = dependencies.readCached ?? readCachedPacketV3;
  const cached = await cachedReader(normalized, researchedAt);
  if (cached) return cached;

  const provenance: SerpProvenance[] = [];
  const naverSearchConfigured = Boolean(getSecret('NAVER_CLIENT_ID') && getSecret('NAVER_CLIENT_SECRET'));
  const naverAdsConfigured = Boolean(
    getSecret('NAVER_ADS_API_KEY') && getSecret('NAVER_ADS_SECRET_KEY') && getSecret('NAVER_ADS_CUSTOMER_ID'),
  );
  const [resultOutcome, keywordOutcome, trendOutcome, gscOutcome] = await Promise.allSettled([
    (dependencies.fetchNaverResults ?? fetchNaverEditorialResultsV3)(primaryQuery),
    (dependencies.fetchNaverKeywordDemand ?? fetchNaverKeywordDemandV3)(primaryQuery),
    (dependencies.fetchNaverTrend ?? fetchNaverTrendDemandV3)(primaryQuery),
    (dependencies.fetchGscDemand ?? fetchGscDemandV3)(primaryQuery),
  ]);
  const results = resultOutcome.status === 'fulfilled' ? resultOutcome.value : [];
  const keywordDemand = keywordOutcome.status === 'fulfilled' ? keywordOutcome.value : [];
  const trendDemand = trendOutcome.status === 'fulfilled' ? trendOutcome.value : [];
  const gscDemand = gscOutcome.status === 'fulfilled' ? gscOutcome.value : [];
  provenance.push({
    provider: 'naver_search_api',
    status: resultOutcome.status === 'rejected' ? 'error' : results.length ? 'used' : (naverSearchConfigured ? 'empty' : 'unconfigured'),
    sourceReference: 'https://openapi.naver.com/v1/search/blog.json + webkr.json',
    observedAt: researchedAt,
    detail: results.length ? `${results.length} editorial samples` : undefined,
  });
  provenance.push({
    provider: 'naver_search_ads',
    status: keywordOutcome.status === 'rejected' ? 'error' : keywordDemand.length ? 'used' : (naverAdsConfigured ? 'empty' : 'unconfigured'),
    sourceReference: 'https://api.searchad.naver.com/keywordstool',
    observedAt: researchedAt,
  });
  provenance.push({
    provider: 'naver_datalab',
    status: trendOutcome.status === 'rejected' ? 'error' : trendDemand.length ? 'used' : (naverSearchConfigured ? 'empty' : 'unconfigured'),
    sourceReference: 'https://openapi.naver.com/v1/datalab/search',
    observedAt: researchedAt,
  });
  provenance.push({
    provider: 'google_search_console',
    status: gscOutcome.status === 'rejected' ? 'error' : gscDemand.length ? 'used' : 'empty',
    sourceReference: 'public.blog_search_performance',
    observedAt: researchedAt,
  });

  const demandSignals = [...keywordDemand, ...trendDemand, ...gscDemand];
  const intent = inferSearchDecisionIntentV3(primaryQuery);
  const { consensus, gaps } = analyzeDecisionCoverage(results, intent);
  const secondaryQueries = unique([
    ...(input.secondaryQueries ?? []),
  ]).filter((query) => normalizeSerpQueryV3(query) !== normalized).slice(0, 12);
  const mode: SerpResearchModeV3 = results.length > 0
    ? 'fresh'
    : demandSignals.length > 0
      ? 'fallback_only'
      : 'unavailable';
  const sourceCoverage = [results.length > 0, keywordDemand.length > 0, trendDemand.length > 0, gscDemand.length > 0]
    .filter(Boolean).length;
  const confidence = Number(Math.min(1, (
    Math.min(0.55, results.length * 0.055)
    + Math.min(0.35, sourceCoverage * 0.1)
    + (consensus.length > 0 ? 0.1 : 0)
  )).toFixed(3));
  const packet: SerpResearchPacketV3 = {
    version: BLOG_SERP_RESEARCH_VERSION,
    queryCluster: {
      primaryQuery,
      secondaryQueries,
      tier: queryTier(primaryQuery),
      destination: inferDestination(primaryQuery),
    },
    mode,
    serpFeatures: {
      editorialResultCount: results.length,
      naverBlogCount: results.filter((result) => result.source === 'naver_blog').length,
      naverWebCount: results.filter((result) => result.source === 'naver_web').length,
      hotelPackLikely: intent === 'hotel_area_selection',
      localPackLikely: intent === 'attraction_selection',
      videoIntentLikely: /브이로그|영상|후기/i.test(primaryQuery),
    },
    intent,
    consensus,
    contentGaps: gaps,
    archetypeCandidates: archetypesFor(intent),
    demandSignals,
    verifiedDemand: demandSignals.some((signal) => signal.value > 0),
    confidence,
    provenance,
    researchedAt,
    expiresAt,
    results,
  };
  if (input.persist !== false) await (dependencies.persist ?? persistPacketV3)(packet);
  return packet;
}

export function buildSerpResearchPromptBlockV3(packet: SerpResearchPacketV3): string {
  const consensus = packet.consensus.length
    ? packet.consensus.map((item) => `- ${item.purpose}: ${item.resultCount}/${packet.serpFeatures.editorialResultCount}개 표본`).join('\n')
    : '- 구조 합의가 충분하지 않음';
  const gaps = packet.contentGaps.length
    ? packet.contentGaps.map((item) => `- ${item.purpose}: ${item.reason}`).join('\n')
    : '- 추가 결정 빈칸 없음';
  return [
    '## 검색 의도 연구 패킷 V3',
    `- 기준 검색어: ${packet.queryCluster.primaryQuery}`,
    `- 연구 모드: ${packet.mode}`,
    `- 주된 결정 의도: ${packet.intent}`,
    `- 분석 가능한 네이버 editorial 표본: ${packet.serpFeatures.editorialResultCount}개`,
    `- 권장 archetype 후보: ${packet.archetypeCandidates.join(', ')}`,
    '',
    '### 표본에서 관찰된 의사결정 방식',
    consensus,
    '',
    '### 우리가 독자에게 추가로 해결해야 할 빈칸',
    gaps,
    '',
    '- 위 항목은 H2 문구 복사 목록이 아니다. 선택한 archetype 안에서 독자의 결정을 해결하는 용도로만 사용한다.',
    '- 경쟁 결과의 문장, 목차, 숫자, 경험담을 복제하지 않는다. 모든 외부 사실은 별도 공식 연구 packet의 claim만 사용한다.',
    '- 검색량, DataLab 상대지수, GSC 노출은 본문에 공개하지 않는다.',
  ].join('\n');
}

function comparableTokens(value: string): string[] {
  return clean(value)
    .toLowerCase()
    .replace(/[^가-힣a-z0-9\s]/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

export function findCompetitorPhraseMatchesV3(
  candidate: string,
  results: SerpEditorialResultV3[],
  minimumTokens = 12,
): CompetitorPhraseMatchV3[] {
  const normalizedCandidate = ` ${comparableTokens(candidate).join(' ')} `;
  if (!normalizedCandidate.trim()) return [];
  const matches: CompetitorPhraseMatchV3[] = [];
  for (const result of results) {
    const tokens = comparableTokens(`${result.title} ${result.snippet}`);
    for (let index = 0; index <= tokens.length - minimumTokens; index += 1) {
      const phrase = tokens.slice(index, index + minimumTokens).join(' ');
      if (normalizedCandidate.includes(` ${phrase} `)) {
        matches.push({ url: result.url, tokenCount: minimumTokens, phrase });
        break;
      }
    }
  }
  return matches;
}
