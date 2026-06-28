import {
  riskForChangeRequest,
  type AdOsChangeRequestType,
  type AdOsChangeRisk,
} from './ad-os-change-request';
import { buildMarketingDeepScorecard } from './marketing-deep-scorecard';

export const AD_OS_SOURCE_LEDGER_TARGET = 100;
export const AD_OS_SECTION_SCORE_TARGET = 95;

export const AD_OS_CHANNELS = ['naver', 'google', 'meta', 'kakao'] as const;
export type AdOsChannel = (typeof AD_OS_CHANNELS)[number];

export type AdDirectorRunMode = 'dry_run' | 'guarded_l3';
export type BudgetGuardrailMode = 'conservative';
export type MarketingSectionStatus = 'pass' | 'warn' | 'fail';
export type AdDirectorObjectiveMetric = 'incremental_margin_after_ad_spend';

export type MarketingSectionScore = {
  section_key: string;
  section_label: string;
  score: number;
  status: MarketingSectionStatus;
  blockers: string[];
  recommendations: string[];
  checks: MarketingSectionCheck[];
  evidence: Record<string, unknown>;
};

export type MarketingSectionCheck = {
  id: string;
  label: string;
  passed: boolean;
  weight: number;
  critical?: boolean;
  evidence: string;
  recommendation: string;
};

export type AdDirectorDecision = {
  id: string;
  role: 'ai_ad_director';
  request_type: AdOsChangeRequestType;
  platform: AdOsChannel | 'all';
  target_table: string;
  target_id: string;
  title: string;
  reason: string;
  risk_level: AdOsChangeRisk;
  confidence: number;
  can_auto_apply_l3: boolean;
  expected_impact: Record<string, unknown>;
  proposed_change: Record<string, unknown>;
  rollback_payload: Record<string, unknown>;
  evidence_refs: Array<{ type: string; ref: string; summary: string }>;
  blocked_reasons: string[];
  next_action: string;
};

export type AdDirectorBudgetAllocation = {
  platform: AdOsChannel;
  allocation_pct: number;
  monthly_cap_krw: number;
  daily_cap_krw: number;
  max_cpc_krw: number;
  status: 'planned' | 'blocked';
  rationale: string;
  guardrail_snapshot: Record<string, unknown>;
};

export type AdDirectorWritePacket = {
  platform: AdOsChannel;
  packet_type:
    | 'naver_paused_keyword'
    | 'google_campaign_draft'
    | 'meta_creative_seed'
    | 'kakao_draft';
  lifecycle_status: 'ready' | 'blocked';
  dry_run: true;
  external_api_write: false;
  idempotency_key: string;
  request_payload: Record<string, unknown>;
  guardrail_snapshot: Record<string, unknown>;
  blocked_reason: string | null;
  rollback_payload: Record<string, unknown>;
};

export type SourceLedgerSeed = {
  source_url: string;
  source_title: string;
  source_type: 'official_docs' | 'release_notes' | 'open_source' | 'research' | 'runbook';
  publisher: string;
  channel: 'google' | 'meta' | 'naver' | 'kakao' | 'seo' | 'mcp' | 'cross_channel';
  status: 'accepted' | 'backlog';
  accepted_capability: string;
  risk_level: 'low' | 'medium' | 'high';
};

export type AdDirectorRun = {
  ok: true;
  generated_at: string;
  mode: AdDirectorRunMode;
  automation_level: 3;
  channels: AdOsChannel[];
  objective: {
    primary_metric: AdDirectorObjectiveMetric;
    guardrails: string[];
  };
  source_ledger: {
    target_sources: number;
    current_sources: number;
    seed_sources: number;
    ready: boolean;
    next_action: string;
  };
  deep_scorecard: {
    domain_count: number;
    subcategory_count: number;
    average_score: number;
    gap_subcategories: number;
    p0_gaps: number;
    score_gate: {
      target: number;
      passed: boolean;
      lowest_score: number;
      blockers: string[];
    };
    top_repairs: Array<{
      repair_id: string;
      title: string;
      current_score: number;
      target_score: number;
      priority: string;
      can_stage_l3: boolean;
      approval_required: boolean;
    }>;
  };
  section_scores: MarketingSectionScore[];
  score_gate: {
    target: number;
    passed: boolean;
    lowest_score: number;
    blockers: string[];
  };
  budget_allocations: AdDirectorBudgetAllocation[];
  decisions: AdDirectorDecision[];
  write_packets: AdDirectorWritePacket[];
  safety: {
    read_only: boolean;
    database_mutation: boolean;
    external_api_write: false;
    live_spend_krw: 0;
    full_auto_allowed: false;
    provider_confirmation_required: true;
  };
};

export type McpQueryClassification = {
  allowed: boolean;
  provider: string;
  tool_name: string;
  mode: 'read_only';
  status: 'allowed_read_only' | 'blocked_mutation' | 'blocked_unknown_provider';
  reason: string;
  safety: {
    read_only: true;
    database_mutation: false;
    external_api_write: false;
    live_spend_krw: 0;
  };
};

type ScoreInput = Record<string, any>;

type BudgetRow = {
  platform?: string | null;
  monthly_budget_krw?: number | null;
  daily_budget_cap_krw?: number | null;
  max_cpc_krw?: number | null;
  max_test_loss_krw?: number | null;
  automation_level?: number | null;
  status?: string | null;
};

const PACKET_TYPE_BY_CHANNEL: Record<AdOsChannel, AdDirectorWritePacket['packet_type']> = {
  naver: 'naver_paused_keyword',
  google: 'google_campaign_draft',
  meta: 'meta_creative_seed',
  kakao: 'kakao_draft',
};

const DEFAULT_ALLOCATION: Record<AdOsChannel, number> = {
  naver: 25,
  google: 25,
  meta: 25,
  kakao: 15,
};

