import {
  buildGoogleConversionExportPackets,
  buildMetaConversionExportPackets,
  type AdOsPlatform,
  type ConversionExportEvent,
  type ConversionExportPacket,
  type PerformanceFactForOptimization,
} from './ad-os-v31-v40';

export type PlatformJobStatus = 'planned' | 'approved' | 'running' | 'succeeded' | 'failed' | 'rolled_back' | 'blocked';
export type OptimizerPlanType = 'pause_waste' | 'scale_winner' | 'reduce_deadline_risk' | 'landing_repair' | 'creative_refresh' | 'holdout_required';
export type DataQualityStatus = 'healthy' | 'warning' | 'blocked';

export type ExternalMutationForJob = {
  id: string;
  tenant_id?: string | null;
  platform: 'naver' | 'google' | 'meta' | 'kakao';
  mutation_type: string;
  mode?: string | null;
  status: string;
  change_request_id?: string | null;
  run_id?: string | null;
  external_account_id?: string | null;
  external_campaign_id?: string | null;
  external_ad_group_id?: string | null;
  idempotency_key?: string | null;
  request_payload?: Record<string, unknown> | null;
  response_payload?: Record<string, unknown> | null;
  error_message?: string | null;
};

export type PlatformGuardrailInput = {
  integrationReady: boolean;
  permissionOk: boolean;
  campaignReady: boolean;
  budgetReady: boolean;
  killSwitchClear: boolean;
  automationLevel: number;
  humanApproved: boolean;
  fullAutoEnabled?: boolean;
};

export type PlatformJobRow = {
  tenant_id: string | null;
  platform: 'naver' | 'google' | 'meta' | 'kakao';
  job_type: string;
  status: PlatformJobStatus;
  automation_level: number;
  change_request_id: string | null;
  external_mutation_result_id: string;
  run_id: string | null;
  idempotency_key: string;
  external_account_id: string | null;
  external_campaign_id: string | null;
  external_ad_group_id: string | null;
  request_payload: Record<string, unknown>;
  before_payload: Record<string, unknown>;
  after_payload: Record<string, unknown>;
  rollback_payload: Record<string, unknown>;
  guardrail_snapshot: Record<string, unknown>;
  response_payload: Record<string, unknown>;
  guardrail_status: 'pending' | 'passed' | 'blocked';
  external_api_write: boolean;
  blocked_reason: string | null;
};

export type ConversionUploadQuality = {
  status: 'ready' | 'blocked';
  score: number;
  consentStatus: 'granted' | 'denied' | 'unknown';
  blockedReason: string | null;
  rawPiiKeys: string[];
};

export type ConversionUploadJobRow = {
  tenant_id: string | null;
  platform: 'google' | 'meta';
  conversion_event_id: string;
  run_id: string | null;
  status: 'planned' | 'blocked';
  upload_type: 'offline_conversion' | 'enhanced_conversion' | 'meta_capi';
  idempotency_key: string;
  event_name: string;
  event_time: string;
  value_krw: number;
  margin_krw: number;
  consent_status: 'granted' | 'denied' | 'unknown';
  signal_quality_score: number;
  blocked_reason: string | null;
  identifiers: Record<string, string>;
  upload_payload: Record<string, unknown>;
};

export type DataQualitySnapshot = {
  tenant_id: string | null;
  status: DataQualityStatus;
  period_start: string;
  period_end: string;
  events_total: number;
  clean_events: number;
  quarantined_events: number;
  upload_ready_events: number;
  blocked_upload_events: number;
  duplicate_dedupe_keys: number;
  attribution_coverage_pct: number;
  margin_coverage_pct: number;
  blocked_by_reason: Record<string, number>;
  recommendations: string[];
};

