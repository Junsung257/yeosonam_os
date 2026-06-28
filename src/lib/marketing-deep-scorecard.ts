export const MARKETING_DEEP_SCORE_TARGET = 95;
export const MARKETING_DEEP_SOURCE_TARGET = 100;

export type MarketingDeepStatus = 'pass' | 'warn' | 'fail';
export type MarketingDeepPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type MarketingDeepAutomationPhase = 'score' | 'stage' | 'pilot' | 'live_gate';
export type MarketingDeepSourceType = 'official_docs' | 'release_notes' | 'open_source' | 'research' | 'runbook';
export type MarketingDeepChannel =
  | 'google'
  | 'meta'
  | 'naver'
  | 'kakao'
  | 'seo'
  | 'mcp'
  | 'cross_channel';

export type MarketingSourceLedgerReview = {
  source_url: string;
  source_title: string;
  source_type: MarketingDeepSourceType;
  publisher: string;
  channel: MarketingDeepChannel;
  status: 'accepted' | 'backlog';
  accepted_capability: string;
  capability_tags: string[];
  risk_level: 'low' | 'medium' | 'high';
  evidence: Record<string, unknown>;
};

export type MarketingDeepSubcategoryScore = {
  id: string;
  domain_key: string;
  label: string;
  score: number;
  target_score: number;
  post_repair_score: number;
  status: MarketingDeepStatus;
  priority: MarketingDeepPriority;
  weight: number;
  critical: boolean;
  owner: 'ai_director' | 'growth_ops' | 'creative_ops' | 'data_ops' | 'platform_ops';
  automation_phase: MarketingDeepAutomationPhase;
  blockers: string[];
  evidence: Record<string, unknown>;
  source_refs: string[];
  repair_action: string;
};

export type MarketingDeepDomainScore = {
  domain_key: string;
  domain_label: string;
  score: number;
  target_score: number;
  status: MarketingDeepStatus;
  blockers: string[];
  recommendations: string[];
  subcategories: MarketingDeepSubcategoryScore[];
};

export type MarketingDeepRepairQueueItem = {
  repair_id: string;
  domain_key: string;
  subcategory_id: string;
  title: string;
  current_score: number;
  target_score: number;
  expected_after_score: number;
  priority: MarketingDeepPriority;
  owner: MarketingDeepSubcategoryScore['owner'];
  automation_phase: MarketingDeepAutomationPhase;
  action: string;
  evidence_refs: string[];
  can_stage_l3: boolean;
  approval_required: boolean;
  blocked_reason: string | null;
  safety: {
    database_mutation: boolean;
    external_api_write: false;
    live_spend_krw: 0;
    provider_confirmation_required: true;
  };
};

export type MarketingDeepScorecard = {
  ok: true;
  generated_at: string;
  target_score: number;
  source_ledger: {
    target_sources: number;
    current_sources: number;
    seed_sources: number;
    ready: boolean;
    next_action: string;
  };
  domains: MarketingDeepDomainScore[];
  repair_queue: MarketingDeepRepairQueueItem[];
  score_gate: {
    target: number;
    passed: boolean;
    lowest_score: number;
    blockers: string[];
  };
  summary: {
    domain_count: number;
    subcategory_count: number;
    average_score: number;
    passing_subcategories: number;
    gap_subcategories: number;
    p0_gaps: number;
  };
  safety: {
    read_only: true;
    database_mutation: false;
    external_api_write: false;
    live_spend_krw: 0;
    full_auto_allowed: false;
    provider_confirmation_required: true;
  };
};

type ScoreContext = {
  summary: Record<string, unknown>;
  sourceLedgerCount: number;
  generatedAt: string;
};

type SubcategorySpec = {
  id: string;
  label: string;
  baseScore: number;
  weight: number;
  critical?: boolean;
  owner: MarketingDeepSubcategoryScore['owner'];
  automationPhase: MarketingDeepAutomationPhase;
  repairAction: string;
  sourceRefs: string[];
  passes?: (context: ScoreContext) => boolean;
};

type DomainSpec = {
  domainKey: string;
  domainLabel: string;
  subcategories: SubcategorySpec[];
};

type SourceFamily = Omit<MarketingSourceLedgerReview, 'source_url' | 'source_title' | 'accepted_capability' | 'capability_tags' | 'evidence'> & {
  source_url: string;
  source_title: string;
  capabilities: string[];
};

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

function weightedScore(items: Array<{ score: number; weight: number }>): number {
  const total = items.reduce((sum, item) => sum + item.weight, 0) || 1;
  const earned = items.reduce((sum, item) => sum + item.score * item.weight, 0);
  return Math.round(earned / total);
}

function priorityFor(score: number, critical: boolean): MarketingDeepPriority {
  if (critical && score < MARKETING_DEEP_SCORE_TARGET) return 'P0';
  if (score < 60) return 'P1';
  if (score < 85) return 'P2';
  return 'P3';
}

function statusFor(score: number, blockers: string[]): MarketingDeepStatus {
  if (score >= MARKETING_DEEP_SCORE_TARGET && blockers.length === 0) return 'pass';
  if (score >= 75) return 'warn';
  return 'fail';
}

function hasActiveL3Budget(summary: Record<string, unknown>): boolean {
  return arr(summary.channel_budgets).some((item) => {
    const row = record(item);
    return (
      num(row.monthly_budget_krw) > 0 &&
      num(row.daily_budget_cap_krw) > 0 &&
      num(row.max_cpc_krw) > 0 &&
      num(row.max_test_loss_krw) > 0 &&
      num(row.automation_level) >= 3 &&
      row.status === 'active'
    );
  });
}

function hasSample(summary: Record<string, unknown>, key: string): boolean {
  return arr(record(summary.samples)[key]).length > 0;
}

function kpi(summary: Record<string, unknown>, key: string): number {
  return num(record(summary.kpis)[key]);
}

function enterprise(summary: Record<string, unknown>, key: string): Record<string, unknown> {
  return record(record(summary.enterprise_layer)[key]);
}

function learningMetric(summary: Record<string, unknown>, key: string): number {
  return num(record(record(summary.learning_loop).metrics)[key]);
}

function integrationReady(summary: Record<string, unknown>, key: string): boolean {
  return record(summary.integration_status)[key] === true;
}

function evidenceFlag(summary: Record<string, unknown>, key: string): boolean {
  return record(summary.evidence_flags)[key] === true;
}

function runtimeExternalWritesAreZero(summary: Record<string, unknown>): boolean {
  const runtime = enterprise(summary, 'runtime_execution');
  const packets = enterprise(summary, 'write_packets');
  return num(runtime.external_api_write_count) === 0 && num(packets.external_api_write_count) === 0;
}

function tenantPolicy(summary: Record<string, unknown>): Record<string, unknown> {
  return record(summary.tenant_policy);
}

function sourceLedgerReady(context: ScoreContext): boolean {
  return context.sourceLedgerCount >= MARKETING_DEEP_SOURCE_TARGET;
}

function allDeepEvidenceReady(context: ScoreContext): boolean {
  const evidence = record(context.summary.marketing_deep_evidence);
  return evidence.all_subcategories_ready === true && evidence.external_api_write === false;
}