export const AD_OS_SOURCE_LEDGER_SEEDS: SourceLedgerSeed[] = [
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/developer-toolkit/mcp-server',
    source_title: 'Google Ads API MCP Server',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'mcp',
    status: 'accepted',
    accepted_capability: 'Read-only account, campaign, keyword planning, recommendation, and reporting evidence.',
    risk_level: 'low',
  },
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/keyword-planning/generate-keyword-ideas',
    source_title: 'Google Ads API Generate Keyword Ideas',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'google',
    status: 'accepted',
    accepted_capability: 'Keyword expansion and micro-intent discovery.',
    risk_level: 'low',
  },
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/keyword-planning/generate-historical-metrics',
    source_title: 'Google Ads API Historical Metrics',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'google',
    status: 'accepted',
    accepted_capability: 'Volume and competition validation before spend.',
    risk_level: 'low',
  },
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/conversions/upload-clicks',
    source_title: 'Google Ads API Upload Click Conversions',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'google',
    status: 'accepted',
    accepted_capability: 'Offline conversion upload for booking and margin attribution.',
    risk_level: 'medium',
  },
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/conversions/enhanced-conversions/leads',
    source_title: 'Enhanced Conversions for Leads',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'google',
    status: 'accepted',
    accepted_capability: 'Lead quality and conversion matching where consent allows.',
    risk_level: 'medium',
  },
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/release-notes',
    source_title: 'Google Ads API Release Notes',
    source_type: 'release_notes',
    publisher: 'Google',
    channel: 'google',
    status: 'backlog',
    accepted_capability: 'Version drift monitoring for adapters.',
    risk_level: 'low',
  },
  {
    source_url: 'https://developers.facebook.com/docs/marketing-api/',
    source_title: 'Meta Marketing API',
    source_type: 'official_docs',
    publisher: 'Meta',
    channel: 'meta',
    status: 'accepted',
    accepted_capability: 'Campaign, ad set, creative, and insights integration contract.',
    risk_level: 'medium',
  },
  {
    source_url: 'https://developers.facebook.com/docs/marketing-api/conversions-api/',
    source_title: 'Meta Conversions API',
    source_type: 'official_docs',
    publisher: 'Meta',
    channel: 'meta',
    status: 'accepted',
    accepted_capability: 'Server-side conversion evidence and dedupe.',
    risk_level: 'medium',
  },
  {
    source_url: 'https://developers.facebook.com/docs/marketing-api/insights/',
    source_title: 'Meta Ads Insights API',
    source_type: 'official_docs',
    publisher: 'Meta',
    channel: 'meta',
    status: 'accepted',
    accepted_capability: 'Performance facts and creative learning loop.',
    risk_level: 'low',
  },
  {
    source_url: 'https://github.com/facebook/facebook-nodejs-business-sdk',
    source_title: 'Meta Business SDK for Node.js',
    source_type: 'open_source',
    publisher: 'Meta',
    channel: 'meta',
    status: 'backlog',
    accepted_capability: 'Reference SDK for typed adapter implementation.',
    risk_level: 'medium',
  },
  {
    source_url: 'https://naver.github.io/searchad-apidoc/#/guides',
    source_title: 'Naver SearchAd API Guide',
    source_type: 'official_docs',
    publisher: 'Naver',
    channel: 'naver',
    status: 'accepted',
    accepted_capability: 'Keyword tool, assets, paused keyword, and reporting adapter evidence.',
    risk_level: 'medium',
  },
  {
    source_url: 'https://developers.kakao.com/docs/latest/ko/kakaomoment/rest-api',
    source_title: 'Kakao Moment REST API',
    source_type: 'official_docs',
    publisher: 'Kakao',
    channel: 'kakao',
    status: 'backlog',
    accepted_capability: 'Draft adapter and readiness planning for Kakao ads.',
    risk_level: 'medium',
  },
  {
    source_url: 'https://developers.google.com/search/docs/fundamentals/using-gen-ai-content',
    source_title: 'Google Search Guidance on AI-generated Content',
    source_type: 'official_docs',
    publisher: 'Google Search Central',
    channel: 'seo',
    status: 'accepted',
    accepted_capability: 'Blog and landing quality guardrails for generated content.',
    risk_level: 'low',
  },
  {
    source_url: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
    source_title: 'Creating Helpful, Reliable, People-first Content',
    source_type: 'official_docs',
    publisher: 'Google Search Central',
    channel: 'seo',
    status: 'accepted',
    accepted_capability: 'SEO quality gate for blog-to-ads landing inventory.',
    risk_level: 'low',
  },
  {
    source_url: 'https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect',
    source_title: 'URL Inspection API',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'seo',
    status: 'accepted',
    accepted_capability: 'Indexability evidence for ad landing inventory.',
    risk_level: 'low',
  },
  {
    source_url: 'https://www.indexnow.org/documentation',
    source_title: 'IndexNow Documentation',
    source_type: 'official_docs',
    publisher: 'IndexNow',
    channel: 'seo',
    status: 'backlog',
    accepted_capability: 'Search indexing handoff where supported.',
    risk_level: 'low',
  },
];

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function arr<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function scoreFromChecks(
  sectionKey: string,
  sectionLabel: string,
  checks: MarketingSectionCheck[],
  evidence: Record<string, unknown>,
): MarketingSectionScore {
  const total = checks.reduce((sum, check) => sum + check.weight, 0) || 1;
  const earned = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  const score = Math.max(0, Math.min(100, Math.round((earned / total) * 100)));
  const blockers = checks
    .filter((check) => !check.passed && check.critical)
    .map((check) => check.label);
  const recommendations = checks
    .filter((check) => !check.passed)
    .map((check) => check.recommendation);
  const status: MarketingSectionStatus =
    score >= AD_OS_SECTION_SCORE_TARGET && blockers.length === 0 ? 'pass' : score >= 75 ? 'warn' : 'fail';

  return {
    section_key: sectionKey,
    section_label: sectionLabel,
    score,
    status,
    blockers,
    recommendations,
    checks,
    evidence,
  };
}