export type PackageFact = {
  id: string;
  tenant_id?: string | null;
  title?: string | null;
  destination?: string | null;
  price?: number | null;
  status?: string | null;
  ticketing_deadline?: string | null;
  seats_held?: number | null;
  seats_confirmed?: number | null;
  seats_total?: number | null;
  commission_fixed_amount?: number | null;
  commission_rate?: number | null;
};

export type ChannelBudgetFact = {
  platform: string;
  monthly_budget_krw?: number | null;
  daily_budget_cap_krw?: number | null;
  max_cpc_krw?: number | null;
  automation_level?: number | null;
  status?: string | null;
};

export type PortfolioPlanRow = {
  tenant_id: string | null;
  platform: AdOsPlatform;
  product_id: string | null;
  scenario_id: string | null;
  run_id?: string | null;
  idempotency_key: string;
  plan_type: OptimizerPlanType;
  status: 'candidate';
  primary_metric: 'margin_roas';
  current_budget_krw: number;
  recommended_budget_krw: number;
  recommended_bid_adjustment_pct: number;
  expected_margin_krw: number;
  expected_cpa_krw: number;
  expected_margin_roas_pct: number;
  deadline_risk_score: number;
  confidence: number;
  reason: string;
  evidence: Record<string, unknown>;
  proposed_change: Record<string, unknown>;
  rollback_payload: Record<string, unknown>;
};

export type CreativeVariantRow = {
  tenant_id: string | null;
  product_id: string | null;
  scenario_id: string | null;
  run_id?: string | null;
  idempotency_key: string;
  platform: 'naver' | 'google' | 'meta' | 'kakao' | 'organic';
  asset_type: string;
  lifecycle_status: 'draft';
  angle: string;
  audience: string;
  headline: string;
  body: string;
  cta: string;
  destination_url: string | null;
  fatigue_score: number;
  ctr_decay_pct: number;
  cpa_trend_pct: number;
  performance_snapshot: Record<string, unknown>;
  generation_payload: Record<string, unknown>;
};

export type TravelIntentSignalRow = {
  tenant_id: string | null;
  product_id: string | null;
  run_id?: string | null;
  destination: string;
  intent_key: string;
  intent_type: string;
  source: 'ad_os_travel_intent';
  keyword_text: string;
  landing_intent: string;
  suggested_budget_cap_krw: number;
  suggested_bid_krw: number;
  cannibalization_risk: number;
  duplicate_content_risk: number;
  score: number;
  evidence: Record<string, unknown>;
  status: 'candidate';
};