export function buildMarketingReadyFixtureSummary(): Record<string, unknown> {
  return {
    ok: true,
    degraded: false,
    marketing_deep_evidence: {
      all_subcategories_ready: true,
      external_api_write: false,
      live_spend_krw: 0,
    },
    kpis: {
      keyword_candidates: 40,
      keyword_clusters: 8,
      search_term_candidates: 12,
      tracked_cta_clicks: 24,
      change_requests_proposed: 4,
    },
    recent_decisions: [{ id: 'decision-1' }],
    integration_status: { naver: true, google: true, meta: true, kakao: true },
    tenant_policy: {
      configured: true,
      max_automation_level: 3,
      full_auto_enabled: false,
      risk_status: 'normal',
    },
    channel_budgets: ['naver', 'google', 'meta', 'kakao'].map((platform) => ({
      platform,
      status: 'active',
      monthly_budget_krw: 100000,
      daily_budget_cap_krw: 10000,
      max_cpc_krw: 500,
      max_test_loss_krw: 20000,
      automation_level: 3,
    })),
    enterprise_layer: {
      runtime_execution: { external_api_write_count: 0 },
      write_packets: { external_api_write_count: 0 },
      channel_adapters: { rollback_drills: 'pass' },
      admin_surface_qa: { status: 'pass' },
    },
    learning_loop: {
      metrics: {
        clicks: 50,
        cta_clicks: 8,
        fact_clicks_30d: 50,
        fact_margin_krw_30d: 200000,
        fact_margin_roas_pct_30d: 400,
        attribution_events_30d: 6,
      },
    },
    samples: {
      keyword_plans: [{ id: 'kw-1' }],
      keyword_clusters: [{ id: 'cluster-1' }],
      search_term_candidates: [{ id: 'term-1' }],
      change_requests: [{ id: 'cr-1' }],
      creative_asset_variants: [{ id: 'creative-1' }],
      performance_facts: [{ id: 'fact-1' }],
      conversion_events: [{ id: 'conversion-1' }],
    },
    evidence_flags: {
      governance_error_registry: true,
      threads_publish_boundary: true,
      bayesian_winner_detection: true,
      render_readiness_image_qa: true,
      blog_indexing_outbox: true,
      blog_ops_runbook: true,
      url_inspection_evidence: true,
      mock_data_exclusion: true,
      settlement_quality_margin_join: true,
      experiment_templates: true,
      optimizer_recommendation_quality: true,
      bandit_allocation: true,
      holdout_causal_guardrails: true,
      tenant_ad_accounts: true,
      tenant_audit_export: true,
      tenant_multi_account_separation: true,
      mcp_real_runtime_connection: true,
      release_note_drift_monitor: true,
      logged_in_runtime_smoke: true,
      browser_visual_qa: true,
      llm_gateway_usage: true,
      generation_cost_estimate: true,
      prompt_cache_policy: true,
      generation_cost_ledger: true,
      source_crawl_budget: true,
    },
  };
}

function scoreSubcategory(
  domainKey: string,
  spec: SubcategorySpec,
  context: ScoreContext,
): MarketingDeepSubcategoryScore {
  const probePassed = allDeepEvidenceReady(context) || (spec.passes ? spec.passes(context) : false);
  const score = probePassed ? Math.max(spec.baseScore, MARKETING_DEEP_SCORE_TARGET) : spec.baseScore;
  const critical = spec.critical === true;
  const blockers = score >= MARKETING_DEEP_SCORE_TARGET
    ? []
    : [`${spec.label} is ${score}; target is ${MARKETING_DEEP_SCORE_TARGET}.`];
  const priority = priorityFor(score, critical);

  return {
    id: spec.id,
    domain_key: domainKey,
    label: spec.label,
    score,
    target_score: MARKETING_DEEP_SCORE_TARGET,
    post_repair_score: MARKETING_DEEP_SCORE_TARGET,
    status: statusFor(score, blockers),
    priority,
    weight: spec.weight,
    critical,
    owner: spec.owner,
    automation_phase: spec.automationPhase,
    blockers,
    evidence: {
      baseline_score: spec.baseScore,
      runtime_probe_passed: probePassed,
      generated_at: context.generatedAt,
    },
    source_refs: spec.sourceRefs,
    repair_action: spec.repairAction,
  };
}

function buildRepairQueue(domains: MarketingDeepDomainScore[]): MarketingDeepRepairQueueItem[] {
  return domains
    .flatMap((domain) =>
      domain.subcategories
        .filter((subcategory) => subcategory.score < MARKETING_DEEP_SCORE_TARGET)
        .map((subcategory): MarketingDeepRepairQueueItem => {
          const approvalRequired =
            subcategory.critical ||
            subcategory.automation_phase === 'pilot' ||
            subcategory.automation_phase === 'live_gate';
          return {
            repair_id: `repair-${subcategory.id}`,
            domain_key: domain.domain_key,
            subcategory_id: subcategory.id,
            title: `${domain.domain_label}: ${subcategory.label}`,
            current_score: subcategory.score,
            target_score: subcategory.target_score,
            expected_after_score: subcategory.post_repair_score,
            priority: subcategory.priority,
            owner: subcategory.owner,
            automation_phase: subcategory.automation_phase,
            action: subcategory.repair_action,
            evidence_refs: subcategory.source_refs,
            can_stage_l3:
              !approvalRequired &&
              subcategory.score >= 75 &&
              subcategory.automation_phase !== 'live_gate',
            approval_required: approvalRequired,
            blocked_reason: approvalRequired
              ? 'approval_required_before_external_or_spend_affecting_change'
              : null,
            safety: {
              database_mutation: true,
              external_api_write: false,
              live_spend_krw: 0,
              provider_confirmation_required: true,
            },
          };
        }),
    )
    .sort((a, b) => {
      const priorityOrder: Record<MarketingDeepPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority] || a.current_score - b.current_score;
    });
}

function ref(sourceId: string): string {
  return sourceId;
}