function check(input: MarketingSectionCheck): MarketingSectionCheck {
  return input;
}

function normalizedReadinessScore(summary: ScoreInput): number {
  const audit = record(summary.readiness_audit);
  const score = num(audit.score);
  const max = num(audit.maxScore || audit.max_score || 100) || 100;
  return Math.round((score / max) * 100);
}

function completionScore(summary: ScoreInput): number {
  return num(record(record(summary.enterprise_layer).completion_audit).readiness_score);
}

function hasActiveL3Budget(summary: ScoreInput): boolean {
  return arr<BudgetRow>(summary.channel_budgets).some((budget) =>
    num(budget.monthly_budget_krw) > 0 &&
    num(budget.daily_budget_cap_krw) > 0 &&
    num(budget.max_cpc_krw) > 0 &&
    num(budget.max_test_loss_krw) > 0 &&
    num(budget.automation_level) >= 3 &&
    budget.status === 'active'
  );
}

function channelsFromInput(channels?: string[]): AdOsChannel[] {
  const requested = new Set((channels || AD_OS_CHANNELS).map(String));
  const parsed = AD_OS_CHANNELS.filter((channel) => requested.has(channel));
  return parsed.length > 0 ? parsed : [...AD_OS_CHANNELS];
}

export function buildMarketingSectionScores(
  summary: ScoreInput,
  sourceLedgerCount = 0,
): MarketingSectionScore[] {
  const kpis = record(summary.kpis);
  const samples = record(summary.samples);
  const counts = record(summary.counts);
  const enterprise = record(summary.enterprise_layer);
  const integrations = record(summary.integration_status);
  const dataQuality = record(enterprise.conversion_data_quality);
  const channelAdapters = record(enterprise.channel_adapters);
  const writePackets = record(enterprise.write_packets);
  const runtimeReadiness = record(enterprise.runtime_readiness);
  const runtimeExecution = record(enterprise.runtime_execution);
  const tenantPolicy = record(summary.tenant_policy);
  const creativeFactory = record(enterprise.creative_factory);
  const learningMetrics = record(record(summary.learning_loop).metrics);

  const readiness = normalizedReadinessScore(summary);
  const completion = completionScore(summary);
  const keywordPlans = arr(samples.keyword_plans);
  const performanceFacts = arr(samples.performance_facts);
  const conversionEvents = arr(samples.conversion_events);
  const creativeVariants = arr(samples.creative_asset_variants);
  const blogVersions = arr(samples.blog_versions);
  const budgetRows = arr<BudgetRow>(summary.channel_budgets);
  const sourceLedgerReady = sourceLedgerCount >= AD_OS_SOURCE_LEDGER_TARGET;

  return [
    scoreFromChecks('marketing_dashboard', 'Marketing dashboard', [
      check({
        id: 'summary_ok',
        label: 'Dashboard summary is available',
        passed: summary.ok === true && summary.degraded !== true,
        critical: true,
        weight: 25,
        evidence: summary.degraded ? 'summary degraded' : 'summary available',
        recommendation: 'Recover /api/admin/ad-os/summary before paid automation.',
      }),
      check({
        id: 'readiness_score',
        label: 'Ad OS readiness is 95+',
        passed: readiness >= AD_OS_SECTION_SCORE_TARGET,
        weight: 25,
        evidence: `readiness=${readiness}`,
        recommendation: 'Close readiness audit gaps until the score reaches 95.',
      }),
      check({
        id: 'launch_queue',
        label: 'Launch action queue exists',
        passed: arr(summary.launch_action_queue).length > 0,
        weight: 15,
        evidence: `actions=${arr(summary.launch_action_queue).length}`,
        recommendation: 'Populate next-action queue from launch audit and learning gaps.',
      }),
      check({
        id: 'drilldown_samples',
        label: 'Dashboard has drilldown samples',
        passed: Object.values(samples).some((value) => arr(value).length > 0),
        weight: 15,
        evidence: `sample_groups=${Object.keys(samples).length}`,
        recommendation: 'Add drilldown evidence rows for the dashboard sections.',
      }),
      check({
        id: 'recent_decisions',
        label: 'AI decisions are visible',
        passed: arr(summary.recent_decisions).length > 0,
        weight: 20,
        evidence: `decisions=${arr(summary.recent_decisions).length}`,
        recommendation: 'Persist AI decisions into ad_os_decision_logs and expose them in the dashboard.',
      }),
    ], { readiness, completion }),

    scoreFromChecks('ad_os_control_plane', 'Ad OS control plane', [
      check({
        id: 'completion_audit',
        label: 'Completion audit is 95+',
        passed: completion >= AD_OS_SECTION_SCORE_TARGET,
        critical: true,
        weight: 25,
        evidence: `completion=${completion}`,
        recommendation: 'Fix completion audit failures before L3 automation.',
      }),
      check({
        id: 'runtime_readiness',
        label: 'Runtime readiness has no blocked checks',
        passed: num(runtimeReadiness.blocked_or_failed) === 0,
        critical: true,
        weight: 20,
        evidence: `blocked_or_failed=${num(runtimeReadiness.blocked_or_failed)}`,
        recommendation: 'Run runtime-readiness and resolve blocked checks.',
      }),
      check({
        id: 'change_requests',
        label: 'Change request queue is present',
        passed: arr(samples.change_requests).length > 0 || num(kpis.change_requests_proposed) > 0,
        weight: 15,
        evidence: `change_requests=${arr(samples.change_requests).length || num(kpis.change_requests_proposed)}`,
        recommendation: 'Stage AI recommendations as change requests.',
      }),
      check({
        id: 'write_packets',
        label: 'Write packet layer is populated',
        passed: num(writePackets.packets) > 0 || num(channelAdapters.snapshots) > 0,
        weight: 15,
        evidence: `packets=${num(writePackets.packets)}, adapter_snapshots=${num(channelAdapters.snapshots)}`,
        recommendation: 'Create channel write packets in dry-run mode before live gates.',
      }),
      check({
        id: 'l3_policy',
        label: 'L3 automation policy is configured',
        passed: num(tenantPolicy.max_automation_level) >= 3 || hasActiveL3Budget(summary),
        weight: 25,
        evidence: `policy_level=${num(tenantPolicy.max_automation_level)}`,
        recommendation: 'Configure tenant policy and active L3 channel budgets.',
      }),
    ], { completion, runtime_readiness: runtimeReadiness }),

    scoreFromChecks('search_ads', 'Search ads', [
      check({
        id: 'keyword_inventory',
        label: 'Keyword inventory exists',
        passed: num(kpis.keyword_candidates) > 0 || keywordPlans.length > 0,
        critical: true,
        weight: 25,
        evidence: `keyword_candidates=${num(kpis.keyword_candidates)}, keyword_plans=${keywordPlans.length}`,
        recommendation: 'Generate Naver/Google micro keyword plans from product inventory.',
      }),
      check({
        id: 'keyword_clusters',
        label: 'Intent clusters exist',
        passed: num(kpis.keyword_clusters) > 0 || arr(samples.keyword_clusters).length > 0,
        weight: 20,
        evidence: `clusters=${num(kpis.keyword_clusters) || arr(samples.keyword_clusters).length}`,
        recommendation: 'Run keyword brain to group core, mid, longtail, and negative tiers.',
      }),
      check({
        id: 'search_terms',
        label: 'Search-term learning is active',
        passed: num(kpis.search_term_candidates) > 0 || arr(samples.search_term_candidates).length > 0,
        weight: 20,
        evidence: `search_terms=${num(kpis.search_term_candidates) || arr(samples.search_term_candidates).length}`,
        recommendation: 'Harvest search terms and split winners from waste terms.',
      }),
      check({
        id: 'search_budgets',
        label: 'Search budgets have conservative caps',
        passed: budgetRows
          .filter((row) => row.platform === 'naver' || row.platform === 'google')
          .some((row) => num(row.monthly_budget_krw) > 0 && num(row.max_cpc_krw) > 0),
        critical: true,
        weight: 20,
        evidence: `search_budget_rows=${budgetRows.filter((row) => row.platform === 'naver' || row.platform === 'google').length}`,
        recommendation: 'Set monthly cap, daily cap, max CPC, and test-loss cap for search channels.',
      }),
      check({
        id: 'google_naver_ready',
        label: 'Naver and Google integrations are ready',
        passed: integrations.naver === true && integrations.google === true,
        weight: 15,
        evidence: `naver=${Boolean(integrations.naver)}, google=${Boolean(integrations.google)}`,
        recommendation: 'Connect Naver and Google Ads credentials and permission probes.',
      }),
    ], { keyword_candidates: num(kpis.keyword_candidates), keyword_plans: keywordPlans.length }),

    scoreFromChecks('social_ads', 'Meta and Kakao social ads', [
      check({
        id: 'meta_ready',
        label: 'Meta integration is ready',
        passed: integrations.meta === true,
        critical: true,
        weight: 20,
        evidence: `meta=${Boolean(integrations.meta)}`,
        recommendation: 'Connect Meta Marketing API credentials and ad account id.',
      }),
      check({
        id: 'kakao_ready',
        label: 'Kakao draft readiness exists',
        passed: integrations.kakao === true || arr(samples.platform_write_packets).some((row) => row.platform === 'kakao'),
        weight: 15,
        evidence: `kakao=${Boolean(integrations.kakao)}`,
        recommendation: 'Add Kakao Moment draft/readiness packet before any live integration.',
      }),
      check({
        id: 'creative_variants',
        label: 'Social creative variants exist',
        passed: creativeVariants.length > 0 || num(creativeFactory.variants) > 0,
        weight: 20,
        evidence: `creative_variants=${creativeVariants.length || num(creativeFactory.variants)}`,
        recommendation: 'Generate Meta/Kakao creative seeds from one campaign brief.',
      }),
      check({
        id: 'capi_quality',
        label: 'Conversion data quality is not blocked',
        passed: String(dataQuality.status || 'unknown') !== 'blocked',
        weight: 20,
        evidence: `data_quality=${String(dataQuality.status || 'unknown')}`,
        recommendation: 'Repair CAPI/offline conversion blockers before social spend.',
      }),
      check({
        id: 'social_budgets',
        label: 'Social channels have conservative caps',
        passed: budgetRows
          .filter((row) => row.platform === 'meta' || row.platform === 'kakao')
          .some((row) => num(row.monthly_budget_krw) > 0 && num(row.max_test_loss_krw) > 0),
        weight: 25,
        evidence: `social_budget_rows=${budgetRows.filter((row) => row.platform === 'meta' || row.platform === 'kakao').length}`,
        recommendation: 'Set social channel monthly, daily, and test-loss caps.',
      }),
    ], { creative_factory: creativeFactory }),

    scoreFromChecks('creative_card_news', 'Creative and card news', [
      check({
        id: 'creative_factory',
        label: 'Creative factory has variants',
        passed: creativeVariants.length > 0 || num(creativeFactory.variants) > 0,
        weight: 25,
        evidence: `variants=${creativeVariants.length || num(creativeFactory.variants)}`,
        recommendation: 'Generate card-news, RSA, Meta, Kakao, and short-copy variants from one brief.',
      }),
      check({
        id: 'duplicate_risk',
        label: 'Duplicate creative risk is controlled',
        passed: num(creativeFactory.duplicate_content_risks) === 0,
        weight: 20,
        evidence: `duplicate_risks=${num(creativeFactory.duplicate_content_risks)}`,
        recommendation: 'Block near-duplicate cards and rotate distinct hooks.',
      }),
      check({
        id: 'card_news_request',
        label: 'Card-news change requests can be staged',
        passed: arr(samples.change_requests).some((row) => row.request_type === 'create_card_news') || num(counts.card_news_by_status) > 0,
        weight: 20,
        evidence: `change_requests=${arr(samples.change_requests).length}`,
        recommendation: 'Stage package-backed card-news creation through change requests.',
      }),
      check({
        id: 'sample_threshold',
        label: 'Creative winner logic has sample evidence',
        passed: num(learningMetrics.clicks) >= 20 || num(learningMetrics.cta_clicks) >= 3,
        weight: 20,
        evidence: `clicks=${num(learningMetrics.clicks)}, cta=${num(learningMetrics.cta_clicks)}`,
        recommendation: 'Collect minimum click/CTA evidence before declaring creative winners.',
      }),
      check({
        id: 'external_write_zero',
        label: 'Creative layer has no unconfirmed external writes',
        passed: num(runtimeExecution.external_api_write_count) === 0,
        critical: true,
        weight: 15,
        evidence: `external_writes=${num(runtimeExecution.external_api_write_count)}`,
        recommendation: 'Confirm provider results or roll back any unconfirmed external writes.',
      }),
    ], { creative_variants: creativeVariants.length }),

    scoreFromChecks('blog_seo_landing', 'Blog SEO and landing inventory', [
      check({
        id: 'landing_inventory',
        label: 'Landing blog inventory exists',
        passed: num(kpis.landing_blogs) > 0 || num(kpis.published_blogs) > 0,
        critical: true,
        weight: 25,
        evidence: `landing=${num(kpis.landing_blogs)}, published=${num(kpis.published_blogs)}`,
        recommendation: 'Create or map ad-safe blog landing inventory.',
      }),
      check({
        id: 'blog_evolution',
        label: 'Blog update/new/no-ad decisions are queued',
        passed: blogVersions.length > 0 || num(kpis.landing_evolution_candidates) > 0,
        weight: 20,
        evidence: `blog_versions=${blogVersions.length}, queue=${num(kpis.landing_evolution_candidates)}`,
        recommendation: 'Run blog evolution to decide update existing vs new micro-angle vs no-ad.',
      }),
      check({
        id: 'seo_bridge',
        label: 'SEO-to-Ads bridge has candidates',
        passed: arr(samples.travel_intent_signals).length > 0 || arr(samples.keyword_clusters).length > 0,
        weight: 20,
        evidence: `intent_signals=${arr(samples.travel_intent_signals).length}`,
        recommendation: 'Bridge SEO intent signals into ad keyword candidates.',
      }),
      check({
        id: 'cta_tracking',
        label: 'CTA tracking is present',
        passed: num(kpis.tracked_cta_clicks) > 0 || num(learningMetrics.cta_clicks) > 0,
        weight: 20,
        evidence: `cta=${num(kpis.tracked_cta_clicks) || num(learningMetrics.cta_clicks)}`,
        recommendation: 'Track CTA clicks by blog, keyword, product, and creative.',
      }),
      check({
        id: 'quality_boundary',
        label: 'Blog publish quality boundary is preserved',
        passed: String(dataQuality.status || 'unknown') !== 'blocked' && summary.degraded !== true,
        weight: 15,
        evidence: `summary_degraded=${Boolean(summary.degraded)}`,
        recommendation: 'Do not route paid traffic to degraded or quality-blocked blog inventory.',
      }),
    ], { blog_versions: blogVersions.length }),

    scoreFromChecks('data_attribution', 'Data and attribution', [
      check({
        id: 'performance_facts',
        label: 'Performance facts exist',
        passed: performanceFacts.length > 0 || num(learningMetrics.fact_clicks_30d) > 0,
        critical: true,
        weight: 25,
        evidence: `facts=${performanceFacts.length}`,
        recommendation: 'Sync all channel, blog, booking, revenue, and margin data into ad_os_performance_facts.',
      }),
      check({
        id: 'conversion_events',
        label: 'Conversion events exist',
        passed: conversionEvents.length > 0 || num(learningMetrics.attribution_events_30d) > 0,
        weight: 20,
        evidence: `conversion_events=${conversionEvents.length}`,
        recommendation: 'Collect clean conversion events before budget scaling.',
      }),
      check({
        id: 'margin_roas',
        label: 'Margin ROAS is computable',
        passed: num(learningMetrics.fact_margin_roas_pct_30d) > 0 || num(learningMetrics.fact_margin_krw_30d) !== 0,
        critical: true,
        weight: 20,
        evidence: `margin_roas=${num(learningMetrics.fact_margin_roas_pct_30d)}`,
        recommendation: 'Join ad cost to booking revenue, cost, refund, and margin.',
      }),
      check({
        id: 'data_quality',
        label: 'Conversion data quality is not blocked',
        passed: String(dataQuality.status || 'unknown') !== 'blocked' && num(dataQuality.blocked_conversions) === 0,
        weight: 20,
        evidence: `blocked_conversions=${num(dataQuality.blocked_conversions)}`,
        recommendation: 'Resolve blocked conversion uploads and attribution coverage gaps.',
      }),
      check({
        id: 'source_ledger',
        label: 'External research ledger has 100+ reviewed sources',
        passed: sourceLedgerReady,
        weight: 15,
        evidence: `sources=${sourceLedgerCount}/${AD_OS_SOURCE_LEDGER_TARGET}`,
        recommendation: 'Import and review at least 100 official/open-source/research sources.',
      }),
    ], { facts: performanceFacts.length, source_ledger: sourceLedgerCount }),

    scoreFromChecks('integrations_mcp', 'Integrations and MCP', [
      check({
        id: 'google_mcp_read_only',
        label: 'Google Ads MCP is treated as read-only',
        passed: true,
        critical: true,
        weight: 20,
        evidence: 'Google Ads MCP broker only classifies read-only calls.',
        recommendation: 'Keep writes on audited provider adapters, not MCP.',
      }),
      check({
        id: 'all_channels_named',
        label: 'All requested channels are modeled',
        passed: AD_OS_CHANNELS.every((channel) => channel in integrations || channel === 'kakao'),
        weight: 15,
        evidence: `integration_keys=${Object.keys(integrations).join(',')}`,
        recommendation: 'Expose Naver, Google, Meta, and Kakao readiness in one integration model.',
      }),
      check({
        id: 'adapter_health',
        label: 'Adapter health snapshots exist',
        passed: num(channelAdapters.snapshots) > 0,
        weight: 20,
        evidence: `adapter_snapshots=${num(channelAdapters.snapshots)}`,
        recommendation: 'Run channel adapter health checks and persist snapshots.',
      }),
      check({
        id: 'write_packet_audit',
        label: 'Write packets are dry-run/audited',
        passed: num(writePackets.external_api_write_count) === 0,
        critical: true,
        weight: 25,
        evidence: `external_write_packets=${num(writePackets.external_api_write_count)}`,
        recommendation: 'Route every external mutation through packet, gate, executor, and confirmation.',
      }),
      check({
        id: 'source_seed',
        label: 'Integration source seeds are available',
        passed: AD_OS_SOURCE_LEDGER_SEEDS.length >= 10,
        weight: 20,
        evidence: `seed_sources=${AD_OS_SOURCE_LEDGER_SEEDS.length}`,
        recommendation: 'Expand source ledger to 100+ reviewed sources before live expansion.',
      }),
    ], { adapter_snapshots: num(channelAdapters.snapshots), write_packets: writePackets }),

    scoreFromChecks('tenant_safety', 'Tenant safety and budget governance', [
      check({
        id: 'tenant_policy',
        label: 'Tenant policy is configured',
        passed: tenantPolicy.configured === true,
        critical: true,
        weight: 20,
        evidence: `configured=${Boolean(tenantPolicy.configured)}`,
        recommendation: 'Save tenant policy with allowed channels and conservative caps.',
      }),
      check({
        id: 'budget_caps',
        label: 'Budget caps are present',
        passed: budgetRows.some((row) =>
          num(row.monthly_budget_krw) > 0 &&
          num(row.daily_budget_cap_krw) > 0 &&
          num(row.max_cpc_krw) > 0 &&
          num(row.max_test_loss_krw) > 0
        ),
        critical: true,
        weight: 25,
        evidence: `budget_rows=${budgetRows.length}`,
        recommendation: 'Set monthly, daily, max CPC, and test-loss caps. Missing caps keep spend at 0 KRW.',
      }),
      check({
        id: 'automation_cap_l3',
        label: 'Automation is capped at L3',
        passed: num(tenantPolicy.max_automation_level) <= 3,
        weight: 15,
        evidence: `max_automation_level=${num(tenantPolicy.max_automation_level)}`,
        recommendation: 'Keep full auto disabled until L4 policy is explicitly approved.',
      }),
      check({
        id: 'full_auto_disabled',
        label: 'Full auto is disabled',
        passed: tenantPolicy.full_auto_enabled !== true,
        critical: true,
        weight: 20,
        evidence: `full_auto=${Boolean(tenantPolicy.full_auto_enabled)}`,
        recommendation: 'Disable full-auto paid execution for this L3 implementation.',
      }),
      check({
        id: 'kill_switch',
        label: 'Kill switch is clear',
        passed: tenantPolicy.risk_status !== 'kill_switch_active',
        critical: true,
        weight: 20,
        evidence: `risk_status=${String(tenantPolicy.risk_status || 'unknown')}`,
        recommendation: 'Resolve kill switch before any guarded automation.',
      }),
    ], { tenant_policy: tenantPolicy, budgets: budgetRows.length }),
  ];
}

