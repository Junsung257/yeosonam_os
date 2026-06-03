export type LearningEvidenceStatus = 'ready' | 'partial' | 'blocked';

export type LearningEvidenceFact = {
  id?: string | null;
  tenant_id?: string | null;
  product_id?: string | null;
  scenario_id?: string | null;
  keyword_text?: string | null;
  blog_post_id?: string | null;
  ad_landing_mapping_id?: string | null;
  content_creative_id?: string | null;
  platform?: string | null;
  channel?: string | null;
  source?: string | null;
  clicks?: number | null;
  cta_clicks?: number | null;
  conversions?: number | null;
  cost_krw?: number | null;
  revenue_krw?: number | null;
  margin_krw?: number | null;
  sessions?: number | null;
  bounces?: number | null;
};

export type LearningEvidenceSummary = {
  status: LearningEvidenceStatus;
  facts: number;
  readiness_score: number;
  dimension_coverage: {
    tenant: number;
    product: number;
    scenario: number;
    keyword: number;
    blog_or_landing: number;
    creative: number;
    channel: number;
  };
  metrics: {
    clicks: number;
    cta_clicks: number;
    conversions: number;
    spend_krw: number;
    revenue_krw: number;
    margin_krw: number;
    cta_rate_pct: number | null;
    conversion_rate_pct: number | null;
    cpa_krw: number | null;
    roas_pct: number | null;
    margin_roas_pct: number | null;
    bounce_rate_pct: number | null;
  };
  candidates: Array<{
    type: 'pause_waste' | 'scale_winner' | 'landing_repair' | 'collect_dimensions';
    status: 'candidate';
    reason: string;
    next_action: string;
  }>;
  missing_dimensions: string[];
  next_action: string;
  safety: {
    read_only: true;
    database_mutation: false;
    external_api_write: false;
  };
};

