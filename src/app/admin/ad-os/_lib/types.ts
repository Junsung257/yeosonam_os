export const LAUNCH_ACTION_KEYS = [
  'refresh',
  'runPilotSetup',
  'createNaverAssets',
  'generateNaverSetupPacket',
  'syncNaverAssets',
  'probePublisher',
  'generateCandidates',
  'runKeywordBrain',
  'harvestLearning',
  'runConversionAttribution',
  'runLaunchAudit',
  'runKillSwitchDryRun',
] as const;

export type LaunchActionKey = (typeof LAUNCH_ACTION_KEYS)[number];

export type Summary = {
  ok: boolean;
  generated_at: string;
  kpis: Record<string, number>;
  counts: Record<string, Record<string, number>>;
  channel_budgets: Array<{
    platform: string;
    configured: boolean;
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
  integration_status: Record<string, boolean>;
  integration_details: Record<string, {
    label: string;
    configured: boolean;
    required: Record<string, boolean>;
    note: string;
  }>;
  external_launch_status: Record<string, {
    ready: boolean;
    pass: number;
    total: number;
    next_action: string;
    checks: Array<{ id: string; label: string; done: boolean; next: string }>;
  }> & { approved_or_testing_keywords?: number };
  channel_execution_states?: Record<string, {
    state: 'missing_credentials' | 'integration_ready' | 'permission_denied' | 'no_campaign' | 'executable';
    label: string;
    tone: 'good' | 'warn' | 'bad' | 'neutral';
    canSpend: boolean;
    summary: string;
    nextAction: string;
  }>;
  automation_modes?: Array<{
    id: 'recommendation' | 'approval' | 'limited_auto' | 'full_auto';
    label: string;
    levelMin: number;
    levelMax: number;
    description: string;
    allowedActions: string[];
  }>;
  active_automation_modes?: Array<{
    platform: string;
    level: number;
    mode: 'recommendation' | 'approval' | 'limited_auto' | 'full_auto';
    status: string;
  }>;
  tenant_guardrails?: Array<{
    id: string;
    label: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
  }>;
  tenant_ad_readiness?: Array<{
    id: string;
    label: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
  }>;
  tenant_policy?: {
    configured: boolean;
    error?: string | null;
    allowed_platforms: string[];
    monthly_budget_cap_krw: number;
    daily_budget_cap_krw: number;
    max_cpc_krw: number;
    max_test_loss_krw: number;
    max_automation_level: number;
    require_human_approval: boolean;
    full_auto_enabled: boolean;
    risk_status: string;
  };
  learning_loop?: {
    scope: string[];
    metrics: {
      clicks: number;
      cta_clicks: number;
      conversions: number;
      spend_krw: number;
      conversion_value_krw: number;
      cpa_krw: number;
      roas_pct: number;
      cta_rate_pct: number;
      conversion_rate_pct: number;
      bounce_rate_pct: number | null;
      engagement_sessions_30d: number;
      avg_time_on_page_seconds: number;
      avg_scroll_depth_pct: number;
      attribution_events_30d?: number;
      attribution_clean_events_30d?: number;
      attribution_quarantined_events_30d?: number;
      fact_clicks_30d?: number;
      fact_cta_clicks_30d?: number;
      fact_conversions_30d?: number;
      fact_spend_krw_30d?: number;
      fact_revenue_krw_30d?: number;
      fact_margin_krw_30d?: number;
      fact_margin_roas_pct_30d?: number;
      fact_cpa_krw_30d?: number;
      paid_assisted_organic_bookings_30d?: number;
      paid_assisted_organic_revenue_krw_30d?: number;
      paid_assisted_organic_margin_krw_30d?: number;
      paid_assisted_organic_cost_krw_30d?: number;
    };
    status: Record<string, boolean>;
    next_action: string;
  };
  enterprise_layer?: {
    platform_job_queue: {
      total: number;
      blocked: number;
      approved_or_running: number;
      external_api_write_count: number;
      safety_note: string;
    };
    conversion_data_quality: Record<string, number | string | null>;
    portfolio_optimizer: {
      candidates: number;
      approved: number;
      applied: number;
      expected_spend_delta_krw: number;
      expected_margin_delta_krw: number;
    };
    creative_factory: {
      variants: number;
      testing: number;
      fatigued: number;
      duplicate_content_risks: number;
    };
    saas_packaging: {
      workspaces: number;
      active_billing_profiles: number;
      full_auto_enabled: number;
    };
    runtime_readiness?: {
      checks: number;
      blocked_or_failed: number;
      critical: number;
    };
    runtime_execution?: {
      attempts: number;
      succeeded: number;
      blocked: number;
      external_api_write_count: number;
    };
    incident_response?: {
      total: number;
      critical: number;
      high: number;
      medium: number;
      low: number;
      open: number;
      watch: number;
      kill_switch_recommended: boolean;
      top_next_action: string;
      alerts: Array<{
        id: string;
        severity: 'critical' | 'high' | 'medium' | 'low';
        status: 'open' | 'watch';
        category: string;
        title: string;
        reason: string;
        next_action: string;
      }>;
    };
    agency_reporting?: {
      status: 'ready' | 'needs_attention' | 'blocked';
      readiness_score: number;
      workspaces: number;
      billable_tenants: number;
      active_billing_profiles: number;
      monthly_reports: number;
      ready_or_draft_reports: number;
      audit_exports: number;
      ready_audit_exports: number;
      full_auto_enabled: number;
      open_incidents: number;
      missing: string[];
      next_action: string;
    };
    completion_audit?: {
      status: 'ready' | 'needs_attention' | 'blocked';
      readiness_score: number;
      passed: number;
      warnings: number;
      failed: number;
      top_blocker: string;
      next_action: string;
      requirements: Array<{
        id: string;
        label: string;
        status: 'pass' | 'warn' | 'fail';
        evidence: string;
        next_action: string;
      }>;
    };
    experiment_standards?: {
      templates: number;
      active: number;
      types: number;
    };
    tenant_audit_exports?: {
      exports: number;
      ready: number;
      draft: number;
    };
    channel_adapters?: {
      snapshots: number;
      paused_write_ready: number;
      draft_ready: number;
      executable: number;
      blocked: number;
      external_api_write_count: number;
    };
    write_packets?: {
      packets: number;
      ready: number;
      blocked: number;
      dry_run: number;
      external_api_write_count: number;
    };
    execution_gates?: {
      gates: number;
      eligible: number;
      blocked: number;
      monitor_only: number;
      high_or_critical_risk: number;
      external_api_write_count: number;
    };
    rollback_drills?: {
      drills: number;
      ready: number;
      blocked: number;
      not_required: number;
      external_api_write_count: number;
    };
    limited_write_pilot?: {
      policies: number;
      active_policies: number;
      dry_run_only_policies: number;
      attempts: number;
      dry_run_succeeded: number;
      blocked: number;
      live_write_blocked: number;
      live_external_write_enabled: number;
      external_api_write_count: number;
      first_blocker: string | null;
    };
    ops_queues?: {
      executor_ready: number;
      confirmation_pending: number;
      failed_or_blocked: number;
      live_writes: number;
      next_action: string;
    };
  };
  launch_action_queue: Array<{
    id: string;
    priority: number;
    label: string;
    description: string;
    button_label: string;
    ui_action: LaunchActionKey;
    tone: 'good' | 'warn' | 'bad' | 'neutral';
  }>;
  recent_decisions: Array<Record<string, unknown>>;
  readiness_audit: {
    score: number;
    maxScore: number;
    grade: string;
    summary: string;
    items: Array<{
      id: string;
      label: string;
      benchmark: string;
      status: 'pass' | 'partial' | 'fail';
      score: number;
      maxScore: number;
      evidence: string;
      nextAction: string;
    }>;
  };
  expiring_packages: Array<Record<string, unknown>>;
  samples: {
    mappings: Array<Record<string, unknown>>;
    keyword_plans: Array<Record<string, unknown>>;
    learning_events: Array<Record<string, unknown>>;
    search_term_candidates: Array<Record<string, unknown>>;
    product_scenarios: Array<Record<string, unknown>>;
    landing_evolution_queue: Array<Record<string, unknown>>;
    budget_pacing: Array<Record<string, unknown>>;
    tenant_ad_accounts: Array<Record<string, unknown>>;
    change_requests: Array<Record<string, unknown>>;
    keyword_clusters?: Array<Record<string, unknown>>;
    external_mutations?: Array<Record<string, unknown>>;
    tenant_reports?: Array<Record<string, unknown>>;
    conversion_events?: Array<Record<string, unknown>>;
    performance_facts?: Array<Record<string, unknown>>;
    experiments?: Array<Record<string, unknown>>;
    blog_versions?: Array<Record<string, unknown>>;
    platform_jobs?: Array<Record<string, unknown>>;
    conversion_upload_jobs?: Array<Record<string, unknown>>;
    data_quality_snapshots?: Array<Record<string, unknown>>;
    portfolio_plans?: Array<Record<string, unknown>>;
    creative_asset_variants?: Array<Record<string, unknown>>;
    travel_intent_signals?: Array<Record<string, unknown>>;
    tenant_workspaces?: Array<Record<string, unknown>>;
    tenant_billing_profiles?: Array<Record<string, unknown>>;
    runtime_readiness_checks?: Array<Record<string, unknown>>;
    execution_attempts?: Array<Record<string, unknown>>;
    experiment_templates?: Array<Record<string, unknown>>;
    tenant_audit_exports?: Array<Record<string, unknown>>;
    channel_adapter_health?: Array<Record<string, unknown>>;
    platform_write_packets?: Array<Record<string, unknown>>;
    adapter_execution_gates?: Array<Record<string, unknown>>;
    rollback_drills?: Array<Record<string, unknown>>;
    limited_write_pilot_policies?: Array<Record<string, unknown>>;
    limited_write_pilot_attempts?: Array<Record<string, unknown>>;
    ops_executor_queue?: Array<Record<string, unknown>>;
    ops_confirmation_queue?: Array<Record<string, unknown>>;
    ops_failed_queue?: Array<Record<string, unknown>>;
  };
  automation_ladder: Array<{ level: number; label: string; description: string }>;
};

export type BudgetDraft = Summary['channel_budgets'][number];
export type TenantPolicyDraft = NonNullable<Summary['tenant_policy']>;
export type LaunchAudit = {
  readiness: {
    pass: number;
    warn: number;
    fail: number;
    total: number;
    today_launch_ready: boolean;
    next_action: string;
  };
  items: Array<{
    id: string;
    label: string;
    status: 'pass' | 'warn' | 'fail';
    evidence: string;
    next_action: string;
  }>;
};

export type StagingSmoke = {
  ok: boolean;
  checked_at: string;
  source: string;
  smoke: {
    status: 'pass' | 'fail';
    passed_assertions: number;
    failed_assertions: number;
    next_action: string;
    counts: {
      scenarios: number;
      keywords: number;
      intent_signals: number;
      creative_variants: number;
      platform_jobs: number;
      conversion_upload_jobs: number;
      portfolio_plans: number;
    };
    evidence: {
      package_id: string;
      platform_job_status: string;
      conversion_upload_status: string;
      external_api_write_zero: boolean;
    };
  };
  safety: {
    read_only: boolean;
    external_api_write: boolean;
    database_mutation: boolean;
    fixture_only: boolean;
    external_spend_krw: number;
  };
};

export type OperatingInventory = {
  ok: boolean;
  generated_at: string;
  inventory: {
    status: 'operational' | 'partial' | 'blocked';
    readiness_score: number;
    operational: number;
    partial: number;
    blocked: number;
    top_gap: string;
    next_action: string;
    items: Array<{
      id: string;
      label: string;
      status: 'operational' | 'partial' | 'blocked';
      evidence: string;
      next_action: string;
      risk: 'low' | 'medium' | 'high';
    }>;
    safety: {
      read_only: boolean;
      database_mutation: boolean;
      external_api_write: boolean;
      live_spend_krw: number;
    };
  };
};

export type StagingValidation = {
  ok: boolean;
  generated_at: string;
  validation: {
    status: 'pass' | 'warn' | 'fail';
    readiness_score: number;
    passed: number;
    warnings: number;
    failed: number;
    top_blocker: string | null;
    next_action: string;
    checks: Array<{
      id: string;
      label: string;
      status: 'pass' | 'warn' | 'fail';
      evidence: string;
      next_action: string;
    }>;
    safety: {
      read_only: boolean;
      database_mutation: boolean;
      external_api_write: boolean;
      live_spend_krw: number;
      full_auto_allowed: boolean;
    };
  };
};

export type AdminSurfaceQa = {
  ok: boolean;
  generated_at: string;
  qa: {
    status: 'pass' | 'warn' | 'fail';
    readiness_score: number;
    passed: number;
    warnings: number;
    failed: number;
    top_gap: string | null;
    next_action: string;
    surfaces: Array<{
      id: string;
      path: string;
      label: string;
      status: 'pass' | 'warn' | 'fail';
      evidence: string;
      data_sources: string[];
      expected_states: string[];
      drilldown_url: string;
      next_action: string;
    }>;
    safety: {
      read_only: boolean;
      database_mutation: boolean;
      external_api_write: boolean;
      live_spend_krw: number;
    };
  };
};

export type NaverSetupPacket = {
  existing_assets: {
    campaigns: number;
    adgroups: number;
    channels: number;
    stored_adgroup_id: string | null;
  };
  required_external: Array<{ item: string; status: string; suggested_value: string | null }>;
  packet: {
    campaign_name: string;
    ad_group_name: string;
    daily_budget_krw: number;
    monthly_budget_krw: number;
    max_cpc_krw: number;
    landing_url: string | null;
    final_url: string | null;
    keyword_count: number;
    keyword_csv: string;
    keyword_samples: Array<{ keyword: string | null; match_type: string | null; bid_krw: number; final_url: string | null }>;
  };
  next_action: string;
};