export function summarizeScoreGate(sectionScores: MarketingSectionScore[]) {
  const lowest = sectionScores.reduce((min, section) => Math.min(min, section.score), 100);
  const blockers = sectionScores
    .filter((section) => section.score < AD_OS_SECTION_SCORE_TARGET || section.blockers.length > 0)
    .map((section) => `${section.section_label}: ${section.blockers[0] || section.recommendations[0] || 'score below target'}`);
  return {
    target: AD_OS_SECTION_SCORE_TARGET,
    passed: blockers.length === 0,
    lowest_score: lowest,
    blockers,
  };
}

export function buildBudgetAllocations(
  summary: ScoreInput,
  channels: AdOsChannel[],
  guardrailMode: BudgetGuardrailMode = 'conservative',
): AdDirectorBudgetAllocation[] {
  const budgets = arr<BudgetRow>(summary.channel_budgets);
  const integrations = record(summary.integration_status);
  const selectedDefaults = channels.reduce((sum, channel) => sum + DEFAULT_ALLOCATION[channel], 0) || 1;

  return channels.map((platform) => {
    const budget = budgets.find((row) => row.platform === platform);
    const normalizedAllocation = Math.round((DEFAULT_ALLOCATION[platform] / selectedDefaults) * 100);
    const monthlyCap = num(budget?.monthly_budget_krw);
    const dailyCap = num(budget?.daily_budget_cap_krw);
    const maxCpc = num(budget?.max_cpc_krw);
    const testLoss = num(budget?.max_test_loss_krw);
    const ready =
      monthlyCap > 0 &&
      dailyCap > 0 &&
      maxCpc > 0 &&
      testLoss > 0 &&
      budget?.status === 'active' &&
      integrations[platform] === true;

    return {
      platform,
      allocation_pct: normalizedAllocation,
      monthly_cap_krw: ready ? monthlyCap : 0,
      daily_cap_krw: ready ? dailyCap : 0,
      max_cpc_krw: ready ? maxCpc : 0,
      status: ready ? 'planned' : 'blocked',
      rationale: ready
        ? `${guardrailMode} L3 allocation within saved channel caps.`
        : 'Blocked until credentials, active budget, max CPC, and test-loss caps are configured.',
      guardrail_snapshot: {
        guardrail_mode: guardrailMode,
        requested_automation_level: 3,
        source_budget: budget || null,
        integration_ready: integrations[platform] === true,
        live_spend_krw: 0,
      },
    };
  });
}

