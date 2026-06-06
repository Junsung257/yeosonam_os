import { classifySearchIntent, intentPriorityDelta } from './blog-search-intent';
import {
  classifyKeywordTier,
  detectDestination,
  researchKeywordsBatch,
  type CompetitionLevel,
  type KeywordTier,
} from './keyword-research';
import { fetchRelatedQueries } from './related-queries';
import { supabaseAdmin } from './supabase';

const DEFAULT_LOOKBACK_DAYS = 28;
const DEFAULT_LIMIT = 8;
const DEFAULT_SEED_LIMIT = 20;
const DEFAULT_MAX_CANDIDATES_PER_SEED = 5;
const DEFAULT_RECENT_DEDUP_DAYS = 90;

const LONGTAIL_MODIFIERS = [
  '비용',
  '일정',
  '준비물',
  '후기',
  '가이드',
  '추천',
  '날씨',
  '환전',
  '공항 이동',
  '가족여행',
  '효도여행',
];

const STOP_TOKENS = new Set([
  '여행',
  '가이드',
  '추천',
  '정리',
  '완벽',
  '최신',
  '총정리',
  '정보',
  '방법',
]);

interface RankHistoryRow {
  slug: string | null;
  query: string | null;
  position: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
}

interface BlogPostLite {
  id: string;
  slug: string | null;
  seo_title: string | null;
  destination: string | null;
  angle_type: string | null;
  product_id: string | null;
}

interface BlogPerformanceLite {
  slug: string | null;
  traffic_count: number | null;
  first_touch_conversions: number | null;
  first_touch_profit: number | null;
  first_touch_revenue: number | null;
}

export interface LongtailSeed {
  slug: string;
  query: string;
  destination: string | null;
  title: string | null;
  impressions: number;
  clicks: number;
  avgPosition: number;
  ctr: number;
  score: number;
  conversionScore: number;
}

export interface LongtailCandidate {
  keyword: string;
  topic: string;
  destination: string | null;
  familyKey: string;
  seedQuery: string;
  seedSlug: string;
  seedScore: number;
  sourceKind: 'related_query' | 'modifier_variant' | 'winner_query';
  tier: KeywordTier;
  monthlySearchVolume: number | null;
  competitionLevel: CompetitionLevel | null;
  intent: ReturnType<typeof classifySearchIntent>;
  priority: number;
  cannibalizationRisk: 'low' | 'medium' | 'high';
  duplicateReason?: string;
}

export interface LongtailExpansionResult {
  seeds: LongtailSeed[];
  candidates: LongtailCandidate[];
  inserted: Array<{ id: string; primary_keyword: string | null }>;
  skipped: Array<{ keyword: string; reason: string }>;
  dryRun: boolean;
  errors: string[];
}

export interface ExpandLongtailOptions {
  limit?: number;
  seedLimit?: number;
  lookbackDays?: number;
  recentDedupDays?: number;
  maxCandidatesPerSeed?: number;
  minSeedImpressions?: number;
  minSeedClicks?: number;
  maxAvgPosition?: number;
  dryRun?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function daysAgoDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

export function normalizeKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\b20\d{2}\b/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeKeyword(keyword: string): string[] {
  const normalized = normalizeKeyword(keyword);
  return normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_TOKENS.has(token));
}

export function buildKeywordFamilyKey(keyword: string, destination: string | null): string {
  const tokens = tokenizeKeyword(keyword)
    .filter((token) => !/^\d+\uC6D4$/.test(token))
    .filter((token) => !/^20\d{2}$/.test(token))
    .sort()
    .slice(0, 5);
  const dest = destination ? normalizeKeyword(destination) : 'global';
  return `${dest}::${tokens.join('|') || normalizeKeyword(keyword)}`;
}

export function keywordSimilarity(a: string, b: string): number {
  const na = normalizeKeyword(a);
  const nb = normalizeKeyword(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length);
    const longer = Math.max(na.length, nb.length);
    return shorter / longer;
  }

  const aTokens = new Set(tokenizeKeyword(a));
  const bTokens = new Set(tokenizeKeyword(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection++;
  }
  const union = new Set([...aTokens, ...bTokens]).size;
  return intersection / union;
}