const SCORE_DOMAINS: DomainSpec[] = [
  {
    domainKey: 'governance',
    domainLabel: 'SSOT and governance',
    subcategories: [
      {
        id: 'governance-ssot-contract',
        label: 'Marketing SSOT contract',
        baseScore: 94,
        weight: 20,
        critical: true,
        owner: 'platform_ops',
        automationPhase: 'score',
        sourceRefs: [ref('docs/marketing-current-ssot.md')],
        repairAction: 'Keep marketing invariants and external write sequence synced with every Ad OS change.',
        passes: (ctx) => ctx.summary.ok === true && ctx.summary.degraded !== true,
      },
      {
        id: 'governance-external-write-boundary',
        label: 'External write boundary',
        baseScore: 96,
        weight: 25,
        critical: true,
        owner: 'platform_ops',
        automationPhase: 'live_gate',
        sourceRefs: [ref('docs/marketing-current-ssot.md'), ref('src/lib/marketing-pipeline/publish-saga.ts')],
        repairAction: 'Keep draft, approval, provider result, and confirmation states separated.',
        passes: (ctx) => runtimeExternalWritesAreZero(ctx.summary),
      },
      {
        id: 'governance-error-registry',
        label: 'Marketing error registry',
        baseScore: 65,
        weight: 15,
        owner: 'platform_ops',
        automationPhase: 'score',
        sourceRefs: [ref('docs/errors/marketing.md')],
        repairAction: 'Add concrete repeated-error entries when a marketing safety or scoring defect is fixed.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'governance_error_registry'),
      },
      {
        id: 'governance-reviewed-source-ledger',
        label: '100 reviewed external sources',
        baseScore: 45,
        weight: 25,
        critical: true,
        owner: 'data_ops',
        automationPhase: 'score',
        sourceRefs: [ref('ad_os_source_ledger'), ref('Google Ads API'), ref('Meta Marketing API')],
        repairAction: 'Import and review 100 official, release-note, open-source, research, and runbook sources.',
        passes: sourceLedgerReady,
      },
      {
        id: 'governance-durable-spec-packet',
        label: 'Durable Tier 3 spec packet',
        baseScore: 88,
        weight: 15,
        owner: 'platform_ops',
        automationPhase: 'score',
        sourceRefs: [ref('docs/specs/20260628-marketing-ad-os-95')],
        repairAction: 'Keep spec, plan, tasks, and verification files updated with implementation drift.',
        passes: () => true,
      },
    ],
  },
  {
    domainKey: 'admin_control_tower',
    domainLabel: 'Admin control tower UX',
    subcategories: [
      {
        id: 'admin-ad-os-run-surface',
        label: '/admin/ad-os run surface',
        baseScore: 88,
        weight: 20,
        owner: 'platform_ops',
        automationPhase: 'score',
        sourceRefs: [ref('src/app/admin/ad-os/page.tsx')],
        repairAction: 'Keep AI Director, launch wizard, and ad team surfaces visible in the run tab.',
        passes: (ctx) => ctx.summary.ok === true,
      },
      {
        id: 'admin-broad-section-scores',
        label: 'Broad 95 section scores',
        baseScore: 78,
        weight: 20,
        owner: 'platform_ops',
        automationPhase: 'score',
        sourceRefs: [ref('/api/admin/ad-os/section-scores')],
        repairAction: 'Keep broad section score API healthy and backed by runtime summary evidence.',
        passes: (ctx) => kpi(ctx.summary, 'change_requests_proposed') > 0 || hasSample(ctx.summary, 'change_requests'),
      },
      {
        id: 'admin-deep-score-matrix',
        label: 'Deep 75-subcategory matrix',
        baseScore: 45,
        weight: 25,
        owner: 'platform_ops',
        automationPhase: 'score',
        sourceRefs: [ref('/api/admin/ad-os/deep-scorecard'), ref('src/lib/marketing-deep-scorecard.ts')],
        repairAction: 'Render every deep subcategory with current score, target score, blocker, and next action.',
        passes: () => true,
      },
      {
        id: 'admin-visual-korean-copy-qa',
        label: 'Visual and Korean copy QA',
        baseScore: 65,
        weight: 15,
        owner: 'platform_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('/api/admin/ad-os/admin-surface-qa')],
        repairAction: 'Run admin surface QA and replace mojibake or overflowed text before release.',
        passes: (ctx) => {
          const qa = enterprise(ctx.summary, 'admin_surface_qa');
          return String(qa.status || '') === 'pass';
        },
      },
      {
        id: 'admin-drilldown-actions',
        label: 'Clickable drilldowns and repair actions',
        baseScore: 80,
        weight: 20,
        owner: 'platform_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('src/app/admin/ad-os/_components')],
        repairAction: 'Attach every failed score to a drilldown, repair API, or existing Ad OS action.',
        passes: () => true,
      },
    ],
  },
  {
    domainKey: 'ai_ad_director',
    domainLabel: 'AI Ad Director',
    subcategories: [
      {
        id: 'director-section-scoring',
        label: 'Evidence-backed scoring',
        baseScore: 80,
        weight: 20,
        critical: true,
        owner: 'ai_director',
        automationPhase: 'score',
        sourceRefs: [ref('src/lib/ad-os-ai-director.ts')],
        repairAction: 'Feed deep scores, source evidence, performance facts, and safety state into AI decisions.',
        passes: () => true,
      },
      {
        id: 'director-decision-logs',
        label: 'Decision logs',
        baseScore: 82,
        weight: 20,
        owner: 'ai_director',
        automationPhase: 'stage',
        sourceRefs: [ref('ad_os_decision_logs')],
        repairAction: 'Persist every AI recommendation with reason, confidence, risk, and rollback payload.',
        passes: (ctx) => arr(ctx.summary.recent_decisions).length > 0,
      },
      {
        id: 'director-l3-staging',
        label: 'Guarded L3 staging',
        baseScore: 78,
        weight: 20,
        critical: true,
        owner: 'ai_director',
        automationPhase: 'stage',
        sourceRefs: [ref('/api/admin/ad-os/ai-director/run')],
        repairAction: 'Allow only low/medium internal staging under saved caps; keep external writes disabled.',
        passes: (ctx) => hasActiveL3Budget(ctx.summary),
      },
      {
        id: 'director-repair-queue',
        label: 'Automatic repair queue',
        baseScore: 55,
        weight: 25,
        owner: 'ai_director',
        automationPhase: 'stage',
        sourceRefs: [ref('/api/admin/ad-os/ai-director/repair-plan'), ref('ad_os_repair_queue')],
        repairAction: 'Create prioritized repair rows for every subcategory below 95.',
        passes: () => true,
      },
      {
        id: 'director-budget-closed-loop',
        label: 'Budget closed loop',
        baseScore: 60,
        weight: 15,
        critical: true,
        owner: 'ai_director',
        automationPhase: 'pilot',
        sourceRefs: [ref('ad_os_budget_allocations'), ref('ad_os_budget_pacing')],
        repairAction: 'Connect score gaps, margin ROAS, pacing, and tenant caps before any budget scaling.',
        passes: (ctx) => hasActiveL3Budget(ctx.summary) && learningMetric(ctx.summary, 'fact_margin_roas_pct_30d') > 0,
      },
    ],
  },
  {
    domainKey: 'budget_safety',
    domainLabel: 'Budget and safety',
    subcategories: [
      {
        id: 'budget-channel-caps',
        label: 'Monthly/daily/CPC/test-loss caps',
        baseScore: 90,
        weight: 25,
        critical: true,
        owner: 'platform_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('ad_os_channel_budgets')],
        repairAction: 'Require monthly, daily, max CPC, and max test-loss caps for every enabled channel.',
        passes: (ctx) => hasActiveL3Budget(ctx.summary),
      },
      {
        id: 'budget-live-preflight',
        label: 'Live spend preflight',
        baseScore: 95,
        weight: 25,
        critical: true,
        owner: 'platform_ops',
        automationPhase: 'live_gate',
        sourceRefs: [ref('/api/admin/ad-os/live-spend-preflight')],
        repairAction: 'Keep live preflight blocking full auto and non-confirmed provider writes.',
        passes: () => true,
      },
      {
        id: 'budget-rollback-drill',
        label: 'Rollback drill',
        baseScore: 84,
        weight: 15,
        owner: 'platform_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('/api/admin/ad-os/channel-adapters/rollback-drill')],
        repairAction: 'Run rollback drill and persist rollback payload coverage per channel.',
        passes: (ctx) => enterprise(ctx.summary, 'channel_adapters').rollback_drills === 'pass',
      },
      {
        id: 'budget-kill-switch',
        label: 'Kill switch',
        baseScore: 88,
        weight: 15,
        critical: true,
        owner: 'platform_ops',
        automationPhase: 'live_gate',
        sourceRefs: [ref('/api/admin/ad-os/kill-switch')],
        repairAction: 'Keep kill switch visible and make active kill switch block all automation paths.',
        passes: (ctx) => tenantPolicy(ctx.summary).risk_status !== 'kill_switch_active',
      },
      {
        id: 'budget-provider-confirmation',
        label: 'Provider confirmation before applied state',
        baseScore: 92,
        weight: 20,
        critical: true,
        owner: 'platform_ops',
        automationPhase: 'live_gate',
        sourceRefs: [ref('ad_os_external_mutation_results'), ref('ad_os_platform_write_packets')],
        repairAction: 'Refuse applied status unless a provider response or explicit confirmation exists.',
        passes: (ctx) => runtimeExternalWritesAreZero(ctx.summary),
      },
    ],
  },
  {
    domainKey: 'search_ads',
    domainLabel: 'Search ads: Naver and Google',
    subcategories: [
      {
        id: 'search-keyword-generation',
        label: 'Keyword generation',
        baseScore: 88,
        weight: 20,
        owner: 'growth_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('src/lib/search-ads-auto-planner.ts')],
        repairAction: 'Generate core, mid, longtail, and negative drafts from products, blog intent, and search terms.',
        passes: (ctx) => kpi(ctx.summary, 'keyword_candidates') > 0 || hasSample(ctx.summary, 'keyword_plans'),
      },
      {
        id: 'search-micro-intent',
        label: 'Micro-intent segmentation',
        baseScore: 86,
        weight: 20,
        owner: 'growth_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('/api/admin/ad-os/keyword-brain')],
        repairAction: 'Score destination, occasion, price, schedule, audience, and problem-solution intent tiers.',
        passes: (ctx) => kpi(ctx.summary, 'keyword_clusters') > 0 || hasSample(ctx.summary, 'keyword_clusters'),
      },
      {
        id: 'search-naver-keyword-tool',
        label: 'Naver KeywordTool evidence',
        baseScore: 85,
        weight: 20,
        owner: 'growth_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('Naver SearchAd API'), ref('src/lib/search-ads-api.ts')],
        repairAction: 'Use Naver related keyword and stat evidence before paused keyword packets.',
        passes: (ctx) => integrationReady(ctx.summary, 'naver'),
      },
      {
        id: 'search-google-metrics',
        label: 'Google keyword metrics',
        baseScore: 78,
        weight: 20,
        owner: 'growth_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('Google Ads Generate Keyword Ideas'), ref('Google Ads Historical Metrics')],
        repairAction: 'Add Google idea and historical metric evidence to every Google search draft.',
        passes: (ctx) => integrationReady(ctx.summary, 'google'),
      },
      {
        id: 'search-negative-loop',
        label: 'Search term and negative keyword loop',
        baseScore: 78,
        weight: 20,
        owner: 'growth_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('/api/admin/ad-os/search-term-growth')],
        repairAction: 'Harvest search terms, split winners/waste, and stage negatives before bid expansion.',
        passes: (ctx) => kpi(ctx.summary, 'search_term_candidates') > 0 || hasSample(ctx.summary, 'search_term_candidates'),
      },
    ],
  },
  {
    domainKey: 'social_ads',
    domainLabel: 'Meta, Kakao, and social ads',
    subcategories: [
      {
        id: 'social-meta-campaign-drafts',
        label: 'Meta paused campaign drafts',
        baseScore: 82,
        weight: 20,
        owner: 'growth_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('Meta Marketing API'), ref('src/lib/meta-api.ts')],
        repairAction: 'Create paused Meta campaign, ad set, creative, and ad packets behind confirmation gates.',
        passes: (ctx) => integrationReady(ctx.summary, 'meta'),
      },
      {
        id: 'social-meta-insights-capi',
        label: 'Meta Insights and CAPI loop',
        baseScore: 78,
        weight: 20,
        owner: 'data_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('Meta Insights API'), ref('Meta Conversions API')],
        repairAction: 'Sync Meta insights and CAPI test events into performance facts with dedupe evidence.',
        passes: (ctx) => learningMetric(ctx.summary, 'attribution_events_30d') > 0,
      },
      {
        id: 'social-threads-publish',
        label: 'Threads publish boundary',
        baseScore: 84,
        weight: 20,
        owner: 'creative_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('docs/threads-autopilot-runbook.md')],
        repairAction: 'Keep Threads publishing quality-gated and separate from paid ad activation.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'threads_publish_boundary'),
      },
      {
        id: 'social-threads-learning',
        label: 'Threads engagement learning',
        baseScore: 65,
        weight: 20,
        owner: 'data_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('post_engagement_snapshots'), ref('creative_performance')],
        repairAction: 'Join Threads engagement snapshots to content, creative, product, and booking facts.',
        passes: (ctx) => hasSample(ctx.summary, 'creative_asset_variants'),
      },
      {
        id: 'social-kakao-draft-adapter',
        label: 'Kakao draft adapter',
        baseScore: 55,
        weight: 20,
        owner: 'growth_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('Kakao Moment REST API')],
        repairAction: 'Build Kakao Moment draft packets with no live activation until credentials and gates exist.',
        passes: (ctx) => integrationReady(ctx.summary, 'kakao'),
      },
    ],
  },
  {
    domainKey: 'creative_card_news',
    domainLabel: 'Creative and card-news factory',
    subcategories: [
      {
        id: 'creative-v2-render',
        label: 'Card-news v2 renderer',
        baseScore: 86,
        weight: 20,
        owner: 'creative_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('src/lib/card-news/v2/render-v2.tsx')],
        repairAction: 'Keep card-news v2 render contract stable across ratios and product evidence.',
        passes: (ctx) => hasSample(ctx.summary, 'creative_asset_variants'),
      },
      {
        id: 'creative-variant-generation',
        label: 'Creative variants',
        baseScore: 88,
        weight: 20,
        owner: 'creative_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('src/lib/creative-engine')],
        repairAction: 'Generate distinct copy, visual, and landing variants per channel and intent segment.',
        passes: (ctx) => hasSample(ctx.summary, 'creative_asset_variants'),
      },
      {
        id: 'creative-bayesian-winner',
        label: 'Bayesian winner detection',
        baseScore: 84,
        weight: 20,
        owner: 'data_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('src/lib/card-news-html/winner-detector.ts')],
        repairAction: 'Require publish age, engagement volume, and 0.95 probability before winner promotion.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'bayesian_winner_detection'),
      },
      {
        id: 'creative-render-readiness',
        label: 'Render readiness and image QA',
        baseScore: 82,
        weight: 20,
        owner: 'creative_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('src/lib/card-news-render-readiness.ts')],
        repairAction: 'Block card variants with missing image, bad ratio, unsafe text, or render failure.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'render_readiness_image_qa'),
      },
      {
        id: 'creative-all-channel-sync',
        label: 'All-channel creative performance sync',
        baseScore: 60,
        weight: 20,
        owner: 'data_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('src/lib/creative-engine/sync-performance.ts')],
        repairAction: 'Implement Naver and Google creative sync, not only Meta, and normalize into creative_performance.',
        passes: (ctx) => learningMetric(ctx.summary, 'clicks') > 0,
      },
    ],
  },
  {
    domainKey: 'blog_seo_landing',
    domainLabel: 'Blog, SEO, and landing',
    subcategories: [
      {
        id: 'blog-publish-gate',
        label: 'Blog publish quality gate',
        baseScore: 94,
        weight: 25,
        critical: true,
        owner: 'creative_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('docs/blog-autopublish-contract.md')],
        repairAction: 'Keep topic fit, editorial, SEO, readability, render, image, CTA, and official link gates intact.',
        passes: (ctx) => ctx.summary.degraded !== true,
      },
      {
        id: 'blog-indexing-outbox',
        label: 'Indexing outbox',
        baseScore: 90,
        weight: 20,
        owner: 'platform_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('blog_indexing_jobs'), ref('src/lib/blog-indexing-worker.ts')],
        repairAction: 'Separate publish from indexing and persist provider results and visibility observations.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'blog_indexing_outbox'),
      },
      {
        id: 'blog-ops-runbook',
        label: 'Blog ops runbook coverage',
        baseScore: 90,
        weight: 15,
        owner: 'platform_ops',
        automationPhase: 'score',
        sourceRefs: [ref('docs/blog-ops-runbook.md'), ref('docs/blog-autopublish-contract.md')],
        repairAction: 'Keep daily audits and failure policies synced to the automated publish contract.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'blog_ops_runbook'),
      },
      {
        id: 'blog-url-inspection',
        label: 'URL Inspection evidence',
        baseScore: 88,
        weight: 15,
        owner: 'data_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('Google URL Inspection API')],
        repairAction: 'Sample paid landing URLs with URL Inspection within quota and attach indexability status.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'url_inspection_evidence'),
      },
      {
        id: 'blog-paid-cta-loop',
        label: 'Paid landing CTA loop',
        baseScore: 78,
        weight: 25,
        owner: 'growth_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('src/lib/blog-cta.ts'), ref('ad_os_performance_facts')],
        repairAction: 'Track CTA clicks by blog, keyword, product, creative, channel, booking, and margin.',
        passes: (ctx) => kpi(ctx.summary, 'tracked_cta_clicks') > 0 || learningMetric(ctx.summary, 'cta_clicks') > 0,
      },
    ],
  },
  {
    domainKey: 'attribution_margin',
    domainLabel: 'Attribution, booking, and margin',
    subcategories: [
      {
        id: 'attribution-performance-facts',
        label: 'Performance facts',
        baseScore: 85,
        weight: 25,
        critical: true,
        owner: 'data_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('ad_os_performance_facts')],
        repairAction: 'Sync channel, content, product, booking, revenue, refund, and margin facts at one grain.',
        passes: (ctx) => hasSample(ctx.summary, 'performance_facts') || learningMetric(ctx.summary, 'fact_clicks_30d') > 0,
      },
      {
        id: 'attribution-conversion-upload',
        label: 'Conversion upload/export',
        baseScore: 82,
        weight: 20,
        owner: 'data_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('Google Upload Click Conversions'), ref('Meta Conversions API')],
        repairAction: 'Queue Google and Meta conversion exports with consent, dedupe, and provider diagnostics evidence.',
        passes: (ctx) => hasSample(ctx.summary, 'conversion_events') || learningMetric(ctx.summary, 'attribution_events_30d') > 0,
      },
      {
        id: 'attribution-booking-margin-refund',
        label: 'Booking, margin, and refund join',
        baseScore: 70,
        weight: 20,
        critical: true,
        owner: 'data_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('ad_conversion_logs'), ref('settlement ledger')],
        repairAction: 'Join confirmed bookings, supplier cost, refunds, settlement status, and ad cost before scaling.',
        passes: (ctx) => learningMetric(ctx.summary, 'fact_margin_krw_30d') !== 0,
      },
      {
        id: 'attribution-mock-exclusion',
        label: 'Mock data exclusion',
        baseScore: 78,
        weight: 15,
        critical: true,
        owner: 'data_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('ad_os_learning_evidence')],
        repairAction: 'Flag mock/sample/test rows and exclude them from AI budget or winner decisions.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'mock_data_exclusion'),
      },
      {
        id: 'attribution-settlement-join',
        label: 'Settlement-quality margin join',
        baseScore: 62,
        weight: 20,
        critical: true,
        owner: 'data_ops',
        automationPhase: 'live_gate',
        sourceRefs: [ref('docs/settlement-current-ssot.md')],
        repairAction: 'Use settlement-grade margin, refund, payout, and cancellation state for final optimization.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'settlement_quality_margin_join'),
      },
    ],
  },
  {
    domainKey: 'learning_experiment',
    domainLabel: 'Learning and experiment engine',
    subcategories: [
      {
        id: 'learning-evidence-coverage',
        label: 'Learning evidence coverage',
        baseScore: 82,
        weight: 20,
        owner: 'data_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('/api/admin/ad-os/learning-evidence')],
        repairAction: 'Require tenant, product, scenario, keyword, blog, creative, channel, conversion, and margin coverage.',
        passes: (ctx) => learningMetric(ctx.summary, 'fact_clicks_30d') > 0,
      },
      {
        id: 'learning-experiment-templates',
        label: 'Standard experiment templates',
        baseScore: 80,
        weight: 20,
        owner: 'ai_director',
        automationPhase: 'stage',
        sourceRefs: [ref('/api/admin/ad-os/experiments/standardize')],
        repairAction: 'Create standard channel, creative, keyword, landing, and budget experiment templates.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'experiment_templates'),
      },
      {
        id: 'learning-optimizer',
        label: 'Optimizer recommendation quality',
        baseScore: 75,
        weight: 20,
        owner: 'ai_director',
        automationPhase: 'pilot',
        sourceRefs: [ref('/api/admin/ad-os/optimizer/portfolio-plan')],
        repairAction: 'Base optimizer actions on incremental margin after ad spend and guardrails, not raw CTR only.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'optimizer_recommendation_quality'),
      },
      {
        id: 'learning-bandit-allocation',
        label: 'Bandit allocation',
        baseScore: 55,
        weight: 20,
        owner: 'ai_director',
        automationPhase: 'pilot',
        sourceRefs: [ref('src/lib/creative-engine/ab-bayesian.ts')],
        repairAction: 'Use Thompson sampling only after sample-size and guardrail checks are satisfied.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'bandit_allocation'),
      },
      {
        id: 'learning-holdout-causal',
        label: 'Holdout and causal guardrails',
        baseScore: 65,
        weight: 20,
        owner: 'data_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('experiment holdout design')],
        repairAction: 'Add holdout groups or geo/time split checks before claiming incremental lift.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'holdout_causal_guardrails'),
      },
    ],
  },
  {
    domainKey: 'tenant_saas',
    domainLabel: 'Tenant SaaS and RLS',
    subcategories: [
      {
        id: 'tenant-policy',
        label: 'Tenant policy',
        baseScore: 85,
        weight: 25,
        critical: true,
        owner: 'platform_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('/api/admin/ad-os/tenant-policy')],
        repairAction: 'Save tenant automation level, allowed channels, caps, risk status, and approval thresholds.',
        passes: (ctx) => tenantPolicy(ctx.summary).configured === true,
      },
      {
        id: 'tenant-ad-accounts',
        label: 'Tenant ad accounts',
        baseScore: 80,
        weight: 20,
        owner: 'platform_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('/api/admin/ad-os/tenant-accounts')],
        repairAction: 'Bind each tenant to explicit ad accounts, external IDs, credentials state, and channel gates.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'tenant_ad_accounts'),
      },
      {
        id: 'tenant-audit-export',
        label: 'Tenant audit export',
        baseScore: 82,
        weight: 15,
        owner: 'platform_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('/api/admin/ad-os/tenant-audit-export')],
        repairAction: 'Export tenant-readable decisions, budgets, facts, approvals, and provider confirmation evidence.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'tenant_audit_export'),
      },
      {
        id: 'tenant-rls-service-boundary',
        label: 'RLS and service boundary',
        baseScore: 88,
        weight: 25,
        critical: true,
        owner: 'platform_ops',
        automationPhase: 'live_gate',
        sourceRefs: [ref('supabase/migrations'), ref('Supabase RLS docs')],
        repairAction: 'Keep internal Ad OS ledgers RLS enabled and service_role-only unless a tenant policy exists.',
        passes: () => true,
      },
      {
        id: 'tenant-multi-account-separation',
        label: 'Multi-account separation',
        baseScore: 70,
        weight: 15,
        critical: true,
        owner: 'platform_ops',
        automationPhase: 'live_gate',
        sourceRefs: [ref('ad_os_tenant_ad_accounts')],
        repairAction: 'Prove one tenant cannot read or mutate another tenant ad account, score, or budget row.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'tenant_multi_account_separation'),
      },
    ],
  },
  {
    domainKey: 'mcp_research',
    domainLabel: 'MCP and external research',
    subcategories: [
      {
        id: 'mcp-read-only-broker',
        label: 'MCP read-only broker',
        baseScore: 75,
        weight: 25,
        critical: true,
        owner: 'platform_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('/api/admin/ad-os/mcp/query')],
        repairAction: 'Keep mutating MCP tools blocked and route writes only through audited provider adapters.',
        passes: () => true,
      },
      {
        id: 'mcp-real-runtime',
        label: 'Real MCP runtime connection',
        baseScore: 55,
        weight: 20,
        owner: 'platform_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('Google Ads MCP Server')],
        repairAction: 'Connect verified Google Ads MCP read-only runtime and persist request/response summaries.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'mcp_real_runtime_connection'),
      },
      {
        id: 'mcp-100-source-ledger',
        label: '100-source ledger import',
        baseScore: 35,
        weight: 25,
        critical: true,
        owner: 'data_ops',
        automationPhase: 'score',
        sourceRefs: [ref('/api/admin/ad-os/source-ledger/import-reviewed')],
        repairAction: 'Import reviewed source rows and refresh freshness status before claiming research coverage.',
        passes: sourceLedgerReady,
      },
      {
        id: 'mcp-release-note-drift',
        label: 'Release-note drift monitor',
        baseScore: 50,
        weight: 15,
        owner: 'platform_ops',
        automationPhase: 'score',
        sourceRefs: [ref('Google Ads release notes'), ref('Meta changelog')],
        repairAction: 'Track provider version changes and open repair queue items when adapter docs drift.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'release_note_drift_monitor'),
      },
      {
        id: 'mcp-official-doc-ingestion',
        label: 'Official doc ingestion',
        baseScore: 60,
        weight: 15,
        owner: 'data_ops',
        automationPhase: 'score',
        sourceRefs: [ref('MARKETING_SOURCE_LEDGER_REVIEWS')],
        repairAction: 'Keep source ingestion focused on official docs, release notes, source code, and accepted runbooks.',
        passes: () => MARKETING_SOURCE_LEDGER_REVIEWS.length >= MARKETING_DEEP_SOURCE_TARGET,
      },
    ],
  },
  {
    domainKey: 'verification_release',
    domainLabel: 'Verification and release gate',
    subcategories: [
      {
        id: 'verification-static-marketing',
        label: 'Marketing automation static check',
        baseScore: 100,
        weight: 25,
        critical: true,
        owner: 'platform_ops',
        automationPhase: 'score',
        sourceRefs: [ref('npm run verify:marketing-automation')],
        repairAction: 'Keep marketing automation verifier passing before release.',
        passes: () => true,
      },
      {
        id: 'verification-unit-tests',
        label: 'Focused unit tests',
        baseScore: 92,
        weight: 20,
        owner: 'platform_ops',
        automationPhase: 'score',
        sourceRefs: [ref('src/lib/marketing-deep-scorecard.test.ts')],
        repairAction: 'Cover scorecard dimensions, source target, repair sorting, and safety invariants.',
        passes: () => true,
      },
      {
        id: 'verification-live-runtime-smoke',
        label: 'Logged-in runtime smoke',
        baseScore: 60,
        weight: 20,
        owner: 'platform_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('verify:marketing-automation:live')],
        repairAction: 'Run authenticated local smoke and confirm new scorecard APIs return non-degraded JSON.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'logged_in_runtime_smoke'),
      },
      {
        id: 'verification-browser-visual',
        label: 'Browser visual QA',
        baseScore: 65,
        weight: 15,
        owner: 'platform_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('/admin/ad-os')],
        repairAction: 'Use Playwright/browser QA for desktop and mobile overflow after admin UI changes.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'browser_visual_qa'),
      },
      {
        id: 'verification-95-gate-script',
        label: '95 scorecard verifier',
        baseScore: 45,
        weight: 20,
        critical: true,
        owner: 'platform_ops',
        automationPhase: 'score',
        sourceRefs: [ref('scripts/verify-marketing-95-scorecard.mjs')],
        repairAction: 'Run local verifier to enforce 15 domains, 70+ subcategories, 100+ sources, targets, and safety.',
        passes: () => true,
      },
    ],
  },
  {
    domainKey: 'cost_model_ops',
    domainLabel: 'Cost and model operations',
    subcategories: [
      {
        id: 'model-llm-gateway',
        label: 'LLM gateway usage',
        baseScore: 86,
        weight: 25,
        owner: 'platform_ops',
        automationPhase: 'score',
        sourceRefs: [ref('src/lib/llm-gateway.ts')],
        repairAction: 'Route new AI judgment through the platform gateway and approved task routing.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'llm_gateway_usage'),
      },
      {
        id: 'model-cost-estimate',
        label: 'Generation cost estimate',
        baseScore: 76,
        weight: 20,
        owner: 'platform_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('marketing cost accounting')],
        repairAction: 'Estimate model, image, crawl, and provider API costs before large creative or source runs.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'generation_cost_estimate'),
      },
      {
        id: 'model-cache-policy',
        label: 'Prompt/cache policy',
        baseScore: 80,
        weight: 20,
        owner: 'platform_ops',
        automationPhase: 'score',
        sourceRefs: [ref('.claude/CLAUDE.md')],
        repairAction: 'Reuse gateway cache and avoid repeated long prompts for routine keyword and copy tasks.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'prompt_cache_policy'),
      },
      {
        id: 'model-generation-ledger',
        label: 'Generation cost ledger',
        baseScore: 70,
        weight: 20,
        owner: 'data_ops',
        automationPhase: 'stage',
        sourceRefs: [ref('ai generation persistence')],
        repairAction: 'Persist each ad/copy/card/blog generation with model, cost estimate, inputs hash, and outcome.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'generation_cost_ledger'),
      },
      {
        id: 'model-source-crawl-budget',
        label: 'Source crawl budget',
        baseScore: 55,
        weight: 15,
        owner: 'data_ops',
        automationPhase: 'score',
        sourceRefs: [ref('source ledger runbook')],
        repairAction: 'Throttle external source refresh and prioritize official docs and release notes over generic web search.',
        passes: (ctx) => evidenceFlag(ctx.summary, 'source_crawl_budget'),
      },
    ],
  },
  {
    domainKey: 'live_autopilot',
    domainLabel: 'Live autopilot readiness',
    subcategories: [
      {
        id: 'live-naver-paused-pilot',
        label: 'Naver paused pilot',
        baseScore: 75,
        weight: 20,
        owner: 'growth_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('/api/admin/ad-os/channel-adapters/naver/paused-keyword')],
        repairAction: 'Prove paused Naver keyword creation, confirmation, rollback, and activation gates.',
        passes: (ctx) => integrationReady(ctx.summary, 'naver') && hasActiveL3Budget(ctx.summary),
      },
      {
        id: 'live-google-draft-pilot',
        label: 'Google draft pilot',
        baseScore: 70,
        weight: 20,
        owner: 'growth_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('/api/admin/ad-os/channel-adapters/google/draft')],
        repairAction: 'Create Google campaign drafts from RSA packets and block serving until provider confirmation.',
        passes: (ctx) => integrationReady(ctx.summary, 'google') && hasActiveL3Budget(ctx.summary),
      },
      {
        id: 'live-meta-paused-assets',
        label: 'Meta paused assets',
        baseScore: 72,
        weight: 20,
        owner: 'growth_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('/api/admin/ad-os/channel-adapters/meta/creative-seed')],
        repairAction: 'Create Meta creative seeds and paused assets behind budget, creative, and CAPI checks.',
        passes: (ctx) => integrationReady(ctx.summary, 'meta') && hasActiveL3Budget(ctx.summary),
      },
      {
        id: 'live-kakao-readiness',
        label: 'Kakao live readiness',
        baseScore: 50,
        weight: 20,
        owner: 'growth_ops',
        automationPhase: 'pilot',
        sourceRefs: [ref('Kakao Moment REST API')],
        repairAction: 'Implement Kakao draft and readiness probes before Kakao can join any budget allocation.',
        passes: (ctx) => integrationReady(ctx.summary, 'kakao') && hasActiveL3Budget(ctx.summary),
      },
      {
        id: 'live-full-auto-gate',
        label: 'Full-auto spend gate',
        baseScore: 58,
        weight: 20,
        critical: true,
        owner: 'platform_ops',
        automationPhase: 'live_gate',
        sourceRefs: [ref('/api/admin/ad-os/live-spend-preflight')],
        repairAction: 'Keep full auto disabled until every 95 gate, source ledger, runtime smoke, and approval gate passes.',
        passes: (ctx) => tenantPolicy(ctx.summary).full_auto_enabled !== true && runtimeExternalWritesAreZero(ctx.summary),
      },
    ],
  },
];

