import { NextResponse } from 'next/server';
import { buildAdOsReadinessAudit } from '@/lib/ad-os-readiness';
import {
  AD_OS_AUTOMATION_MODES,
  automationLevelToMode,
  buildTenantRiskGuardrails,
  classifyChannelExecutionState,
} from '@/lib/ad-os-governance';
import { buildTenantAdReadiness } from '@/lib/ad-os-tenant-readiness';
import { buildAdOsIncidentSummary } from '@/lib/ad-os-v321-v340';
import { buildAgencyReportingSummary } from '@/lib/ad-os-v341-v360';
import { buildAdOsCompletionAuditSummary } from '@/lib/ad-os-v361-v380';
import { withAdminGuard } from '@/lib/admin-guard';
import { withTimeout } from '@/lib/promise-timeout';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import type { LaunchActionKey, Summary } from '@/app/admin/ad-os/_lib/types';

export const dynamic = 'force-dynamic';
const AD_OS_SUMMARY_TIMEOUT_MS = 15000;

const PLATFORMS = ['naver', 'google', 'meta', 'kakao'] as const;

function sum<T>(rows: T[], pick: (row: T) => number | null | undefined): number {
  return rows.reduce((acc, row) => acc + Number(pick(row) || 0), 0);
}

function byKey<T>(rows: T[], pick: (row: T) => string | null | undefined): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = pick(row) || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function payloadFlag(row: { response_payload?: unknown }, key: string): boolean {
  return asRecord(row.response_payload)[key] === true;
}

function conversionPayloadFlag(row: { quality_flags?: unknown; raw_payload?: unknown }, key: string): boolean {
  return asRecord(row.quality_flags)[key] === true || asRecord(row.raw_payload)[key] === true;
}

function sampleQueueRow(input: {
  id: string | null | undefined;
  source: string;
  platform: string | null | undefined;
  status: string | null | undefined;
  title: string | null | undefined;
  reason?: string | null | undefined;
  next_action: string;
  created_at?: string | null | undefined;
}) {
  return {
    id: input.id || '',
    source: input.source,
    platform: input.platform || 'internal',
    status: input.status || 'unknown',
    title: input.title || input.source,
    reason: input.reason || null,
    next_action: input.next_action,
    created_at: input.created_at || null,
  };
}

function hasAllSecrets(names: string[]): boolean {
  return names.every((name) => Boolean(getSecret(name as never)));
}

function hasAnySecret(names: string[]): boolean {
  return names.some((name) => Boolean(getSecret(name as never)));
}

function buildExternalLaunchStatus(input: {
  integrationStatus: Record<string, boolean>;
  channelBudgets: Array<{
    platform: string;
    monthly_budget_krw: number;
    daily_budget_cap_krw: number;
    status: string;
    external_campaign_id?: string | null;
    external_ad_group_id?: string | null;
  }>;
  tenantAdAccounts: Array<{
    platform: string | null;
    connection_status: string | null;
    external_campaign_id?: string | null;
    external_ad_group_id?: string | null;
    can_publish_keywords?: boolean | null;
  }>;
  keywordStatusCounts: Record<string, number>;
  draftCampaigns: number;
}) {
  const approvedOrTestingKeywords =
    Number(input.keywordStatusCounts.approved || 0) +
    Number(input.keywordStatusCounts.testing || 0) +
    Number(input.keywordStatusCounts.active || 0);
  const naverBudget = input.channelBudgets.find((budget) => budget.platform === 'naver');
  const googleBudget = input.channelBudgets.find((budget) => budget.platform === 'google');
  const naverAccount = input.tenantAdAccounts.find((account) => account.platform === 'naver');
  const googleAccount = input.tenantAdAccounts.find((account) => account.platform === 'google');
  const naverPermissionReady = ['credentials_ready', 'no_campaign', 'ready'].includes(naverAccount?.connection_status || '');
  const googlePermissionReady = ['credentials_ready', 'no_campaign', 'ready'].includes(googleAccount?.connection_status || '');
  const naverCampaignId = naverBudget?.external_campaign_id || naverAccount?.external_campaign_id;
  const naverAdGroupId = naverBudget?.external_ad_group_id || naverAccount?.external_ad_group_id;
  const hasNaverBudget = Boolean(
    naverBudget &&
      naverBudget.status === 'active' &&
      Number(naverBudget.monthly_budget_krw || 0) > 0 &&
      Number(naverBudget.daily_budget_cap_krw || 0) > 0,
  );
  const hasGoogleBudget = Boolean(
    googleBudget &&
      googleBudget.status === 'active' &&
      Number(googleBudget.monthly_budget_krw || 0) > 0 &&
      Number(googleBudget.daily_budget_cap_krw || 0) > 0,
  );
  const naverChecks = [
    { id: 'api', label: 'API 키', done: Boolean(input.integrationStatus.naver), next: 'NAVER_ADS_API_KEY/SECRET/CUSTOMER_ID 설정' },
    { id: 'permission', label: '권한 감사', done: naverPermissionReady, next: '외부 계정 테스트 또는 네이버 자산 자동저장 실행' },
    { id: 'budget', label: '예산', done: hasNaverBudget, next: '네이버 월예산/일상한/Max CPC 활성화' },
    { id: 'adgroup', label: '광고그룹 ID', done: Boolean(naverCampaignId && naverAdGroupId), next: '네이버 광고센터에서 캠페인/비즈채널/광고그룹 생성 후 자산 자동저장' },
    { id: 'keywords', label: '승인 키워드', done: approvedOrTestingKeywords > 0, next: '네이버 후보 승인 또는 1단계 시범 세팅' },
    { id: 'drafts', label: '내부 드래프트', done: input.draftCampaigns > 0, next: '캠페인 드래프트 생성' },
  ];
  const googleChecks = [
    { id: 'api', label: 'API/OAuth', done: Boolean(input.integrationStatus.google), next: 'Google Ads OAuth 권한 확인' },
    { id: 'permission', label: '권한 감사', done: googlePermissionReady, next: '외부 계정 테스트에서 Google Ads PERMISSION_DENIED 해소' },
    { id: 'budget', label: '예산', done: hasGoogleBudget, next: '구글 월예산/일상한/Max CPC 활성화' },
    { id: 'keywords', label: '승인 키워드', done: approvedOrTestingKeywords > 0, next: '구글 후보 승인' },
    { id: 'drafts', label: '내부 드래프트', done: input.draftCampaigns > 0, next: '캠페인 드래프트 생성' },
  ];
  const naverMissing = naverChecks.filter((check) => !check.done);
  const googleMissing = googleChecks.filter((check) => !check.done);

  return {
    naver: {
      ready: naverMissing.length === 0,
      pass: naverChecks.length - naverMissing.length,
      total: naverChecks.length,
      checks: naverChecks,
      next_action: naverMissing[0]?.next || '네이버 limited pilot 점검 후 감사된 executor만 사용',
    },
    google: {
      ready: googleMissing.length === 0,
      pass: googleChecks.length - googleMissing.length,
      total: googleChecks.length,
      checks: googleChecks,
      next_action: googleMissing[0]?.next || 'Google Ads 권한 감사 후 guarded publisher 실행',
    },
    approved_or_testing_keywords: approvedOrTestingKeywords,
  };
}

function buildLaunchActionQueue(input: {
  externalLaunchStatus: ReturnType<typeof buildExternalLaunchStatus>;
  keywordCandidates: number;
  keywordClusters: number;
  pendingExternalMutations: number;
  approvedOrTestingKeywords: number;
  draftCampaigns: number;
  activeSearchBudgetChannels: number;
  learningEventCount: number;
  conversionEvents: number;
  performanceFacts: number;
  productScenarioCandidates: number;
  landingEvolutionCandidates: number;
}) {
  const actions: Array<{
    id: string;
    priority: number;
    label: string;
    description: string;
    button_label: string;
    ui_action: LaunchActionKey;
    tone: 'good' | 'warn' | 'bad' | 'neutral';
  }> = [];

  if (input.activeSearchBudgetChannels === 0 || input.approvedOrTestingKeywords === 0 || input.draftCampaigns === 0) {
    actions.push({
      id: 'pilot_setup',
      priority: 1,
      label: '1단계 시범 세팅',
      description: '네이버/구글 소액 예산, 승인 키워드, 내부 캠페인 드래프트를 한 번에 준비합니다. 외부 광고비는 쓰지 않습니다.',
      button_label: '1단계 시범 세팅',
      ui_action: 'runPilotSetup',
      tone: 'good',
    });
  }

  if (!input.externalLaunchStatus.naver.ready) {
    if (input.externalLaunchStatus.naver.pass >= 3 && input.pendingExternalMutations === 0) {
      actions.push({
        id: 'naver_create_assets',
        priority: 2,
        label: '네이버 외부 자산 요청',
        description: '캠페인/비즈채널/광고그룹/paused 키워드 생성을 승인형 변경요청으로 만듭니다. 외부 광고비는 0원입니다.',
        button_label: '자산 요청 생성',
        ui_action: 'createNaverAssets',
        tone: 'warn',
      });
    }
    actions.push({
      id: 'naver_setup_packet',
      priority: input.externalLaunchStatus.naver.pass >= 4 ? 3 : 4,
      label: '네이버 세팅 패킷',
      description: '네이버 광고센터에서 만들 캠페인/광고그룹/예산/키워드 샘플을 먼저 뽑습니다.',
      button_label: '세팅 패킷 생성',
      ui_action: 'generateNaverSetupPacket',
      tone: input.externalLaunchStatus.naver.pass >= 4 ? 'warn' : 'neutral',
    });
    actions.push({
      id: 'naver_assets',
      priority: input.externalLaunchStatus.naver.pass >= 4 ? 3 : 5,
      label: '네이버 외부 자산 연결',
      description: input.externalLaunchStatus.naver.next_action,
      button_label: '네이버 자산 자동저장',
      ui_action: 'syncNaverAssets',
      tone: input.externalLaunchStatus.naver.pass >= 4 ? 'warn' : 'neutral',
    });
  }

  if (!input.externalLaunchStatus.google.ready) {
    actions.push({
      id: 'google_permission',
      priority: input.externalLaunchStatus.google.pass >= 4 ? 4 : 6,
      label: '구글 권한 감사',
      description: input.externalLaunchStatus.google.next_action,
      button_label: '외부 계정 테스트',
      ui_action: 'probePublisher',
      tone: 'warn',
    });
  }

  if (input.keywordCandidates === 0) {
    actions.push({
      id: 'generate_candidates',
      priority: 6,
      label: '상품 후보 생성',
      description: '상품별 초세부 키워드 후보가 없으므로 먼저 후보를 생성해야 합니다.',
      button_label: '상품 후보 생성',
      ui_action: 'generateCandidates',
      tone: 'neutral',
    });
  }

  if (input.keywordClusters === 0) {
    actions.push({
      id: 'keyword_brain',
      priority: 5,
      label: '초세부 키워드 Brain',
      description: '상품 팩트, 검색어, 실패어를 묶어 부모님/출발지/항공/불안해소형 longtail cluster를 만듭니다.',
      button_label: 'Keyword Brain',
      ui_action: 'runKeywordBrain',
      tone: 'good',
    });
  }

  if (input.learningEventCount > 0) {
    actions.push({
      id: 'learning_harvest',
      priority: 7,
      label: '성과 학습 반영',
      description: '누적된 학습 신호를 다음 키워드/랜딩 후보에 반영합니다.',
      button_label: '성과 학습 수확',
      ui_action: 'harvestLearning',
      tone: 'neutral',
    });
  }

  if (input.conversionEvents > 0 && input.performanceFacts === 0) {
    actions.push({
      id: 'conversion_attribution',
      priority: 6,
      label: '전환 attribution',
      description: '클릭/CTA/예약 이벤트는 있으나 학습용 성과 팩트가 비어 있습니다. 이벤트를 상품·키워드·블로그 단위로 묶습니다.',
      button_label: '전환 attribution',
      ui_action: 'runConversionAttribution',
      tone: 'good',
    });
  }

  if (input.productScenarioCandidates === 0) {
    actions.push({
      id: 'product_autopilot',
      priority: 6,
      label: '상품별 시나리오 생성',
      description: '상품 등록 후 고객 의도/랜딩/키워드 시나리오가 비어 있습니다. 승인 상품을 Ad OS V2 파이프라인에 태워야 합니다.',
      button_label: '상품 후보 생성',
      ui_action: 'generateCandidates',
      tone: 'neutral',
    });
  }

  if (input.landingEvolutionCandidates > 0) {
    actions.push({
      id: 'landing_evolution',
      priority: 7,
      label: '블로그 진화 큐 검토',
      description: '성과와 상품 만료에 따라 CTA 교체, 기존 글 업데이트, 신규 글 생성 후보가 쌓여 있습니다.',
      button_label: '성과 학습 수확',
      ui_action: 'harvestLearning',
      tone: 'neutral',
    });
  }

  actions.push({
    id: 'launch_audit',
    priority: 8,
    label: '오늘 집행 감사',
    description: '실제 외부 광고를 켜기 전에 API, 예산, 승인 키워드, 드래프트, 외부 자산을 다시 점검합니다.',
    button_label: '오늘 집행 감사',
    ui_action: 'runLaunchAudit',
    tone: 'neutral',
  });

  actions.push({
    id: 'kill_switch',
    priority: 9,
    label: '전체 정지 점검',
    description: '자동화가 멈춰야 할 때 어떤 예산/키워드/랜딩이 정지 대상인지 확인합니다. 기본은 드라이런입니다.',
    button_label: '전체 정지 점검',
    ui_action: 'runKillSwitchDryRun',
    tone: 'bad',
  });

  return actions
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 5);
}

