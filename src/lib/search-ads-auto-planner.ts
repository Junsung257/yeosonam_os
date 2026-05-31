import {
  enrichKeywordsWithNaverVolume,
  extractKeywords,
  generateMicroKeywords,
  type ExtractedKeyword,
  type Platform,
} from '@/lib/keyword-brain';
import { generateGoogleHistoricalMetrics } from '@/lib/search-ads-api';
import { getSecret } from '@/lib/secret-registry';
import { applyUtmToUrl, buildUtm, normalizeUtmValue } from '@/lib/utm-builder';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

type PlanStatus = 'draft' | 'approved' | 'published' | 'failed' | 'archived';

export interface TravelPackageForSearchAds {
  id: string;
  title?: string | null;
  destination?: string | null;
  country?: string | null;
  duration?: number | null;
  nights?: number | null;
  price?: number | null;
  price_tiers?: unknown;
  inclusions?: string[] | null;
  itinerary?: string[] | null;
  parsed_data?: Record<string, unknown> | null;
  short_code?: string | null;
}

export interface SearchAdKeywordPlanItem {
  package_id: string;
  platform: Platform;
  plan_status: PlanStatus;
  campaign_name: string;
  campaign_slug: string;
  ad_group_name: string;
  tier: ExtractedKeyword['tier'];
  match_type: ExtractedKeyword['matchType'];
  keyword_text: string;
  source: string;
  suggested_bid_krw: number;
  daily_budget_share_pct: number;
  monthly_search_volume: number | null;
  competition_level: 'low' | 'medium' | 'high' | null;
  landing_url: string;
  utm_url: string;
  rationale: string;
  quality_flags: Record<string, unknown>;
}

export interface SearchAdKeywordPlanRow extends SearchAdKeywordPlanItem {
  id: string;
  external_campaign_id: string | null;
  external_ad_group_id: string | null;
  external_keyword_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  travel_packages?: {
    title?: string | null;
    destination?: string | null;
    short_code?: string | null;
  } | null;
}

export interface SearchAdPackagePlan {
  packageId: string;
  campaignName: string;
  campaignSlug: string;
  dailyBudgetKrw: number;
  maxDailyBudgetKrw: number;
  publishMode: 'draft' | 'live';
  items: SearchAdKeywordPlanItem[];
  summary: {
    total: number;
    byPlatform: Record<Platform, number>;
    byTier: Record<ExtractedKeyword['tier'], number>;
    excluded: number;
  };
}

const DEFAULT_DAILY_BUDGET_KRW = 30000;
const DEFAULT_MAX_DAILY_BUDGET_KRW = 50000;
const MAX_KEYWORDS_PER_PLATFORM = 80;

const BLOCKED_LIVE_WORDS = [
  '무료',
  '공짜',
  '이벤트 당첨',
  '항공권만',
  '호텔 예약',
  '에어비앤비',
  '비자 발급',
  '하나투어',
  '모두투어',
  '노랑풍선',
  '참좋은여행',
];