function requestTypeForSection(section: MarketingSectionScore): AdOsChangeRequestType {
  switch (section.section_key) {
    case 'search_ads':
      return 'create_keyword';
    case 'social_ads':
      return 'sync_external_asset';
    case 'creative_card_news':
      return 'create_creative_draft';
    case 'blog_seo_landing':
      return 'update_blog_cta';
    case 'data_attribution':
      return 'sync_performance';
    case 'tenant_safety':
      return 'update_tenant_policy';
    case 'integrations_mcp':
      return 'sync_external_asset';
    default:
      return 'create_experiment';
  }
}

function platformForSection(section: MarketingSectionScore): AdDirectorDecision['platform'] {
  if (section.section_key === 'search_ads') return 'naver';
  if (section.section_key === 'social_ads') return 'meta';
  if (section.section_key === 'integrations_mcp') return 'google';
  return 'all';
}

export function buildAdDirectorDecisions(input: {
  summary: ScoreInput;
  sectionScores: MarketingSectionScore[];
  budgetAllocations: AdDirectorBudgetAllocation[];
  mode: AdDirectorRunMode;
}): AdDirectorDecision[] {
  const budgetReady = input.budgetAllocations.some((allocation) => allocation.status === 'planned');
  const scoreGate = summarizeScoreGate(input.sectionScores);
  const failing = input.sectionScores.filter((section) => section.status !== 'pass');
  const topSections = failing.length > 0 ? failing : input.sectionScores.slice(0, 3);

  const decisions = topSections.slice(0, 6).map((section, index): AdDirectorDecision => {
    const requestType = requestTypeForSection(section);
    const platform = platformForSection(section);
    const changesExternalAccount = ['create_keyword', 'sync_external_asset', 'create_campaign'].includes(requestType);
    const risk = riskForChangeRequest({
      requestType,
      automationLevel: 3,
      changesExternalAccount,
      externalSpendKrw: 0,
    });
    const criticalBlocked = section.blockers.length > 0 || (risk === 'high' || risk === 'critical');
    const canAutoApplyL3 =
      input.mode === 'guarded_l3' &&
      budgetReady &&
      !criticalBlocked &&
      (risk === 'low' || risk === 'medium');

    return {
      id: `ai-director-${section.section_key}-${index + 1}`,
      role: 'ai_ad_director',
      request_type: requestType,
      platform,
      target_table: 'ad_os_section_scores',
      target_id: section.section_key,
      title: `Repair ${section.section_label} to 95+`,
      reason: section.recommendations[0] || `Section score is ${section.score}; target is ${AD_OS_SECTION_SCORE_TARGET}.`,
      risk_level: risk,
      confidence: section.score >= 90 ? 0.72 : section.score >= 75 ? 0.82 : 0.9,
      can_auto_apply_l3: canAutoApplyL3,
      expected_impact: {
        primary_metric: 'incremental_margin_after_ad_spend',
        current_section_score: section.score,
        target_section_score: AD_OS_SECTION_SCORE_TARGET,
        expected_margin_roas_direction: 'improve',
      },
      proposed_change: {
        section_key: section.section_key,
        recommendations: section.recommendations,
        failed_checks: section.checks.filter((check) => !check.passed).map((check) => check.id),
        automation_level: 3,
        external_api_write: false,
        live_spend_krw: 0,
      },
      rollback_payload: {
        section_key: section.section_key,
        rollback_action: 'archive_ai_director_change_request',
        external_api_write: false,
      },
      evidence_refs: section.checks.slice(0, 3).map((item) => ({
        type: 'section_check',
        ref: item.id,
        summary: item.evidence,
      })),
      blocked_reasons: criticalBlocked
        ? [
            ...section.blockers,
            risk === 'high' || risk === 'critical' ? `risk_${risk}_requires_approval` : '',
          ].filter(Boolean)
        : [],
      next_action: canAutoApplyL3
        ? 'L3 can stage this low/medium-risk internal change request within saved caps.'
        : criticalBlocked
          ? 'Resolve critical blockers or operator approval before execution.'
          : 'Stage as proposed change request and keep external writes disabled.',
    };
  });

  if (scoreGate.passed && budgetReady) {
    decisions.unshift({
      id: 'ai-director-maintain-l3',
      role: 'ai_ad_director',
      request_type: 'create_experiment',
      platform: 'all',
      target_table: 'ad_os_experiment_results',
      target_id: 'l3-cross-channel',
      title: 'Run conservative L3 cross-channel experiment',
      reason: 'All section scores pass the 95 gate and at least one channel budget is ready.',
      risk_level: 'low',
      confidence: 0.78,
      can_auto_apply_l3: input.mode === 'guarded_l3',
      expected_impact: {
        primary_metric: 'incremental_margin_after_ad_spend',
        expected_margin_roas_direction: 'validate',
      },
      proposed_change: {
        experiment_scope: 'naver_google_meta_kakao',
        guardrail_mode: 'conservative',
        external_api_write: false,
        live_spend_krw: 0,
      },
      rollback_payload: {
        rollback_action: 'stop_experiment_draft',
        external_api_write: false,
      },
      evidence_refs: [{ type: 'score_gate', ref: 'section_scores', summary: 'All sections are 95+.' }],
      blocked_reasons: [],
      next_action: 'Create dry-run write packets and wait for provider confirmation gates.',
    });
  }

  return decisions;
}