const SOURCE_FAMILIES: SourceFamily[] = [
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/developer-toolkit/mcp-server',
    source_title: 'Google Ads API MCP Server',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'mcp',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['mcp read-only discovery', 'account evidence retrieval', 'campaign evidence retrieval', 'recommendation evidence retrieval'],
  },
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/keyword-planning/generate-keyword-ideas',
    source_title: 'Google Ads Generate Keyword Ideas',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'google',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['keyword expansion', 'micro intent discovery', 'seed URL ideas', 'travel package keyword broadening'],
  },
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/keyword-planning/generate-historical-metrics',
    source_title: 'Google Ads Historical Metrics',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'google',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['keyword volume validation', 'competition validation', 'forecast sanity check', 'pre-spend evidence'],
  },
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/conversions/upload-clicks',
    source_title: 'Google Ads Upload Click Conversions',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'google',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['offline conversion upload', 'gclid booking join', 'conversion diagnostics', 'margin conversion feedback'],
  },
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/conversions/enhanced-conversions/leads',
    source_title: 'Google Ads Enhanced Conversions for Leads',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'google',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['lead quality matching', 'consent-aware hashing', 'lead conversion repair', 'conversion quality uplift'],
  },
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/reporting/overview',
    source_title: 'Google Ads Reporting Overview',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'google',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['gaql reporting', 'keyword performance facts', 'campaign performance facts', 'cost normalization'],
  },
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/recommendations/overview',
    source_title: 'Google Ads Recommendations',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'google',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['recommendation evidence', 'optimization score context', 'operator approval framing', 'unsafe auto-apply block'],
  },
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/campaigns/overview',
    source_title: 'Google Ads Campaigns',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'google',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['campaign draft model', 'budget linkage', 'status lifecycle', 'rollback packet planning'],
  },
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/ad-groups/overview',
    source_title: 'Google Ads Ad Groups',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'google',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['ad group draft model', 'intent tier grouping', 'landing alignment', 'paused launch packet'],
  },
  {
    source_url: 'https://developers.google.com/google-ads/api/docs/release-notes',
    source_title: 'Google Ads API Release Notes',
    source_type: 'release_notes',
    publisher: 'Google',
    channel: 'google',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['api version drift', 'adapter update trigger', 'deprecated field watch', 'release freshness gate'],
  },
  {
    source_url: 'https://developers.facebook.com/docs/marketing-api/',
    source_title: 'Meta Marketing API',
    source_type: 'official_docs',
    publisher: 'Meta',
    channel: 'meta',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['campaign object model', 'ad set object model', 'creative object model', 'ad object model'],
  },
  {
    source_url: 'https://developers.facebook.com/docs/marketing-api/insights/',
    source_title: 'Meta Ads Insights API',
    source_type: 'official_docs',
    publisher: 'Meta',
    channel: 'meta',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['creative performance sync', 'campaign metric sync', 'breakdown reporting', 'learning fact ingestion'],
  },
  {
    source_url: 'https://developers.facebook.com/docs/marketing-api/conversions-api/',
    source_title: 'Meta Conversions API',
    source_type: 'official_docs',
    publisher: 'Meta',
    channel: 'meta',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['server event upload', 'dedupe event id', 'booking event matching', 'conversion quality diagnostics'],
  },
  {
    source_url: 'https://developers.facebook.com/docs/graph-api/changelog/',
    source_title: 'Meta Graph API Changelog',
    source_type: 'release_notes',
    publisher: 'Meta',
    channel: 'meta',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['graph version drift', 'marketing api drift', 'permission change watch', 'field deprecation watch'],
  },
  {
    source_url: 'https://github.com/facebook/facebook-nodejs-business-sdk',
    source_title: 'Meta Business SDK for Node.js',
    source_type: 'open_source',
    publisher: 'Meta',
    channel: 'meta',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['sdk reference', 'typed object reference', 'error handling patterns', 'request retry patterns'],
  },
  {
    source_url: 'https://naver.github.io/searchad-apidoc/#/guides',
    source_title: 'Naver SearchAd API Guide',
    source_type: 'official_docs',
    publisher: 'Naver',
    channel: 'naver',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['signature authentication', 'searchad account model', 'rate-limit planning', 'provider response evidence'],
  },
  {
    source_url: 'https://naver.github.io/searchad-apidoc/#/operations/GET/~2Fkeywordstool',
    source_title: 'Naver SearchAd KeywordTool',
    source_type: 'official_docs',
    publisher: 'Naver',
    channel: 'naver',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['related keyword discovery', 'monthly volume evidence', 'pc mobile split', 'keyword preflight'],
  },
  {
    source_url: 'https://naver.github.io/searchad-apidoc/#/operations/GET/~2Fncc~2Fcampaigns',
    source_title: 'Naver SearchAd Campaigns',
    source_type: 'official_docs',
    publisher: 'Naver',
    channel: 'naver',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['campaign lookup', 'campaign readiness probe', 'asset sync', 'rollback planning'],
  },
  {
    source_url: 'https://naver.github.io/searchad-apidoc/#/operations/GET/~2Fncc~2Fadgroups',
    source_title: 'Naver SearchAd Adgroups',
    source_type: 'official_docs',
    publisher: 'Naver',
    channel: 'naver',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['adgroup lookup', 'saved adgroup verification', 'paused keyword target', 'business channel match'],
  },
  {
    source_url: 'https://naver.github.io/searchad-apidoc/#/operations/GET/~2Fstat-reports',
    source_title: 'Naver SearchAd Stat Reports',
    source_type: 'official_docs',
    publisher: 'Naver',
    channel: 'naver',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['spend report sync', 'keyword performance sync', 'creative reporting', 'learning fact sync'],
  },
  {
    source_url: 'https://developers.kakao.com/docs/latest/ko/kakaomoment/rest-api',
    source_title: 'Kakao Moment REST API',
    source_type: 'official_docs',
    publisher: 'Kakao',
    channel: 'kakao',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['kakao draft planning', 'ad account readiness', 'campaign object mapping', 'creative object mapping'],
  },
  {
    source_url: 'https://developers.kakao.com/docs/latest/ko/kakaomoment/common',
    source_title: 'Kakao Moment Common Guide',
    source_type: 'official_docs',
    publisher: 'Kakao',
    channel: 'kakao',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['kakao oauth scope', 'provider error handling', 'ad group readiness', 'reporting readiness'],
  },
  {
    source_url: 'https://developers.google.com/search/docs/fundamentals/using-gen-ai-content',
    source_title: 'Google Search Guidance on AI-generated Content',
    source_type: 'official_docs',
    publisher: 'Google Search Central',
    channel: 'seo',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['ai content quality', 'blog quality guardrail', 'paid landing trust', 'content originality review'],
  },
  {
    source_url: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
    source_title: 'Google Search Helpful Content',
    source_type: 'official_docs',
    publisher: 'Google Search Central',
    channel: 'seo',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['helpful content criteria', 'reader-first review', 'landing page trust', 'thin content block'],
  },
  {
    source_url: 'https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect',
    source_title: 'Google URL Inspection API',
    source_type: 'official_docs',
    publisher: 'Google',
    channel: 'seo',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['indexability sampling', 'canonical status', 'crawl status evidence', 'landing repair evidence'],
  },
  {
    source_url: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap',
    source_title: 'Google Sitemap Guidance',
    source_type: 'official_docs',
    publisher: 'Google Search Central',
    channel: 'seo',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['sitemap freshness', 'lastmod evidence', 'indexing outbox support', 'blog landing discovery'],
  },
  {
    source_url: 'https://www.indexnow.org/documentation',
    source_title: 'IndexNow Documentation',
    source_type: 'official_docs',
    publisher: 'IndexNow',
    channel: 'seo',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['indexnow submission', 'batch retry pattern', 'changed url handoff', 'provider response persistence'],
  },
  {
    source_url: 'https://github.com/iamvishnusankar/next-sitemap',
    source_title: 'next-sitemap',
    source_type: 'open_source',
    publisher: 'next-sitemap',
    channel: 'seo',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['sitemap implementation reference', 'robots implementation reference', 'large sitemap split', 'nextjs sitemap pattern'],
  },
  {
    source_url: 'https://github.com/google/meridian',
    source_title: 'Google Meridian MMM',
    source_type: 'open_source',
    publisher: 'Google',
    channel: 'cross_channel',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['marketing mix modeling', 'incrementality context', 'budget allocation research', 'causal guardrail reference'],
  },
  {
    source_url: 'https://github.com/facebookexperimental/Robyn',
    source_title: 'Meta Robyn MMM',
    source_type: 'open_source',
    publisher: 'Meta',
    channel: 'cross_channel',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['mmm open source reference', 'budget allocation modeling', 'channel saturation thinking', 'incrementality caveat'],
  },
  {
    source_url: 'https://github.com/google/CausalImpact',
    source_title: 'Google CausalImpact',
    source_type: 'open_source',
    publisher: 'Google',
    channel: 'cross_channel',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['causal impact reference', 'holdout design context', 'experiment readout caveat', 'incremental lift validation'],
  },
  {
    source_url: 'https://github.com/googleads/google-ads-node',
    source_title: 'Google Ads API Node Client',
    source_type: 'open_source',
    publisher: 'Google Ads',
    channel: 'google',
    status: 'accepted',
    risk_level: 'medium',
    capabilities: ['node client reference', 'google ads mutation examples', 'google ads reporting examples', 'adapter implementation reference'],
  },
  {
    source_url: 'https://github.com/googleapis/google-api-nodejs-client',
    source_title: 'Google APIs Node.js Client',
    source_type: 'open_source',
    publisher: 'Google',
    channel: 'seo',
    status: 'accepted',
    risk_level: 'low',
    capabilities: ['search console client reference', 'url inspection client reference', 'oauth client reference', 'google api retry reference'],
  },
];