const TIER_BUDGET_WEIGHT: Record<ExtractedKeyword['tier'], number> = {
  core: 0.35,
  mid: 0.3,
  longtail: 0.35,
  negative: 0,
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFlag(name: string): boolean {
  const raw = process.env[name];
  return raw === 'true' || raw === '1';
}

function clampBid(keyword: ExtractedKeyword): number {
  if (keyword.tier === 'negative') return 0;
  const min = keyword.tier === 'core' ? 500 : keyword.tier === 'mid' ? 300 : 100;
  const max = keyword.tier === 'core' ? 2500 : keyword.tier === 'mid' ? 1500 : 800;
  return Math.min(max, Math.max(min, Math.round(keyword.suggestedBid)));
}

function normalizePackage(pkg: TravelPackageForSearchAds): TravelPackageForSearchAds {
  const parsed = pkg.parsed_data ?? {};
  const parsedInclusions = Array.isArray(parsed.inclusions) ? parsed.inclusions : [];
  const parsedItinerary = Array.isArray(parsed.itinerary) ? parsed.itinerary : [];

  return {
    ...pkg,
    title: pkg.title ?? String(parsed.title ?? ''),
    destination: pkg.destination ?? String(parsed.destination ?? ''),
    duration: pkg.duration ?? (Number(parsed.duration ?? 0) || null),
    price: pkg.price ?? (Number(parsed.price ?? 0) || null),
    inclusions: pkg.inclusions ?? parsedInclusions.filter((v): v is string => typeof v === 'string'),
    itinerary: pkg.itinerary ?? parsedItinerary.filter((v): v is string => typeof v === 'string'),
  };
}

function buildCampaignSlug(pkg: TravelPackageForSearchAds): string {
  const destination = normalizeUtmValue(pkg.destination || 'package') || 'package';
  const code = normalizeUtmValue(pkg.short_code || pkg.id.slice(0, 8)) || pkg.id.slice(0, 8);
  return `pkg_${destination}_${code}`;
}

function getLandingUrl(pkg: TravelPackageForSearchAds): string {
  const base =
    (getSecret('NEXT_PUBLIC_APP_URL') ??
      getSecret('NEXT_PUBLIC_BASE_URL') ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      'https://yeosonam.com');
  return `${String(base).replace(/\/$/, '')}/packages/${pkg.id}`;
}

function qualityFlags(keyword: ExtractedKeyword): Record<string, unknown> {
  const blockedWords = BLOCKED_LIVE_WORDS.filter(word => keyword.keyword.includes(word));
  return {
    blocked_live_publish: blockedWords.length > 0,
    blocked_words: blockedWords,
    needs_human_review: blockedWords.length > 0 || keyword.keyword.length < 2,
  };
}

function shouldExcludeFromPositive(keyword: ExtractedKeyword): boolean {
  if (keyword.tier === 'negative') return false;
  return BLOCKED_LIVE_WORDS.some(word => keyword.keyword.includes(word));
}

function dedupeKeywords(keywords: ExtractedKeyword[]): ExtractedKeyword[] {
  const byKey = new Map<string, ExtractedKeyword>();
  for (const kw of keywords) {
    const key = `${kw.keyword.trim()}::${kw.matchType}`;
    const existing = byKey.get(key);
    if (!existing || TIER_BUDGET_WEIGHT[kw.tier] > TIER_BUDGET_WEIGHT[existing.tier]) {
      byKey.set(key, { ...kw, keyword: kw.keyword.trim() });
    }
  }
  return [...byKey.values()].filter(kw => kw.keyword.length > 0);
}

function calculateBudgetShare(keyword: ExtractedKeyword, tierCounts: Record<ExtractedKeyword['tier'], number>): number {
  const tierCount = Math.max(1, tierCounts[keyword.tier]);
  const share = (TIER_BUDGET_WEIGHT[keyword.tier] / tierCount) * 100;
  return Math.round(share * 1000) / 1000;
}

async function enrichForGoogle(keywords: ExtractedKeyword[]): Promise<ExtractedKeyword[]> {
  const positive = keywords.filter(kw => kw.tier !== 'negative').slice(0, 120);
  if (!positive.length) return keywords;

  const metrics = await generateGoogleHistoricalMetrics(positive.map(kw => kw.keyword));
  const grouped = new Map<string, { searches: number; competition: 'low' | 'medium' | 'high'; lowBid: number; highBid: number }>();

  for (const metric of metrics) {
    const existing = grouped.get(metric.keyword) ?? {
      searches: 0,
      competition: 'medium' as const,
      lowBid: metric.lowTopOfPageBid,
      highBid: metric.highTopOfPageBid,
    };
    grouped.set(metric.keyword, {
      searches: existing.searches + metric.avgMonthlySearches,
      competition: String(metric.competition).toLowerCase() as 'low' | 'medium' | 'high',
      lowBid: metric.lowTopOfPageBid || existing.lowBid,
      highBid: metric.highTopOfPageBid || existing.highBid,
    });
  }

  return keywords.map(kw => {
    const metric = grouped.get(kw.keyword);
    if (!metric) return kw;
    const avgMonthly = Math.round(metric.searches / 12);
    const bid = metric.lowBid > 0 ? Math.round((metric.lowBid + metric.highBid) / 2) : kw.suggestedBid;
    return {
      ...kw,
      suggestedBid: kw.tier === 'negative' ? 0 : Math.max(kw.suggestedBid, bid),
      monthlySearchVolume: avgMonthly,
      competitionLevel: metric.competition,
    };
  });
}

export async function buildSearchAdPackagePlan(
  rawPackage: TravelPackageForSearchAds,
  options: {
    platforms?: Platform[];
    publishMode?: 'draft' | 'live';
  } = {},
): Promise<SearchAdPackagePlan> {
  const pkg = normalizePackage(rawPackage);
  const platforms = options.platforms ?? ['naver', 'google'];
  const dailyBudgetKrw = envNumber('SEARCH_ADS_AUTO_DAILY_BUDGET_KRW', DEFAULT_DAILY_BUDGET_KRW);
  const maxDailyBudgetKrw = envNumber('SEARCH_ADS_MAX_DAILY_BUDGET_KRW', DEFAULT_MAX_DAILY_BUDGET_KRW);
  const cappedBudget = Math.min(dailyBudgetKrw, maxDailyBudgetKrw);
  const publishMode = options.publishMode ?? (envFlag('SEARCH_ADS_AUTO_PUBLISH_NAVER') ? 'live' : 'draft');

  const baseKeywords = dedupeKeywords([
    ...extractKeywords({
      title: pkg.title ?? undefined,
      destination: pkg.destination ?? undefined,
      duration: pkg.duration ?? undefined,
      price: pkg.price ?? undefined,
      inclusions: pkg.inclusions ?? undefined,
      price_tiers: Array.isArray(pkg.price_tiers) ? pkg.price_tiers as { adult_price?: number }[] : undefined,
    }),
    ...generateMicroKeywords({
      title: pkg.title ?? undefined,
      destination: pkg.destination ?? undefined,
      duration: pkg.duration ?? undefined,
      inclusions: pkg.inclusions ?? undefined,
    }),
  ]);

  const filtered = baseKeywords.filter(kw => !shouldExcludeFromPositive(kw));
  const tierCounts = filtered.reduce<Record<ExtractedKeyword['tier'], number>>(
    (acc, kw) => ({ ...acc, [kw.tier]: acc[kw.tier] + 1 }),
    { core: 0, mid: 0, longtail: 0, negative: 0 },
  );

  const campaignSlug = buildCampaignSlug(pkg);
  const campaignName = `YSN_${pkg.destination || 'PACKAGE'}_${pkg.short_code || pkg.id.slice(0, 8)}`;
  const landingUrl = getLandingUrl(pkg);
  const items: SearchAdKeywordPlanItem[] = [];

  for (const platform of platforms) {
    const enriched =
      platform === 'naver'
        ? await enrichKeywordsWithNaverVolume(filtered)
        : await enrichForGoogle(filtered);

    for (const kw of enriched.slice(0, MAX_KEYWORDS_PER_PLATFORM)) {
      const utmUrl = applyUtmToUrl(
        landingUrl,
        buildUtm({
          base_url: landingUrl,
          platform,
          campaign_slug: campaignSlug,
          keyword: kw.keyword,
          medium: 'cpc',
          creative_variant: `${kw.tier}_${kw.matchType}`,
        }),
      );

      items.push({
        package_id: pkg.id,
        platform,
        plan_status: publishMode === 'live' && kw.tier !== 'negative' ? 'approved' : 'draft',
        campaign_name: campaignName,
        campaign_slug: campaignSlug,
        ad_group_name: `${campaignName}_${kw.tier}_${kw.matchType}`,
        tier: kw.tier,
        match_type: kw.matchType,
        keyword_text: kw.keyword,
        source: kw.category || 'package_auto_planner',
        suggested_bid_krw: clampBid(kw),
        daily_budget_share_pct: calculateBudgetShare(kw, tierCounts),
        monthly_search_volume: kw.monthlySearchVolume ?? null,
        competition_level: kw.competitionLevel ?? null,
        landing_url: landingUrl,
        utm_url: utmUrl,
        rationale: `${pkg.destination || '상품'} ${kw.tier}/${kw.matchType} 키워드. 상품 승인 후 검색광고 draft로 생성됨.`,
        quality_flags: qualityFlags(kw),
      });
    }
  }

  const byPlatform: Record<Platform, number> = { naver: 0, google: 0 };
  const byTier: Record<ExtractedKeyword['tier'], number> = { core: 0, mid: 0, longtail: 0, negative: 0 };
  for (const item of items) {
    byPlatform[item.platform] += 1;
    byTier[item.tier] += 1;
  }

  return {
    packageId: pkg.id,
    campaignName,
    campaignSlug,
    dailyBudgetKrw: cappedBudget,
    maxDailyBudgetKrw,
    publishMode,
    items,
    summary: {
      total: items.length,
      byPlatform,
      byTier,
      excluded: baseKeywords.length - filtered.length,
    },
  };
}

type MinimalPostgrestResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;

type UntypedSupabase = {
  from: (table: string) => {
    upsert: (
      rows: unknown,
      options?: { onConflict?: string },
    ) => {
      select: (columns?: string) => MinimalPostgrestResult<unknown[]>;
    };
    select: (columns?: string) => {
      eq: (column: string, value: string) => {
        single: () => MinimalPostgrestResult<TravelPackageForSearchAds>;
        order: (column: string, options?: { ascending?: boolean }) => {
          limit: (count: number) => MinimalPostgrestResult<unknown[]>;
        };
        in: (column: string, values: string[]) => {
          order: (column: string, options?: { ascending?: boolean }) => {
            limit: (count: number) => MinimalPostgrestResult<unknown[]>;
          };
        };
      };
      in: (column: string, values: string[]) => {
        order: (column: string, options?: { ascending?: boolean }) => {
          limit: (count: number) => MinimalPostgrestResult<unknown[]>;
        };
      };
      order: (column: string, options?: { ascending?: boolean }) => {
        limit: (count: number) => MinimalPostgrestResult<unknown[]>;
      };
    };
    update: (row: unknown) => {
      in: (column: string, values: string[]) => {
        select: (columns?: string) => MinimalPostgrestResult<unknown[]>;
      };
    };
  };
};

function getUntypedSupabase(): UntypedSupabase | null {
  if (!isSupabaseConfigured || !supabaseAdmin) return null;
  return supabaseAdmin as unknown as UntypedSupabase;
}

export async function saveSearchAdPackagePlan(plan: SearchAdPackagePlan): Promise<{ saved: number }> {
  const db = getUntypedSupabase();
  if (!db || plan.items.length === 0) return { saved: 0 };

  const { data, error } = await db
    .from('search_ad_keyword_plans')
    .upsert(plan.items, { onConflict: 'package_id,platform,keyword_text,match_type' })
    .select('id');

  if (error) throw new Error(`검색광고 키워드 플랜 저장 실패: ${error.message}`);
  return { saved: Array.isArray(data) ? data.length : 0 };
}

export async function buildAndSaveSearchAdPackagePlan(packageId: string): Promise<SearchAdPackagePlan & { saved: number }> {
  const db = getUntypedSupabase();
  if (!db) {
    return {
      ...(await buildSearchAdPackagePlan({ id: packageId })),
      saved: 0,
    };
  }

  const { data: pkg, error } = await db
    .from('travel_packages')
    .select('id,title,destination,country,duration,nights,price,price_tiers,inclusions,itinerary,parsed_data,short_code')
    .eq('id', packageId)
    .single();

  if (error || !pkg) {
    throw new Error(error?.message ?? '상품을 찾을 수 없습니다.');
  }

  const plan = await buildSearchAdPackagePlan(pkg);
  const saved = await saveSearchAdPackagePlan(plan);
  return { ...plan, saved: saved.saved };
}

export async function listSearchAdKeywordPlans(filters: {
  packageId?: string;
  statuses?: PlanStatus[];
  limit?: number;
} = {}): Promise<SearchAdKeywordPlanRow[]> {
  const db = getUntypedSupabase();
  if (!db) return [];

  const columns = `
    *,
    travel_packages:package_id(title,destination,short_code)
  `;
  const limit = Math.min(Math.max(filters.limit ?? 120, 1), 500);
  const statuses = filters.statuses?.length ? filters.statuses : undefined;

  let data: unknown[] | null = null;
  let error: { message: string } | null = null;

  if (filters.packageId && statuses) {
    const result = await db
      .from('search_ad_keyword_plans')
      .select(columns)
      .eq('package_id', filters.packageId)
      .in('plan_status', statuses)
      .order('created_at', { ascending: false })
      .limit(limit);
    data = result.data;
    error = result.error;
  } else if (filters.packageId) {
    const result = await db
      .from('search_ad_keyword_plans')
      .select(columns)
      .eq('package_id', filters.packageId)
      .order('created_at', { ascending: false })
      .limit(limit);
    data = result.data;
    error = result.error;
  } else if (statuses) {
    const result = await db
      .from('search_ad_keyword_plans')
      .select(columns)
      .in('plan_status', statuses)
      .order('created_at', { ascending: false })
      .limit(limit);
    data = result.data;
    error = result.error;
  } else {
    const result = await db
      .from('search_ad_keyword_plans')
      .select(columns)
      .order('created_at', { ascending: false })
      .limit(limit);
    data = result.data;
    error = result.error;
  }

  if (error) throw new Error(`검색광고 키워드 플랜 조회 실패: ${error.message}`);
  return (data ?? []) as SearchAdKeywordPlanRow[];
}

export async function updateSearchAdKeywordPlanStatus(
  ids: string[],
  status: PlanStatus,
): Promise<{ updated: number }> {
  const db = getUntypedSupabase();
  const cleanIds = ids.filter(Boolean);
  if (!db || cleanIds.length === 0) return { updated: 0 };

  const patch = {
    plan_status: status,
    updated_at: new Date().toISOString(),
    ...(status === 'published' ? { published_at: new Date().toISOString() } : {}),
  };
  const { data, error } = await db
    .from('search_ad_keyword_plans')
    .update(patch)
    .in('id', cleanIds)
    .select('id');

  if (error) throw new Error(`검색광고 키워드 플랜 상태 변경 실패: ${error.message}`);
  return { updated: Array.isArray(data) ? data.length : 0 };
}