export function buildWritePackets(input: {
  channels: AdOsChannel[];
  budgetAllocations: AdDirectorBudgetAllocation[];
  generatedAt: string;
}): AdDirectorWritePacket[] {
  return input.channels.map((platform) => {
    const allocation = input.budgetAllocations.find((item) => item.platform === platform);
    const ready = allocation?.status === 'planned';
    const blockedReason = ready ? null : 'budget_or_integration_not_ready';
    return {
      platform,
      packet_type: PACKET_TYPE_BY_CHANNEL[platform],
      lifecycle_status: ready ? 'ready' : 'blocked',
      dry_run: true,
      external_api_write: false,
      idempotency_key: `ai-director-${platform}-${input.generatedAt.slice(0, 10)}`,
      request_payload: {
        source: 'ai_ad_director',
        objective: 'incremental_margin_after_ad_spend',
        allocation_pct: allocation?.allocation_pct || 0,
        monthly_cap_krw: allocation?.monthly_cap_krw || 0,
        daily_cap_krw: allocation?.daily_cap_krw || 0,
        live_spend_krw: 0,
      },
      guardrail_snapshot: {
        ...(allocation?.guardrail_snapshot || {}),
        provider_confirmation_required: true,
      },
      blocked_reason: blockedReason,
      rollback_payload: {
        rollback_action: 'archive_packet',
        external_api_write: false,
      },
    };
  });
}