function buildDegradedSummary(error: unknown) {
  const message = error instanceof Error ? error.message : 'Ad OS summary unavailable';
  const integrationStatus = {
    naver: hasAllSecrets(['NAVER_ADS_API_KEY', 'NAVER_ADS_SECRET_KEY', 'NAVER_ADS_CUSTOMER_ID']),
    google: hasAllSecrets(['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET']),
    meta: hasAnySecret(['META_ACCESS_TOKEN', 'META_ADS_ACCESS_TOKEN']) && hasAllSecrets(['META_AD_ACCOUNT_ID']),
    kakao: false,
  };

  const launchActionQueue: Summary['launch_action_queue'] = [
    {
      id: 'data_plane_recover',
      priority: 1,
      label: '데이터 연결 복구',
      description: 'Supabase 응답 지연 중에는 외부 광고 집행을 켜지 않습니다.',
      button_label: '상태 새로고침',
      ui_action: 'refresh',
      tone: 'bad',
    },
  ];

  return {
    ok: true,
    degraded: true,
    reason: message.toLowerCase().includes('supabase') ? 'supabase_unconfigured' : 'summary_degraded',
    error: message,
    generated_at: new Date().toISOString(),
    kpis: {
      mapping_candidates: 0,
      keyword_candidates: 0,
      live_mappings: 0,
      landing_blogs: 0,
      published_blogs: 0,
      tracked_clicks: 0,
      tracked_cta_clicks: 0,
      tracked_conversions: 0,
      tracked_spend_krw: 0,
      tracked_roas_pct: 0,
      configured_monthly_budget_krw: 0,
      draft_campaigns: 0,
      active_campaigns: 0,
      learning_events: 0,
      search_term_candidates: 0,
      tenant_ad_accounts: 0,
      tenant_ad_accounts_ready: 0,
      change_requests_proposed: 0,
      change_requests_high_risk: 0,
    },
    counts: {},
    readiness_audit: {
      ready: false,
      score: 0,
      blockers: ['Supabase 응답 지연으로 Ad OS 상태를 확인하지 못했습니다.'],
      warnings: [],
      next_actions: ['외부 광고 집행은 자동 차단 상태로 유지하고 DB 연결 회복 후 다시 확인하세요.'],
    },
    learning_loop: {
      scope: ['blog_landing', 'keyword', 'product', 'tenant'],
      metrics: {
        clicks: 0,
        cta_clicks: 0,
        conversions: 0,
        spend_krw: 0,
        conversion_value_krw: 0,
        cpa_krw: 0,
        roas_pct: 0,
        cta_rate_pct: 0,
        conversion_rate_pct: 0,
        bounce_rate_pct: null,
        engagement_sessions_30d: 0,
        avg_time_on_page_seconds: 0,
        avg_scroll_depth_pct: 0,
      },
      status: {
        has_click_signal: false,
        has_cta_signal: false,
        has_booking_signal: false,
        has_cost_signal: false,
        bounce_tracking_ready: false,
      },
      next_action: 'DB 연결 회복 후 CPA/ROAS 학습 루프를 재계산합니다.',
    },
    channel_budgets: PLATFORMS.map((platform) => ({
      platform,
      configured: false,
      monthly_budget_krw: 0,
      daily_budget_cap_krw: 0,
      max_cpc_krw: 0,
      max_test_loss_krw: 0,
      automation_level: 1,
      status: 'paused',
      external_account_id: null,
      external_campaign_id: null,
      external_ad_group_id: null,
      external_config_note: null,
    })),
    integration_status: integrationStatus,
    channel_execution_states: {
      naver: {
        label: '네이버',
        tone: 'bad',
        canSpend: false,
        summary: '상태 확인 불가',
        nextAction: 'Supabase 연결 회복 후 네이버 집행 준비도를 다시 확인하세요.',
      },
      google: {
        label: '구글',
        tone: 'bad',
        canSpend: false,
        summary: '상태 확인 불가',
        nextAction: 'Supabase 연결 회복 후 구글 집행 준비도를 다시 확인하세요.',
      },
    },
    active_automation_modes: PLATFORMS.map((platform) => ({
      platform,
      level: 1,
      mode: 'recommendation',
      status: 'paused',
    })),
    automation_modes: AD_OS_AUTOMATION_MODES,
    tenant_guardrails: [
      {
        key: 'data_plane',
        label: '데이터 연결',
        status: 'fail',
        message,
      },
    ],
    enterprise_layer: {
      incident_response: {
        total: 1,
        critical: 1,
        high: 0,
        medium: 0,
        low: 0,
        open: 1,
        watch: 0,
        kill_switch_recommended: true,
        top_next_action: 'Supabase 연결 회복 전에는 외부 광고 집행을 승인하지 마세요.',
        alerts: [{
          id: 'summary_degraded',
          severity: 'critical',
          status: 'open',
          category: 'runtime_readiness',
          title: 'Ad OS summary degraded',
          reason: message,
          next_action: 'Supabase 연결과 admin API 응답을 복구한 뒤 다시 점검하세요.',
          evidence: { degraded: true },
        }],
      },
      agency_reporting: {
        status: 'blocked',
        readiness_score: 0,
        workspaces: 0,
        billable_tenants: 0,
        active_billing_profiles: 0,
        monthly_reports: 0,
        ready_or_draft_reports: 0,
        audit_exports: 0,
        ready_audit_exports: 0,
        full_auto_enabled: 0,
        open_incidents: 1,
        missing: ['data_plane'],
        next_action: 'Supabase 연결 회복 후 테넌트 리포트와 audit export 상태를 다시 계산하세요.',
      },
      completion_audit: buildAdOsCompletionAuditSummary({
        platformJobQueue: { total: 0, blocked: 1, external_api_write_count: 0 },
        runtimeExecution: { total: 0, blocked: 1, external_api_write_count: 0 },
        channelAdapters: { snapshots: 0, blocked: 1, external_api_write_count: 0 },
        conversionDataQuality: { status: 'blocked', uploadable_conversions: 0, blocked_conversions: 1 },
        learningLoop: { status: { attribution_ready: false, margin_learning_ready: false } },
        tenantPolicy: { configured: false, full_auto_enabled: false },
        incidentResponse: { critical: 1, high: 0, open: 1, kill_switch_recommended: true },
        agencyReporting: { status: 'blocked', readiness_score: 0, full_auto_enabled: 0 },
        runtimeReadiness: { checks: 0, blocked_or_failed: 1, critical: 1 },
      }),
    },
    tenant_policy: {
      configured: false,
      error: message,
      tenant_id: null,
      allowed_platforms: ['naver', 'google'],
      monthly_budget_cap_krw: 0,
      daily_budget_cap_krw: 0,
      max_cpc_krw: 0,
      max_test_loss_krw: 0,
      max_automation_level: 1,
      require_human_approval: true,
      full_auto_enabled: false,
      risk_status: 'blocked',
    },
    tenant_ad_readiness: [],
    launch_action_queue: launchActionQueue,
    recent_decisions: [],
    expiring_packages: [],
    samples: {
      mappings: [],
      keyword_plans: [],
      learning_events: [],
      search_term_candidates: [],
      product_scenarios: [],
      landing_evolution_queue: [],
      budget_pacing: [],
      tenant_ad_accounts: [],
      change_requests: [],
      campaign_memories: [],
    },
  };
}