function isNearDuplicate(keyword: string, existing: string[]): string | null {
  for (const value of existing) {
    if (!value) continue;
    const similarity = keywordSimilarity(keyword, value);
    if (similarity >= 0.82) return value;
  }
  return null;
}

function cleanCandidateKeyword(keyword: string): string {
  return keyword
    .replace(/\s+/g, ' ')
    .replace(/[|]/g, ' ')
    .trim()
    .slice(0, 80);
}

function ensureDestinationPrefix(keyword: string, destination: string | null): string {
  if (!destination) return keyword;
  return keyword.includes(destination) ? keyword : `${destination} ${keyword}`;
}

function buildTopic(keyword: string, destination: string | null, sourceKind: LongtailCandidate['sourceKind']): string {
  const prefix = destination ? `${destination} ` : '';
  if (sourceKind === 'winner_query') return `${keyword} 검색 의도 완전 정리`;
  if (/비용|가격|예산/.test(keyword)) return `${keyword} 실제 예산과 예약 전 체크포인트`;
  if (/일정|코스|루트/.test(keyword)) return `${keyword} 추천 일정과 동선 가이드`;
  if (/날씨|옷차림|기온/.test(keyword)) return `${keyword} 날씨와 옷차림 가이드`;
  if (/환전|화폐|팁/.test(keyword)) return `${keyword} 환전과 현지 결제 팁`;
  return `${prefix}${keyword} 여행자가 가장 많이 묻는 질문 정리`.replace(/\s+/g, ' ').trim();
}

function scoreSeed(row: {
  impressions: number;
  clicks: number;
  avgPosition: number;
  ctr: number;
  conversionScore?: number;
}): number {
  const positionScore = Math.max(0, 30 - row.avgPosition) * 3;
  const clickScore = row.clicks * 60;
  const impressionScore = Math.min(200, row.impressions) * 0.4;
  const ctrScore = row.ctr * 120;
  const revenueScore = row.conversionScore ?? 0;
  return Math.round((positionScore + clickScore + impressionScore + ctrScore + revenueScore) * 10) / 10;
}

function scorePerformanceSignal(performance?: BlogPerformanceLite | null): number {
  if (!performance) return 0;
  const conversions = performance.first_touch_conversions ?? 0;
  const profit = performance.first_touch_profit ?? 0;
  const revenue = performance.first_touch_revenue ?? 0;
  const traffic = Math.max(1, performance.traffic_count ?? 0);
  const conversionRate = conversions / traffic;
  return Math.min(180, conversions * 80 + conversionRate * 240 + Math.max(0, profit || revenue) / 100_000);
}

function scoreCandidate(input: {
  seedScore: number;
  tier: KeywordTier;
  volume: number | null;
  competition: CompetitionLevel | null;
  intent: ReturnType<typeof classifySearchIntent>;
  sourceKind: LongtailCandidate['sourceKind'];
}): number {
  const tierBoost = input.tier === 'longtail' ? 18 : input.tier === 'mid' ? 10 : -10;
  const competitionBoost = input.competition === 'low' ? 18 : input.competition === 'medium' ? 8 : -12;
  const volumeBoost = input.volume ? Math.min(18, Math.log10(input.volume + 1) * 6) : 0;
  const sourceBoost = input.sourceKind === 'related_query' ? 8 : input.sourceKind === 'winner_query' ? 5 : 0;
  const intentBoost = intentPriorityDelta(input.intent);
  return Math.round(
    clamp(45 + input.seedScore * 0.12 + tierBoost + competitionBoost + volumeBoost + sourceBoost + intentBoost, 35, 95),
  );
}

function riskForFamily(existingFamilyKeys: Set<string>, familyKey: string, sourceKind: LongtailCandidate['sourceKind']): LongtailCandidate['cannibalizationRisk'] {
  if (!existingFamilyKeys.has(familyKey)) return 'low';
  return sourceKind === 'winner_query' ? 'medium' : 'high';
}

