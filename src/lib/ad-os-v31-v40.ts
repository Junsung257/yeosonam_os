import { createHash } from 'crypto';

export type AdOsPlatform = 'naver' | 'google' | 'meta' | 'kakao' | 'organic';

export type ConversionExportEvent = {
  id: string;
  tenant_id?: string | null;
  event_type: string;
  event_time?: string | null;
  platform?: AdOsPlatform | null;
  session_id?: string | null;
  visitor_id?: string | null;
  click_id?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  naver_click_id?: string | null;
  fbclid?: string | null;
  product_id?: string | null;
  keyword_text?: string | null;
  booking_id?: string | null;
  revenue_krw?: number | null;
  margin_krw?: number | null;
  quarantine_status?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

export type ConversionExportPacket = {
  event_id: string;
  platform: 'google' | 'meta';
  ready_for_upload: boolean;
  blocked_reason: string | null;
  dedupe_key: string;
  event_name: string;
  event_time: string;
  value_krw: number;
  margin_krw: number;
  identifiers: Record<string, string>;
  custom_data: Record<string, unknown>;
};

export type PerformanceFactForOptimization = {
  id: string;
  tenant_id?: string | null;
  platform: AdOsPlatform;
  product_id?: string | null;
  ad_landing_mapping_id?: string | null;
  content_creative_id?: string | null;
  keyword_text?: string | null;
  event_date?: string | null;
  impressions?: number | null;
  clicks?: number | null;
  cost_krw?: number | null;
  cta_clicks?: number | null;
  conversions?: number | null;
  revenue_krw?: number | null;
  margin_krw?: number | null;
  bounces?: number | null;
  sessions?: number | null;
};

export type BidOptimizerCandidate = {
  fact_id: string;
  tenant_id: string | null;
  platform: Exclude<AdOsPlatform, 'organic'>;
  request_type: 'pause_keyword' | 'increase_bid' | 'decrease_bid' | 'replace_landing' | 'update_blog_cta';
  target_table: 'search_ad_keyword_plans' | 'ad_landing_mappings' | 'ad_os_landing_evolution_queue' | 'blog_content_versions';
  target_id: string;
  title: string;
  reason: string;
  risk_level: 'low' | 'medium' | 'high';
  proposed_change: Record<string, unknown>;
  expected_impact: Record<string, unknown>;
};

export type ExperimentForRun = {
  id: string;
  status: string;
  experiment_type: string;
  name: string;
  platform?: AdOsPlatform | null;
  product_id?: string | null;
  primary_metric?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  minimum_sample?: Record<string, unknown> | null;
};

export type ExperimentRunDecision = {
  experiment_id: string;
  next_status: 'running' | 'completed' | 'paused';
  reason: string;
  patch: Record<string, unknown>;
};

export type NaverExecutionMode = 'dry_run' | 'paused_only' | 'active_allowed';

export type NaverChangeRequestForExecution = {
  id: string;
  tenant_id?: string | null;
  request_type: string;
  status: string;
  platform?: string | null;
  automation_level?: number | null;
  proposed_change?: Record<string, unknown> | null;
};

export type NaverExecutionGate = {
  request_id: string;
  mutation_type: 'create_paused_keyword' | 'activate_keyword' | 'pause_keyword' | 'update_bid' | 'dry_run';
  allowed: boolean;
  reason: string;
  idempotency_key: string;
};

function text(value: unknown): string {
  return String(value || '').trim();
}

function numeric(value: unknown): number {
  return Math.max(0, Math.round(Number(value || 0)));
}

function sha256(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function eventDate(value?: string | null): string {
  const parsed = value ? new Date(value) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function rawText(event: ConversionExportEvent, key: string): string {
  const raw = event.raw_payload || {};
  return text(raw[key]);
}

function firstPartyIdentifiers(event: ConversionExportEvent): Record<string, string> {
  const identifiers: Record<string, string> = {};
  const email = rawText(event, 'email');
  const phone = rawText(event, 'phone');
  if (email) identifiers.email_sha256 = sha256(email);
  if (phone) identifiers.phone_sha256 = sha256(phone.replace(/[^\d+]/g, ''));
  if (event.visitor_id) identifiers.visitor_id = event.visitor_id;
  if (event.session_id) identifiers.session_id = event.session_id;
  return identifiers;
}

function googleEventName(eventType: string): string {
  if (eventType === 'lead') return 'lead';
  if (['booking', 'revenue', 'margin', 'settlement_confirmed'].includes(eventType)) return 'purchase';
  return eventType;
}

function metaEventName(eventType: string): string {
  if (eventType === 'landing_view') return 'PageView';
  if (eventType === 'cta_click') return 'Contact';
  if (eventType === 'lead') return 'Lead';
  if (['booking', 'revenue', 'margin', 'settlement_confirmed'].includes(eventType)) return 'Purchase';
  return eventType === 'click' ? 'ViewContent' : 'CustomEvent';
}

export function buildGoogleConversionExportPackets(events: ConversionExportEvent[]): ConversionExportPacket[] {
  const allowedEvents = new Set(['lead', 'booking', 'revenue', 'margin', 'settlement_confirmed']);
  return events.map((event) => {
    const identifiers: Record<string, string> = {
      ...firstPartyIdentifiers(event),
    };
    if (event.gclid) identifiers.gclid = event.gclid;
    if (event.gbraid) identifiers.gbraid = event.gbraid;
    if (event.wbraid) identifiers.wbraid = event.wbraid;
    const hasClickId = Boolean(identifiers.gclid || identifiers.gbraid || identifiers.wbraid);
    const hasFirstParty = Boolean(identifiers.email_sha256 || identifiers.phone_sha256);
    const clean = !event.quarantine_status || event.quarantine_status === 'clean';
    const ready = clean && allowedEvents.has(event.event_type) && (hasClickId || hasFirstParty);
    const blockedReason = !clean
      ? 'signal_quarantined'
      : !allowedEvents.has(event.event_type)
        ? 'event_type_not_exportable'
        : hasClickId || hasFirstParty
          ? null
          : 'missing_google_click_or_hashed_first_party_identifier';
    return {
      event_id: event.id,
      platform: 'google',
      ready_for_upload: ready,
      blocked_reason: blockedReason,
      dedupe_key: `google:${event.id}:${event.booking_id || event.event_type}`,
      event_name: googleEventName(event.event_type),
      event_time: eventDate(event.event_time),
      value_krw: numeric(event.revenue_krw),
      margin_krw: Math.round(Number(event.margin_krw || 0)),
      identifiers,
      custom_data: {
        tenant_id: event.tenant_id || null,
        product_id: event.product_id || null,
        keyword_text: event.keyword_text || null,
        booking_id: event.booking_id || null,
      },
    };
  });
}

export function buildMetaConversionExportPackets(events: ConversionExportEvent[]): ConversionExportPacket[] {
  const allowedEvents = new Set(['click', 'landing_view', 'cta_click', 'lead', 'booking', 'revenue', 'margin', 'settlement_confirmed']);
  return events.map((event) => {
    const identifiers: Record<string, string> = {
      ...firstPartyIdentifiers(event),
    };
    if (event.fbclid) identifiers.fbclid = event.fbclid;
    const hasMetaSignal = Boolean(identifiers.fbclid || identifiers.email_sha256 || identifiers.phone_sha256 || identifiers.visitor_id || identifiers.session_id);
    const clean = !event.quarantine_status || event.quarantine_status === 'clean';
    const ready = clean && allowedEvents.has(event.event_type) && hasMetaSignal;
    const blockedReason = !clean
      ? 'signal_quarantined'
      : !allowedEvents.has(event.event_type)
        ? 'event_type_not_exportable'
        : hasMetaSignal
          ? null
          : 'missing_meta_click_or_first_party_identifier';
    return {
      event_id: event.id,
      platform: 'meta',
      ready_for_upload: ready,
      blocked_reason: blockedReason,
      dedupe_key: `meta:${event.id}:${event.booking_id || event.event_type}`,
      event_name: metaEventName(event.event_type),
      event_time: eventDate(event.event_time),
      value_krw: numeric(event.revenue_krw),
      margin_krw: Math.round(Number(event.margin_krw || 0)),
      identifiers,
      custom_data: {
        tenant_id: event.tenant_id || null,
        product_id: event.product_id || null,
        keyword_text: event.keyword_text || null,
        booking_id: event.booking_id || null,
      },
    };
  });
}

export function summarizeConversionPackets(packets: ConversionExportPacket[]) {
  const ready = packets.filter((packet) => packet.ready_for_upload);
  return {
    total: packets.length,
    ready_for_upload: ready.length,
    blocked: packets.length - ready.length,
    value_krw: ready.reduce((sum, packet) => sum + packet.value_krw, 0),
    margin_krw: ready.reduce((sum, packet) => sum + packet.margin_krw, 0),
    blocked_by_reason: packets.reduce<Record<string, number>>((acc, packet) => {
      if (!packet.blocked_reason) return acc;
      acc[packet.blocked_reason] = (acc[packet.blocked_reason] || 0) + 1;
      return acc;
    }, {}),
  };
}

function targetIdForFact(fact: PerformanceFactForOptimization): string {
  return text(fact.ad_landing_mapping_id) || text(fact.content_creative_id) || fact.id;
}

export function buildBidOptimizerCandidates(
  facts: PerformanceFactForOptimization[],
  options: { targetCpaKrw?: number; targetMarginRoasPct?: number; minSpendKrw?: number } = {},
): BidOptimizerCandidate[] {
  const targetCpa = numeric(options.targetCpaKrw || 80000);
  const targetMarginRoas = numeric(options.targetMarginRoasPct || 250);
  const minSpend = numeric(options.minSpendKrw || 5000);
  const candidates: BidOptimizerCandidate[] = [];

  for (const fact of facts) {
    if (fact.platform === 'organic') continue;
    const clicks = numeric(fact.clicks);
    const ctaClicks = numeric(fact.cta_clicks);
    const conversions = Number(fact.conversions || 0);
    const cost = numeric(fact.cost_krw);
    const margin = Math.round(Number(fact.margin_krw || 0));
    const sessions = numeric(fact.sessions);
    const bounces = numeric(fact.bounces);
    const cpa = conversions > 0 ? Math.round(cost / conversions) : null;
    const marginRoas = cost > 0 ? Math.round((margin / cost) * 100) : null;
    const bounceRate = sessions > 0 ? Math.round((bounces / sessions) * 100) : 0;
    const targetId = targetIdForFact(fact);

    if (cost >= minSpend && clicks >= 10 && ctaClicks === 0) {
      candidates.push({
        fact_id: fact.id,
        tenant_id: fact.tenant_id || null,
        platform: fact.platform,
        request_type: 'pause_keyword',
        target_table: 'ad_landing_mappings',
        target_id: targetId,
        title: '비효율 키워드 중지 후보',
        reason: `${fact.keyword_text || '무명 키워드'}는 비용 ${cost.toLocaleString('ko-KR')}원을 사용했지만 CTA가 없습니다.`,
        risk_level: 'medium',
        proposed_change: { operational_status: 'paused', active: false, paused_reason: 'ad_os_bid_optimizer_no_cta' },
        expected_impact: { waste_reduction_krw: cost, cpa_krw: cpa, margin_roas_pct: marginRoas },
      });
      continue;
    }

    if (conversions > 0 && marginRoas !== null && marginRoas >= targetMarginRoas && cpa !== null && cpa <= targetCpa) {
      candidates.push({
        fact_id: fact.id,
        tenant_id: fact.tenant_id || null,
        platform: fact.platform,
        request_type: 'increase_bid',
        target_table: 'search_ad_keyword_plans',
        target_id: targetId,
        title: '성과 키워드 입찰 확대 후보',
        reason: `${fact.keyword_text || '무명 키워드'}는 CPA ${cpa.toLocaleString('ko-KR')}원, 마진 ROAS ${marginRoas}%로 목표를 통과했습니다.`,
        risk_level: 'high',
        proposed_change: { autopilot_status: 'testing', bid_adjustment_pct: 15, reason: 'ad_os_bid_optimizer_scale_winner' },
        expected_impact: { expected_more_conversions: true, cpa_krw: cpa, margin_roas_pct: marginRoas },
      });
      continue;
    }

    if (sessions >= 10 && bounceRate >= 70 && ctaClicks === 0) {
      candidates.push({
        fact_id: fact.id,
        tenant_id: fact.tenant_id || null,
        platform: fact.platform,
        request_type: fact.content_creative_id ? 'update_blog_cta' : 'replace_landing',
        target_table: fact.content_creative_id ? 'blog_content_versions' : 'ad_os_landing_evolution_queue',
        target_id: targetId,
        title: '랜딩/CTA 개선 후보',
        reason: `${fact.keyword_text || '랜딩'} 유입의 이탈률이 ${bounceRate}%이고 CTA가 없습니다.`,
        risk_level: 'low',
        proposed_change: { status: 'candidate', change_type: 'cta_refresh', reason: 'ad_os_bid_optimizer_high_bounce' },
        expected_impact: { bounce_rate_pct: bounceRate, cta_recovery: true },
      });
    }
  }

  return candidates;
}

export function decideExperimentRun(
  experiment: ExperimentForRun,
  facts: PerformanceFactForOptimization[],
  nowIso = new Date().toISOString(),
): ExperimentRunDecision {
  if (experiment.status === 'approved') {
    return {
      experiment_id: experiment.id,
      next_status: 'running',
      reason: '승인된 실험을 실행 상태로 전환합니다. 외부 광고 변경은 별도 change request가 필요합니다.',
      patch: { status: 'running', starts_at: nowIso, updated_at: nowIso },
    };
  }

  const minClicks = Number(experiment.minimum_sample?.clicks || 50);
  const totalClicks = facts.reduce((sum, fact) => sum + numeric(fact.clicks), 0);
  const totalCost = facts.reduce((sum, fact) => sum + numeric(fact.cost_krw), 0);
  const totalConversions = facts.reduce((sum, fact) => sum + Number(fact.conversions || 0), 0);
  const totalMargin = facts.reduce((sum, fact) => sum + Math.round(Number(fact.margin_krw || 0)), 0);
  const shouldComplete = experiment.status === 'running' && totalClicks >= minClicks;

  if (shouldComplete) {
    return {
      experiment_id: experiment.id,
      next_status: 'completed',
      reason: `최소 샘플 ${minClicks}클릭을 충족해 결과를 정리합니다.`,
      patch: {
        status: 'completed',
        ends_at: nowIso,
        updated_at: nowIso,
        result_summary: {
          clicks: totalClicks,
          cost_krw: totalCost,
          conversions: totalConversions,
          margin_krw: totalMargin,
          cpa_krw: totalConversions > 0 ? Math.round(totalCost / totalConversions) : null,
          margin_roas_pct: totalCost > 0 ? Math.round((totalMargin / totalCost) * 100) : null,
        },
      },
    };
  }

  return {
    experiment_id: experiment.id,
    next_status: 'running',
    reason: `아직 최소 샘플 ${minClicks}클릭 미만입니다.`,
    patch: { status: 'running', updated_at: nowIso },
  };
}

function naverMutationType(requestType: string): NaverExecutionGate['mutation_type'] {
  if (requestType === 'publish_paused_keyword' || requestType === 'create_keyword') return 'create_paused_keyword';
  if (requestType === 'activate_paused_keyword') return 'activate_keyword';
  if (requestType === 'pause_keyword') return 'pause_keyword';
  if (requestType === 'increase_bid' || requestType === 'decrease_bid' || requestType === 'budget_change') return 'update_bid';
  return 'dry_run';
}

export function gateNaverChangeRequests(
  requests: NaverChangeRequestForExecution[],
  mode: NaverExecutionMode,
  guards: { integrationReady: boolean; permissionOk: boolean; campaignReady: boolean; budgetReady: boolean; automationLevel: number },
): NaverExecutionGate[] {
  return requests.map((request) => {
    const mutationType = naverMutationType(request.request_type);
    const activeMutation = mutationType === 'activate_keyword' || mutationType === 'pause_keyword' || mutationType === 'update_bid';
    let allowed = request.status === 'approved';
    let reason = allowed ? 'approved_change_request' : 'change_request_not_approved';

    if (allowed && mode === 'dry_run') {
      allowed = false;
      reason = 'dry_run_only';
    }
    if (allowed && !guards.integrationReady) {
      allowed = false;
      reason = 'missing_naver_credentials';
    }
    if (allowed && !guards.permissionOk) {
      allowed = false;
      reason = 'naver_permission_not_ready';
    }
    if (allowed && !guards.campaignReady) {
      allowed = false;
      reason = 'naver_campaign_or_adgroup_missing';
    }
    if (allowed && !guards.budgetReady) {
      allowed = false;
      reason = 'budget_guard_not_ready';
    }
    if (allowed && mode === 'paused_only' && activeMutation) {
      allowed = false;
      reason = 'paused_only_blocks_active_mutation';
    }
    if (allowed && activeMutation && (mode !== 'active_allowed' || guards.automationLevel < 3)) {
      allowed = false;
      reason = 'limited_autopilot_required_for_active_mutation';
    }

    return {
      request_id: request.id,
      mutation_type: mutationType,
      allowed,
      reason,
      idempotency_key: `naver:${request.id}:${mode}`,
    };
  });
}