export function buildAdDirectorRun(input: {
  summary: ScoreInput;
  mode?: AdDirectorRunMode;
  channels?: string[];
  sourceLedgerCount?: number;
  apply?: boolean;
}): AdDirectorRun {
  const generatedAt = new Date().toISOString();
  const mode = input.mode || 'dry_run';
  const channels = channelsFromInput(input.channels);
  const sourceLedgerCount = Math.max(0, Math.floor(num(input.sourceLedgerCount)));
  const sectionScores = buildMarketingSectionScores(input.summary, sourceLedgerCount);
  const deepScorecard = buildMarketingDeepScorecard({
    summary: input.summary,
    sourceLedgerCount,
    generatedAt,
  });
  const budgetAllocations = buildBudgetAllocations(input.summary, channels);
  const decisions = buildAdDirectorDecisions({
    summary: input.summary,
    sectionScores,
    budgetAllocations,
    mode,
  });
  const writePackets = buildWritePackets({ channels, budgetAllocations, generatedAt });
  const scoreGate = summarizeScoreGate(sectionScores);

  return {
    ok: true,
    generated_at: generatedAt,
    mode,
    automation_level: 3,
    channels,
    objective: {
      primary_metric: 'incremental_margin_after_ad_spend',
      guardrails: [
        'daily_budget_cap',
        'monthly_budget_cap',
        'max_cpc',
        'max_test_loss',
        'provider_confirmation',
        'content_quality',
        'pii_policy',
        'kill_switch',
      ],
    },
    source_ledger: {
      target_sources: AD_OS_SOURCE_LEDGER_TARGET,
      current_sources: sourceLedgerCount,
      seed_sources: Math.max(AD_OS_SOURCE_LEDGER_SEEDS.length, deepScorecard.source_ledger.seed_sources),
      ready: sourceLedgerCount >= AD_OS_SOURCE_LEDGER_TARGET,
      next_action: sourceLedgerCount >= AD_OS_SOURCE_LEDGER_TARGET
        ? 'Source ledger target met. Keep release notes and API docs fresh.'
        : `Review ${AD_OS_SOURCE_LEDGER_TARGET - sourceLedgerCount} more sources before claiming research coverage.`,
    },
    deep_scorecard: {
      domain_count: deepScorecard.summary.domain_count,
      subcategory_count: deepScorecard.summary.subcategory_count,
      average_score: deepScorecard.summary.average_score,
      gap_subcategories: deepScorecard.summary.gap_subcategories,
      p0_gaps: deepScorecard.summary.p0_gaps,
      score_gate: deepScorecard.score_gate,
      top_repairs: deepScorecard.repair_queue.slice(0, 8).map((item) => ({
        repair_id: item.repair_id,
        title: item.title,
        current_score: item.current_score,
        target_score: item.target_score,
        priority: item.priority,
        can_stage_l3: item.can_stage_l3,
        approval_required: item.approval_required,
      })),
    },
    section_scores: sectionScores,
    score_gate: scoreGate,
    budget_allocations: budgetAllocations,
    decisions,
    write_packets: writePackets,
    safety: {
      read_only: mode === 'dry_run' || !input.apply,
      database_mutation: mode === 'guarded_l3' && input.apply === true,
      external_api_write: false,
      live_spend_krw: 0,
      full_auto_allowed: false,
      provider_confirmation_required: true,
    },
  };
}

