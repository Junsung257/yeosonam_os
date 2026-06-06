export type PaidKeywordIntent = 'commercial' | 'informational' | 'mixed' | 'negative';
export type PaidKeywordTier = 'core' | 'mid' | 'longtail' | 'negative';
export type PaidKeywordPlatform = 'naver' | 'google';

export interface OrganicKeywordSignal {
  keyword: string;
  slug: string | null;
  destination: string | null;
  productId: string | null;
  impressions: number;
  clicks: number;
  avgPosition: number | null;
  conversions?: number | null;
  revenueKrw?: number | null;
  profitKrw?: number | null;
}

export interface PaidKeywordCandidate {
  keyword: string;
  slug: string | null;
  destination: string | null;
  productId: string | null;
  intent: PaidKeywordIntent;
  tier: PaidKeywordTier;
  matchType: 'exact' | 'phrase';
  score: number;
  suggestedBidKrw: number;
  maxCpcGuardKrw: number;
  landingStrategy: 'product_landing' | 'blog_landing';
  reason: string;
  evidence: Record<string, unknown>;
}

const COMMERCIAL_RE = /패키지|예약|가격|비용|견적|출발|항공|호텔|효도|가족|단체|특가|할인|상담|문의/i;
const INFORMATIONAL_RE = /날씨|일정|코스|준비물|환전|비자|입국|교통|공항|맛집|후기|팁|가이드/i;
const NEGATIVE_RE = /무료|공짜|쿠폰만|항공권만|호텔만|취소|환불|불만|컴플레인|사기|셀프|개별예약/i;

export function normalizePaidKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function classifyPaidKeywordIntent(keyword: string): PaidKeywordIntent {
  const text = keyword.trim();
  if (!text) return 'informational';
  if (NEGATIVE_RE.test(text)) return 'negative';
  const commercial = COMMERCIAL_RE.test(text);
  const informational = INFORMATIONAL_RE.test(text);
  if (commercial && informational) return 'mixed';
  if (commercial) return 'commercial';
  if (informational) return 'informational';
  return 'mixed';
}

export function classifyPaidKeywordTier(keyword: string, intent: PaidKeywordIntent): PaidKeywordTier {
  if (intent === 'negative') return 'negative';
  const tokens = normalizePaidKeyword(keyword).split(/\s+/).filter(Boolean);
  if (tokens.length <= 2 && intent === 'commercial') return 'core';
  if (tokens.length <= 4) return 'mid';
  return 'longtail';
}

export function scoreOrganicPaidOpportunity(signal: OrganicKeywordSignal, intent: PaidKeywordIntent): number {
  const impressions = Math.max(0, signal.impressions);
  const clicks = Math.max(0, signal.clicks);
  const avgPosition = signal.avgPosition ?? 30;
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const conversionScore = Math.max(0, signal.conversions ?? 0) * 120;
  const profitScore = Math.max(0, signal.profitKrw || signal.revenueKrw || 0) / 100_000;
  const intentBoost = intent === 'commercial' ? 22 : intent === 'mixed' ? 14 : intent === 'informational' ? -4 : -30;
  const rankOpportunity = avgPosition > 3 ? Math.min(35, avgPosition) : 8;
  const score = clicks * 55 + Math.min(500, impressions) * 0.25 + ctr * 160 + conversionScore + profitScore + intentBoost + rankOpportunity;
  return Math.round(Math.max(0, Math.min(1000, score)) * 10) / 10;
}

export function suggestPaidBidKrw(input: {
  platform: PaidKeywordPlatform;
  tier: PaidKeywordTier;
  score: number;
  maxCpcGuardKrw?: number | null;
}): number {
  if (input.tier === 'negative') return 0;
  const base = input.tier === 'core' ? 900 : input.tier === 'mid' ? 550 : 260;
  const platformBoost = input.platform === 'naver' ? 1 : 1.15;
  const scoreBoost = Math.min(700, input.score * 0.7);
  const guard = Math.max(100, input.maxCpcGuardKrw || 1200);
  return Math.round(Math.min(guard, (base + scoreBoost) * platformBoost) / 10) * 10;
}

export function buildPaidKeywordCandidatesFromOrganic(
  signals: OrganicKeywordSignal[],
  options: {
    platform: PaidKeywordPlatform;
    maxCpcGuardKrw?: number | null;
    minScore?: number;
    limit?: number;
  },
): PaidKeywordCandidate[] {
  const minScore = options.minScore ?? 30;
  const byKeyword = new Map<string, PaidKeywordCandidate>();

  for (const signal of signals) {
    const keyword = normalizePaidKeyword(signal.keyword);
    if (!keyword || keyword.length < 2) continue;
    const intent = classifyPaidKeywordIntent(keyword);
    const tier = classifyPaidKeywordTier(keyword, intent);
    const score = scoreOrganicPaidOpportunity(signal, intent);
    if (intent !== 'negative' && score < minScore) continue;
    const candidate: PaidKeywordCandidate = {
      keyword,
      slug: signal.slug,
      destination: signal.destination,
      productId: signal.productId,
      intent,
      tier,
      matchType: tier === 'core' ? 'phrase' : 'exact',
      score,
      suggestedBidKrw: suggestPaidBidKrw({
        platform: options.platform,
        tier,
        score,
        maxCpcGuardKrw: options.maxCpcGuardKrw,
      }),
      maxCpcGuardKrw: options.maxCpcGuardKrw || 1200,
      landingStrategy: intent === 'informational' ? 'blog_landing' : 'product_landing',
      reason: intent === 'negative'
        ? 'Organic query contains paid-search waste or low-fit intent; propose as negative candidate.'
        : 'Organic query already has search demand; safe to test as low-budget paid keyword draft.',
      evidence: {
        source: 'seo_keyword_bridge',
        slug: signal.slug,
        impressions: signal.impressions,
        clicks: signal.clicks,
        avg_position: signal.avgPosition,
        conversions: signal.conversions ?? 0,
        revenue_krw: signal.revenueKrw ?? 0,
        profit_krw: signal.profitKrw ?? 0,
      },
    };

    const existing = byKeyword.get(keyword);
    if (!existing || candidate.score > existing.score) {
      byKeyword.set(keyword, candidate);
    }
  }

  return [...byKeyword.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 80);
}
