import { hasVerifiedBlogDemandSignal, type BlogDemandSignalInput } from './blog-autopublish-policy-v3';

export type BlogDemandProvider =
  | 'google_search_console'
  | 'naver_search_advisor'
  | 'customer_question'
  | 'consultation_aggregate'
  | 'active_product_question'
  | 'operator_note'
  | 'editor_seed'
  | 'search_volume'
  | 'search_trend';

export interface BlogDemandCandidateV3 {
  demand: BlogDemandSignalInput;
  impressions?: number | null;
  clicks?: number | null;
  ctr?: number | null;
  averagePosition?: number | null;
  customerQuestionFrequency?: number | null;
  activeProductRelevance?: number | null;
  seasonality?: number | null;
  sourceFreshness?: number | null;
  cannibalizationPenalty?: number | null;
  templateSaturationPenalty?: number | null;
  staleInformationRisk?: number | null;
}

export interface BlogDemandScoreV3 {
  eligible: boolean;
  score: number | null;
  components: Record<string, number>;
  reasons: string[];
}

const clamp = (value: number | null | undefined, min = 0, max = 1) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? Number(value) : 0));

export function scoreBlogDemandCandidateV3(input: BlogDemandCandidateV3): BlogDemandScoreV3 {
  if (!hasVerifiedBlogDemandSignal(input.demand)) {
    return { eligible: false, score: null, components: {}, reasons: ['verified_demand_signal_missing'] };
  }

  const impressions = Math.log10(Math.max(0, Number(input.impressions || 0)) + 1) / 5;
  const ctrOpportunity = input.impressions && Number(input.impressions) > 0
    ? clamp(1 - Number(input.ctr || 0) / 0.08)
    : 0;
  const position = Number(input.averagePosition || 0);
  const refreshOpportunity = position >= 4 && position <= 20
    ? clamp(1 - Math.abs(position - 10) / 10)
    : 0;
  const components = {
    impressions: clamp(impressions),
    ctr_opportunity: ctrOpportunity,
    position_4_20_refresh: refreshOpportunity,
    customer_question_frequency: clamp(Math.log10(Number(input.customerQuestionFrequency || 0) + 1) / 2),
    active_product_relevance: clamp(input.activeProductRelevance),
    seasonality: clamp(input.seasonality),
    source_freshness: clamp(input.sourceFreshness),
    cannibalization_penalty: clamp(input.cannibalizationPenalty),
    template_saturation_penalty: clamp(input.templateSaturationPenalty),
    stale_information_risk: clamp(input.staleInformationRisk),
  };
  const score = 100 * (
    components.impressions * 0.18
    + components.ctr_opportunity * 0.12
    + components.position_4_20_refresh * 0.12
    + components.customer_question_frequency * 0.18
    + components.active_product_relevance * 0.15
    + components.seasonality * 0.08
    + components.source_freshness * 0.08
    + components.stale_information_risk * 0.09
    - components.cannibalization_penalty * 0.12
    - components.template_saturation_penalty * 0.15
  );

  return {
    eligible: true,
    score: Math.round(Math.max(0, Math.min(100, score)) * 100) / 100,
    components,
    reasons: [],
  };
}

export function assertImportedMetricIsObserved(input: {
  provider: BlogDemandProvider;
  value: number | null;
  observed: boolean;
}): void {
  if (!input.observed || input.value == null || !Number.isFinite(input.value)) {
    throw new Error(`demand_metric_missing:${input.provider}`);
  }
}