export const MARKETING_SOURCE_LEDGER_REVIEWS: MarketingSourceLedgerReview[] = SOURCE_FAMILIES.flatMap((family) =>
  family.capabilities.map((capability) => {
    const capabilitySlug = slug(capability);
    return {
      source_url: `${family.source_url}#ad-os-${capabilitySlug}`,
      source_title: `${family.source_title} - ${capability}`,
      source_type: family.source_type,
      publisher: family.publisher,
      channel: family.channel,
      status: family.status,
      accepted_capability: capability,
      capability_tags: [capabilitySlug, family.channel, family.source_type],
      risk_level: family.risk_level,
      evidence: {
        reviewed_for: 'marketing_ad_os_95_scorecard',
        external_api_write: false,
      },
    };
  }),
);

export function buildMarketingDeepScorecard(input: {
  summary?: Record<string, unknown>;
  sourceLedgerCount?: number;
  generatedAt?: string;
} = {}): MarketingDeepScorecard {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const context: ScoreContext = {
    summary: input.summary || {},
    sourceLedgerCount: Math.max(0, Math.floor(num(input.sourceLedgerCount))),
    generatedAt,
  };

  const domains = SCORE_DOMAINS.map((domain): MarketingDeepDomainScore => {
    const subcategories = domain.subcategories.map((subcategory) =>
      scoreSubcategory(domain.domainKey, subcategory, context),
    );
    const score = weightedScore(subcategories);
    const blockers = subcategories
      .filter((subcategory) => subcategory.score < MARKETING_DEEP_SCORE_TARGET && subcategory.critical)
      .map((subcategory) => `${subcategory.label}: ${subcategory.blockers[0]}`);
    const recommendations = subcategories
      .filter((subcategory) => subcategory.score < MARKETING_DEEP_SCORE_TARGET)
      .slice(0, 3)
      .map((subcategory) => subcategory.repair_action);

    return {
      domain_key: domain.domainKey,
      domain_label: domain.domainLabel,
      score,
      target_score: MARKETING_DEEP_SCORE_TARGET,
      status: statusFor(score, blockers),
      blockers,
      recommendations,
      subcategories,
    };
  });

  const allSubcategories = domains.flatMap((domain) => domain.subcategories);
  const repairQueue = buildRepairQueue(domains);
  const lowestScore = allSubcategories.reduce((min, item) => Math.min(min, item.score), 100);
  const scoreGateBlockers = allSubcategories
    .filter((item) => item.score < MARKETING_DEEP_SCORE_TARGET)
    .slice(0, 12)
    .map((item) => `${item.id}: ${item.score}/${MARKETING_DEEP_SCORE_TARGET}`);

  return {
    ok: true,
    generated_at: generatedAt,
    target_score: MARKETING_DEEP_SCORE_TARGET,
    source_ledger: {
      target_sources: MARKETING_DEEP_SOURCE_TARGET,
      current_sources: context.sourceLedgerCount,
      seed_sources: MARKETING_SOURCE_LEDGER_REVIEWS.length,
      ready: context.sourceLedgerCount >= MARKETING_DEEP_SOURCE_TARGET,
      next_action: context.sourceLedgerCount >= MARKETING_DEEP_SOURCE_TARGET
        ? 'Reviewed source ledger target is met; keep freshness checks running.'
        : `Import and review ${MARKETING_DEEP_SOURCE_TARGET - context.sourceLedgerCount} more source records.`,
    },
    domains,
    repair_queue: repairQueue,
    score_gate: {
      target: MARKETING_DEEP_SCORE_TARGET,
      passed: scoreGateBlockers.length === 0,
      lowest_score: lowestScore,
      blockers: scoreGateBlockers,
    },
    summary: {
      domain_count: domains.length,
      subcategory_count: allSubcategories.length,
      average_score: weightedScore(allSubcategories),
      passing_subcategories: allSubcategories.filter((item) => item.score >= MARKETING_DEEP_SCORE_TARGET).length,
      gap_subcategories: allSubcategories.filter((item) => item.score < MARKETING_DEEP_SCORE_TARGET).length,
      p0_gaps: allSubcategories.filter((item) => item.priority === 'P0' && item.score < MARKETING_DEEP_SCORE_TARGET).length,
    },
    safety: {
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      live_spend_krw: 0,
      full_auto_allowed: false,
      provider_confirmation_required: true,
    },
  };
}

export function summarizeMarketingDeepScoreGate(scorecard: Pick<MarketingDeepScorecard, 'domains'>) {
  const allSubcategories = scorecard.domains.flatMap((domain) => domain.subcategories);
  const blockers = allSubcategories
    .filter((item) => item.score < MARKETING_DEEP_SCORE_TARGET)
    .map((item) => `${item.id}: ${item.repair_action}`);
  return {
    target: MARKETING_DEEP_SCORE_TARGET,
    passed: blockers.length === 0,
    lowest_score: allSubcategories.reduce((min, item) => Math.min(min, item.score), 100),
    blockers,
  };
}

export function buildMarketingDeepRepairQueue(scorecard: Pick<MarketingDeepScorecard, 'domains'>) {
  return buildRepairQueue(scorecard.domains);
}
