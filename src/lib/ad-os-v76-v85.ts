type JsonRecord = Record<string, unknown>;

export type AdOsAdapterPlatform = 'naver' | 'google' | 'meta' | 'kakao';
export type AdapterState =
  | 'missing_credentials'
  | 'permission_denied'
  | 'no_campaign'
  | 'draft_ready'
  | 'paused_write_ready'
  | 'live_write_blocked'
  | 'executable'
  | 'blocked';

export type AdapterCapabilityInput = {
  platform: AdOsAdapterPlatform;
  tenantId?: string | null;
  credentialsReady: boolean;
  connectionStatus?: string | null;
  externalCampaignId?: string | null;
  externalAdGroupId?: string | null;
  budgetStatus?: string | null;
  monthlyBudgetKrw?: number | null;
  dailyBudgetCapKrw?: number | null;
  maxCpcKrw?: number | null;
  automationLevel?: number | null;
  canPublishKeywords?: boolean | null;
  canChangeBids?: boolean | null;
  canPauseAssets?: boolean | null;
  conversionReady?: boolean | null;
  fullAutoEnabled?: boolean | null;
  livePublishEnabled?: boolean | null;
};

export type AdapterCapability = {
  tenant_id: string | null;
  platform: AdOsAdapterPlatform;
  adapter_state: AdapterState;
  capability_level: number;
  credentials_ready: boolean;
  permission_ready: boolean;
  campaign_ready: boolean;
  budget_ready: boolean;
  conversion_ready: boolean;
  live_publish_enabled: boolean;
  external_api_write: false;
  blocked_reasons: string[];
  capabilities: {
    create_paused_keyword: boolean;
    create_campaign_draft: boolean;
    conversion_upload_draft: boolean;
    creative_seed: boolean;
    live_keyword_activation: boolean;
    bid_change: boolean;
    pause_asset: boolean;
  };
  recommended_action: string;
};

export type PlatformWritePacket = {
  tenant_id: string | null;
  platform: AdOsAdapterPlatform;
  packet_type:
    | 'naver_paused_keyword'
    | 'google_campaign_draft'
    | 'google_conversion_action_check'
    | 'meta_capi_test_event'
    | 'meta_creative_seed'
    | 'kakao_draft';
  lifecycle_status: 'planned' | 'ready' | 'blocked' | 'queued' | 'succeeded' | 'failed' | 'archived';
  job_id?: string | null;
  run_id?: string | null;
  idempotency_key: string;
  dry_run: true;
  external_api_write: false;
  request_payload: JsonRecord;
  guardrail_snapshot: JsonRecord;
  response_payload: JsonRecord;
  blocked_reason: string | null;
  rollback_payload: JsonRecord;
};

export type PacketSeed = {
  tenantId?: string | null;
  keyword?: string | null;
  landingUrl?: string | null;
  headline?: string | null;
  description?: string | null;
  campaignName?: string | null;
  adGroupName?: string | null;
  maxCpcKrw?: number | null;
  dailyBudgetKrw?: number | null;
  conversionActionName?: string | null;
  eventName?: string | null;
  eventId?: string | null;
  valueKrw?: number | null;
  creativeName?: string | null;
  primaryText?: string | null;
  callToAction?: string | null;
  productId?: string | null;
  scenarioId?: string | null;
  runId?: string | null;
};

function int(value: unknown): number {
  return Math.max(0, Math.round(Number(value || 0)));
}

function stableText(value: unknown, fallback: string): string {
  const text = String(value || '').trim();
  return text || fallback;
}