function numeric(value: unknown): number {
  return Math.max(0, Math.round(Number(value || 0)));
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function hasText(value: unknown): boolean {
  return String(value || '').trim().length > 0;
}

function coverage(facts: LearningEvidenceFact[], predicate: (fact: LearningEvidenceFact) => boolean): number {
  return facts.filter(predicate).length;
}

export function buildAdOsLearningEvidence(facts: LearningEvidenceFact[]): LearningEvidenceSummary {
  const factCount = facts.length;
  const clicks = facts.reduce((sum, fact) => sum + numeric(fact.clicks), 0);
  const ctaClicks = facts.reduce((sum, fact) => sum + numeric(fact.cta_clicks), 0);
  const conversions = facts.reduce((sum, fact) => sum + Number(fact.conversions || 0), 0);
  const spend = facts.reduce((sum, fact) => sum + numeric(fact.cost_krw), 0);
  const revenue = facts.reduce((sum, fact) => sum + numeric(fact.revenue_krw), 0);
  const margin = facts.reduce((sum, fact) => sum + Math.round(Number(fact.margin_krw || 0)), 0);
  const sessions = facts.reduce((sum, fact) => sum + numeric(fact.sessions), 0);
  const bounces = facts.reduce((sum, fact) => sum + numeric(fact.bounces), 0);
  const dimensionCoverage = {
    tenant: coverage(facts, (fact) => hasText(fact.tenant_id)),
    product: coverage(facts, (fact) => hasText(fact.product_id)),
    scenario: coverage(facts, (fact) => hasText(fact.scenario_id)),
    keyword: coverage(facts, (fact) => hasText(fact.keyword_text)),
    blog_or_landing: coverage(facts, (fact) => hasText(fact.blog_post_id) || hasText(fact.ad_landing_mapping_id)),
    creative: coverage(facts, (fact) => hasText(fact.content_creative_id)),
    channel: coverage(facts, (fact) => hasText(fact.platform) || hasText(fact.channel)),
  };
  const missingDimensions = Object.entries(dimensionCoverage)
    .filter(([, count]) => factCount === 0 || count === 0)
    .map(([key]) => key);
  const ctaRate = pct(ctaClicks, clicks);
  const conversionRate = pct(conversions, clicks);
  const cpa = conversions > 0 ? Math.round(spend / conversions) : null;
  const roas = pct(revenue, spend);
  const marginRoas = pct(margin, spend);
  const bounceRate = pct(bounces, sessions);
  const candidates: LearningEvidenceSummary['candidates'] = [];

  if (factCount === 0) {
    candidates.push({
      type: 'collect_dimensions',
      status: 'candidate',
      reason: 'No performance facts are available for the learning loop.',
      next_action: 'Sync clicks, CTA clicks, bookings, spend, revenue, margin, sessions, and bounces into ad_os_performance_facts.',
    });
  }
  if (spend > 0 && clicks > 0 && ctaClicks === 0) {
    candidates.push({
      type: 'pause_waste',
      status: 'candidate',
      reason: `Spend ${spend.toLocaleString('ko-KR')} KRW has clicks but no CTA clicks.`,
      next_action: 'Create a pause or keyword-quality review candidate before spending more budget.',
    });
  }
  if (conversions > 0 && marginRoas !== null && marginRoas >= 250) {
    candidates.push({
      type: 'scale_winner',
      status: 'candidate',
      reason: `Margin ROAS is ${marginRoas}% with ${conversions.toLocaleString('ko-KR')} conversions.`,
      next_action: 'Generate similar longtail keywords and a budget-increase candidate under tenant caps.',
    });
  }
  if (bounceRate !== null && bounceRate >= 70 && ctaClicks === 0) {
    candidates.push({
      type: 'landing_repair',
      status: 'candidate',
      reason: `Bounce rate is ${bounceRate}% and CTA clicks are zero.`,
      next_action: 'Create a landing intro, CTA block, or product-fit repair candidate.',
    });
  }
  if (missingDimensions.length > 0 && factCount > 0) {
    candidates.push({
      type: 'collect_dimensions',
      status: 'candidate',
      reason: `Missing learning dimensions: ${missingDimensions.join(', ')}.`,
      next_action: 'Attach tenant, product, scenario, keyword, blog/landing, creative, and channel ids before trusting optimization.',
    });
  }

  const requiredCoverage = ['product', 'keyword', 'blog_or_landing', 'creative', 'channel'];
  const coveredRequired = requiredCoverage.filter((key) => !missingDimensions.includes(key)).length;
  const score = factCount === 0 ? 0 : Math.max(0, Math.min(100, Math.round((coveredRequired / requiredCoverage.length) * 70 + (margin > 0 ? 15 : 0) + (conversions > 0 ? 15 : 0))));
  const status: LearningEvidenceStatus = factCount === 0 ? 'blocked' : score >= 80 ? 'ready' : 'partial';

  return {
    status,
    facts: factCount,
    readiness_score: score,
    dimension_coverage: dimensionCoverage,
    metrics: {
      clicks,
      cta_clicks: ctaClicks,
      conversions,
      spend_krw: spend,
      revenue_krw: revenue,
      margin_krw: margin,
      cta_rate_pct: ctaRate,
      conversion_rate_pct: conversionRate,
      cpa_krw: cpa,
      roas_pct: roas,
      margin_roas_pct: marginRoas,
      bounce_rate_pct: bounceRate,
    },
    candidates,
    missing_dimensions: missingDimensions,
    next_action: status === 'ready'
      ? 'Learning evidence is tied to core dimensions. Use candidates as approval-queue inputs, not direct live changes.'
      : missingDimensions.length > 0
        ? `Collect missing dimensions before trusting optimization: ${missingDimensions.join(', ')}.`
        : 'Collect performance facts before generating optimization candidates.',
    safety: {
      read_only: true,
      database_mutation: false,
      external_api_write: false,
    },
  };
}