function aggregateSeeds(
  rows: RankHistoryRow[],
  postMap: Map<string, BlogPostLite>,
  performanceMap: Map<string, BlogPerformanceLite>,
  opts: Required<Pick<ExpandLongtailOptions, 'minSeedImpressions' | 'minSeedClicks' | 'maxAvgPosition'>>,
): LongtailSeed[] {
  const groups = new Map<string, {
    slug: string;
    query: string;
    impressions: number;
    clicks: number;
    weightedPosition: number;
    positionWeight: number;
  }>();

  for (const row of rows) {
    const slug = row.slug?.trim();
    const query = row.query?.trim();
    if (!slug || !query || query === '__page__') continue;
    const impressions = row.impressions ?? 0;
    const clicks = row.clicks ?? 0;
    const position = row.position ?? 99;
    const key = `${slug}::${query.toLowerCase()}`;
    const current = groups.get(key) || {
      slug,
      query,
      impressions: 0,
      clicks: 0,
      weightedPosition: 0,
      positionWeight: 0,
    };
    const weight = Math.max(1, impressions);
    current.impressions += impressions;
    current.clicks += clicks;
    current.weightedPosition += position * weight;
    current.positionWeight += weight;
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((group) => {
      const avgPosition = group.positionWeight > 0 ? group.weightedPosition / group.positionWeight : 99;
      const ctr = group.impressions > 0 ? group.clicks / group.impressions : 0;
      const post = postMap.get(group.slug);
      const destination = post?.destination || detectDestination(group.query) || detectDestination(post?.seo_title || '') || null;
      const conversionScore = scorePerformanceSignal(performanceMap.get(group.slug));
      return {
        slug: group.slug,
        query: group.query,
        destination,
        title: post?.seo_title || null,
        impressions: group.impressions,
        clicks: group.clicks,
        avgPosition: Math.round(avgPosition * 10) / 10,
        ctr: Math.round(ctr * 1000) / 1000,
        conversionScore: Math.round(conversionScore * 10) / 10,
        score: scoreSeed({
          impressions: group.impressions,
          clicks: group.clicks,
          avgPosition,
          ctr,
          conversionScore,
        }),
      };
    })
    .filter((seed) =>
      (seed.impressions >= opts.minSeedImpressions || seed.clicks >= opts.minSeedClicks) &&
      seed.avgPosition <= opts.maxAvgPosition &&
      seed.query.length >= 3,
    )
    .sort((a, b) => b.score - a.score);
}

async function buildCandidatesForSeed(
  seed: LongtailSeed,
  maxCandidatesPerSeed: number,
): Promise<Array<Pick<LongtailCandidate, 'keyword' | 'sourceKind'>>> {
  const candidates = new Map<string, Pick<LongtailCandidate, 'keyword' | 'sourceKind'>>();
  const add = (keyword: string, sourceKind: LongtailCandidate['sourceKind']) => {
    const cleaned = cleanCandidateKeyword(keyword);
    if (!cleaned || cleaned.length < 3) return;
    const key = normalizeKeyword(cleaned);
    if (!candidates.has(key)) candidates.set(key, { keyword: cleaned, sourceKind });
  };

  add(seed.query, 'winner_query');

  const related = await fetchRelatedQueries(seed.query).catch(() => []);
  for (const relatedQuery of related.slice(0, maxCandidatesPerSeed)) {
    add(ensureDestinationPrefix(relatedQuery, seed.destination), 'related_query');
  }

  for (const modifier of LONGTAIL_MODIFIERS) {
    if (seed.query.includes(modifier)) continue;
    add(`${seed.query} ${modifier}`, 'modifier_variant');
    if (candidates.size >= maxCandidatesPerSeed + 2) break;
  }

  return [...candidates.values()]
    .filter((candidate) => normalizeKeyword(candidate.keyword) !== normalizeKeyword(seed.query) || candidate.sourceKind === 'winner_query')
    .slice(0, maxCandidatesPerSeed + 1);
}

async function loadExistingKeywordSurface(recentDedupDays: number): Promise<string[]> {
  const values: string[] = [];

  const { data: queued } = await supabaseAdmin
    .from('blog_topic_queue')
    .select('primary_keyword, topic, destination')
    .gte('created_at', daysAgoIso(recentDedupDays))
    .in('status', ['queued', 'generating', 'published']);

  for (const row of (queued || []) as Array<{ primary_keyword: string | null; topic: string | null; destination: string | null }>) {
    if (row.primary_keyword) values.push(row.primary_keyword);
    if (row.topic) values.push(row.topic);
    if (row.destination && row.primary_keyword) values.push(`${row.destination} ${row.primary_keyword}`);
  }

  const { data: posts } = await supabaseAdmin
    .from('content_creatives')
    .select('seo_title, slug, destination')
    .eq('channel', 'naver_blog')
    .in('status', ['draft', 'scheduled', 'published'])
    .limit(2000);

  for (const row of (posts || []) as Array<{ seo_title: string | null; slug: string | null; destination: string | null }>) {
    if (row.seo_title) values.push(row.seo_title);
    if (row.slug) values.push(row.slug.replace(/-/g, ' '));
    if (row.destination && row.seo_title) values.push(`${row.destination} ${row.seo_title}`);
  }

  return values;
}

async function loadExistingFamilyKeys(): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('blog_keyword_families')
    .select('family_key')
    .in('status', ['active', 'watch'])
    .limit(5000);

  return new Set(((data || []) as Array<{ family_key: string | null }>)
    .map((row) => row.family_key)
    .filter((key): key is string => Boolean(key)));
}