function keyPart(value: unknown): string {
  return stableText(value, 'none')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function hasBudget(input: AdapterCapabilityInput): boolean {
  return (
    input.budgetStatus === 'active' &&
    int(input.monthlyBudgetKrw) > 0 &&
    int(input.dailyBudgetCapKrw) > 0 &&
    int(input.maxCpcKrw) > 0
  );
}

function isPermissionReady(status?: string | null): boolean {
  return ['credentials_ready', 'no_campaign', 'ready', 'executable'].includes(String(status || ''));
}

function isPermissionDenied(status?: string | null): boolean {
  return ['permission_denied', 'denied', 'forbidden'].includes(String(status || ''));
}

function isCampaignReady(input: AdapterCapabilityInput): boolean {
  if (input.platform === 'meta') return Boolean(input.externalCampaignId) || isPermissionReady(input.connectionStatus);
  if (input.platform === 'google') return Boolean(input.externalCampaignId) || isPermissionReady(input.connectionStatus);
  return Boolean(input.externalCampaignId && input.externalAdGroupId);
}

export function buildChannelAdapterCapability(input: AdapterCapabilityInput): AdapterCapability {
  const permissionReady = isPermissionReady(input.connectionStatus) || (input.credentialsReady && !isPermissionDenied(input.connectionStatus));
  const campaignReady = isCampaignReady(input);
  const budgetReady = hasBudget(input);
  const automationLevel = int(input.automationLevel);
  const conversionReady = Boolean(input.conversionReady);
  const livePublishEnabled = Boolean(input.livePublishEnabled && input.fullAutoEnabled && automationLevel >= 3);
  const blockedReasons: string[] = [];

  if (!input.credentialsReady) blockedReasons.push('missing_credentials');
  if (isPermissionDenied(input.connectionStatus)) blockedReasons.push('permission_denied');
  if (!campaignReady && ['naver'].includes(input.platform)) blockedReasons.push('campaign_or_ad_group_missing');
  if (!budgetReady) blockedReasons.push('budget_guard_not_ready');
  if (automationLevel < 2) blockedReasons.push('approval_mode_required');
  if (livePublishEnabled && !Boolean(input.fullAutoEnabled)) blockedReasons.push('full_auto_disabled');

  const canDraft = input.credentialsReady && permissionReady;
  const canCreatePausedKeyword =
    input.platform === 'naver' &&
    canDraft &&
    campaignReady &&
    budgetReady &&
    automationLevel >= 2 &&
    input.canPublishKeywords !== false;
  const capabilities = {
    create_paused_keyword: canCreatePausedKeyword,
    create_campaign_draft: canDraft && ['google', 'naver'].includes(input.platform),
    conversion_upload_draft: canDraft && ['google', 'meta'].includes(input.platform) && conversionReady,
    creative_seed: canDraft && ['meta', 'google', 'naver'].includes(input.platform),
    live_keyword_activation: livePublishEnabled && canCreatePausedKeyword,
    bid_change: livePublishEnabled && Boolean(input.canChangeBids),
    pause_asset: livePublishEnabled && Boolean(input.canPauseAssets),
  };

  let adapterState: AdapterState = 'blocked';
  let recommendedAction = '채널 설정을 확인하세요.';
  if (!input.credentialsReady) {
    adapterState = 'missing_credentials';
    recommendedAction = '광고 API 키와 계정 ID를 먼저 연결하세요.';
  } else if (isPermissionDenied(input.connectionStatus)) {
    adapterState = 'permission_denied';
    recommendedAction = '광고 계정 권한과 customer/account 접근 권한을 다시 확인하세요.';
  } else if (!campaignReady && input.platform === 'naver') {
    adapterState = 'no_campaign';
    recommendedAction = '네이버 캠페인/광고그룹 ID를 연결하거나 세팅 패킷을 생성하세요.';
  } else if (canCreatePausedKeyword) {
    adapterState = livePublishEnabled ? 'executable' : 'paused_write_ready';
    recommendedAction = livePublishEnabled
      ? '승인된 change request만 제한 예산 안에서 실행할 수 있습니다.'
      : 'paused keyword 패킷 생성까지 가능하며 live 활성화는 차단됩니다.';
  } else if (canDraft && input.platform === 'google') {
    adapterState = 'draft_ready';
    recommendedAction = 'Google campaign draft와 conversion action 확인까지만 진행하세요.';
  } else if (canDraft && input.platform === 'meta') {
    adapterState = 'draft_ready';
    recommendedAction = 'Meta CAPI test event와 creative seed까지만 진행하세요.';
  } else if (canDraft) {
    adapterState = 'live_write_blocked';
    recommendedAction = '예산/자동화 레벨/캠페인 조건을 채워 paused write 단계로 올리세요.';
  }

  const capabilityLevel =
    adapterState === 'executable' ? 5 :
    adapterState === 'paused_write_ready' ? 4 :
    adapterState === 'draft_ready' ? 3 :
    adapterState === 'live_write_blocked' ? 2 :
    adapterState === 'no_campaign' ? 1 : 0;

  return {
    tenant_id: input.tenantId ?? null,
    platform: input.platform,
    adapter_state: adapterState,
    capability_level: capabilityLevel,
    credentials_ready: input.credentialsReady,
    permission_ready: permissionReady,
    campaign_ready: campaignReady,
    budget_ready: budgetReady,
    conversion_ready: conversionReady,
    live_publish_enabled: livePublishEnabled,
    external_api_write: false,
    blocked_reasons: blockedReasons,
    capabilities,
    recommended_action: recommendedAction,
  };
}

function basePacket(input: {
  capability: AdapterCapability;
  seed: PacketSeed;
  packetType: PlatformWritePacket['packet_type'];
  idempotencySuffix: string;
  requestPayload: JsonRecord;
  requiredCapability: keyof AdapterCapability['capabilities'];
  blockedFallback: string;
}): PlatformWritePacket {
  const ready = Boolean(input.capability.capabilities[input.requiredCapability]);
  const idempotencyKey = [
    input.packetType,
    input.capability.platform,
    keyPart(input.seed.productId || input.seed.keyword || input.seed.eventId || input.seed.campaignName),
    input.idempotencySuffix,
  ].join(':').slice(0, 240);

  return {
    tenant_id: input.seed.tenantId ?? input.capability.tenant_id,
    platform: input.capability.platform,
    packet_type: input.packetType,
    lifecycle_status: ready ? 'ready' : 'blocked',
    run_id: input.seed.runId ?? null,
    idempotency_key: idempotencyKey,
    dry_run: true,
    external_api_write: false,
    request_payload: input.requestPayload,
    guardrail_snapshot: {
      adapter_state: input.capability.adapter_state,
      capability_level: input.capability.capability_level,
      blocked_reasons: input.capability.blocked_reasons,
      live_publish_enabled: input.capability.live_publish_enabled,
      external_api_write: false,
    },
    response_payload: {
      dry_run: true,
      external_api_write: false,
      next_step: ready ? 'approval_queue_or_staging_executor' : input.capability.recommended_action,
    },
    blocked_reason: ready ? null : input.capability.blocked_reasons[0] || input.blockedFallback,
    rollback_payload: {},
  };
}

export function buildNaverPausedKeywordPacket(capability: AdapterCapability, seed: PacketSeed = {}): PlatformWritePacket {
  const keyword = stableText(seed.keyword, '부산출발 다낭 가족 패키지');
  const landingUrl = stableText(seed.landingUrl, '/blog/danang-family-package');
  const maxCpcKrw = int(seed.maxCpcKrw) || 300;

  return basePacket({
    capability,
    seed,
    packetType: 'naver_paused_keyword',
    requiredCapability: 'create_paused_keyword',
    idempotencySuffix: keyPart(`${keyword}:${landingUrl}:${maxCpcKrw}`),
    blockedFallback: 'naver_paused_keyword_not_ready',
    requestPayload: {
      keyword,
      final_url: landingUrl,
      max_cpc_krw: maxCpcKrw,
      dki_headline: stableText(seed.headline, `{keyword:다낭 패키지} 특가`),
      description: stableText(seed.description, '예약 전 발권기한과 포함사항을 확인하세요.'),
      paused: true,
      external_api_write: false,
    },
  });
}

export function buildGoogleCampaignDraftPacket(capability: AdapterCapability, seed: PacketSeed = {}): PlatformWritePacket {
  const campaignName = stableText(seed.campaignName, 'YSN Danang Longtail Draft');
  const adGroupName = stableText(seed.adGroupName, 'Danang scenario longtail');

  return basePacket({
    capability,
    seed,
    packetType: 'google_campaign_draft',
    requiredCapability: 'create_campaign_draft',
    idempotencySuffix: keyPart(`${campaignName}:${adGroupName}`),
    blockedFallback: 'google_draft_not_ready',
    requestPayload: {
      campaign_name: campaignName,
      ad_group_name: adGroupName,
      daily_budget_krw: int(seed.dailyBudgetKrw) || 10000,
      final_url: stableText(seed.landingUrl, '/blog/danang-package-guide'),
      keyword_seed: stableText(seed.keyword, '부산 부모님 다낭 여행'),
      rsa_headline: seed.headline ? stableText(seed.headline, '') : null,
      rsa_description: seed.description ? stableText(seed.description, '') : null,
      live_publish_disabled: true,
      external_api_write: false,
    },
  });
}

export function buildMetaCapiTestPacket(capability: AdapterCapability, seed: PacketSeed = {}): PlatformWritePacket {
  const eventName = stableText(seed.eventName, 'Lead');
  const eventId = stableText(seed.eventId, `dryrun-${Date.now()}`);

  return basePacket({
    capability,
    seed: { ...seed, eventId },
    packetType: 'meta_capi_test_event',
    requiredCapability: 'conversion_upload_draft',
    idempotencySuffix: keyPart(`${eventName}:${eventId}`),
    blockedFallback: 'meta_capi_test_not_ready',
    requestPayload: {
      event_name: eventName,
      event_id: eventId,
      value_krw: int(seed.valueKrw),
      action_source: 'website',
      test_event_code_required: true,
      external_api_write: false,
    },
  });
}

export function buildMetaCreativeSeedPacket(capability: AdapterCapability, seed: PacketSeed = {}): PlatformWritePacket {
  const creativeName = stableText(seed.creativeName || seed.campaignName, 'YSN Meta Creative Seed');
  const landingUrl = stableText(seed.landingUrl, '/blog/danang-family-package');
  const headline = stableText(seed.headline, 'Family trip offer');
  const primaryText = stableText(seed.primaryText || seed.description, 'Compare itinerary, inclusions, and booking fit before inquiry.');

  return basePacket({
    capability,
    seed,
    packetType: 'meta_creative_seed',
    requiredCapability: 'creative_seed',
    idempotencySuffix: keyPart(`${creativeName}:${landingUrl}:${headline}`),
    blockedFallback: 'meta_creative_seed_not_ready',
    requestPayload: {
      creative_name: creativeName,
      final_url: landingUrl,
      headline,
      primary_text: primaryText,
      description: seed.description ? stableText(seed.description, '') : null,
      call_to_action: stableText(seed.callToAction, 'LEARN_MORE'),
      asset_source: 'ad_os_creative_asset_variants',
      product_id: seed.productId || null,
      scenario_id: seed.scenarioId || null,
      live_publish_disabled: true,
      external_api_write: false,
    },
  });
}

export function summarizeAdapterCapabilities(capabilities: AdapterCapability[]) {
  const byState = capabilities.reduce<Record<string, number>>((acc, capability) => {
    acc[capability.adapter_state] = (acc[capability.adapter_state] || 0) + 1;
    return acc;
  }, {});
  return {
    platforms: capabilities.length,
    executable: capabilities.filter((capability) => capability.adapter_state === 'executable').length,
    paused_write_ready: capabilities.filter((capability) => capability.adapter_state === 'paused_write_ready').length,
    draft_ready: capabilities.filter((capability) => capability.adapter_state === 'draft_ready').length,
    blocked: capabilities.filter((capability) => ['missing_credentials', 'permission_denied', 'blocked'].includes(capability.adapter_state)).length,
    external_api_write_count: 0,
    by_state: byState,
  };
}
