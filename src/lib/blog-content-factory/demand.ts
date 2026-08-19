import { createHash } from 'node:crypto';

import type {
  BlogContentOperationType,
  BlogDemandMaterializationDecisionV4,
  BlogDemandMaterializationInputV4,
  BlogDemandSignalV4,
} from './types';

const QUERY_NOISE_RE = /(?:여행\s*가이드|완벽|총정리|필수|best|베스트)/gi;
const WEATHER_RE = /(?:날씨|우기|건기|기온|강수|태풍|옷차림|weather|rain)/i;
const HOTEL_RE = /(?:호텔|숙소|리조트|hotel|resort|accommodation)/i;
const ROUTE_RE = /(?:공항|이동|교통|가는\s*법|에서.+까지|airport|transport|route)/i;
const COST_RE = /(?:비용|예산|경비|가격|얼마|cost|budget|price)/i;
const ENTRY_RE = /(?:입국|비자|여권|세관|면세|esta|eta|etias|visa|passport|customs)/i;
const ITINERARY_RE = /(?:일정|코스|동선|가볼만한곳|명소|itinerary|things\s+to\s+do)/i;
const FAMILY_RE = /(?:가족|아이|부모님|아동|family|kids?|senior)/i;

export function normalizeBlogDemandQueryV4(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(QUERY_NOISE_RE, ' ')
    .replace(/[()[\]{}"'`~!@#$%^&*+=_|\\/:;,.?<>·…—–-]+/g, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferBlogDemandIntentV4(query: string): string {
  if (ENTRY_RE.test(query)) return 'entry_requirements';
  if (WEATHER_RE.test(query)) return 'monthly_weather';
  if (HOTEL_RE.test(query)) return 'hotel_areas';
  if (ROUTE_RE.test(query)) return 'airport_transport';
  if (COST_RE.test(query)) return FAMILY_RE.test(query) ? 'family_budget' : 'food_budget';
  if (ITINERARY_RE.test(query)) return 'itinerary';
  return 'general';
}

function signalIsFresh(signal: BlogDemandSignalV4, now = new Date()): boolean {
  if (!signal.verifiedAt || Number.isNaN(Date.parse(signal.verifiedAt))) return false;
  if (!signal.observedAt || Number.isNaN(Date.parse(signal.observedAt))) return false;
  if (signal.expiresAt && Date.parse(signal.expiresAt) <= now.getTime()) return false;
  if (!/^[0-9a-f]{64}$/.test(signal.sourceRowHash)) return false;
  if (['active_product', 'active_product_question', 'operator_note', 'editor_seed'].includes(signal.provider)) {
    return true;
  }
  const metrics = signal.metrics ?? {};
  return Number(signal.metricValue ?? 0) > 0
    || Number(metrics.impressions ?? 0) > 0
    || Number(metrics.clicks ?? 0) > 0
    || Number(metrics.frequency ?? 0) > 0;
}

export function scoreBlogDemandSignalV4(input: {
  signal: BlogDemandSignalV4;
  now: Date;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  seasonal: boolean;
  representativeExists: boolean;
}): { score: number; components: Record<string, number> } {
  const { signal } = input;
  const metrics = signal.metrics ?? {};
  const impressions = Math.max(0, Number(metrics.impressions ?? 0));
  const clicks = Math.max(0, Number(metrics.clicks ?? 0));
  const questionFrequency = ['customer_question', 'consultation_aggregate'].includes(signal.provider)
    ? Math.max(0, Number(metrics.frequency ?? signal.metricValue ?? 0))
    : Math.max(0, Number(metrics.frequency ?? 0));
  const volumeSignal = ['search_volume', 'search_trend'].includes(signal.provider)
    ? Math.max(0, Number(signal.metricValue ?? 0))
    : 0;
  const productRelevance = Math.max(0, Math.min(1, Number(metrics.product_relevance ?? 0)));
  const ctr = Math.max(0, Math.min(1, Number(metrics.ctr ?? (impressions > 0 ? clicks / impressions : 0))));
  const position = Number(metrics.average_position);
  const inRefreshBand = Number.isFinite(position) && position >= 4 && position <= 20;
  const observedAt = Date.parse(signal.observedAt);
  const ageDays = Number.isFinite(observedAt)
    ? Math.max(0, (input.now.getTime() - observedAt) / 86_400_000)
    : 90;
  const seasonalityMetric = Number(metrics.seasonality ?? 0);
  const cannibalizationPenalty = Number(metrics.cannibalization_penalty ?? 0);
  const templateSaturationPenalty = Number(metrics.template_saturation_penalty ?? 0);
  const components = {
    impressions: Math.min(30, Math.log10(impressions + 1) * 8),
    clicks: Math.min(10, Math.log10(clicks + 1) * 5),
    customer_question_frequency: Math.min(15, Math.log10(questionFrequency + 1) * 8),
    observed_volume_or_trend: Math.min(15, Math.log10(volumeSignal + 1) * 5),
    active_product_relevance: productRelevance * 15,
    ctr_opportunity: inRefreshBand && impressions > 0 ? Math.min(10, (1 - ctr) * 10) : 0,
    position_4_to_20_refresh: inRefreshBand ? Math.min(10, ((20 - position) / 16) * 10) : 0,
    seasonality: input.seasonal
      ? 5
      : Number.isFinite(seasonalityMetric) ? Math.max(0, Math.min(1, seasonalityMetric) * 5) : 0,
    source_freshness: Math.max(0, 5 * (1 - Math.min(90, ageDays) / 90)),
    stale_information_risk: input.riskLevel === 'HIGH' ? 10 : input.riskLevel === 'MEDIUM' ? 5 : 0,
    canonical_refresh: input.representativeExists ? 5 : 0,
    cannibalization_penalty: Number.isFinite(cannibalizationPenalty)
      ? Math.max(0, Math.min(20, cannibalizationPenalty)) : 0,
    template_saturation_penalty: Number.isFinite(templateSaturationPenalty)
      ? Math.max(0, Math.min(20, templateSaturationPenalty)) : 0,
  };
  // A verified editor/operator seed is real demand authority but is not given
  // fictitious volume. Its score simply clears the inventory ordering floor.
  const authorityFloor = ['editor_seed', 'operator_note'].includes(signal.provider) ? 25 : 0;
  const positive = Object.entries(components)
    .filter(([key]) => !key.endsWith('_penalty'))
    .reduce((sum, [, value]) => sum + value, 0);
  const penalties = components.cannibalization_penalty + components.template_saturation_penalty;
  const score = Math.round(Math.max(authorityFloor, Math.min(100, positive - penalties)) * 1000) / 1000;
  return {
    score,
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [
      key,
      Math.round(value * 1000) / 1000,
    ])),
  };
}

