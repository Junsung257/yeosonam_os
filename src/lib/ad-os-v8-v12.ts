import { analyzeSearchTerms, type SearchTerm } from '@/lib/search-ads-api';

export type EnterprisePacingStatus = 'under_pacing' | 'on_track' | 'over_pacing' | 'loss_limit_near' | 'blocked';
export type EnterprisePacingAction = 'no_change' | 'recommend_increase' | 'decrease_daily_cap' | 'pause_channel' | 'block_external_publish';

export type AdOsConversionInput = {
  eventType: string;
  userAgent?: string | null;
  isTest?: boolean;
  isAdmin?: boolean;
  isBot?: boolean;
  revenueKrw?: number;
  marginKrw?: number;
  costKrw?: number;
  rawPayload?: Record<string, unknown>;
};

export type AdOsConversionClassification = {
  quarantineStatus: 'clean' | 'quarantined' | 'review';
  reasons: string[];
  excludedFromLearning: boolean;
  excludedFromPlatformUpload: boolean;
  qualityFlags: Record<string, unknown>;
};

export function classifyAdOsConversionSignal(input: AdOsConversionInput): AdOsConversionClassification {
  const reasons: string[] = [];
  const ua = (input.userAgent || '').toLowerCase();
  const botPattern = /bot|crawler|spider|slurp|headless|playwright|puppeteer|lighthouse/;

  if (input.isTest) reasons.push('test_event');
  if (input.isAdmin) reasons.push('admin_event');
  if (input.isBot || botPattern.test(ua)) reasons.push('bot_or_automation_user_agent');
  if (Number(input.revenueKrw || 0) === 0 && ['booking', 'revenue', 'margin'].includes(input.eventType)) reasons.push('zero_value_conversion');
  if (Number(input.marginKrw || 0) < 0) reasons.push('negative_margin_requires_review');

  const severe = reasons.some((reason) => ['test_event', 'admin_event', 'bot_or_automation_user_agent'].includes(reason));
  const quarantineStatus = severe ? 'quarantined' : reasons.length > 0 ? 'review' : 'clean';

  return {
    quarantineStatus,
    reasons,
    excludedFromLearning: quarantineStatus !== 'clean',
    excludedFromPlatformUpload: quarantineStatus !== 'clean',
    qualityFlags: {
      severe,
      revenue_krw: Math.max(0, Math.round(Number(input.revenueKrw || 0))),
      margin_krw: Math.round(Number(input.marginKrw || 0)),
      cost_krw: Math.max(0, Math.round(Number(input.costKrw || 0))),
    },
  };
}

export function normalizeSearchTermAction(action: string): 'add_keyword' | 'add_negative' | 'review' {
  if (action === 'add_as_keyword' || action === 'add_keyword') return 'add_keyword';
  if (action === 'add_as_negative' || action === 'add_negative') return 'add_negative';
  return 'review';
}

export function scoreSearchTerm(term: SearchTerm): number {
  const conversions = Number(term.conversions || 0);
  const clicks = Number(term.clicks || 0);
  const cost = Number(term.costKrw || 0);
  const ctr = Number(term.ctr || 0);
  if (conversions > 0) return Math.min(100, 70 + conversions * 8 + clicks * 0.2);
  if (cost > 10000 && ctr < 0.5) return Math.min(95, 55 + cost / 1000);
  return Math.min(60, 20 + clicks * 0.4 + ctr);
}

export function buildSearchTermHarvestRows(searchTerms: SearchTerm[]) {
  const recommendationByTerm = new Map(analyzeSearchTerms(searchTerms).map((rec) => [rec.searchTerm, rec]));
  return searchTerms.map((term) => {
    const rec = recommendationByTerm.get(term.searchTerm);
    const action = normalizeSearchTermAction(rec?.action || 'review');
    const score = Math.round(scoreSearchTerm(term) * 10) / 10;
    return {
      platform: term.platform,
      search_term: term.searchTerm,
      parent_keyword: term.keywordText || null,
      match_type: term.matchType || null,
      impressions: Math.max(0, Math.round(Number(term.impressions || 0))),
      clicks: Math.max(0, Math.round(Number(term.clicks || 0))),
      cost_krw: Math.max(0, Math.round(Number(term.costKrw || 0))),
      conversions: Math.max(0, Number(term.conversions || 0)),
      action,
      priority: rec?.priority || (score >= 70 ? 'high' : score >= 35 ? 'medium' : 'low'),
      score,
      reason: rec?.reason || '검색어 성과 검토 필요',
      raw_payload: term,
    };
  });
}

export type ExperimentSeed = {
  productId?: string | null;
  scenarioId?: string | null;
  platform?: string | null;
  clicks?: number;
  conversions?: number;
  revenueKrw?: number;
  marginKrw?: number;
  ctaClicks?: number;
  bounceRatePct?: number | null;
};