async function persistKeywordFamilies(
  candidates: LongtailCandidate[],
  insertedRows: Array<{ id: string; primary_keyword: string | null }>,
): Promise<void> {
  if (candidates.length === 0 || insertedRows.length === 0) return;

  const insertedByKeyword = new Map(
    insertedRows
      .filter((row) => row.primary_keyword)
      .map((row) => [row.primary_keyword as string, row.id]),
  );
  const familyRows = candidates.map((candidate) => ({
    family_key: candidate.familyKey,
    canonical_keyword: candidate.keyword,
    destination: candidate.destination,
    intent: candidate.intent,
    status: candidate.cannibalizationRisk === 'high' ? 'watch' : 'active',
    meta: {
      latest_seed_query: candidate.seedQuery,
      latest_seed_slug: candidate.seedSlug,
      latest_source_kind: candidate.sourceKind,
      cannibalization_risk: candidate.cannibalizationRisk,
    },
  }));

  const { data: families } = await supabaseAdmin
    .from('blog_keyword_families')
    .upsert(familyRows, { onConflict: 'family_key' })
    .select('id, family_key');

  const familyIdByKey = new Map(
    ((families || []) as Array<{ id: string; family_key: string }>)
      .map((family) => [family.family_key, family.id]),
  );

  type KeywordFamilyMemberInsert = {
    family_id: string;
    keyword: string;
    topic_queue_id: string;
    role: string;
    source: string;
    score: number;
    metrics: Record<string, unknown>;
  };

  const memberRows: KeywordFamilyMemberInsert[] = [];
  for (const candidate of candidates) {
    const familyId = familyIdByKey.get(candidate.familyKey);
    const topicQueueId = insertedByKeyword.get(candidate.keyword);
    if (!familyId || !topicQueueId) continue;
    memberRows.push({
      family_id: familyId,
      keyword: candidate.keyword,
      topic_queue_id: topicQueueId,
      role: candidate.cannibalizationRisk === 'high' ? 'supporting' : 'candidate',
      source: 'gsc_longtail',
      score: candidate.priority,
      metrics: {
        seed_query: candidate.seedQuery,
        seed_slug: candidate.seedSlug,
        seed_score: candidate.seedScore,
        monthly_search_volume: candidate.monthlySearchVolume,
        competition_level: candidate.competitionLevel,
        source_kind: candidate.sourceKind,
        cannibalization_risk: candidate.cannibalizationRisk,
      },
    });
  }

  if (memberRows.length === 0) return;
  await supabaseAdmin
    .from('blog_keyword_family_members')
    .upsert(memberRows, { onConflict: 'family_id,keyword,source' });
}