function operationType(input: BlogDemandMaterializationInputV4, refresh: boolean): BlogContentOperationType {
  if (refresh) return input.packageSnapshot ? 'product_refresh' : 'material_refresh';
  if (input.packageSnapshot) return 'new_commercial';
  if (input.seasonal || input.emergency) return 'new_seasonal';
  return 'new_info';
}

export function decideBlogDemandMaterializationV4(
  input: BlogDemandMaterializationInputV4,
  now = new Date(),
): BlogDemandMaterializationDecisionV4 {
  const primaryQuery = input.primaryQuery.replace(/\s+/g, ' ').trim();
  const normalizedQuery = normalizeBlogDemandQueryV4(primaryQuery);
  if (!normalizedQuery) throw new Error('blog_demand_query_missing');
  if (!signalIsFresh(input.signal, now)) throw new Error('verified_blog_demand_signal_missing_or_expired');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.operationDayKst)) {
    throw new Error('blog_operation_day_kst_invalid');
  }

  const intent = inferBlogDemandIntentV4(normalizedQuery);
  const audience = input.audience?.trim() || (FAMILY_RE.test(primaryQuery) ? 'family' : 'general');
  const locale = input.locale?.trim() || 'ko-KR';
  const destinationId = input.destinationId?.trim() || null;
  const activeRepresentative = input.representative?.status === 'active'
    && Boolean(input.representative.canonicalCreativeId)
    ? input.representative
    : null;
  const refreshTargetCreativeId = activeRepresentative?.canonicalCreativeId
    ?? input.refreshTargetCreativeId?.trim()
    ?? null;
  const refresh = Boolean(refreshTargetCreativeId);
  const riskLevel = input.riskLevel ?? 'LOW';
  const demandScoring = scoreBlogDemandSignalV4({
    signal: input.signal,
    now,
    riskLevel,
    seasonal: Boolean(input.seasonal || input.emergency),
    representativeExists: refresh,
  });
  const decision = refresh
    ? 'refresh'
    : input.packageSnapshot
      ? 'commercial_companion'
      : 'new';
  const type = operationType(input, refresh);
  const clusterSource = [locale, destinationId ?? 'destinationless', intent, audience, normalizedQuery].join('|');
  const clusterKey = `v4|${createHash('sha256').update(clusterSource).digest('hex').slice(0, 32)}`;
  const idempotencySource = [input.operationDayKst, clusterKey, type, input.packageSnapshot?.snapshotId ?? 'none'].join('|');

  return {
    clusterKey,
    normalizedQuery,
    primaryQuery,
    intent,
    destinationId,
    audience,
    locale,
    demandScore: demandScoring.score,
    scoreComponents: demandScoring.components,
    riskLevel,
    freshnessExpiresAt: input.signal.expiresAt ?? null,
    decision,
    decisionReason: refresh
      ? 'active_representative_requires_material_refresh'
      : input.packageSnapshot
        ? 'verified_demand_with_immutable_active_package_snapshot'
        : 'verified_demand_without_existing_representative',
    representativeKey: activeRepresentative?.representativeKey ?? null,
    canonicalCreativeId: refreshTargetCreativeId,
    refreshTargetCreativeId,
    operationType: type,
    createsNewUrl: !refresh,
    idempotencyKey: `blog-op-v4:${createHash('sha256').update(idempotencySource).digest('hex')}`,
    operationDayKst: input.operationDayKst,
    signal: input.signal,
    packageSnapshot: input.packageSnapshot ?? null,
    queueId: input.queueId ?? null,
    creativeId: input.creativeId ?? activeRepresentative?.canonicalCreativeId ?? null,
  };
}
