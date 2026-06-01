import { NextResponse } from 'next/server';
import { buildAdOsReadinessAudit } from '@/lib/ad-os-readiness';
import {
  AD_OS_AUTOMATION_MODES,
  automationLevelToMode,
  buildTenantRiskGuardrails,
  classifyChannelExecutionState,
} from '@/lib/ad-os-governance';
import { buildTenantAdReadiness } from '@/lib/ad-os-tenant-readiness';
import { withAdminGuard } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

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
  keywordStatusCounts: Record<string, number>;
  draftCampaigns: number;
}) {
  const approvedOrTestingKeywords =
    Number(input.keywordStatusCounts.approved || 0) +
    Number(input.keywordStatusCounts.testing || 0) +
    Number(input.keywordStatusCounts.active || 0);
  const naverBudget = input.channelBudgets.find((budget) => budget.platform === 'naver');
  const googleBudget = input.channelBudgets.find((budget) => budget.platform === 'google');
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
    { id: 'budget', label: '예산', done: hasNaverBudget, next: '네이버 월예산/일상한/Max CPC 활성화' },
    { id: 'adgroup', label: '광고그룹 ID', done: Boolean(naverBudget?.external_ad_group_id), next: '네이버 광고센터에서 캠페인/비즈채널/광고그룹 생성 후 자산 자동저장' },
    { id: 'keywords', label: '승인 키워드', done: approvedOrTestingKeywords > 0, next: '네이버 후보 승인 또는 1단계 시범 세팅' },
    { id: 'drafts', label: '내부 드래프트', done: input.draftCampaigns > 0, next: '캠페인 드래프트 생성' },
  ];
  const googleChecks = [
    { id: 'api', label: 'API/OAuth', done: Boolean(input.integrationStatus.google), next: 'Google Ads OAuth 권한 확인' },
    { id: 'permission', label: '권한 감사', done: false, next: '외부 계정 테스트에서 Google Ads PERMISSION_DENIED 해소' },
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
      next_action: naverMissing[0]?.next || '네이버 정지 키워드 점검 후 guarded publisher 실행',
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
  approvedOrTestingKeywords: number;
  draftCampaigns: number;
  activeSearchBudgetChannels: number;
  learningEventCount: number;
  productScenarioCandidates: number;
  landingEvolutionCandidates: number;
}) {
  const actions: Array<{
    id: string;
    priority: number;
    label: string;
    description: string;
    button_label: string;
    ui_action: string;
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
    actions.push({
      id: 'naver_setup_packet',
      priority: input.externalLaunchStatus.naver.pass >= 4 ? 2 : 4,
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

export const GET = withAdminGuard(async () => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
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
      .select('id, platform, account_mode, connection_status, monthly_budget_cap_krw, daily_budget_cap_krw, can_publish_keywords, can_change_bids, can_pause_assets, risk_status')
      .order('platform', { ascending: true })
      .limit(100),
    supabaseAdmin
      .from('ad_os_change_requests')
      .select('id, request_type, status, risk_level, platform, title, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
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
    changeRequestRes.error;
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
    status: string | null;
    risk_level: string | null;
  }>;

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
    keywordStatusCounts,
    draftCampaigns,
  });
  const launchActionQueue = buildLaunchActionQueue({
    externalLaunchStatus,
    keywordCandidates,
    approvedOrTestingKeywords: Number(externalLaunchStatus.approved_or_testing_keywords || 0),
    draftCampaigns,
    activeSearchBudgetChannels: channelBudgets.filter((budget) => ['naver', 'google'].includes(budget.platform) && budget.status === 'active' && budget.monthly_budget_krw > 0).length,
    learningEventCount: learningEvents.length,
    productScenarioCandidates: productScenarios.filter((row) => ['candidate', 'queued'].includes(row.status || '')).length,
    landingEvolutionCandidates: landingEvolutionQueue.filter((row) => row.status === 'candidate').length,
  });
  const approvedOrTestingKeywords = Number(externalLaunchStatus.approved_or_testing_keywords || 0);
  const channelExecutionStates = Object.fromEntries(
    ['naver', 'google'].map((platform) => {
      const budget = channelBudgets.find((row) => row.platform === platform);
      const permissionOk = platform === 'google'
        ? false
        : Boolean(integrationStatus[platform as keyof typeof integrationStatus]);

      return [
        platform,
        classifyChannelExecutionState({
          integrationReady: Boolean(integrationStatus[platform as keyof typeof integrationStatus]),
          permissionOk,
          hasCampaign: Boolean(budget?.external_campaign_id),
          hasAdGroup: Boolean(budget?.external_ad_group_id),
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
      budget_pacing_alerts: budgetPacingSnapshots.filter((row) => ['overspend', 'exhausted', 'blocked'].includes(row.status || '')).length,
      tenant_ad_accounts: tenantAdAccounts.length,
      tenant_ad_accounts_ready: tenantAdAccounts.filter((row) => row.connection_status === 'ready').length,
      change_requests_proposed: changeRequests.filter((row) => row.status === 'proposed').length,
      change_requests_high_risk: changeRequests.filter((row) => ['high', 'critical'].includes(row.risk_level || '')).length,
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
      },
      status: {
        has_click_signal: trackedClicks > 0,
        has_cta_signal: trackedCtaClicks > 0,
        has_booking_signal: trackedConversions > 0,
        has_cost_signal: trackedSpendKrw > 0,
        bounce_tracking_ready: engagementSessions > 0,
      },
      next_action: trackedSpendKrw > 0
        ? 'CPA/ROAS 기준으로 키워드 증액, 정지, 제외어 후보를 학습합니다.'
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
});
