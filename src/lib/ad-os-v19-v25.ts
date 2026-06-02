import type { AdOsChangeRequestType } from '@/lib/ad-os-change-request';

export type EnterpriseKeywordTier = 'core' | 'mid' | 'longtail' | 'negative';
export type EnterpriseMatchType = 'exact' | 'phrase' | 'broad';

export type EnterpriseProductFacts = {
  id: string;
  title?: string | null;
  destination?: string | null;
  departureAirport?: string | null;
  airline?: string | null;
  priceKrw?: number | null;
  ticketDeadline?: string | null;
  marginKrw?: number | null;
};

export type EnterpriseKeywordCandidate = {
  keyword: string;
  platform: 'naver' | 'google';
  matchType: EnterpriseMatchType;
  tier: EnterpriseKeywordTier;
  intent: string;
  source: string;
  score: number;
  suggestedBidKrw: number;
  maxCpcGuardKrw: number;
  landingStrategy: string;
  negativeRisk: boolean;
  duplicateCluster: boolean;
  rationale: string;
  evidence: Record<string, unknown>;
};

function clean(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function canonical(value: string): string {
  return clean(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ');
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.map(clean).filter(Boolean)) {
    const key = canonical(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function priceBand(priceKrw?: number | null): string {
  const price = Number(priceKrw || 0);
  if (price <= 0) return '';
  return `${Math.max(1, Math.floor(price / 10000))}만원대`;
}

function scoreKeyword(input: {
  keyword: string;
  tier: EnterpriseKeywordTier;
  source: string;
  winningTerms: Set<string>;
  wasteTerms: Set<string>;
  existing: Set<string>;
}): number {
  const key = canonical(input.keyword);
  let score = input.tier === 'longtail' ? 72 : input.tier === 'mid' ? 62 : input.tier === 'core' ? 45 : 30;
  if (input.source.includes('search_term')) score += 12;
  if (input.winningTerms.has(key)) score += 18;
  if (input.wasteTerms.has(key)) score -= 35;
  if (input.existing.has(key)) score -= 25;
  if (input.keyword.length >= 8 && input.keyword.length <= 34) score += 6;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function bidForTier(tier: EnterpriseKeywordTier, score: number, maxCpcGuardKrw: number): number {
  if (tier === 'negative') return 0;
  const base = tier === 'core' ? 450 : tier === 'mid' ? 280 : 90;
  const bid = base + Math.max(0, score - 50) * (tier === 'longtail' ? 4 : 8);
  return Math.min(Math.max(70, Math.round(bid)), Math.max(70, maxCpcGuardKrw || 500));
}

export function buildEnterpriseKeywordBrain(input: {
  product: EnterpriseProductFacts;
  winningSearchTerms?: string[];
  wasteSearchTerms?: string[];
  existingKeywords?: string[];
  maxCpcGuardKrw?: number;
  limit?: number;
}): EnterpriseKeywordCandidate[] {
  const destination = clean(input.product.destination || input.product.title || '여행지');
  const title = clean(input.product.title || destination);
  const departure = clean(input.product.departureAirport || '');
  const airline = clean(input.product.airline || '');
  const band = priceBand(input.product.priceKrw);
  const deadline = clean(input.product.ticketDeadline || '');
  const maxCpcGuardKrw = Math.max(70, Math.round(Number(input.maxCpcGuardKrw || 500)));
  const winningTerms = new Set((input.winningSearchTerms || []).map(canonical));
  const wasteTerms = new Set((input.wasteSearchTerms || []).map(canonical));
  const existing = new Set((input.existingKeywords || []).map(canonical));

  const roots = [
    { tier: 'core' as const, intent: 'conversion', source: 'product_fact', values: [`${destination} 패키지`, `${destination} 여행`] },
    { tier: 'mid' as const, intent: 'regional_departure', source: 'product_fact', values: departure ? [`${departure} 출발 ${destination}`, `${departure}에서 출발하는 ${destination}`] : [] },
    { tier: 'mid' as const, intent: 'airline', source: 'product_fact', values: airline ? [`${airline} ${destination} 패키지`, `${airline} 타고 ${destination}`] : [] },
    { tier: 'longtail' as const, intent: 'filial', source: 'intent_question', values: [`부모님 ${destination} 여행`, `엄마랑 ${destination} 패키지`, `${destination} 부모님 모시고`] },
    { tier: 'longtail' as const, intent: 'family', source: 'intent_question', values: [`아이랑 ${destination} 패키지`, `${destination} 가족여행 일정`, `${destination} 가족 패키지 추천`] },
    { tier: 'longtail' as const, intent: 'anxiety_resolution', source: 'intent_question', values: [`${destination} 팁 문화`, `${destination} 환전`, `${destination} 날씨 패키지`] },
    { tier: 'longtail' as const, intent: 'comparison', source: 'intent_question', values: [`${destination} vs 나트랑`, `${destination} 호이안 포함`, `${destination} 자유시간 있는 패키지`] },
    { tier: 'longtail' as const, intent: 'deadline', source: 'product_fact', values: deadline ? [`${destination} 발권 마감`, `이번주 ${destination} 패키지`, `${destination} 마감임박`] : [] },
    { tier: 'longtail' as const, intent: 'price_objection', source: 'product_fact', values: band ? [`${band} ${destination} 패키지`, `${destination} 가성비 패키지`] : [] },
    { tier: 'negative' as const, intent: 'waste_control', source: 'default_negative', values: ['무료', '항공권만', '비자 발급만', '현지투어만', '환전소'] },
    { tier: 'longtail' as const, intent: 'search_term_winner', source: 'winning_search_term', values: input.winningSearchTerms || [] },
    { tier: 'negative' as const, intent: 'search_term_waste', source: 'waste_search_term', values: input.wasteSearchTerms || [] },
  ];

  const candidates: EnterpriseKeywordCandidate[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const keyword of unique(root.values)) {
      const key = canonical(keyword);
      const matchType: EnterpriseMatchType = root.tier === 'negative' || root.tier === 'longtail' ? 'exact' : 'phrase';
      const scopedKey = `${key}:${matchType}:${root.tier}`;
      if (!key || seen.has(scopedKey)) continue;
      seen.add(scopedKey);
      const score = scoreKeyword({
        keyword,
        tier: root.tier,
        source: root.source,
        winningTerms,
        wasteTerms,
        existing,
      });
      candidates.push({
        keyword,
        platform: 'naver',
        matchType,
        tier: root.tier,
        intent: root.intent,
        source: root.source,
        score,
        suggestedBidKrw: bidForTier(root.tier, score, maxCpcGuardKrw),
        maxCpcGuardKrw,
        landingStrategy: root.intent === 'anxiety_resolution' || root.intent === 'comparison' ? 'blog_or_hub' : 'product_landing',
        negativeRisk: root.tier === 'negative' || wasteTerms.has(key),
        duplicateCluster: existing.has(key),
        rationale: `${title} 상품 팩트와 ${root.intent} 의도에서 생성한 ${root.tier} 후보입니다.`,
        evidence: {
          product_id: input.product.id,
          destination,
          departure_airport: departure || null,
          airline: airline || null,
          price_band: band || null,
          ticket_deadline: deadline || null,
          source: root.source,
        },
      });
    }
  }

  const filtered = candidates.filter((candidate) => candidate.tier === 'negative' || !candidate.duplicateCluster);
  const negatives = filtered
    .filter((candidate) => candidate.tier === 'negative')
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  const positiveLimit = Math.max(1, Number(input.limit || 80) - negatives.length);
  const positives = filtered
    .filter((candidate) => candidate.tier !== 'negative')
    .sort((a, b) => b.score - a.score)
    .slice(0, positiveLimit);

  return [...positives, ...negatives].slice(0, Math.max(1, Number(input.limit || 80)));
}

export type NaverAssetPlanInput = {
  campaignName: string;
  adGroupName: string;
  landingUrl?: string | null;
  dailyBudgetKrw: number;
  monthlyBudgetKrw: number;
  maxCpcKrw: number;
  approvedKeywordCount: number;
  existingCampaigns: number;
  existingAdgroups: number;
  existingChannels: number;
  storedAdgroupId?: string | null;
  integrationReady: boolean;
  tenantAllowed: boolean;
  killSwitchActive?: boolean;
};

export function buildNaverExternalAssetPlan(input: NaverAssetPlanInput) {
  const blockers: string[] = [];
  if (!input.integrationReady) blockers.push('naver_credentials_missing');
  if (!input.tenantAllowed) blockers.push('tenant_policy_blocks_naver');
  if (input.killSwitchActive) blockers.push('kill_switch_active');
  if (input.dailyBudgetKrw <= 0 || input.monthlyBudgetKrw <= 0) blockers.push('budget_missing');
  if (input.maxCpcKrw <= 0) blockers.push('max_cpc_missing');

  const needsCampaign = input.existingCampaigns === 0;
  const needsChannel = input.existingChannels === 0;
  const needsAdGroup = input.existingAdgroups === 0 && !input.storedAdgroupId;
  const canRequest = blockers.length === 0;
  const mutations = [
    needsCampaign && {
      mutationType: 'create_campaign',
      requestType: 'create_campaign' as AdOsChangeRequestType,
      title: 'Create Naver SearchAd campaign',
      proposedChange: {
        platform: 'naver',
        campaign_name: input.campaignName,
        monthly_budget_krw: input.monthlyBudgetKrw,
      },
    },
    needsChannel && {
      mutationType: 'create_business_channel',
      requestType: 'sync_external_asset' as AdOsChangeRequestType,
      title: 'Create or sync Naver business channel',
      proposedChange: {
        platform: 'naver',
        landing_url: input.landingUrl || null,
      },
    },
    needsAdGroup && {
      mutationType: 'create_ad_group',
      requestType: 'sync_external_asset' as AdOsChangeRequestType,
      title: 'Create Naver SearchAd ad group',
      proposedChange: {
        platform: 'naver',
        ad_group_name: input.adGroupName,
        daily_budget_krw: input.dailyBudgetKrw,
        max_cpc_krw: input.maxCpcKrw,
      },
    },
    input.approvedKeywordCount > 0 && {
      mutationType: 'create_paused_keyword',
      requestType: 'publish_paused_keyword' as AdOsChangeRequestType,
      title: 'Upload approved Naver keywords paused',
      proposedChange: {
        platform: 'naver',
        approved_keywords: input.approvedKeywordCount,
        external_status: 'paused',
      },
    },
  ].filter(Boolean) as Array<{
    mutationType: string;
    requestType: AdOsChangeRequestType;
    title: string;
    proposedChange: Record<string, unknown>;
  }>;

  return {
    canRequest,
    blockers,
    readiness: {
      needs_campaign: needsCampaign,
      needs_business_channel: needsChannel,
      needs_ad_group: needsAdGroup,
      can_upload_paused_keywords: canRequest && !needsAdGroup && input.approvedKeywordCount > 0,
    },
    defaultMode: canRequest ? 'change_request' : 'dry_run',
    mutations,
    nextAction: blockers[0]
      ? `Resolve ${blockers[0]} before creating external asset requests.`
      : mutations.length > 0
        ? 'Review and approve the proposed Naver asset change requests.'
        : 'Naver assets are already present; run paused keyword upload or activation audit.',
  };
}

export function buildEnterpriseTenantReport(input: {
  spendKrw: number;
  revenueKrw: number;
  marginKrw: number;
  conversions: number;
  ctaClicks: number;
  clicks: number;
  budgetCapKrw: number;
  pausedWasteKeywords: number;
  discoveredCheapKeywords: number;
  externalMutations: number;
  keywordClusters: number;
}) {
  const spend = Math.max(0, Math.round(input.spendKrw || 0));
  const margin = Math.round(input.marginKrw || 0);
  const conversions = Math.max(0, Number(input.conversions || 0));
  const clicks = Math.max(0, Number(input.clicks || 0));
  const ctaClicks = Math.max(0, Number(input.ctaClicks || 0));
  const budgetUsagePct = input.budgetCapKrw > 0 ? Math.round((spend / input.budgetCapKrw) * 1000) / 10 : 0;
  const marginRoasPct = spend > 0 ? Math.round((margin / spend) * 100) : 0;
  return {
    budget_usage_pct: budgetUsagePct,
    spend_krw: spend,
    revenue_krw: Math.max(0, Math.round(input.revenueKrw || 0)),
    margin_krw: margin,
    margin_roas_pct: marginRoasPct,
    cpa_krw: conversions > 0 ? Math.round(spend / conversions) : 0,
    cta_rate_pct: clicks > 0 ? Math.round((ctaClicks / clicks) * 1000) / 10 : 0,
    conversion_rate_pct: clicks > 0 ? Math.round((conversions / clicks) * 1000) / 10 : 0,
    paused_waste_keywords: input.pausedWasteKeywords,
    discovered_cheap_keywords: input.discoveredCheapKeywords,
    external_mutations: input.externalMutations,
    keyword_clusters: input.keywordClusters,
    executive_summary: marginRoasPct > 0
      ? `Margin ROAS ${marginRoasPct}% with ${conversions} conversions.`
      : 'Learning loop is ready, but paid conversion margin data is still insufficient.',
    next_actions: [
      input.keywordClusters > 0 ? 'Approve high-score longtail clusters for paused publisher tests.' : 'Run Keyword Brain to create product-level longtail clusters.',
      input.pausedWasteKeywords > 0 ? 'Apply negative keyword candidates after review.' : 'Harvest search terms to find waste queries.',
      input.externalMutations > 0 ? 'Review external mutation audit rows before activation.' : 'Create Naver asset change requests before live publishing.',
    ],
  };
}