async function loadPostMap(slugs: string[]): Promise<Map<string, BlogPostLite>> {
  if (slugs.length === 0) return new Map();
  const { data } = await supabaseAdmin
    .from('content_creatives')
    .select('id, slug, seo_title, destination, angle_type, product_id')
    .eq('channel', 'naver_blog')
    .in('slug', slugs);

  return new Map(
    ((data || []) as BlogPostLite[])
      .filter((post) => post.slug)
      .map((post) => [post.slug as string, post]),
  );
}

async function loadPerformanceMap(slugs: string[]): Promise<Map<string, BlogPerformanceLite>> {
  if (slugs.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('content_roas_summary')
    .select('slug, traffic_count, first_touch_conversions, first_touch_profit, first_touch_revenue')
    .in('slug', slugs);

  if (error || !data) return new Map();
  return new Map(
    (data as BlogPerformanceLite[])
      .filter((row) => row.slug)
      .map((row) => [row.slug as string, row]),
  );
}

export async function expandGscLongtailTopics(
  options: ExpandLongtailOptions = {},
): Promise<LongtailExpansionResult> {
  const limit = clamp(options.limit ?? DEFAULT_LIMIT, 1, 30);
  const seedLimit = clamp(options.seedLimit ?? DEFAULT_SEED_LIMIT, 3, 80);
  const lookbackDays = clamp(options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS, 7, 120);
  const recentDedupDays = clamp(options.recentDedupDays ?? DEFAULT_RECENT_DEDUP_DAYS, 14, 365);
  const maxCandidatesPerSeed = clamp(options.maxCandidatesPerSeed ?? DEFAULT_MAX_CANDIDATES_PER_SEED, 2, 12);
  const minSeedImpressions = Math.max(1, options.minSeedImpressions ?? 5);
  const minSeedClicks = Math.max(1, options.minSeedClicks ?? 1);
  const maxAvgPosition = clamp(options.maxAvgPosition ?? 25, 1, 80);
  const dryRun = options.dryRun ?? false;
  const errors: string[] = [];

  const { data: rankRows, error: rankError } = await supabaseAdmin
    .from('rank_history')
    .select('slug, query, position, impressions, clicks, ctr')
    .gte('date', daysAgoDate(lookbackDays))
    .neq('query', '__page__');

  if (rankError) throw rankError;
  if (!rankRows || rankRows.length === 0) {
    return { seeds: [], candidates: [], inserted: [], skipped: [], dryRun, errors };
  }

  const slugs = [...new Set((rankRows as RankHistoryRow[]).map((row) => row.slug).filter(Boolean))] as string[];
  const postMap = await loadPostMap(slugs);
  const performanceMap = await loadPerformanceMap(slugs).catch(() => new Map<string, BlogPerformanceLite>());
  const seeds = aggregateSeeds(rankRows as RankHistoryRow[], postMap, performanceMap, {
    minSeedImpressions,
    minSeedClicks,
    maxAvgPosition,
  }).slice(0, seedLimit);

  if (seeds.length === 0) {
    return { seeds: [], candidates: [], inserted: [], skipped: [], dryRun, errors };
  }

  const rawCandidates: Array<{
    keyword: string;
    sourceKind: LongtailCandidate['sourceKind'];
    seed: LongtailSeed;
  }> = [];

  for (const seed of seeds) {
    const seedCandidates = await buildCandidatesForSeed(seed, maxCandidatesPerSeed);
    for (const candidate of seedCandidates) {
      rawCandidates.push({ ...candidate, seed });
    }
  }

  const uniqueCandidateMap = new Map<string, typeof rawCandidates[number]>();
  for (const candidate of rawCandidates) {
    const key = normalizeKeyword(candidate.keyword);
    const existing = uniqueCandidateMap.get(key);
    if (!existing || candidate.seed.score > existing.seed.score) {
      uniqueCandidateMap.set(key, candidate);
    }
  }

  const existingSurface = await loadExistingKeywordSurface(recentDedupDays);
  const existingFamilyKeys = await loadExistingFamilyKeys().catch(() => new Set<string>());
  const skipped: Array<{ keyword: string; reason: string }> = [];
  const deduped = [...uniqueCandidateMap.values()].filter((candidate) => {
    const duplicate = isNearDuplicate(candidate.keyword, existingSurface);
    if (duplicate) {
      skipped.push({ keyword: candidate.keyword, reason: `near_duplicate:${duplicate.slice(0, 80)}` });
      return false;
    }
    existingSurface.push(candidate.keyword);
    return true;
  });

  const research = await researchKeywordsBatch(deduped.map((candidate) => candidate.keyword)).catch((err) => {
    errors.push(`keyword research failed: ${err instanceof Error ? err.message : String(err)}`);
    return new Map();
  });

  const candidates: LongtailCandidate[] = deduped
    .map((candidate) => {
      const r = research.get(candidate.keyword);
      const tier = r?.tier ?? classifyKeywordTier(candidate.keyword, r?.monthly_search_volume ?? null);
      const intent = classifySearchIntent(candidate.keyword);
      const destination = candidate.seed.destination || detectDestination(candidate.keyword);
      const familyKey = buildKeywordFamilyKey(candidate.keyword, destination);
      const cannibalizationRisk = riskForFamily(existingFamilyKeys, familyKey, candidate.sourceKind);
      const priority = scoreCandidate({
        seedScore: candidate.seed.score,
        tier,
        volume: r?.monthly_search_volume ?? null,
        competition: r?.competition_level ?? null,
        intent,
        sourceKind: candidate.sourceKind,
      });
      return {
        keyword: candidate.keyword,
        topic: buildTopic(candidate.keyword, destination, candidate.sourceKind),
        destination,
        familyKey,
        seedQuery: candidate.seed.query,
        seedSlug: candidate.seed.slug,
        seedScore: candidate.seed.score,
        sourceKind: candidate.sourceKind,
        tier,
        monthlySearchVolume: r?.monthly_search_volume ?? null,
        competitionLevel: r?.competition_level ?? null,
        intent,
        priority,
        cannibalizationRisk,
      };
    })
    .filter((candidate) => candidate.tier !== 'head' && candidate.cannibalizationRisk !== 'high')
    .sort((a, b) => {
      if ((b.monthlySearchVolume ?? 0) !== (a.monthlySearchVolume ?? 0)) {
        return (b.monthlySearchVolume ?? 0) - (a.monthlySearchVolume ?? 0);
      }
      return b.priority - a.priority;
    })
    .slice(0, limit);

  if (dryRun || candidates.length === 0) {
    return { seeds, candidates, inserted: [], skipped, dryRun, errors };
  }

  const rows = candidates.map((candidate) => ({
    topic: candidate.topic,
    source: 'gsc_longtail',
    priority: candidate.priority,
    destination: candidate.destination,
    angle_type: 'longtail',
    category: candidate.intent === 'commercial' ? 'product_intro' : 'travel_tips',
    primary_keyword: candidate.keyword,
    keyword_tier: candidate.tier,
    monthly_search_volume: candidate.monthlySearchVolume,
    competition_level: candidate.competitionLevel ?? (candidate.tier === 'longtail' ? 'low' : 'medium'),
    meta: {
      source_kind: candidate.sourceKind,
      seed_query: candidate.seedQuery,
      seed_slug: candidate.seedSlug,
      seed_score: candidate.seedScore,
      seed_conversion_score: seeds.find((seed) => seed.slug === candidate.seedSlug && seed.query === candidate.seedQuery)?.conversionScore ?? null,
      keyword_family_key: candidate.familyKey,
      cannibalization_risk: candidate.cannibalizationRisk,
      search_intent: candidate.intent,
      generated_by: 'blog-longtail-expander',
    },
  }));

  const { data: insertedRows, error: insertError } = await supabaseAdmin
    .from('blog_topic_queue')
    .insert(rows)
    .select('id, primary_keyword');

  if (insertError) throw insertError;

  const inserted = (insertedRows || []) as Array<{ id: string; primary_keyword: string | null }>;
  await persistKeywordFamilies(candidates, inserted).catch((err) => {
    errors.push(`keyword family persist failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  return {
    seeds,
    candidates,
    inserted,
    skipped,
    dryRun,
    errors,
  };
}