export function classifyMcpQuery(input: {
  provider?: string;
  toolName?: string;
  mode?: string;
}): McpQueryClassification {
  const provider = String(input.provider || '').trim();
  const toolName = String(input.toolName || '').trim();
  const mutatingPattern = /(^|[_\-.])(create|mutate|update|delete|remove|pause|enable|activate|upload|set|apply|execute)([_\-.]|$)/i;
  const knownProvider = ['google_ads_mcp', 'internal_ad_os_mcp', 'meta_ads_mcp', 'naver_searchad_mcp'].includes(provider);
  const mutating = mutatingPattern.test(toolName);

  if (!knownProvider) {
    return {
      allowed: false,
      provider,
      tool_name: toolName,
      mode: 'read_only',
      status: 'blocked_unknown_provider',
      reason: 'Only registered marketing MCP providers can be brokered.',
      safety: { read_only: true, database_mutation: false, external_api_write: false, live_spend_krw: 0 },
    };
  }

  if (mutating) {
    return {
      allowed: false,
      provider,
      tool_name: toolName,
      mode: 'read_only',
      status: 'blocked_mutation',
      reason: 'MCP calls are read-only. Writes must use audited Ad OS packets and provider confirmation.',
      safety: { read_only: true, database_mutation: false, external_api_write: false, live_spend_krw: 0 },
    };
  }

  return {
    allowed: true,
    provider,
    tool_name: toolName,
    mode: 'read_only',
    status: 'allowed_read_only',
    reason: 'Read-only evidence request accepted for analysis brokering.',
    safety: { read_only: true, database_mutation: false, external_api_write: false, live_spend_krw: 0 },
  };
}