async function buildSummaryResponse() {
  if (!isSupabaseConfigured) {
    return NextResponse.json(buildDegradedSummary(new Error('Supabase unconfigured')));
  }

  const [
    mappingRes,
    keywordPlanRes,
    budgetRes,
    decisionRes,
    expiringPackageRes,
    contentRes,
    campaignRes,
    learningRes,
    searchTermCandidateRes,
    blogEngagementRes,
    tenantGovernanceRes,
    productScenarioRes,
    landingEvolutionRes,
    budgetPacingRes,
    tenantAdAccountRes,
    changeRequestRes,
    keywordClusterRes,
    externalMutationRes,
    tenantReportRes,
    conversionEventRes,
    performanceFactRes,
    experimentRes,
    blogVersionRes,
    platformJobRes,
    conversionUploadJobRes,
    dataQualitySnapshotRes,
    portfolioPlanRes,
    creativeAssetVariantRes,
    travelIntentSignalRes,
    tenantWorkspaceRes,
    tenantBillingProfileRes,
    runtimeReadinessRes,
    executionAttemptRes,
    experimentTemplateRes,
    tenantAuditExportRes,
    channelAdapterHealthRes,
    platformWritePacketRes,
    adapterExecutionGateRes,
    rollbackDrillRes,
    limitedWritePilotPolicyRes,
    limitedWritePilotAttemptRes,
    campaignMemoryRes,
  ] = await Promise.all([
    supabaseAdmin
      .from('ad_landing_mappings')
      .select('id, platform, keyword, operational_status, active, clicks, cta_clicks, conversions, conversion_value_krw, created_at, content_creative_id')
      .order('created_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('search_ad_keyword_plans')
      .select('id, platform, keyword_text, tier, match_type, autopilot_status, plan_status, suggested_bid_krw, monthly_search_volume, competition_level, package_id, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('*')
      .order('platform', { ascending: true }),
    supabaseAdmin
      .from('ad_os_decision_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(25),
    supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, ticketing_deadline, status, price, commission_fixed_amount, commission_rate')
      .not('ticketing_deadline', 'is', null)
      .gte('ticketing_deadline', new Date().toISOString().slice(0, 10))
      .lte('ticketing_deadline', new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10))
      .order('ticketing_deadline', { ascending: true })
      .limit(20),
    supabaseAdmin
      .from('content_creatives')
      .select('id, status, landing_enabled, destination, published_at')
      .eq('channel', 'naver_blog')
      .order('published_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('ad_campaigns')
      .select('id, channel, status, daily_budget_krw, total_spend_krw, created_at')
      .in('channel', ['naver', 'google', 'meta'])
      .order('created_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('ad_os_learning_events')
      .select('id, signal_type, status, score, recommendation, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_search_term_candidates')
      .select('id, platform, search_term, action, priority, score, status, reason, created_at')
      .order('score', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('blog_engagement_logs')
      .select('content_creative_id, time_on_page_seconds, max_scroll_depth_pct, cta_clicked, created_at')
      .gte('created_at', new Date(Date.now() - 30 * 86400_000).toISOString())
      .eq('event_type', 'summary')
      .order('created_at', { ascending: false })
      .limit(1000),
    supabaseAdmin
      .from('ad_os_tenant_governance')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1),
    supabaseAdmin
      .from('ad_os_product_scenarios')
      .select('id, scenario_type, funnel_stage, landing_strategy, status, priority, recommended_channel, created_at')
      .order('priority', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('ad_os_landing_evolution_queue')
      .select('id, action, status, priority, reason, created_at')
      .order('priority', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('ad_os_budget_pacing_snapshots')
      .select('id, platform, status, recommended_action, pace_ratio, actual_spend_krw, expected_spend_krw, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_tenant_ad_accounts')
      .select('id, platform, account_mode, connection_status, external_account_id, external_customer_id, external_campaign_id, external_ad_group_id, monthly_budget_cap_krw, daily_budget_cap_krw, can_publish_keywords, can_change_bids, can_pause_assets, risk_status')
      .order('platform', { ascending: true })
      .limit(100),
    supabaseAdmin
      .from('ad_os_change_requests')
      .select('id, request_type, target_table, target_id, status, risk_level, platform, title, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_keyword_clusters')
      .select('id, platform, keyword_text, tier, intent, status, score, suggested_bid_krw, created_at')
      .order('score', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_external_mutation_results')
      .select('id, platform, mutation_type, mode, status, external_campaign_id, external_ad_group_id, error_message, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_tenant_reports')
      .select('id, tenant_id, period_start, period_end, report_type, status, metrics, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('ad_os_conversion_events')
      .select('id, event_type, platform, quarantine_status, revenue_krw, margin_krw, cost_krw, quality_flags, raw_payload, event_time')
      .gte('event_time', new Date(Date.now() - 30 * 86400_000).toISOString())
      .order('event_time', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('ad_os_performance_facts')
      .select('id, platform, source, clicks, cta_clicks, conversions, cost_krw, revenue_krw, margin_krw, event_date')
      .gte('event_date', new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10))
      .order('event_date', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('ad_os_experiments')
      .select('id, experiment_type, name, platform, primary_metric, status, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('blog_content_versions')
      .select('id, slug, change_type, status, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_platform_jobs')
      .select('id, platform, job_type, status, guardrail_status, blocked_reason, automation_level, external_api_write, response_payload, change_request_id, external_mutation_result_id, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_conversion_upload_jobs')
      .select('id, platform, event_name, status, signal_quality_score, blocked_reason, response_payload, external_upload_id, uploaded_at, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_data_quality_snapshots')
      .select('id, tenant_id, period_start, period_end, status, events_total, clean_events, upload_ready_events, blocked_upload_events, attribution_coverage_pct, margin_coverage_pct, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
    supabaseAdmin
      .from('ad_os_portfolio_budget_plans')
      .select('id, platform, plan_type, status, confidence, current_budget_krw, recommended_budget_krw, expected_margin_krw, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_creative_asset_variants')
      .select('id, platform, asset_type, lifecycle_status, angle, audience, fatigue_score, ctr_decay_pct, cpa_trend_pct, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_travel_intent_signals')
      .select('id, destination, intent_key, intent_type, status, keyword_text, suggested_budget_cap_krw, cannibalization_risk, duplicate_content_risk, score, created_at')
      .order('score', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('tenant_ad_workspaces')
      .select('id, tenant_id, workspace_name, monthly_budget_cap_krw, daily_budget_cap_krw, max_cpc_krw, automation_level, require_human_approval, full_auto_enabled, audit_export_enabled, risk_status, billing_plan, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_tenant_billing_profiles')
      .select('id, tenant_id, workspace_id, billing_plan, invoice_status, base_subscription_krw, managed_spend_fee_pct, performance_fee_pct, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_runtime_readiness_checks')
      .select('id, tenant_id, check_key, surface, status, severity, next_action, checked_at')
      .order('checked_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_execution_attempts')
      .select('id, platform, attempt_type, status, dry_run, external_api_write, blocked_reason, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_experiment_templates')
      .select('id, tenant_id, template_key, experiment_type, primary_metric, minimum_clicks, minimum_conversions, minimum_days, confidence_threshold, status, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_tenant_audit_exports')
      .select('id, tenant_id, workspace_id, period_start, period_end, status, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_channel_adapter_health')
      .select('id, tenant_id, platform, adapter_state, capability_level, credentials_ready, permission_ready, campaign_ready, budget_ready, conversion_ready, live_publish_enabled, external_api_write, blocked_reasons, capabilities, recommended_action, checked_at')
      .order('checked_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_platform_write_packets')
      .select('id, tenant_id, platform, packet_type, lifecycle_status, dry_run, external_api_write, blocked_reason, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_adapter_execution_gates')
      .select('id, tenant_id, platform, gate_status, requested_mode, allowed_mode, risk_level, risk_score, external_api_write, next_action, evaluated_at')
      .order('evaluated_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_rollback_drills')
      .select('id, tenant_id, platform, drill_status, rollback_type, external_api_write, blocked_reason, drilled_at')
      .order('drilled_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_limited_write_pilot_policies')
      .select('id, tenant_id, platform, status, pilot_level, monthly_budget_cap_krw, daily_budget_cap_krw, max_cpc_krw, max_test_loss_krw, live_external_write_enabled, updated_at')
      .order('updated_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('ad_os_limited_write_pilot_attempts')
      .select('id, tenant_id, platform, requested_mode, attempt_status, external_api_write, blockers, next_action, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_campaign_memories')
      .select('id, tenant_id, workspace_id, memory_key, status, score, purpose, facts, next_tests, last_diagnostic, updated_at')
      .order('updated_at', { ascending: false })
      .limit(20),
  ]);

  const firstError =
    mappingRes.error ||
    keywordPlanRes.error ||
    budgetRes.error ||
    decisionRes.error ||
    expiringPackageRes.error ||
    contentRes.error ||
    campaignRes.error ||
    learningRes.error ||
    searchTermCandidateRes.error ||
    productScenarioRes.error ||
    landingEvolutionRes.error ||
    budgetPacingRes.error ||
    tenantAdAccountRes.error ||
    changeRequestRes.error ||
    keywordClusterRes.error ||
    externalMutationRes.error ||
    tenantReportRes.error ||
    conversionEventRes.error ||
    performanceFactRes.error ||
    experimentRes.error ||
    blogVersionRes.error ||
    platformJobRes.error ||
    conversionUploadJobRes.error ||
    dataQualitySnapshotRes.error ||
    portfolioPlanRes.error ||
    creativeAssetVariantRes.error ||
    travelIntentSignalRes.error ||
    tenantWorkspaceRes.error ||
    tenantBillingProfileRes.error ||
    runtimeReadinessRes.error ||
    executionAttemptRes.error ||
    experimentTemplateRes.error ||
    tenantAuditExportRes.error ||
    channelAdapterHealthRes.error ||
    platformWritePacketRes.error ||
    adapterExecutionGateRes.error ||
    rollbackDrillRes.error ||
    limitedWritePilotPolicyRes.error ||
    limitedWritePilotAttemptRes.error;
  if (firstError) {
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const mappings = (mappingRes.data || []) as Array<{
    platform: string;
    operational_status: string | null;
    active: boolean | null;
    clicks: number | null;
    cta_clicks: number | null;
    conversions: number | null;
    conversion_value_krw: number | null;
  }>;
  const keywordPlans = (keywordPlanRes.data || []) as Array<{
    platform: string;
    autopilot_status: string | null;
    tier: string | null;
    suggested_bid_krw: number | null;
  }>;
  const budgets = (budgetRes.data || []) as Array<{
    platform: string;
    monthly_budget_krw: number;
    daily_budget_cap_krw: number;
    max_cpc_krw: number;
    max_test_loss_krw: number;
    automation_level: number;
    status: string;
    external_account_id?: string | null;
    external_campaign_id?: string | null;
    external_ad_group_id?: string | null;
    external_config_note?: string | null;
  }>;
  const contents = (contentRes.data || []) as Array<{
    status: string;
    landing_enabled: boolean | null;
    destination: string | null;
  }>;
  const campaigns = (campaignRes.data || []) as Array<{
    channel: string | null;
    status: string | null;
    daily_budget_krw: number | null;
    total_spend_krw?: number | null;
  }>;
  const learningEvents = (learningRes.data || []) as Array<{
    signal_type: string | null;
    status: string | null;
  }>;
  const searchTermCandidates = (searchTermCandidateRes.data || []) as Array<{
    action: string | null;
    status: string | null;
  }>;
  const blogEngagementLogs = (!blogEngagementRes.error ? blogEngagementRes.data || [] : []) as Array<{
    content_creative_id: string | null;
    time_on_page_seconds: number | null;
    max_scroll_depth_pct: number | null;
    cta_clicked: boolean | null;
    created_at: string | null;
  }>;
  const tenantGovernance = (!tenantGovernanceRes.error && tenantGovernanceRes.data?.[0] ? tenantGovernanceRes.data[0] : null) as {
    tenant_id?: string | null;
    allowed_platforms?: string[] | null;
    monthly_budget_cap_krw?: number | null;
    daily_budget_cap_krw?: number | null;
    max_cpc_krw?: number | null;
    max_test_loss_krw?: number | null;
    max_automation_level?: number | null;
    require_human_approval?: boolean | null;
    full_auto_enabled?: boolean | null;
    risk_status?: string | null;
  } | null;
  const productScenarios = (productScenarioRes.data || []) as Array<{
    scenario_type: string | null;
    funnel_stage: string | null;
    landing_strategy: string | null;
    status: string | null;
    recommended_channel: string | null;
  }>;
  const landingEvolutionQueue = (landingEvolutionRes.data || []) as Array<{
    action: string | null;
    status: string | null;
  }>;
  const budgetPacingSnapshots = (budgetPacingRes.data || []) as Array<{
    platform: string | null;
    status: string | null;
    recommended_action: string | null;
  }>;
  const tenantAdAccounts = (tenantAdAccountRes.data || []) as Array<{
    platform: string | null;
    account_mode: string | null;
    connection_status: string | null;
    external_account_id: string | null;
    external_customer_id: string | null;
    external_campaign_id: string | null;
    external_ad_group_id: string | null;
    monthly_budget_cap_krw: number | null;
    daily_budget_cap_krw: number | null;
    can_publish_keywords: boolean | null;
    can_change_bids: boolean | null;
    can_pause_assets: boolean | null;
    risk_status: string | null;
  }>;
  const tenantAdReadiness = buildTenantAdReadiness(tenantAdAccounts.map((account) => ({
    platform: account.platform || 'unknown',
    accountMode: account.account_mode || 'agency_managed',
    connectionStatus: account.connection_status || 'not_connected',
    monthlyBudgetCapKrw: Number(account.monthly_budget_cap_krw || 0),
    dailyBudgetCapKrw: Number(account.daily_budget_cap_krw || 0),
    canPublishKeywords: Boolean(account.can_publish_keywords),
    canChangeBids: Boolean(account.can_change_bids),
    canPauseAssets: Boolean(account.can_pause_assets),
    riskStatus: account.risk_status || 'watch',
  })));
  const changeRequests = (changeRequestRes.data || []) as Array<{
    request_type: string | null;
    target_table?: string | null;
    target_id?: string | null;
    status: string | null;
    risk_level: string | null;
  }>;
  const keywordClusters = (keywordClusterRes.data || []) as Array<{
    platform: string | null;
    tier: string | null;
    intent: string | null;
    status: string | null;
    score: number | null;
  }>;
  const externalMutations = (externalMutationRes.data || []) as Array<{
    platform: string | null;
    mutation_type: string | null;
    mode: string | null;
    status: string | null;
  }>;
  const tenantReports = (tenantReportRes.data || []) as Array<{
    tenant_id: string | null;
    period_start: string | null;
    period_end: string | null;
    report_type?: string | null;
    status: string | null;
  }>;
  const conversionEvents = (conversionEventRes.data || []) as Array<{
    event_type: string | null;
    platform: string | null;
    quarantine_status: string | null;
    revenue_krw: number | null;
    margin_krw: number | null;
    cost_krw: number | null;
    quality_flags?: Record<string, unknown> | null;
    raw_payload?: Record<string, unknown> | null;
  }>;
  const performanceFacts = (performanceFactRes.data || []) as Array<{
    platform: string | null;
    source: string | null;
    clicks: number | null;
    cta_clicks: number | null;
    conversions: number | null;
    cost_krw: number | null;
    revenue_krw: number | null;
    margin_krw: number | null;
  }>;
  const experiments = (experimentRes.data || []) as Array<{
    experiment_type: string | null;
    platform: string | null;
    status: string | null;
  }>;
  const blogVersions = (blogVersionRes.data || []) as Array<{
    slug: string | null;
    change_type: string | null;
    status: string | null;
  }>;
  const platformJobs = (platformJobRes.data || []) as Array<{
    id: string | null;
    platform: string | null;
    job_type: string | null;
    status: string | null;
    guardrail_status: string | null;
    blocked_reason: string | null;
    external_api_write: boolean | null;
    response_payload?: unknown;
    external_mutation_result_id?: string | null;
    created_at?: string | null;
  }>;
  const conversionUploadJobs = (conversionUploadJobRes.data || []) as Array<{
    id: string | null;
    platform: string | null;
    event_name: string | null;
    status: string | null;
    signal_quality_score: number | null;
    blocked_reason: string | null;
    response_payload?: unknown;
    external_upload_id?: string | null;
    uploaded_at?: string | null;
    created_at?: string | null;
  }>;
  const dataQualitySnapshots = (dataQualitySnapshotRes.data || []) as Array<{
    status: string | null;
    events_total: number | null;
    clean_events: number | null;
    upload_ready_events: number | null;
    blocked_upload_events: number | null;
    duplicate_dedupe_keys?: number | null;
    attribution_coverage_pct: number | null;
    margin_coverage_pct: number | null;
  }>;
  const portfolioPlans = (portfolioPlanRes.data || []) as Array<{
    platform: string | null;
    plan_type: string | null;
    status: string | null;
    confidence: number | null;
    current_budget_krw: number | null;
    recommended_budget_krw: number | null;
    expected_margin_krw: number | null;
  }>;
  const runtimeReadinessChecks = (runtimeReadinessRes.data || []) as Array<{
    status: string | null;
    severity: string | null;
    check_key: string | null;
  }>;
  const executionAttempts = (executionAttemptRes.data || []) as Array<{
    id: string | null;
    platform: string | null;
    attempt_type: string | null;
    status: string | null;
    external_api_write: boolean | null;
    blocked_reason: string | null;
    created_at?: string | null;
  }>;
  const experimentTemplates = (experimentTemplateRes.data || []) as Array<{
    experiment_type: string | null;
    status: string | null;
  }>;
  const tenantAuditExports = (tenantAuditExportRes.data || []) as Array<{
    status: string | null;
  }>;
  const channelAdapterHealth = (channelAdapterHealthRes.data || []) as Array<{
    platform: string | null;
    adapter_state: string | null;
    capability_level: number | null;
    external_api_write: boolean | null;
    recommended_action: string | null;
  }>;
  const platformWritePackets = (platformWritePacketRes.data || []) as Array<{
    platform: string | null;
    packet_type: string | null;
    lifecycle_status: string | null;
    dry_run: boolean | null;
    external_api_write: boolean | null;
    blocked_reason: string | null;
  }>;
  const adapterExecutionGates = (adapterExecutionGateRes.data || []) as Array<{
    platform: string | null;
    gate_status: string | null;
    requested_mode: string | null;
    allowed_mode: string | null;
    risk_level: string | null;
    risk_score: number | null;
    external_api_write: boolean | null;
  }>;
  const rollbackDrills = (rollbackDrillRes.data || []) as Array<{
    platform: string | null;
    drill_status: string | null;
    rollback_type: string | null;
    external_api_write: boolean | null;
    blocked_reason: string | null;
  }>;
  const limitedWritePilotPolicies = (limitedWritePilotPolicyRes.data || []) as Array<{
    platform: string | null;
    status: string | null;
    pilot_level: string | null;
    live_external_write_enabled: boolean | null;
  }>;
  const limitedWritePilotAttempts = (limitedWritePilotAttemptRes.data || []) as Array<{
    platform: string | null;
    requested_mode: string | null;
    attempt_status: string | null;
    external_api_write: boolean | null;
    blockers: string[] | null;
    next_action: string | null;
  }>;
  const campaignMemories = (!campaignMemoryRes.error ? campaignMemoryRes.data || [] : []) as Array<{
    tenant_id: string | null;
    workspace_id: string | null;
    memory_key: string | null;
    status: string | null;
    score: number | null;
    purpose: string | null;
    updated_at: string | null;
  }>;
  const creativeAssetVariants = (creativeAssetVariantRes.data || []) as Array<{
    platform: string | null;
    asset_type: string | null;
    lifecycle_status: string | null;
    angle: string | null;
    audience: string | null;
    fatigue_score: number | null;
  }>;
  const travelIntentSignals = (travelIntentSignalRes.data || []) as Array<{
    destination: string | null;
    intent_key: string | null;
    intent_type: string | null;
    status: string | null;
    cannibalization_risk: number | null;
    duplicate_content_risk: number | null;
    score: number | null;
  }>;
  const tenantWorkspaces = (tenantWorkspaceRes.data || []) as Array<{
    tenant_id: string | null;
    workspace_name: string | null;
    automation_level: number | null;
    require_human_approval: boolean | null;
    full_auto_enabled: boolean | null;
    audit_export_enabled?: boolean | null;
    monthly_budget_cap_krw?: number | null;
    daily_budget_cap_krw?: number | null;
    risk_status: string | null;
    billing_plan: string | null;
  }>;
  const tenantBillingProfiles = (tenantBillingProfileRes.data || []) as Array<{
    tenant_id: string | null;
    billing_plan: string | null;
    invoice_status: string | null;
    base_subscription_krw: number | null;
    managed_spend_fee_pct: number | null;
    performance_fee_pct: number | null;
  }>;
  const incidentResponse = buildAdOsIncidentSummary({
    platformJobs,
    conversionUploadJobs,
    dataQualitySnapshots,
    executionAttempts,
    tenantWorkspaces,
  });
  const agencyReporting = buildAgencyReportingSummary({
    tenantWorkspaces,
    tenantBillingProfiles,
    tenantReports,
    tenantAuditExports,
    incidentResponse,
  });

  const platformConfirmationJobs = platformJobs.filter((row) =>
    row.status === 'running' &&
    (
      Boolean(row.external_mutation_result_id) ||
      payloadFlag(row, 'external_result_pending_confirmation')
    )
  );
  const conversionConfirmationJobs = conversionUploadJobs.filter((row) =>
    row.status === 'running' &&
    (
      Boolean(row.external_upload_id) ||
      payloadFlag(row, 'external_upload_id_pending_confirmation')
    )
  );
  const executorQueueRows = [
    ...platformJobs
      .filter((row) => ['approved', 'running'].includes(row.status || '') && !platformConfirmationJobs.some((candidate) => candidate.id === row.id))
      .map((row) => sampleQueueRow({
        id: row.id,
        source: 'platform_job',
        platform: row.platform,
        status: row.status,
        title: row.job_type,
        reason: row.blocked_reason,
        next_action: row.platform === 'naver'
          ? '네이버 paused-write executor dry-run 후 live gate를 확인하세요.'
          : row.platform === 'google'
            ? 'Google draft/OAuth/conversion action gate를 확인하세요.'
            : row.platform === 'meta'
              ? 'Meta creative/CAPI draft gate를 확인하세요.'
              : '채널 어댑터 실행 게이트를 확인하세요.',
        created_at: row.created_at,
      })),
    ...conversionUploadJobs
      .filter((row) => ['approved', 'running'].includes(row.status || '') && !conversionConfirmationJobs.some((candidate) => candidate.id === row.id))
      .map((row) => sampleQueueRow({
        id: row.id,
        source: 'conversion_upload_job',
        platform: row.platform,
        status: row.status,
        title: row.event_name,
        reason: row.blocked_reason,
        next_action: '전환 upload dry-run으로 consent, dedupe, identifier 품질을 재확인하세요.',
        created_at: row.created_at,
      })),
  ];
  const confirmationQueueRows = [
    ...platformConfirmationJobs.map((row) => sampleQueueRow({
      id: row.id,
      source: 'platform_job_confirmation',
      platform: row.platform,
      status: row.status,
      title: row.job_type,
      reason: row.external_mutation_result_id || 'external result pending',
      next_action: '외부 플랫폼 결과를 확인한 뒤 external-results/confirm으로 성공/실패를 확정하세요.',
      created_at: row.created_at,
    })),
    ...conversionConfirmationJobs.map((row) => sampleQueueRow({
      id: row.id,
      source: 'conversion_upload_confirmation',
      platform: row.platform,
      status: row.status,
      title: row.event_name,
      reason: row.external_upload_id || 'external upload id pending',
      next_action: 'Google/Meta 업로드 id를 확인한 뒤 external-results/confirm으로 업로드 상태를 확정하세요.',
      created_at: row.created_at,
    })),
  ];
  const failedQueueRows = [
    ...platformJobs
      .filter((row) => ['blocked', 'failed'].includes(row.status || '') || row.guardrail_status === 'blocked')
      .map((row) => sampleQueueRow({
        id: row.id,
        source: 'platform_job',
        platform: row.platform,
        status: row.status || row.guardrail_status,
        title: row.job_type,
        reason: row.blocked_reason,
        next_action: row.blocked_reason || '예산, 권한, 자동화 레벨, kill switch를 확인하세요.',
        created_at: row.created_at,
      })),
    ...conversionUploadJobs
      .filter((row) => ['blocked', 'failed'].includes(row.status || ''))
      .map((row) => sampleQueueRow({
        id: row.id,
        source: 'conversion_upload_job',
        platform: row.platform,
        status: row.status,
        title: row.event_name,
        reason: row.blocked_reason,
        next_action: row.blocked_reason || 'PII, consent, dedupe, freshness, identifier 품질을 확인하세요.',
        created_at: row.created_at,
      })),
    ...executionAttempts
      .filter((row) => ['blocked', 'failed'].includes(row.status || ''))
      .map((row) => sampleQueueRow({
        id: row.id,
        source: 'execution_attempt',
        platform: row.platform,
        status: row.status,
        title: row.attempt_type,
        reason: row.blocked_reason,
        next_action: row.blocked_reason || '최근 실행 attempt의 dry-run 결과와 adapter gate를 확인하세요.',
        created_at: row.created_at,
      })),
  ];

  const budgetByPlatform = new Map(budgets.map((b) => [b.platform, b]));
  const channelBudgets = PLATFORMS.map((platform) => ({
    platform,
    configured: budgetByPlatform.has(platform),
    monthly_budget_krw: budgetByPlatform.get(platform)?.monthly_budget_krw ?? 0,
    daily_budget_cap_krw: budgetByPlatform.get(platform)?.daily_budget_cap_krw ?? 0,
    max_cpc_krw: budgetByPlatform.get(platform)?.max_cpc_krw ?? 0,
    max_test_loss_krw: budgetByPlatform.get(platform)?.max_test_loss_krw ?? 0,
    automation_level: budgetByPlatform.get(platform)?.automation_level ?? 1,
    status: budgetByPlatform.get(platform)?.status ?? 'paused',
    external_account_id: budgetByPlatform.get(platform)?.external_account_id ?? null,
    external_campaign_id: budgetByPlatform.get(platform)?.external_campaign_id ?? null,
    external_ad_group_id: budgetByPlatform.get(platform)?.external_ad_group_id ?? null,
    external_config_note: budgetByPlatform.get(platform)?.external_config_note ?? null,
  }));

  const integrationStatus = {
    naver: hasAllSecrets(['NAVER_ADS_API_KEY', 'NAVER_ADS_SECRET_KEY', 'NAVER_ADS_CUSTOMER_ID']),
    google: hasAllSecrets(['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET']),
    meta: hasAnySecret(['META_ACCESS_TOKEN', 'META_ADS_ACCESS_TOKEN']) && hasAllSecrets(['META_AD_ACCOUNT_ID']),
    kakao: false,
  };
  const integrationDetails = {
    naver: {
      label: 'Naver Search Ads',
      configured: integrationStatus.naver,
      required: {
        NAVER_ADS_API_KEY: Boolean(getSecret('NAVER_ADS_API_KEY')),
        NAVER_ADS_SECRET_KEY: Boolean(getSecret('NAVER_ADS_SECRET_KEY')),
        NAVER_ADS_CUSTOMER_ID: Boolean(getSecret('NAVER_ADS_CUSTOMER_ID')),
      },
      note: integrationStatus.naver ? 'KeywordTool/검색광고 API 호출 가능' : '네이버 검색광고 서버 키 필요',
    },
    google: {
      label: 'Google Ads',
      configured: integrationStatus.google,
      required: {
        GOOGLE_ADS_DEVELOPER_TOKEN: Boolean(getSecret('GOOGLE_ADS_DEVELOPER_TOKEN')),
        GOOGLE_ADS_CUSTOMER_ID: Boolean(getSecret('GOOGLE_ADS_CUSTOMER_ID')),
        GOOGLE_ADS_CLIENT_ID: Boolean(getSecret('GOOGLE_ADS_CLIENT_ID')),
        GOOGLE_ADS_CLIENT_SECRET: Boolean(getSecret('GOOGLE_ADS_CLIENT_SECRET')),
      },
      note: integrationStatus.google ? 'OAuth 토큰 상태까지 별도 확인 필요' : 'Developer token/OAuth/Customer ID 필요',
    },
    meta: {
      label: 'Meta Ads',
      configured: integrationStatus.meta,
      required: {
        META_AD_ACCOUNT_ID: Boolean(getSecret('META_AD_ACCOUNT_ID')),
        META_ACCESS_TOKEN: hasAnySecret(['META_ACCESS_TOKEN', 'META_ADS_ACCESS_TOKEN']),
      },
      note: integrationStatus.meta ? '광고 계정과 액세스 토큰 존재' : 'Meta 광고 계정/토큰 필요',
    },
    kakao: {
      label: 'Kakao Moment',
      configured: false,
      required: {
        KAKAO_MOMENT_ACCESS_TOKEN: false,
      },
      note: '현재는 픽셀/채널/알림톡 중심입니다. 카카오모먼트 광고 집행 API는 별도 연결 필요',
    },
  };

  const mappingCandidates = mappings.filter((m) => (m.operational_status || 'candidate') === 'candidate').length;
  const keywordCandidates = keywordPlans.filter((p) => (p.autopilot_status || 'candidate') === 'candidate').length;
  const liveMappings = mappings.filter((m) => ['active', 'winning', 'scaled'].includes(m.operational_status || '')).length;
  const publishedBlogs = contents.filter((c) => c.status === 'published').length;
  const landingBlogs = contents.filter((c) => c.status === 'published' && c.landing_enabled).length;
  const trackedClicks = sum(mappings, (m) => m.clicks);
  const trackedCtaClicks = sum(mappings, (m) => m.cta_clicks);
  const trackedConversions = sum(mappings, (m) => m.conversions);
  const trackedConversionValueKrw = sum(mappings, (m) => m.conversion_value_krw);
  const trackedSpendKrw = sum(campaigns, (c) => c.total_spend_krw);
  const factClicks = sum(performanceFacts, (row) => row.clicks);
  const factCtaClicks = sum(performanceFacts, (row) => row.cta_clicks);
  const factConversions = sum(performanceFacts, (row) => row.conversions);
  const factSpendKrw = sum(performanceFacts, (row) => row.cost_krw);
  const factRevenueKrw = sum(performanceFacts, (row) => row.revenue_krw);
  const factMarginKrw = sum(performanceFacts, (row) => row.margin_krw);
  const attributionEventsClean = conversionEvents.filter((row) => !row.quarantine_status || row.quarantine_status === 'clean').length;
  const attributionEventsQuarantined = conversionEvents.filter((row) => row.quarantine_status && row.quarantine_status !== 'clean').length;
  const paidAssistedOrganicBookingEvents = conversionEvents.filter((row) =>
    row.event_type === 'booking' &&
    (!row.quarantine_status || row.quarantine_status === 'clean') &&
    conversionPayloadFlag(row, 'paid_assisted_organic')
  );
  const paidAssistedOrganicBookings = paidAssistedOrganicBookingEvents.length;
  const paidAssistedOrganicRevenueKrw = sum(paidAssistedOrganicBookingEvents, (row) => row.revenue_krw);
  const paidAssistedOrganicMarginKrw = sum(paidAssistedOrganicBookingEvents, (row) => row.margin_krw);
  const paidAssistedOrganicCostKrw = sum(paidAssistedOrganicBookingEvents, (row) => row.cost_krw);
  const attributionMarginRoasPct = factSpendKrw > 0 ? Math.round((factMarginKrw / factSpendKrw) * 100) : 0;
  const attributionCpaKrw = factConversions > 0 ? Math.round(factSpendKrw / factConversions) : 0;
  const trackedCpaKrw = trackedConversions > 0 ? Math.round(trackedSpendKrw / trackedConversions) : 0;
  const trackedRoasPct = trackedSpendKrw > 0 ? Math.round((trackedConversionValueKrw / trackedSpendKrw) * 100) : 0;
  const trackedCtaRatePct = trackedClicks > 0 ? Math.round((trackedCtaClicks / trackedClicks) * 1000) / 10 : 0;
  const trackedConversionRatePct = trackedClicks > 0 ? Math.round((trackedConversions / trackedClicks) * 1000) / 10 : 0;
  const engagementSessions = blogEngagementLogs.length;
  const bounceSessions = blogEngagementLogs.filter((row) => {
    const timeOnPage = Number(row.time_on_page_seconds || 0);
    const scrollDepth = Number(row.max_scroll_depth_pct || 0);
    return !row.cta_clicked && timeOnPage < 15 && scrollDepth < 35;
  }).length;
  const trackedBounceRatePct = engagementSessions > 0 ? Math.round((bounceSessions / engagementSessions) * 1000) / 10 : null;
  const avgTimeOnPageSeconds = engagementSessions > 0
    ? Math.round(sum(blogEngagementLogs, (row) => row.time_on_page_seconds) / engagementSessions)
    : 0;
  const avgScrollDepthPct = engagementSessions > 0
    ? Math.round((sum(blogEngagementLogs, (row) => row.max_scroll_depth_pct) / engagementSessions) * 10) / 10
    : 0;
  const configuredMonthlyBudgetKrw = sum(channelBudgets, (b) => b.monthly_budget_krw);
  const keywordPlansByTier = byKey(keywordPlans, (p) => p.tier);
  const keywordPlansByPlatform = byKey(keywordPlans, (p) => p.platform);
  const mappingsByStatus = byKey(mappings, (m) => m.operational_status || (m.active ? 'legacy_active' : 'legacy_paused'));
  const expiringPackages7d = expiringPackageRes.data?.length ?? 0;
  const readinessAudit = buildAdOsReadinessAudit({
    mappingCandidates,
    keywordCandidates,
    liveMappings,
    landingBlogs,
    publishedBlogs,
    trackedClicks,
    trackedCtaClicks,
    trackedConversions,
    trackedConversionValueKrw,
    expiringPackages7d,
    configuredMonthlyBudgetKrw,
    activeBudgetChannels: channelBudgets.filter((b) => b.status === 'active' && b.monthly_budget_krw > 0).length,
    integrationStatus,
    decisionCount: decisionRes.data?.length ?? 0,
    learningEventCount: learningEvents.length,
    searchTermCandidateCount: searchTermCandidates.length,
    keywordTiers: keywordPlansByTier,
    keywordPlatforms: keywordPlansByPlatform,
    mappingStatuses: mappingsByStatus,
  });
  const campaignCountsByStatus = byKey(campaigns, (c) => c.status || 'unknown');
  const campaignCountsByChannel = byKey(campaigns, (c) => c.channel || 'unknown');
  const keywordStatusCounts = byKey(keywordPlans, (p) => p.autopilot_status || 'candidate');
  const draftCampaigns = Number(campaignCountsByStatus.DRAFT || 0);
  const activeCampaigns = Number(campaignCountsByStatus.ACTIVE || 0);
  const externalLaunchStatus = buildExternalLaunchStatus({
    integrationStatus,
    channelBudgets,
    tenantAdAccounts,
    keywordStatusCounts,
    draftCampaigns,
  });
  const launchActionQueue = buildLaunchActionQueue({
    externalLaunchStatus,
    keywordCandidates,
    keywordClusters: keywordClusters.length,
    pendingExternalMutations: externalMutations.filter((row) => ['planned', 'requested'].includes(row.status || '')).length,
    approvedOrTestingKeywords: Number(externalLaunchStatus.approved_or_testing_keywords || 0),
    draftCampaigns,
    activeSearchBudgetChannels: channelBudgets.filter((budget) => ['naver', 'google'].includes(budget.platform) && budget.status === 'active' && budget.monthly_budget_krw > 0).length,
    learningEventCount: learningEvents.length,
    conversionEvents: conversionEvents.length,
    performanceFacts: performanceFacts.length,
    productScenarioCandidates: productScenarios.filter((row) => ['candidate', 'queued'].includes(row.status || '')).length,
    landingEvolutionCandidates: landingEvolutionQueue.filter((row) => row.status === 'candidate').length,
  });
  const approvedOrTestingKeywords = Number(externalLaunchStatus.approved_or_testing_keywords || 0);
  const tenantAccountByPlatform = new Map(tenantAdAccounts.map((account) => [account.platform, account]));
  const channelExecutionStates = Object.fromEntries(
    ['naver', 'google'].map((platform) => {
      const budget = channelBudgets.find((row) => row.platform === platform);
      const tenantAccount = tenantAccountByPlatform.get(platform);
      const connectionStatus = tenantAccount?.connection_status || null;
      const permissionOk = connectionStatus
        ? ['credentials_ready', 'no_campaign', 'ready'].includes(connectionStatus)
        : platform === 'naver' && Boolean(integrationStatus[platform as keyof typeof integrationStatus]);
      const integrationReady = Boolean(integrationStatus[platform as keyof typeof integrationStatus]) ||
        ['credentials_ready', 'no_campaign', 'ready', 'permission_denied'].includes(connectionStatus || '');
      const externalCampaignId = budget?.external_campaign_id || tenantAccount?.external_campaign_id;
      const externalAdGroupId = budget?.external_ad_group_id || tenantAccount?.external_ad_group_id;

      return [
        platform,
        classifyChannelExecutionState({
          integrationReady,
          permissionOk,
          hasCampaign: Boolean(externalCampaignId),
          hasAdGroup: Boolean(externalAdGroupId),
          budgetReady: Boolean(
            budget &&
              budget.status === 'active' &&
              Number(budget.monthly_budget_krw || 0) > 0 &&
              Number(budget.daily_budget_cap_krw || 0) > 0,
          ),
          approvedKeywords: approvedOrTestingKeywords,
          internalDrafts: draftCampaigns,
          platformLabel: platform === 'naver' ? '네이버' : '구글',
        }),
      ];
    }),
  );
  const activeAutomationModes = channelBudgets.map((budget) => ({
    platform: budget.platform,
    level: budget.automation_level,
    mode: automationLevelToMode(budget.automation_level),
    status: budget.status,
  }));
  const tenantGuardrails = buildTenantRiskGuardrails({
    tenantScopedTables: 3,
    monthlyBudgetKrw: tenantGovernance?.monthly_budget_cap_krw || configuredMonthlyBudgetKrw,
    activeBudgetChannels: channelBudgets.filter((budget) => budget.status === 'active' && budget.monthly_budget_krw > 0).length,
    maxAutomationLevel: tenantGovernance?.max_automation_level ?? Math.max(...channelBudgets.map((budget) => Number(budget.automation_level || 0)), 0),
  });
  const tenantPolicy = tenantGovernance
    ? {
        configured: true,
        tenant_id: tenantGovernance.tenant_id ?? null,
        allowed_platforms: tenantGovernance.allowed_platforms || ['naver', 'google'],
        monthly_budget_cap_krw: tenantGovernance.monthly_budget_cap_krw || 0,
        daily_budget_cap_krw: tenantGovernance.daily_budget_cap_krw || 0,
        max_cpc_krw: tenantGovernance.max_cpc_krw || 0,
        max_test_loss_krw: tenantGovernance.max_test_loss_krw || 0,
        max_automation_level: tenantGovernance.max_automation_level ?? 2,
        require_human_approval: tenantGovernance.require_human_approval ?? true,
        full_auto_enabled: tenantGovernance.full_auto_enabled ?? false,
        risk_status: tenantGovernance.risk_status || 'normal',
      }
    : {
        configured: false,
        error: tenantGovernanceRes.error?.message || null,
        tenant_id: null,
        allowed_platforms: ['naver', 'google'],
        monthly_budget_cap_krw: configuredMonthlyBudgetKrw,
        daily_budget_cap_krw: 0,
        max_cpc_krw: 0,
        max_test_loss_krw: 0,
        max_automation_level: 2,
        require_human_approval: true,
        full_auto_enabled: false,
        risk_status: 'watch',
      };
  const completionAudit = buildAdOsCompletionAuditSummary({
    platformJobQueue: {
      total: platformJobs.length,
      blocked: platformJobs.filter((row) => row.status === 'blocked' || row.guardrail_status === 'blocked').length,
      approved_or_running: platformJobs.filter((row) => ['approved', 'running'].includes(row.status || '')).length,
      external_api_write_count: platformJobs.filter((row) => row.external_api_write).length,
    },
    runtimeExecution: {
      total: executionAttempts.length,
      blocked: executionAttempts.filter((row) => row.status === 'blocked').length,
      external_api_write_count:
        executionAttempts.filter((row) => row.external_api_write).length +
        platformJobs.filter((row) => row.external_api_write).length,
    },
    channelAdapters: {
      snapshots: channelAdapterHealth.length,
      paused_write_ready: channelAdapterHealth.filter((row) => row.adapter_state === 'paused_write_ready').length,
      draft_ready: channelAdapterHealth.filter((row) => row.adapter_state === 'draft_ready').length,
      executable: channelAdapterHealth.filter((row) => row.adapter_state === 'executable').length,
      blocked: channelAdapterHealth.filter((row) => ['missing_credentials', 'permission_denied', 'blocked'].includes(row.adapter_state || '')).length,
      external_api_write_count: channelAdapterHealth.filter((row) => row.external_api_write).length,
    },
    writePackets: {
      total: platformWritePackets.length,
      blocked: platformWritePackets.filter((row) => row.lifecycle_status === 'blocked').length,
      external_api_write_count: platformWritePackets.filter((row) => row.external_api_write).length,
    },
    executionGates: {
      total: adapterExecutionGates.length,
      blocked: adapterExecutionGates.filter((row) => row.gate_status === 'blocked').length,
      external_api_write_count: adapterExecutionGates.filter((row) => row.external_api_write).length,
    },
    rollbackDrills: {
      total: rollbackDrills.length,
      blocked: rollbackDrills.filter((row) => row.drill_status === 'blocked').length,
      external_api_write_count: rollbackDrills.filter((row) => row.external_api_write).length,
    },
    limitedWritePilot: {
      total: limitedWritePilotAttempts.length,
      blocked: limitedWritePilotAttempts.filter((row) => ['blocked', 'live_write_blocked'].includes(row.attempt_status || '')).length,
      external_api_write_count: limitedWritePilotAttempts.filter((row) => row.external_api_write).length,
    },
    conversionDataQuality: dataQualitySnapshots[0] ? {
      status: dataQualitySnapshots[0].status || 'unknown',
      uploadable_conversions: Number(dataQualitySnapshots[0].upload_ready_events || 0),
      blocked_conversions: Number(dataQualitySnapshots[0].blocked_upload_events || 0),
      attribution_coverage: Number(dataQualitySnapshots[0].attribution_coverage_pct || 0) / 100,
    } : {
      status: conversionUploadJobs.some((row) => row.status === 'blocked') ? 'warning' : 'unknown',
      uploadable_conversions: conversionUploadJobs.filter((row) => row.status === 'planned').length,
      blocked_conversions: conversionUploadJobs.filter((row) => row.status === 'blocked').length,
      attribution_coverage: performanceFacts.length > 0 && conversionEvents.length > 0
        ? Math.round((performanceFacts.length / conversionEvents.length) * 1000) / 1000
        : 0,
    },
    learningLoop: {
      status: {
        attribution_ready: performanceFacts.length > 0,
        margin_learning_ready: factMarginKrw !== 0 || factRevenueKrw > 0,
      },
      metrics: {
        fact_clicks_30d: factClicks,
        fact_cta_clicks_30d: factCtaClicks,
        fact_conversions_30d: factConversions,
        fact_spend_krw_30d: factSpendKrw,
        fact_margin_krw_30d: factMarginKrw,
        paid_assisted_organic_bookings_30d: paidAssistedOrganicBookings,
        paid_assisted_organic_revenue_krw_30d: paidAssistedOrganicRevenueKrw,
        paid_assisted_organic_margin_krw_30d: paidAssistedOrganicMarginKrw,
        paid_assisted_organic_cost_krw_30d: paidAssistedOrganicCostKrw,
      },
    },
    tenantPolicy,
    tenantGuardrails,
    tenantAdReadiness,
    incidentResponse,
    agencyReporting,
    experimentStandards: {
      templates: experimentTemplates.length,
      active: experimentTemplates.filter((row) => row.status === 'active').length,
      types: Object.keys(byKey(experimentTemplates, (row) => row.experiment_type || 'unknown')).length,
    },
    runtimeReadiness: {
      checks: runtimeReadinessChecks.length,
      blocked_or_failed: runtimeReadinessChecks.filter((row) => ['blocked', 'fail'].includes(row.status || '')).length,
      critical: runtimeReadinessChecks.filter((row) => row.severity === 'critical').length,
    },
    creativeFactory: {
      variants: creativeAssetVariants.length,
      duplicate_content_risks: travelIntentSignals.filter((row) => Number(row.duplicate_content_risk || 0) >= 60).length,
    },
  });

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    kpis: {
      mapping_candidates: mappingCandidates,
      keyword_candidates: keywordCandidates,
      live_mappings: liveMappings,
      landing_blogs: landingBlogs,
      published_blogs: publishedBlogs,
      expiring_packages_7d: expiringPackages7d,
      tracked_clicks: trackedClicks,
      tracked_cta_clicks: trackedCtaClicks,
      tracked_conversions: trackedConversions,
      tracked_conversion_value_krw: trackedConversionValueKrw,
      tracked_spend_krw: trackedSpendKrw,
      tracked_cpa_krw: trackedCpaKrw,
      tracked_roas_pct: trackedRoasPct,
      tracked_cta_rate_pct: trackedCtaRatePct,
      tracked_conversion_rate_pct: trackedConversionRatePct,
      tracked_bounce_rate_pct: trackedBounceRatePct ?? 0,
      engagement_sessions_30d: engagementSessions,
      avg_time_on_page_seconds: avgTimeOnPageSeconds,
      avg_scroll_depth_pct: avgScrollDepthPct,
      configured_monthly_budget_krw: configuredMonthlyBudgetKrw,
      draft_campaigns: draftCampaigns,
      active_campaigns: activeCampaigns,
      learning_events: learningEvents.length,
      search_term_candidates: searchTermCandidates.length,
      negative_candidates: searchTermCandidates.filter((row) => row.action === 'add_negative' && row.status === 'candidate').length,
      product_scenarios: productScenarios.length,
      landing_evolution_candidates: landingEvolutionQueue.filter((row) => row.status === 'candidate').length,
      budget_pacing_snapshots: budgetPacingSnapshots.length,
      budget_pacing_alerts: budgetPacingSnapshots.filter((row) => ['over_pacing', 'overspend', 'loss_limit_near', 'exhausted', 'blocked'].includes(row.status || '')).length,
      tenant_ad_accounts: tenantAdAccounts.length,
      tenant_ad_accounts_ready: tenantAdAccounts.filter((row) => row.connection_status === 'ready').length,
      change_requests_proposed: changeRequests.filter((row) => row.status === 'proposed').length,
      change_requests_high_risk: changeRequests.filter((row) => ['high', 'critical'].includes(row.risk_level || '')).length,
      keyword_clusters: keywordClusters.length,
      keyword_clusters_high_score: keywordClusters.filter((row) => Number(row.score || 0) >= 70).length,
      external_mutation_requests: externalMutations.length,
      external_mutation_pending: externalMutations.filter((row) => ['planned', 'requested'].includes(row.status || '')).length,
      tenant_reports: tenantReports.length,
      conversion_events_30d: conversionEvents.length,
      conversion_events_clean_30d: attributionEventsClean,
      conversion_events_quarantined_30d: attributionEventsQuarantined,
      paid_assisted_organic_bookings_30d: paidAssistedOrganicBookings,
      paid_assisted_organic_revenue_krw_30d: paidAssistedOrganicRevenueKrw,
      paid_assisted_organic_margin_krw_30d: paidAssistedOrganicMarginKrw,
      paid_assisted_organic_cost_krw_30d: paidAssistedOrganicCostKrw,
      performance_facts_30d: performanceFacts.length,
      experiments: experiments.length,
      experiments_running: experiments.filter((row) => row.status === 'running').length,
      experiments_completed: experiments.filter((row) => row.status === 'completed').length,
      blog_versions_approved: blogVersions.filter((row) => row.status === 'approved').length,
      blog_versions_applied: blogVersions.filter((row) => row.status === 'applied').length,
      platform_jobs: platformJobs.length,
      platform_jobs_blocked: platformJobs.filter((row) => row.status === 'blocked' || row.guardrail_status === 'blocked').length,
      platform_jobs_succeeded: platformJobs.filter((row) => row.status === 'succeeded').length,
      platform_jobs_external_api_write: platformJobs.filter((row) => row.external_api_write).length,
      conversion_upload_jobs: conversionUploadJobs.length,
      conversion_upload_jobs_blocked: conversionUploadJobs.filter((row) => row.status === 'blocked').length,
      conversion_upload_jobs_clean: conversionUploadJobs.filter((row) => row.status === 'planned').length,
      data_quality_snapshots: dataQualitySnapshots.length,
      data_quality_blocked: dataQualitySnapshots.filter((row) => row.status === 'blocked').length,
      portfolio_plans_candidate: portfolioPlans.filter((row) => row.status === 'candidate').length,
      portfolio_plans_approved: portfolioPlans.filter((row) => row.status === 'approved').length,
      portfolio_expected_margin_delta_krw: sum(portfolioPlans, (row) => row.expected_margin_krw),
      portfolio_expected_spend_delta_krw: sum(portfolioPlans, (row) => Number(row.recommended_budget_krw || 0) - Number(row.current_budget_krw || 0)),
      creative_asset_variants: creativeAssetVariants.length,
      creative_asset_variants_testing: creativeAssetVariants.filter((row) => row.lifecycle_status === 'testing').length,
      creative_asset_variants_fatigued: creativeAssetVariants.filter((row) => row.lifecycle_status === 'fatigued').length,
      travel_intent_signals: travelIntentSignals.length,
      travel_intent_duplicate_risks: travelIntentSignals.filter((row) => Number(row.duplicate_content_risk || 0) >= 60).length,
      tenant_workspaces: tenantWorkspaces.length,
      tenant_workspaces_full_auto: tenantWorkspaces.filter((row) => row.full_auto_enabled).length,
      tenant_billing_profiles_active: tenantBillingProfiles.filter((row) => row.invoice_status === 'active').length,
      runtime_readiness_checks: runtimeReadinessChecks.length,
      runtime_readiness_blocked: runtimeReadinessChecks.filter((row) => ['blocked', 'fail'].includes(row.status || '')).length,
      execution_attempts: executionAttempts.length,
      execution_attempts_succeeded: executionAttempts.filter((row) => row.status === 'succeeded').length,
      execution_attempts_blocked: executionAttempts.filter((row) => row.status === 'blocked').length,
      execution_attempts_external_api_write: executionAttempts.filter((row) => row.external_api_write).length,
      experiment_templates_active: experimentTemplates.filter((row) => row.status === 'active').length,
      tenant_audit_exports: tenantAuditExports.length,
      tenant_audit_exports_ready: tenantAuditExports.filter((row) => row.status === 'ready').length,
      channel_adapter_health: channelAdapterHealth.length,
      channel_adapter_paused_write_ready: channelAdapterHealth.filter((row) => row.adapter_state === 'paused_write_ready').length,
      channel_adapter_draft_ready: channelAdapterHealth.filter((row) => row.adapter_state === 'draft_ready').length,
      channel_adapter_external_api_write: channelAdapterHealth.filter((row) => row.external_api_write).length,
      platform_write_packets: platformWritePackets.length,
      platform_write_packets_ready: platformWritePackets.filter((row) => row.lifecycle_status === 'ready').length,
      platform_write_packets_blocked: platformWritePackets.filter((row) => row.lifecycle_status === 'blocked').length,
      platform_write_packets_external_api_write: platformWritePackets.filter((row) => row.external_api_write).length,
      adapter_execution_gates: adapterExecutionGates.length,
      adapter_execution_gates_eligible: adapterExecutionGates.filter((row) => row.gate_status === 'eligible').length,
      adapter_execution_gates_blocked: adapterExecutionGates.filter((row) => row.gate_status === 'blocked').length,
      adapter_execution_gates_external_api_write: adapterExecutionGates.filter((row) => row.external_api_write).length,
      rollback_drills: rollbackDrills.length,
      rollback_drills_ready: rollbackDrills.filter((row) => row.drill_status === 'ready').length,
      rollback_drills_blocked: rollbackDrills.filter((row) => row.drill_status === 'blocked').length,
      rollback_drills_external_api_write: rollbackDrills.filter((row) => row.external_api_write).length,
      limited_write_pilot_policies: limitedWritePilotPolicies.length,
      limited_write_pilot_policies_active: limitedWritePilotPolicies.filter((row) => row.status === 'active').length,
      limited_write_pilot_attempts: limitedWritePilotAttempts.length,
      limited_write_pilot_dry_run_succeeded: limitedWritePilotAttempts.filter((row) => row.attempt_status === 'dry_run_succeeded').length,
      limited_write_pilot_blocked: limitedWritePilotAttempts.filter((row) => row.attempt_status === 'blocked' || row.attempt_status === 'live_write_blocked').length,
      limited_write_pilot_external_api_write: limitedWritePilotAttempts.filter((row) => row.external_api_write).length,
      campaign_memories: campaignMemories.length,
      campaign_memories_ready: campaignMemories.filter((row) => row.status === 'ready').length,
      ops_executor_queue: executorQueueRows.length,
      ops_confirmation_queue: confirmationQueueRows.length,
      ops_failed_queue: failedQueueRows.length,
      fact_clicks_30d: factClicks,
      fact_cta_clicks_30d: factCtaClicks,
      fact_conversions_30d: factConversions,
      fact_spend_krw_30d: factSpendKrw,
      fact_revenue_krw_30d: factRevenueKrw,
      fact_margin_krw_30d: factMarginKrw,
      fact_margin_roas_pct_30d: attributionMarginRoasPct,
      fact_cpa_krw_30d: attributionCpaKrw,
    },
    counts: {
      mappings_by_status: mappingsByStatus,
      mappings_by_platform: byKey(mappings, (m) => m.platform),
      keyword_plans_by_status: keywordStatusCounts,
      keyword_plans_by_tier: keywordPlansByTier,
      keyword_plans_by_platform: keywordPlansByPlatform,
      campaigns_by_status: campaignCountsByStatus,
      campaigns_by_channel: campaignCountsByChannel,
      learning_events_by_type: byKey(learningEvents, (row) => row.signal_type || 'unknown'),
      search_term_candidates_by_action: byKey(searchTermCandidates, (row) => row.action || 'unknown'),
      product_scenarios_by_type: byKey(productScenarios, (row) => row.scenario_type || 'unknown'),
      product_scenarios_by_status: byKey(productScenarios, (row) => row.status || 'unknown'),
      landing_evolution_by_action: byKey(landingEvolutionQueue, (row) => row.action || 'unknown'),
      budget_pacing_by_status: byKey(budgetPacingSnapshots, (row) => row.status || 'unknown'),
      tenant_ad_accounts_by_status: byKey(tenantAdAccounts, (row) => row.connection_status || 'unknown'),
      change_requests_by_status: byKey(changeRequests, (row) => row.status || 'unknown'),
      change_requests_by_type: byKey(changeRequests, (row) => row.request_type || 'unknown'),
      keyword_clusters_by_tier: byKey(keywordClusters, (row) => row.tier || 'unknown'),
      keyword_clusters_by_intent: byKey(keywordClusters, (row) => row.intent || 'unknown'),
      external_mutations_by_status: byKey(externalMutations, (row) => row.status || 'unknown'),
      external_mutations_by_type: byKey(externalMutations, (row) => row.mutation_type || 'unknown'),
      conversion_events_by_type: byKey(conversionEvents, (row) => row.event_type || 'unknown'),
      conversion_events_by_status: byKey(conversionEvents, (row) => row.quarantine_status || 'clean'),
      performance_facts_by_source: byKey(performanceFacts, (row) => row.source || 'unknown'),
      performance_facts_by_platform: byKey(performanceFacts, (row) => row.platform || 'unknown'),
      experiments_by_status: byKey(experiments, (row) => row.status || 'unknown'),
      experiments_by_type: byKey(experiments, (row) => row.experiment_type || 'unknown'),
      blog_versions_by_status: byKey(blogVersions, (row) => row.status || 'unknown'),
      blog_versions_by_change_type: byKey(blogVersions, (row) => row.change_type || 'unknown'),
      platform_jobs_by_status: byKey(platformJobs, (row) => row.status || 'unknown'),
      platform_jobs_by_platform: byKey(platformJobs, (row) => row.platform || 'unknown'),
      platform_jobs_by_guardrail: byKey(platformJobs, (row) => row.guardrail_status || 'unknown'),
      conversion_upload_jobs_by_status: byKey(conversionUploadJobs, (row) => row.status || 'unknown'),
      conversion_upload_jobs_by_event: byKey(conversionUploadJobs, (row) => row.event_name || 'unknown'),
      data_quality_by_status: byKey(dataQualitySnapshots, (row) => row.status || 'unknown'),
      portfolio_plans_by_status: byKey(portfolioPlans, (row) => row.status || 'unknown'),
      portfolio_plans_by_type: byKey(portfolioPlans, (row) => row.plan_type || 'unknown'),
      creative_variants_by_status: byKey(creativeAssetVariants, (row) => row.lifecycle_status || 'unknown'),
      creative_variants_by_type: byKey(creativeAssetVariants, (row) => row.asset_type || 'unknown'),
      travel_intent_signals_by_intent: byKey(travelIntentSignals, (row) => row.intent_key || 'unknown'),
      travel_intent_signals_by_duplicate_risk: byKey(travelIntentSignals, (row) => Number(row.duplicate_content_risk || 0) >= 60 ? 'high' : Number(row.duplicate_content_risk || 0) >= 30 ? 'medium' : 'low'),
      tenant_workspaces_by_risk: byKey(tenantWorkspaces, (row) => row.risk_status || 'unknown'),
      tenant_billing_profiles_by_plan: byKey(tenantBillingProfiles, (row) => row.billing_plan || 'unknown'),
      runtime_readiness_by_status: byKey(runtimeReadinessChecks, (row) => row.status || 'unknown'),
      runtime_readiness_by_key: byKey(runtimeReadinessChecks, (row) => row.check_key || 'unknown'),
      execution_attempts_by_status: byKey(executionAttempts, (row) => row.status || 'unknown'),
      execution_attempts_by_type: byKey(executionAttempts, (row) => row.attempt_type || 'unknown'),
      experiment_templates_by_type: byKey(experimentTemplates, (row) => row.experiment_type || 'unknown'),
      tenant_audit_exports_by_status: byKey(tenantAuditExports, (row) => row.status || 'unknown'),
      channel_adapter_health_by_state: byKey(channelAdapterHealth, (row) => row.adapter_state || 'unknown'),
      channel_adapter_health_by_platform: byKey(channelAdapterHealth, (row) => row.platform || 'unknown'),
      platform_write_packets_by_status: byKey(platformWritePackets, (row) => row.lifecycle_status || 'unknown'),
      platform_write_packets_by_type: byKey(platformWritePackets, (row) => row.packet_type || 'unknown'),
      adapter_execution_gates_by_status: byKey(adapterExecutionGates, (row) => row.gate_status || 'unknown'),
      adapter_execution_gates_by_risk: byKey(adapterExecutionGates, (row) => row.risk_level || 'unknown'),
      rollback_drills_by_status: byKey(rollbackDrills, (row) => row.drill_status || 'unknown'),
      rollback_drills_by_type: byKey(rollbackDrills, (row) => row.rollback_type || 'unknown'),
      limited_write_pilot_policies_by_status: byKey(limitedWritePilotPolicies, (row) => row.status || 'unknown'),
      limited_write_pilot_attempts_by_status: byKey(limitedWritePilotAttempts, (row) => row.attempt_status || 'unknown'),
      campaign_memories_by_status: byKey(campaignMemories, (row) => row.status || 'unknown'),
    },
    readiness_audit: readinessAudit,
    learning_loop: {
      scope: ['blog_landing', 'keyword', 'product', 'tenant'],
      metrics: {
        clicks: trackedClicks,
        cta_clicks: trackedCtaClicks,
        conversions: trackedConversions,
        spend_krw: trackedSpendKrw,
        conversion_value_krw: trackedConversionValueKrw,
        cpa_krw: trackedCpaKrw,
        roas_pct: trackedRoasPct,
        cta_rate_pct: trackedCtaRatePct,
        conversion_rate_pct: trackedConversionRatePct,
        bounce_rate_pct: trackedBounceRatePct,
        engagement_sessions_30d: engagementSessions,
        avg_time_on_page_seconds: avgTimeOnPageSeconds,
        avg_scroll_depth_pct: avgScrollDepthPct,
        attribution_events_30d: conversionEvents.length,
        attribution_clean_events_30d: attributionEventsClean,
        attribution_quarantined_events_30d: attributionEventsQuarantined,
        fact_clicks_30d: factClicks,
        fact_cta_clicks_30d: factCtaClicks,
        fact_conversions_30d: factConversions,
        fact_spend_krw_30d: factSpendKrw,
        fact_revenue_krw_30d: factRevenueKrw,
        fact_margin_krw_30d: factMarginKrw,
        fact_margin_roas_pct_30d: attributionMarginRoasPct,
        fact_cpa_krw_30d: attributionCpaKrw,
        paid_assisted_organic_bookings_30d: paidAssistedOrganicBookings,
        paid_assisted_organic_revenue_krw_30d: paidAssistedOrganicRevenueKrw,
        paid_assisted_organic_margin_krw_30d: paidAssistedOrganicMarginKrw,
        paid_assisted_organic_cost_krw_30d: paidAssistedOrganicCostKrw,
      },
      status: {
        has_click_signal: trackedClicks > 0,
        has_cta_signal: trackedCtaClicks > 0,
        has_booking_signal: trackedConversions > 0,
        has_cost_signal: trackedSpendKrw > 0,
        bounce_tracking_ready: engagementSessions > 0,
        attribution_ready: performanceFacts.length > 0,
        margin_learning_ready: factMarginKrw !== 0 || factRevenueKrw > 0,
      },
      next_action: performanceFacts.length > 0
        ? '전환 attribution fact 기준으로 CPA/마진 ROAS 학습을 실행할 수 있습니다.'
        : trackedSpendKrw > 0
          ? '성과 팩트 동기화와 전환 attribution을 실행해 광고비와 예약/마진을 묶으세요.'
          : '외부 광고비 또는 검색어 성과 수집이 들어오면 CPA/ROAS 학습이 활성화됩니다.',
    },
    channel_budgets: channelBudgets,
    integration_status: integrationStatus,
    integration_details: integrationDetails,
    external_launch_status: externalLaunchStatus,
    channel_execution_states: channelExecutionStates,
    active_automation_modes: activeAutomationModes,
    automation_modes: AD_OS_AUTOMATION_MODES,
    tenant_guardrails: tenantGuardrails,
    tenant_policy: tenantPolicy,
    tenant_ad_readiness: tenantAdReadiness,
    enterprise_layer: {
      platform_job_queue: {
        total: platformJobs.length,
        blocked: platformJobs.filter((row) => row.status === 'blocked' || row.guardrail_status === 'blocked').length,
        approved_or_running: platformJobs.filter((row) => ['approved', 'running'].includes(row.status || '')).length,
        external_api_write_count: platformJobs.filter((row) => row.external_api_write).length,
        safety_note: 'External writes remain gated by approval, budget, automation level, tenant policy, and kill switches.',
      },
      conversion_data_quality: dataQualitySnapshots[0] ? {
        status: dataQualitySnapshots[0].status || 'unknown',
        event_collection_rate: Number(dataQualitySnapshots[0].events_total || 0) > 0 ? 1 : 0,
        clean_conversion_rate: Number(dataQualitySnapshots[0].events_total || 0) > 0
          ? Math.round((Number(dataQualitySnapshots[0].clean_events || 0) / Number(dataQualitySnapshots[0].events_total || 1)) * 1000) / 1000
          : 0,
        uploadable_conversions: Number(dataQualitySnapshots[0].upload_ready_events || 0),
        blocked_conversions: Number(dataQualitySnapshots[0].blocked_upload_events || 0),
        attribution_coverage: Number(dataQualitySnapshots[0].attribution_coverage_pct || 0) / 100,
      } : {
        status: conversionUploadJobs.some((row) => row.status === 'blocked') ? 'warning' : 'unknown',
        event_collection_rate: conversionEvents.length > 0 ? 1 : 0,
        clean_conversion_rate: conversionUploadJobs.length > 0
          ? Math.round((conversionUploadJobs.filter((row) => row.status === 'planned').length / conversionUploadJobs.length) * 1000) / 1000
          : 0,
        uploadable_conversions: conversionUploadJobs.filter((row) => row.status === 'planned').length,
        blocked_conversions: conversionUploadJobs.filter((row) => row.status === 'blocked').length,
        attribution_coverage: performanceFacts.length > 0 && conversionEvents.length > 0
          ? Math.round((performanceFacts.length / conversionEvents.length) * 1000) / 1000
          : 0,
      },
      portfolio_optimizer: {
        candidates: portfolioPlans.filter((row) => row.status === 'candidate').length,
        approved: portfolioPlans.filter((row) => row.status === 'approved').length,
        applied: portfolioPlans.filter((row) => row.status === 'applied').length,
        expected_spend_delta_krw: sum(portfolioPlans, (row) => Number(row.recommended_budget_krw || 0) - Number(row.current_budget_krw || 0)),
        expected_margin_delta_krw: sum(portfolioPlans, (row) => row.expected_margin_krw),
      },
      creative_factory: {
        variants: creativeAssetVariants.length,
        testing: creativeAssetVariants.filter((row) => row.lifecycle_status === 'testing').length,
        fatigued: creativeAssetVariants.filter((row) => row.lifecycle_status === 'fatigued').length,
        duplicate_content_risks: travelIntentSignals.filter((row) => Number(row.duplicate_content_risk || 0) >= 60).length,
      },
      saas_packaging: {
        workspaces: tenantWorkspaces.length,
        active_billing_profiles: tenantBillingProfiles.filter((row) => row.invoice_status === 'active').length,
        full_auto_enabled: tenantWorkspaces.filter((row) => row.full_auto_enabled).length,
      },
      runtime_readiness: {
        checks: runtimeReadinessChecks.length,
        blocked_or_failed: runtimeReadinessChecks.filter((row) => ['blocked', 'fail'].includes(row.status || '')).length,
        critical: runtimeReadinessChecks.filter((row) => row.severity === 'critical').length,
      },
      runtime_execution: {
        attempts: executionAttempts.length,
        succeeded: executionAttempts.filter((row) => row.status === 'succeeded').length,
        blocked: executionAttempts.filter((row) => row.status === 'blocked').length,
        external_api_write_count:
          executionAttempts.filter((row) => row.external_api_write).length +
          platformJobs.filter((row) => row.external_api_write).length,
      },
      incident_response: incidentResponse,
      agency_reporting: agencyReporting,
      completion_audit: completionAudit,
      experiment_standards: {
        templates: experimentTemplates.length,
        active: experimentTemplates.filter((row) => row.status === 'active').length,
        types: Object.keys(byKey(experimentTemplates, (row) => row.experiment_type || 'unknown')).length,
      },
      tenant_audit_exports: {
        exports: tenantAuditExports.length,
        ready: tenantAuditExports.filter((row) => row.status === 'ready').length,
        draft: tenantAuditExports.filter((row) => row.status === 'draft').length,
      },
      channel_adapters: {
        snapshots: channelAdapterHealth.length,
        paused_write_ready: channelAdapterHealth.filter((row) => row.adapter_state === 'paused_write_ready').length,
        draft_ready: channelAdapterHealth.filter((row) => row.adapter_state === 'draft_ready').length,
        executable: channelAdapterHealth.filter((row) => row.adapter_state === 'executable').length,
        blocked: channelAdapterHealth.filter((row) => ['missing_credentials', 'permission_denied', 'blocked'].includes(row.adapter_state || '')).length,
        external_api_write_count: channelAdapterHealth.filter((row) => row.external_api_write).length,
      },
      write_packets: {
        packets: platformWritePackets.length,
        ready: platformWritePackets.filter((row) => row.lifecycle_status === 'ready').length,
        blocked: platformWritePackets.filter((row) => row.lifecycle_status === 'blocked').length,
        dry_run: platformWritePackets.filter((row) => row.dry_run).length,
        external_api_write_count: platformWritePackets.filter((row) => row.external_api_write).length,
      },
      execution_gates: {
        gates: adapterExecutionGates.length,
        eligible: adapterExecutionGates.filter((row) => row.gate_status === 'eligible').length,
        blocked: adapterExecutionGates.filter((row) => row.gate_status === 'blocked').length,
        monitor_only: adapterExecutionGates.filter((row) => row.gate_status === 'monitor_only').length,
        high_or_critical_risk: adapterExecutionGates.filter((row) => ['high', 'critical'].includes(row.risk_level || '')).length,
        external_api_write_count: adapterExecutionGates.filter((row) => row.external_api_write).length,
      },
      rollback_drills: {
        drills: rollbackDrills.length,
        ready: rollbackDrills.filter((row) => row.drill_status === 'ready').length,
        blocked: rollbackDrills.filter((row) => row.drill_status === 'blocked').length,
        not_required: rollbackDrills.filter((row) => row.drill_status === 'not_required').length,
        external_api_write_count: rollbackDrills.filter((row) => row.external_api_write).length,
      },
      limited_write_pilot: {
        policies: limitedWritePilotPolicies.length,
        active_policies: limitedWritePilotPolicies.filter((row) => row.status === 'active').length,
        dry_run_only_policies: limitedWritePilotPolicies.filter((row) => row.pilot_level === 'dry_run_only').length,
        attempts: limitedWritePilotAttempts.length,
        dry_run_succeeded: limitedWritePilotAttempts.filter((row) => row.attempt_status === 'dry_run_succeeded').length,
        blocked: limitedWritePilotAttempts.filter((row) => row.attempt_status === 'blocked').length,
        live_write_blocked: limitedWritePilotAttempts.filter((row) => row.attempt_status === 'live_write_blocked').length,
        live_external_write_enabled: limitedWritePilotPolicies.filter((row) => row.live_external_write_enabled).length,
        external_api_write_count: limitedWritePilotAttempts.filter((row) => row.external_api_write).length,
        first_blocker: limitedWritePilotAttempts.find((row) => Array.isArray(row.blockers) && row.blockers.length > 0)?.blockers?.[0] || null,
      },
      ops_queues: {
        executor_ready: executorQueueRows.length,
        confirmation_pending: confirmationQueueRows.length,
        failed_or_blocked: failedQueueRows.length,
        live_writes:
          executionAttempts.filter((row) => row.external_api_write).length +
          platformJobs.filter((row) => row.external_api_write).length +
          conversionUploadJobs.filter((row) => payloadFlag(row, 'external_api_write')).length,
        next_action: confirmationQueueRows.length > 0
          ? '외부 플랫폼 결과를 확인하고 성공/실패를 확정하세요.'
          : failedQueueRows.length > 0
            ? '실패·차단 사유를 먼저 해소한 뒤 dry-run을 재실행하세요.'
            : executorQueueRows.length > 0
              ? '승인된 job을 dry-run으로 검증하고 live gate를 확인하세요.'
              : '승인 대기 변경요청 또는 상품 기반 후보 생성부터 진행하세요.',
      },
    },
    launch_action_queue: launchActionQueue,
    recent_decisions: decisionRes.data || [],
    expiring_packages: expiringPackageRes.data || [],
    samples: {
      mappings: mappingRes.data?.slice(0, 12) || [],
      keyword_plans: keywordPlanRes.data?.slice(0, 12) || [],
      learning_events: learningRes.data?.slice(0, 12) || [],
      search_term_candidates: searchTermCandidateRes.data?.slice(0, 12) || [],
      product_scenarios: productScenarioRes.data?.slice(0, 12) || [],
      landing_evolution_queue: landingEvolutionRes.data?.slice(0, 12) || [],
      budget_pacing: budgetPacingRes.data?.slice(0, 12) || [],
      tenant_ad_accounts: tenantAdAccountRes.data?.slice(0, 12) || [],
      change_requests: changeRequestRes.data?.slice(0, 12) || [],
      keyword_clusters: keywordClusterRes.data?.slice(0, 12) || [],
      external_mutations: externalMutationRes.data?.slice(0, 12) || [],
      tenant_reports: tenantReportRes.data?.slice(0, 12) || [],
      conversion_events: conversionEventRes.data?.slice(0, 12) || [],
      performance_facts: performanceFactRes.data?.slice(0, 12) || [],
      experiments: experimentRes.data?.slice(0, 12) || [],
      blog_versions: blogVersionRes.data?.slice(0, 12) || [],
      platform_jobs: platformJobRes.data?.slice(0, 12) || [],
      conversion_upload_jobs: conversionUploadJobRes.data?.slice(0, 12) || [],
      data_quality_snapshots: dataQualitySnapshotRes.data?.slice(0, 12) || [],
      portfolio_plans: portfolioPlanRes.data?.slice(0, 12) || [],
      creative_asset_variants: creativeAssetVariantRes.data?.slice(0, 12) || [],
      travel_intent_signals: travelIntentSignalRes.data?.slice(0, 12) || [],
      tenant_workspaces: tenantWorkspaceRes.data?.slice(0, 12) || [],
      tenant_billing_profiles: tenantBillingProfileRes.data?.slice(0, 12) || [],
      runtime_readiness_checks: runtimeReadinessRes.data?.slice(0, 12) || [],
      execution_attempts: executionAttemptRes.data?.slice(0, 12) || [],
      experiment_templates: experimentTemplateRes.data?.slice(0, 12) || [],
      tenant_audit_exports: tenantAuditExportRes.data?.slice(0, 12) || [],
      channel_adapter_health: channelAdapterHealthRes.data?.slice(0, 12) || [],
      platform_write_packets: platformWritePacketRes.data?.slice(0, 12) || [],
      adapter_execution_gates: adapterExecutionGateRes.data?.slice(0, 12) || [],
      rollback_drills: rollbackDrillRes.data?.slice(0, 12) || [],
      limited_write_pilot_policies: limitedWritePilotPolicyRes.data?.slice(0, 12) || [],
      limited_write_pilot_attempts: limitedWritePilotAttemptRes.data?.slice(0, 12) || [],
      campaign_memories: !campaignMemoryRes.error ? campaignMemoryRes.data?.slice(0, 12) || [] : [],
      ops_executor_queue: executorQueueRows.slice(0, 8),
      ops_confirmation_queue: confirmationQueueRows.slice(0, 8),
      ops_failed_queue: failedQueueRows.slice(0, 8),
    },
    automation_ladder: [
      { level: 0, label: '분석만', description: 'AI가 추천만 만들고 DB/외부 광고는 변경하지 않음' },
      { level: 1, label: '후보 생성', description: '키워드/랜딩/소재 후보를 자동 생성' },
      { level: 2, label: '승인형 집행', description: '승인된 후보만 외부 광고 계정에 배포' },
      { level: 3, label: '소액 자동 테스트', description: '채널 예산 캡 안에서 자동 테스트 시작' },
      { level: 4, label: '자동 최적화', description: '입찰/중지/제외/랜딩 교체를 자동 적용' },
      { level: 5, label: '완전자율', description: '목표 CPA/ROAS와 예산 안에서 생성-집행-연장-중지 자동' },
    ],
  });
}

export const GET = withAdminGuard(async () => {
  try {
    return await withTimeout(
      buildSummaryResponse(),
      AD_OS_SUMMARY_TIMEOUT_MS,
      'ad os summary',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ad OS summary unavailable';
    console.warn('[ad-os/summary] degraded response:', message);
    return NextResponse.json(buildDegradedSummary(error));
  }
});
