export type ConversionEventForAttribution = {
  id: string;
  tenant_id?: string | null;
  event_type: string;
  event_time?: string | null;
  platform?: 'naver' | 'google' | 'meta' | 'kakao' | 'organic' | null;
  product_id?: string | null;
  scenario_id?: string | null;
  ad_landing_mapping_id?: string | null;
  content_creative_id?: string | null;
  ad_campaign_id?: string | null;
  ad_creative_id?: string | null;
  keyword_text?: string | null;
  search_term?: string | null;
  revenue_krw?: number | null;
  margin_krw?: number | null;
  cost_krw?: number | null;
  quarantine_status?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

export type NormalizedPerformanceFact = {
  tenant_id: string | null;
  product_id: string | null;
  scenario_id: string | null;
  ad_landing_mapping_id: string | null;
  content_creative_id: string | null;
  ad_campaign_id: string | null;
  ad_creative_id: string | null;
  platform: 'naver' | 'google' | 'meta' | 'kakao' | 'organic';
  keyword_text: string | null;
  search_term: string | null;
  source: 'conversion_events_attribution';
  event_date: string;
  impressions: number;
  clicks: number;
  cost_krw: number;
  cta_clicks: number;
  conversions: number;
  revenue_krw: number;
  margin_krw: number;
  bounces: number;
  sessions: number;
  avg_time_on_page_seconds: number;
  avg_scroll_depth_pct: number;
  metrics: Record<string, unknown>;
};

function dateOnly(value?: string | null): string {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function cleanText(value?: string | null): string | null {
  const out = String(value || '').trim().replace(/\s+/g, ' ');
  return out || null;
}

function safePlatform(value?: string | null): NormalizedPerformanceFact['platform'] {
  if (value === 'naver' || value === 'google' || value === 'meta' || value === 'kakao' || value === 'organic') return value;
  return 'organic';
}

function groupKey(event: ConversionEventForAttribution): string {
  return [
    event.tenant_id || '',
    event.product_id || '',
    event.scenario_id || '',
    event.ad_landing_mapping_id || '',
    event.content_creative_id || '',
    event.ad_campaign_id || '',
    event.ad_creative_id || '',
    safePlatform(event.platform),
    cleanText(event.keyword_text) || '',
    cleanText(event.search_term) || '',
    dateOnly(event.event_time),
  ].join('|');
}

export function normalizeConversionEventsToPerformanceFacts(events: ConversionEventForAttribution[]): NormalizedPerformanceFact[] {
  const groups = new Map<string, NormalizedPerformanceFact & { eventIds: string[]; eventTypeCounts: Record<string, number> }>();

  for (const event of events) {
    if (event.quarantine_status && event.quarantine_status !== 'clean') continue;

    const key = groupKey(event);
    const eventDate = dateOnly(event.event_time);
    const row = groups.get(key) || {
      tenant_id: event.tenant_id || null,
      product_id: event.product_id || null,
      scenario_id: event.scenario_id || null,
      ad_landing_mapping_id: event.ad_landing_mapping_id || null,
      content_creative_id: event.content_creative_id || null,
      ad_campaign_id: event.ad_campaign_id || null,
      ad_creative_id: event.ad_creative_id || null,
      platform: safePlatform(event.platform),
      keyword_text: cleanText(event.keyword_text),
      search_term: cleanText(event.search_term),
      source: 'conversion_events_attribution',
      event_date: eventDate,
      impressions: 0,
      clicks: 0,
      cost_krw: 0,
      cta_clicks: 0,
      conversions: 0,
      revenue_krw: 0,
      margin_krw: 0,
      bounces: 0,
      sessions: 0,
      avg_time_on_page_seconds: 0,
      avg_scroll_depth_pct: 0,
      metrics: {},
      eventIds: [],
      eventTypeCounts: {},
    };

    const eventType = event.event_type;
    row.eventIds.push(event.id);
    row.eventTypeCounts[eventType] = (row.eventTypeCounts[eventType] || 0) + 1;
    row.cost_krw += Math.max(0, Math.round(Number(event.cost_krw || 0)));
    row.revenue_krw += Math.max(0, Math.round(Number(event.revenue_krw || 0)));
    row.margin_krw += Math.round(Number(event.margin_krw || 0));

    if (eventType === 'impression') row.impressions += 1;
    if (eventType === 'click') row.clicks += 1;
    if (eventType === 'landing_view') row.sessions += 1;
    if (eventType === 'cta_click') row.cta_clicks += 1;
    if (['lead', 'booking', 'revenue', 'margin', 'settlement_confirmed'].includes(eventType)) row.conversions += eventType === 'lead' ? 0.25 : 1;
    if (eventType === 'cancel') row.metrics.cancel_events = Number(row.metrics.cancel_events || 0) + 1;

    groups.set(key, row);
  }

  return Array.from(groups.values()).map(({ eventIds, eventTypeCounts, ...row }) => ({
    ...row,
    metrics: {
      ...row.metrics,
      attribution_basis: 'conversion_events',
      source_event_count: eventIds.length,
      source_event_ids: eventIds.slice(0, 50),
      event_type_counts: eventTypeCounts,
      margin_roas_pct: row.cost_krw > 0 ? Math.round((row.margin_krw / row.cost_krw) * 100) : null,
      cpa_krw: row.conversions > 0 ? Math.round(row.cost_krw / row.conversions) : null,
    },
  }));
}

export type ExternalMutationAuditInput = {
  runId: string;
  platform: 'naver' | 'google' | 'meta' | 'kakao';
  mode: 'dry_run' | 'guarded' | 'full';
  canPublish: boolean;
  changeRequest: {
    id: string;
    tenant_id?: string | null;
    request_type?: string | null;
    proposed_change?: Record<string, unknown> | null;
  };
  account?: {
    external_account_id?: string | null;
    external_campaign_id?: string | null;
    external_ad_group_id?: string | null;
  } | null;
  errorMessage?: string | null;
};

function mutationTypeForRequest(requestType?: string | null): string {
  if (requestType === 'create_campaign') return 'create_campaign';
  if (requestType === 'publish_paused_keyword' || requestType === 'create_keyword') return 'create_paused_keyword';
  if (requestType === 'pause_keyword') return 'pause_keyword';
  if (requestType === 'increase_bid' || requestType === 'decrease_bid' || requestType === 'budget_change') return 'update_bid';
  if (requestType === 'sync_external_asset') return 'sync_asset';
  return 'dry_run';
}

export function buildExternalMutationAuditRow(input: ExternalMutationAuditInput) {
  const mutationType = mutationTypeForRequest(input.changeRequest.request_type);
  const auditMode = input.mode === 'full'
    ? 'active_allowed'
    : input.mode === 'guarded'
      ? 'paused_only'
      : 'dry_run';
  return {
    tenant_id: input.changeRequest.tenant_id || null,
    platform: input.platform,
    mutation_type: mutationType,
    mode: auditMode,
    status: input.canPublish ? (input.mode === 'dry_run' ? 'planned' : 'requested') : 'blocked',
    change_request_id: input.changeRequest.id,
    run_id: input.runId,
    external_account_id: input.account?.external_account_id || null,
    external_campaign_id: input.account?.external_campaign_id || null,
    external_ad_group_id: input.account?.external_ad_group_id || null,
    external_keyword_id: null,
    idempotency_key: `${input.platform}:${input.changeRequest.id}:${auditMode}`,
    request_payload: {
      request_type: input.changeRequest.request_type || null,
      proposed_change: input.changeRequest.proposed_change || {},
      external_spend_allowed: false,
    },
    response_payload: {
      external_api_write: false,
      channel_publisher_required: input.canPublish,
    },
    error_message: input.canPublish ? null : input.errorMessage || 'channel_gate_blocked',
  };
}

export function buildAttributionSummary(facts: NormalizedPerformanceFact[]) {
  const clicks = facts.reduce((sum, row) => sum + row.clicks, 0);
  const ctaClicks = facts.reduce((sum, row) => sum + row.cta_clicks, 0);
  const conversions = facts.reduce((sum, row) => sum + Number(row.conversions || 0), 0);
  const costKrw = facts.reduce((sum, row) => sum + row.cost_krw, 0);
  const revenueKrw = facts.reduce((sum, row) => sum + row.revenue_krw, 0);
  const marginKrw = facts.reduce((sum, row) => sum + row.margin_krw, 0);
  return {
    facts_prepared: facts.length,
    clicks,
    cta_clicks: ctaClicks,
    conversions,
    cost_krw: costKrw,
    revenue_krw: revenueKrw,
    margin_krw: marginKrw,
    cta_rate_pct: clicks > 0 ? Math.round((ctaClicks / clicks) * 1000) / 10 : 0,
    margin_roas_pct: costKrw > 0 ? Math.round((marginKrw / costKrw) * 100) : 0,
    cpa_krw: conversions > 0 ? Math.round(costKrw / conversions) : 0,
  };
}