export function buildAdOsExperimentPlan(seed: ExperimentSeed) {
  const clicks = Number(seed.clicks || 0);
  const conversions = Number(seed.conversions || 0);
  const ctaClicks = Number(seed.ctaClicks || 0);
  const bounce = seed.bounceRatePct == null ? null : Number(seed.bounceRatePct);
  const enoughTraffic = clicks >= 100 || ctaClicks >= 30;
  const enoughConversion = conversions >= 5;

  const plans = [
    {
      experiment_type: 'holdout',
      name: '검색광고 증분성 holdout',
      hypothesis: '일부 초세부 키워드를 보류해 실제 증분 예약/마진 기여를 분리합니다.',
      primary_metric: 'margin_roas',
      minimum_sample: { clicks: 300, conversions: 10, days: 14 },
      split_config: { holdout_pct: 10, unit: 'keyword_cluster' },
      guardrails: { max_loss_krw: 30000, no_full_auto: true },
      status: enoughConversion ? 'candidate' : 'candidate',
    },
    {
      experiment_type: 'landing_ab',
      name: '블로그 랜딩 CTA A/B',
      hypothesis: '구매 직전 CTA와 불안 해소형 CTA를 비교해 상담/예약 전환율을 높입니다.',
      primary_metric: 'cta_to_booking_rate',
      minimum_sample: { sessions: 500, cta_clicks: 40, days: 14 },
      split_config: { variants: ['price_deadline_cta', 'trust_faq_cta'] },
      guardrails: { canonical_owner_required: true, duplicate_content_block: true },
      status: enoughTraffic || (bounce != null && bounce >= 55) ? 'candidate' : 'candidate',
    },
    {
      experiment_type: 'keyword_match_type',
      name: '초세부 키워드 match type 테스트',
      hypothesis: '성과 검색어는 exact/phrase로 승격하고 낭비 broad 검색어는 제외어로 분리합니다.',
      primary_metric: 'margin_cpa',
      minimum_sample: { impressions: 1000, clicks: 80, days: 10 },
      split_config: { match_types: ['exact', 'phrase'], broad_holdout: true },
      guardrails: { max_cpc_multiplier: 1, cooldown_days: 7 },
      status: 'candidate',
    },
  ];

  return plans.map((plan) => ({
    ...plan,
    platform: seed.platform || null,
    product_id: seed.productId || null,
    scenario_id: seed.scenarioId || null,
    expected_impact: {
      clicks,
      conversions,
      revenue_krw: Math.max(0, Number(seed.revenueKrw || 0)),
      margin_krw: Number(seed.marginKrw || 0),
      enough_traffic: enoughTraffic,
      enough_conversion: enoughConversion,
      bandit_enabled: false,
      bandit_reason: '초기에는 실험 후보만 만들고, 최소 표본 충족 후에만 Thompson/UCB 배분을 제안합니다.',
    },
  }));
}

export type TenantReportInput = {
  spendKrw: number;
  revenueKrw: number;
  marginKrw: number;
  conversions: number;
  ctaClicks: number;
  clicks: number;
  pausedWasteKeywords: number;
  discoveredCheapKeywords: number;
  budgetCapKrw: number;
};

export function buildTenantAdReport(input: TenantReportInput) {
  const spend = Math.max(0, Math.round(input.spendKrw || 0));
  const revenue = Math.max(0, Math.round(input.revenueKrw || 0));
  const margin = Math.round(input.marginKrw || 0);
  const conversions = Math.max(0, Number(input.conversions || 0));
  const clicks = Math.max(0, Number(input.clicks || 0));
  const ctaClicks = Math.max(0, Number(input.ctaClicks || 0));
  return {
    budget_usage_pct: input.budgetCapKrw > 0 ? Math.round((spend / input.budgetCapKrw) * 1000) / 10 : 0,
    spend_krw: spend,
    revenue_krw: revenue,
    margin_krw: margin,
    revenue_roas_pct: spend > 0 ? Math.round((revenue / spend) * 100) : 0,
    margin_roas_pct: spend > 0 ? Math.round((margin / spend) * 100) : 0,
    cpa_krw: conversions > 0 ? Math.round(spend / conversions) : 0,
    cta_rate_pct: clicks > 0 ? Math.round((ctaClicks / clicks) * 1000) / 10 : 0,
    conversion_rate_pct: clicks > 0 ? Math.round((conversions / clicks) * 1000) / 10 : 0,
    paused_waste_keywords: input.pausedWasteKeywords,
    discovered_cheap_keywords: input.discoveredCheapKeywords,
    next_actions: [
      input.discoveredCheapKeywords > 0 ? '저가 승자 키워드 유사 확장 후보를 승인합니다.' : '검색어 수확을 먼저 실행해 저가 키워드를 발굴합니다.',
      input.pausedWasteKeywords > 0 ? '낭비 키워드 정지/제외어 적용 결과를 확인합니다.' : '비용 누수 후보가 없으면 소액 테스트 범위를 유지합니다.',
      margin > 0 ? '마진 ROAS 기준으로 다음 달 예산 증감안을 검토합니다.' : '예약 마진 귀속을 보강해 매출 ROAS와 마진 ROAS를 분리합니다.',
    ],
  };
}