function int(value: unknown): number {
  return Math.max(0, Math.round(Number(value || 0)));
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dateOnly(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function daysUntil(value?: string | null): number | null {
  const iso = dateOnly(value);
  if (!iso) return null;
  const ms = new Date(`${iso}T00:00:00.000Z`).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

function dedupeKey(platform: string, id: string, suffix: string): string {
  return `${platform}:${id}:${suffix}`.slice(0, 240);
}

function mutationTypeToJobType(value: string): PlatformJobRow['job_type'] {
  if (value === 'create_campaign') return 'create_campaign';
  if (value === 'create_business_channel') return 'create_business_channel';
  if (value === 'create_ad_group') return 'create_ad_group';
  if (value === 'create_paused_keyword') return 'create_paused_keyword';
  if (value === 'activate_keyword') return 'activate_keyword';
  if (value === 'pause_keyword') return 'pause_keyword';
  if (value === 'update_bid') return 'update_bid';
  if (value === 'sync_asset') return 'sync_asset';
  return 'dry_run';
}

export function gatePlatformJob(input: {
  mutation: ExternalMutationForJob;
  guardrails: PlatformGuardrailInput;
  execute?: boolean;
}): { status: PlatformJobStatus; blockedReason: string | null } {
  const { mutation, guardrails } = input;
  if (!['planned', 'requested'].includes(mutation.status)) {
    return { status: 'blocked', blockedReason: `mutation_status_${mutation.status}` };
  }
  if (mutation.status !== 'requested' || !mutation.change_request_id) {
    return { status: 'blocked', blockedReason: 'human_approval_required' };
  }
  if (!guardrails.humanApproved) return { status: 'blocked', blockedReason: 'human_approval_required' };
  if (!guardrails.integrationReady) return { status: 'blocked', blockedReason: 'missing_credentials' };
  if (!guardrails.permissionOk) return { status: 'blocked', blockedReason: 'permission_not_ready' };
  if (!guardrails.campaignReady) return { status: 'blocked', blockedReason: 'campaign_or_ad_group_missing' };
  if (!guardrails.budgetReady) return { status: 'blocked', blockedReason: 'budget_guard_not_ready' };
  if (!guardrails.killSwitchClear) return { status: 'blocked', blockedReason: 'kill_switch_active' };
  if (guardrails.automationLevel < 3 && ['activate_keyword', 'pause_keyword', 'update_bid'].includes(mutationTypeToJobType(mutation.mutation_type))) {
    return { status: 'blocked', blockedReason: 'limited_autopilot_required' };
  }
  if (guardrails.automationLevel >= 4 && !guardrails.fullAutoEnabled) {
    return { status: 'blocked', blockedReason: 'full_auto_disabled' };
  }
  return { status: input.execute ? 'running' : 'approved', blockedReason: null };
}

export function buildPlatformJobRows(
  mutations: ExternalMutationForJob[],
  guardrailsByPlatform: Record<string, PlatformGuardrailInput>,
  options: { runId?: string | null; execute?: boolean } = {},
): PlatformJobRow[] {
  return mutations.map((mutation) => {
    const guardrails = guardrailsByPlatform[mutation.platform] || {
      integrationReady: false,
      permissionOk: false,
      campaignReady: false,
      budgetReady: false,
      killSwitchClear: false,
      automationLevel: 0,
      humanApproved: false,
      fullAutoEnabled: false,
    };
    const gate = gatePlatformJob({ mutation, guardrails, execute: options.execute });
    const jobType = mutationTypeToJobType(mutation.mutation_type);
    return {
      tenant_id: mutation.tenant_id || null,
      platform: mutation.platform,
      job_type: jobType,
      status: gate.status,
      automation_level: guardrails.automationLevel,
      change_request_id: mutation.change_request_id || null,
      external_mutation_result_id: mutation.id,
      run_id: options.runId || mutation.run_id || null,
      idempotency_key: dedupeKey(mutation.platform, mutation.idempotency_key || mutation.id, 'platform-job'),
      external_account_id: mutation.external_account_id || null,
      external_campaign_id: mutation.external_campaign_id || null,
      external_ad_group_id: mutation.external_ad_group_id || null,
      request_payload: {
        ...(mutation.request_payload || {}),
        external_api_write: false,
        job_control_plane: true,
      },
      before_payload: mutation.response_payload || {},
      after_payload: {},
      rollback_payload: {
        platform: mutation.platform,
        mutation_type: mutation.mutation_type,
        source_mutation_result_id: mutation.id,
      },
      guardrail_snapshot: guardrails,
      response_payload: {
        external_api_write: false,
        next_executor_required: gate.status === 'approved',
      },
      guardrail_status: gate.status === 'blocked' ? 'blocked' : 'passed',
      external_api_write: false,
      blocked_reason: gate.blockedReason,
    };
  });
}

function rawPiiKeys(payload?: Record<string, unknown> | null): string[] {
  if (!payload) return [];
  const piiPatterns = [/email/i, /phone/i, /tel/i, /passport/i, /name/i];
  return Object.keys(payload).filter((key) => piiPatterns.some((pattern) => pattern.test(key)) && String(payload[key] || '').trim().length > 0);
}

function consentStatus(payload?: Record<string, unknown> | null): 'granted' | 'denied' | 'unknown' {
  const raw = payload || {};
  const value = String(raw.consent_status || raw.ad_user_data || raw.ad_personalization || raw.marketing_consent || '').toLowerCase();
  if (['granted', 'true', 'yes', '1'].includes(value)) return 'granted';
  if (['denied', 'false', 'no', '0'].includes(value)) return 'denied';
  return 'unknown';
}

export function assessConversionUploadQuality(packet: ConversionExportPacket, event: ConversionExportEvent): ConversionUploadQuality {
  const piiKeys = rawPiiKeys(event.raw_payload);
  const consent = consentStatus(event.raw_payload);
  let score = 0;
  if (packet.ready_for_upload) score += 35;
  if (Object.keys(packet.identifiers).length >= 1) score += 25;
  if (packet.value_krw > 0 || packet.margin_krw !== 0) score += 15;
  if (consent === 'granted') score += 15;
  if (consent === 'unknown') score += 5;
  if (piiKeys.length === 0) score += 10;
  score = clamp(score, 0, 100);

  const blockedReason = packet.blocked_reason ||
    (consent === 'denied' ? 'consent_denied' : null) ||
    (piiKeys.length > 0 ? 'raw_pii_present' : null);

  return {
    status: blockedReason ? 'blocked' : 'ready',
    score,
    consentStatus: consent,
    blockedReason,
    rawPiiKeys: piiKeys,
  };
}

export function buildConversionUploadJobRows(
  events: ConversionExportEvent[],
  platform: 'google' | 'meta',
  options: { runId?: string | null } = {},
): ConversionUploadJobRow[] {
  const packets = platform === 'google'
    ? buildGoogleConversionExportPackets(events)
    : buildMetaConversionExportPackets(events);
  const eventById = new Map(events.map((event) => [event.id, event]));

  return packets.map((packet) => {
    const event = eventById.get(packet.event_id) || { id: packet.event_id, event_type: packet.event_name };
    const quality = assessConversionUploadQuality(packet, event);
    return {
      tenant_id: event.tenant_id || null,
      platform,
      conversion_event_id: packet.event_id,
      run_id: options.runId || null,
      status: quality.status === 'ready' ? 'planned' : 'blocked',
      upload_type: platform === 'google'
        ? packet.identifiers.gclid || packet.identifiers.gbraid || packet.identifiers.wbraid
          ? 'offline_conversion'
          : 'enhanced_conversion'
        : 'meta_capi',
      idempotency_key: packet.dedupe_key,
      event_name: packet.event_name,
      event_time: packet.event_time,
      value_krw: packet.value_krw,
      margin_krw: packet.margin_krw,
      consent_status: quality.consentStatus,
      signal_quality_score: quality.score,
      blocked_reason: quality.blockedReason,
      identifiers: packet.identifiers,
      upload_payload: {
        ...packet.custom_data,
        event_name: packet.event_name,
        event_time: packet.event_time,
        value_krw: packet.value_krw,
        margin_krw: packet.margin_krw,
        raw_pii_keys: quality.rawPiiKeys,
        external_api_write: false,
      },
    };
  });
}

export function buildDataQualitySnapshot(input: {
  events: ConversionExportEvent[];
  uploadJobs: Array<{ status?: string | null; blocked_reason?: string | null; idempotency_key?: string | null }>;
  performanceFacts: PerformanceFactForOptimization[];
  periodStart: string;
  periodEnd: string;
  tenantId?: string | null;
}): DataQualitySnapshot {
  const eventsTotal = input.events.length;
  const cleanEvents = input.events.filter((event) => !event.quarantine_status || event.quarantine_status === 'clean').length;
  const quarantinedEvents = eventsTotal - cleanEvents;
  const uploadReady = input.uploadJobs.filter((job) => ['planned', 'approved', 'running', 'uploaded'].includes(job.status || '')).length;
  const blocked = input.uploadJobs.filter((job) => job.status === 'blocked').length;
  const dedupeCounts = input.uploadJobs.reduce<Record<string, number>>((acc, job) => {
    const key = job.idempotency_key || '';
    if (key) acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const duplicateDedupeKeys = Object.values(dedupeCounts).filter((count) => count > 1).length;
  const blockedByReason = input.uploadJobs.reduce<Record<string, number>>((acc, job) => {
    const reason = job.blocked_reason || null;
    if (reason) acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});
  const factsWithConversions = input.performanceFacts.filter((fact) => Number(fact.conversions || 0) > 0).length;
  const factsWithMargin = input.performanceFacts.filter((fact) => Number(fact.margin_krw || 0) !== 0).length;
  const attributionCoverage = pct(factsWithConversions, Math.max(cleanEvents, 1));
  const marginCoverage = pct(factsWithMargin, Math.max(factsWithConversions, 1));
  const status: DataQualityStatus =
    eventsTotal === 0 || cleanEvents === 0 || duplicateDedupeKeys > 0 ? 'blocked' :
      blocked > uploadReady || attributionCoverage < 30 ? 'warning' :
        'healthy';
  const recommendations: string[] = [];
  if (eventsTotal === 0) recommendations.push('No conversion events collected. Verify blog CTA, booking funnel, and UTM capture.');
  if (quarantinedEvents > 0) recommendations.push('Review quarantined events before learning or platform upload.');
  if (blocked > 0) recommendations.push('Fix blocked conversion upload reasons before enabling conversion upload jobs.');
  if (duplicateDedupeKeys > 0) recommendations.push('Fix duplicate conversion dedupe keys.');
  if (attributionCoverage < 30 && eventsTotal > 0) recommendations.push('Increase attribution coverage by connecting booking IDs to campaign and keyword facts.');
  if (marginCoverage < 50 && factsWithConversions > 0) recommendations.push('Attach margin data before margin-ROAS optimization.');

  return {
    tenant_id: input.tenantId || null,
    status,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    events_total: eventsTotal,
    clean_events: cleanEvents,
    quarantined_events: quarantinedEvents,
    upload_ready_events: uploadReady,
    blocked_upload_events: blocked,
    duplicate_dedupe_keys: duplicateDedupeKeys,
    attribution_coverage_pct: attributionCoverage,
    margin_coverage_pct: marginCoverage,
    blocked_by_reason: blockedByReason,
    recommendations,
  };
}

export function buildPortfolioBudgetPlans(
  facts: PerformanceFactForOptimization[],
  budgets: ChannelBudgetFact[],
  packages: PackageFact[],
): PortfolioPlanRow[] {
  const budgetByPlatform = new Map(budgets.map((budget) => [budget.platform, budget]));
  const packageById = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const plans: PortfolioPlanRow[] = [];

  for (const fact of facts) {
    if (fact.platform === 'organic') continue;
    const budget = budgetByPlatform.get(fact.platform);
    const pkg = fact.product_id ? packageById.get(fact.product_id) : undefined;
    const cost = int(fact.cost_krw);
    const clicks = int(fact.clicks);
    const cta = int(fact.cta_clicks);
    const conversions = Number(fact.conversions || 0);
    const margin = Math.round(Number(fact.margin_krw || 0));
    const cpa = conversions > 0 ? Math.round(cost / conversions) : 0;
    const marginRoas = cost > 0 ? Math.round((margin / cost) * 100) : 0;
    const days = daysUntil(pkg?.ticketing_deadline);
    const deadlineRisk = days === null ? 0 : clamp(days <= 0 ? 100 : 100 - days * 10, 0, 100);
    const currentBudget = int(budget?.daily_budget_cap_krw || budget?.monthly_budget_krw);

    let planType: OptimizerPlanType | null = null;
    let recommendedBudget = currentBudget;
    let bidAdjustment = 0;
    let confidence = 0.45;
    let reason = '';

    if (cost >= 5000 && clicks >= 10 && cta === 0) {
      planType = 'pause_waste';
      recommendedBudget = 0;
      bidAdjustment = -100;
      confidence = 0.75;
      reason = 'Spend exists but CTA is zero. Pause or sharply reduce the unit before more budget is used.';
    } else if (conversions > 0 && marginRoas >= 250) {
      planType = 'scale_winner';
      recommendedBudget = Math.min(currentBudget + Math.max(5000, Math.round(currentBudget * 0.15)), int(budget?.monthly_budget_krw || currentBudget + 5000));
      bidAdjustment = 15;
      confidence = 0.7;
      reason = 'Conversion and margin ROAS beat the scale threshold. Increase budget or bid inside tenant caps.';
    } else if (deadlineRisk >= 70 && conversions === 0 && cost > 0) {
      planType = 'reduce_deadline_risk';
      recommendedBudget = Math.max(0, Math.round(currentBudget * 0.5));
      bidAdjustment = -25;
      confidence = 0.6;
      reason = 'Ticketing deadline risk is high without conversion proof. Reduce budget and switch to urgency creative.';
    } else if (clicks >= 20 && cta > 0 && conversions === 0) {
      planType = 'landing_repair';
      recommendedBudget = currentBudget;
      bidAdjustment = 0;
      confidence = 0.58;
      reason = 'CTA exists but bookings are missing. Product price, landing, or booking friction needs review.';
    }

    if (!planType) continue;
    plans.push({
      tenant_id: fact.tenant_id || pkg?.tenant_id || null,
      platform: fact.platform,
      product_id: fact.product_id || null,
      scenario_id: null,
      idempotency_key: dedupeKey(fact.platform, String(fact.id || fact.keyword_text || plans.length), String(planType)),
      plan_type: planType,
      status: 'candidate',
      primary_metric: 'margin_roas',
      current_budget_krw: currentBudget,
      recommended_budget_krw: recommendedBudget,
      recommended_bid_adjustment_pct: bidAdjustment,
      expected_margin_krw: margin,
      expected_cpa_krw: cpa,
      expected_margin_roas_pct: marginRoas,
      deadline_risk_score: deadlineRisk,
      confidence,
      reason,
      evidence: {
        fact_id: fact.id,
        keyword_text: fact.keyword_text || null,
        clicks,
        cta_clicks: cta,
        conversions,
        cost_krw: cost,
        margin_krw: margin,
        ticketing_deadline: pkg?.ticketing_deadline || null,
      },
      proposed_change: {
        platform: fact.platform,
        recommended_budget_krw: recommendedBudget,
        recommended_bid_adjustment_pct: bidAdjustment,
      },
      rollback_payload: {
        previous_budget_krw: currentBudget,
        previous_bid_adjustment_pct: 0,
      },
    });
  }

  return plans;
}

function normalizeDestination(value?: string | null): string {
  return String(value || 'travel').trim() || 'travel';
}

function shortTitle(pkg: PackageFact): string {
  return String(pkg.title || pkg.destination || 'Travel package').trim();
}

function packageMargin(pkg: PackageFact): number {
  const fixed = int(pkg.commission_fixed_amount);
  if (fixed > 0) return fixed;
  const price = int(pkg.price);
  const rate = Number(pkg.commission_rate || 0);
  return Math.round(price * (rate > 1 ? rate / 100 : rate));
}

export function buildTravelIntentSignalsForPackage(pkg: PackageFact, existingSignals: Array<{ destination?: string | null; intent_type?: string | null }> = []): TravelIntentSignalRow[] {
  const destination = normalizeDestination(pkg.destination);
  const title = shortTitle(pkg);
  const margin = packageMargin(pkg);
  const duplicateDestinationCount = existingSignals.filter((signal) => normalizeDestination(signal.destination) === destination).length;
  const duplicateRisk = clamp(duplicateDestinationCount * 15, 0, 95);
  const budgetCap = Math.max(5000, Math.min(50000, Math.round(Math.max(margin, 30000) * 0.25)));
  const baseBid = Math.max(50, Math.min(700, Math.round(Math.max(margin, 20000) / 200)));
  const intents = [
    { type: 'departure_region', keyword: `${destination} package from Busan`, landing: 'departure_region_landing', score: 78 },
    { type: 'family', keyword: `${destination} parents trip package`, landing: 'family_scenario_landing', score: 82 },
    { type: 'price', keyword: `${destination} low budget package under price`, landing: 'price_objection_landing', score: 72 },
    { type: 'anxiety', keyword: `${destination} exchange tips weather guide`, landing: 'anxiety_guide_landing', score: 68 },
    { type: 'deadline', keyword: `${destination} ticketing deadline package`, landing: 'urgency_landing', score: daysUntil(pkg.ticketing_deadline) !== null ? 74 : 55 },
    { type: 'comparison', keyword: `${destination} vs nearby destination package`, landing: 'comparison_landing', score: 64 },
    { type: 'differentiator', keyword: `${title} no shopping itinerary`, landing: 'differentiator_landing', score: 70 },
  ];

  return intents.map((intent) => ({
    tenant_id: pkg.tenant_id || null,
    product_id: pkg.id,
    destination,
    intent_key: `${destination}:${intent.type}`.toLowerCase().replace(/\s+/g, '-'),
    intent_type: intent.type,
    source: 'ad_os_travel_intent',
    keyword_text: intent.keyword,
    landing_intent: intent.landing,
    suggested_budget_cap_krw: budgetCap,
    suggested_bid_krw: baseBid,
    cannibalization_risk: duplicateRisk,
    duplicate_content_risk: intent.type === 'anxiety' || intent.type === 'comparison' ? Math.max(20, duplicateRisk - 15) : duplicateRisk,
    score: clamp(intent.score - Math.round(duplicateRisk / 5), 0, 100),
    evidence: {
      product_title: title,
      destination,
      price_krw: int(pkg.price),
      expected_margin_krw: margin,
      ticketing_deadline: pkg.ticketing_deadline || null,
      duplicate_destination_count: duplicateDestinationCount,
    },
    status: 'candidate',
  }));
}

export function buildCreativeAssetVariantsForPackage(
  pkg: PackageFact,
  signals: TravelIntentSignalRow[],
): CreativeVariantRow[] {
  const destination = normalizeDestination(pkg.destination);
  const title = shortTitle(pkg);
  const pick = (type: string) => signals.find((signal) => signal.intent_type === type) || signals[0];
  const variants = [
    {
      platform: 'google' as const,
      asset_type: 'rsa_headline',
      angle: 'price',
      audience: 'search_intent',
      headline: `${destination} package with clear deadline`,
      body: `${title} availability, price, and booking CTA in one landing page.`,
      cta: 'Check availability',
    },
    {
      platform: 'naver' as const,
      asset_type: 'dki_headline',
      angle: 'departure_region',
      audience: 'regional_searcher',
      headline: `{KeyWord:${destination} package}`,
      body: `Match Naver keyword intent to ${destination} landing CTA.`,
      cta: 'View package',
    },
    {
      platform: 'organic' as const,
      asset_type: 'blog_faq_block',
      angle: 'anxiety',
      audience: 'researcher',
      headline: `${destination} travel FAQ`,
      body: 'Exchange, tips, weather, itinerary, and booking deadline FAQ block.',
      cta: 'Compare package options',
    },
    {
      platform: 'meta' as const,
      asset_type: 'instagram_carousel',
      angle: 'family',
      audience: 'parents_family',
      headline: `${destination} trip for parents`,
      body: 'Carousel draft: hook, itinerary proof, hotel/flight, deadline, CTA.',
      cta: 'Ask on Kakao',
    },
    {
      platform: 'meta' as const,
      asset_type: 'retargeting_message',
      angle: 'retargeting',
      audience: 'cta_clicked_no_booking',
      headline: `${destination} seats may close soon`,
      body: 'Retargeting message for CTA clickers who did not complete booking.',
      cta: 'Resume booking',
    },
  ];

  return variants.map((variant) => {
    const signal = pick(variant.angle);
    return {
      tenant_id: pkg.tenant_id || null,
      product_id: pkg.id,
      scenario_id: null,
      idempotency_key: dedupeKey(variant.platform, `${pkg.id}:${variant.asset_type}:${variant.angle}`, 'creative'),
      platform: variant.platform,
      asset_type: variant.asset_type,
      lifecycle_status: 'draft',
      angle: variant.angle,
      audience: variant.audience,
      headline: variant.headline,
      body: variant.body,
      cta: variant.cta,
      destination_url: null,
      fatigue_score: 0,
      ctr_decay_pct: 0,
      cpa_trend_pct: 0,
      performance_snapshot: {},
      generation_payload: {
        product_title: title,
        destination,
        intent_signal_id: signal?.intent_key || null,
        duplicate_content_risk: signal?.duplicate_content_risk || 0,
        publish_policy: 'draft_only',
      },
    };
  });
}

export function buildTenantWorkspaceDefaults(input: {
  tenantId?: string | null;
  workspaceName?: string | null;
  allowedPlatforms?: string[] | null;
  monthlyBudgetCapKrw?: number | null;
  dailyBudgetCapKrw?: number | null;
  maxCpcKrw?: number | null;
  automationLevel?: number | null;
  billingPlan?: string | null;
  approverUserIds?: string[] | null;
  operatorUserIds?: string[] | null;
  forbiddenKeywords?: string[] | null;
  dataRetentionDays?: number | null;
  auditExportEnabled?: boolean | null;
}) {
  const allowed = (input.allowedPlatforms && input.allowedPlatforms.length > 0 ? input.allowedPlatforms : ['naver', 'google'])
    .filter((platform) => ['naver', 'google', 'meta', 'kakao'].includes(platform));
  const automationLevel = clamp(Math.round(Number(input.automationLevel ?? 2)), 0, 3);
  return {
    workspace: {
      tenant_id: input.tenantId || null,
      workspace_name: input.workspaceName || 'Default Ad Workspace',
      allowed_platforms: allowed.length > 0 ? allowed : ['naver', 'google'],
      monthly_budget_cap_krw: int(input.monthlyBudgetCapKrw),
      daily_budget_cap_krw: int(input.dailyBudgetCapKrw),
      max_cpc_krw: int(input.maxCpcKrw),
      max_test_loss_krw: Math.max(10_000, Math.round(int(input.monthlyBudgetCapKrw) * 0.1)),
      automation_level: automationLevel,
      require_human_approval: true,
      full_auto_enabled: false,
      risk_status: automationLevel >= 4 ? 'restricted' : 'watch',
      billing_plan: input.billingPlan || 'pilot',
      approver_user_ids: input.approverUserIds || [],
      operator_user_ids: input.operatorUserIds || [],
      forbidden_keywords: input.forbiddenKeywords || [],
      data_retention_days: Math.max(30, int(input.dataRetentionDays ?? 730)),
      audit_export_enabled: input.auditExportEnabled !== false,
    },
    billing: {
      tenant_id: input.tenantId || null,
      billing_plan: input.billingPlan || 'pilot',
      base_subscription_krw: input.billingPlan === 'enterprise' ? 990_000 : input.billingPlan === 'agency' ? 390_000 : 0,
      managed_spend_fee_pct: input.billingPlan === 'internal' ? 0 : 10,
      performance_fee_pct: input.billingPlan === 'enterprise' ? 3 : 0,
      invoice_status: 'active',
      audit_export_enabled: true,
      report_sla_days: 7,
      data_retention_days: 730,
    },
  };
}
