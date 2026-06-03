import { describe, expect, it } from 'vitest';
import { buildAdOsOperatingInventory } from '@/lib/ad-os-v581-v600';
import { evaluateLiveSpendPreflight } from '@/lib/ad-os-v601-v620';
import { buildAdOsLearningEvidence } from '@/lib/ad-os-v621-v640';
import { buildAdOsStagingSmokeSummary } from '@/lib/ad-os-v541-v560';
import { buildAdOsStagingValidationPackage } from '@/lib/ad-os-v641-v660';

const completionAudit = {
  status: 'pass',
  failed: 0,
  warnings: 0,
  passed: 12,
  requirements: [],
};

const enterpriseLayer = {
  platform_job_queue: { external_api_write_count: 0 },
  runtime_execution: { external_api_write_count: 0 },
  channel_adapters: {
    snapshots: 3,
    paused_write_ready: 1,
    draft_ready: 1,
    external_api_write_count: 0,
  },
  execution_gates: { external_api_write_count: 0 },
  limited_write_pilot: {
    dry_run_succeeded: 1,
    live_external_write_enabled: 0,
    external_api_write_count: 0,
  },
  conversion_data_quality: {
    uploadable_conversions: 1,
    blocked_conversions: 0,
  },
  portfolio_optimizer: { candidates: 1 },
  creative_factory: { variants: 3, duplicate_content_risks: 0 },
  saas_packaging: {
    workspaces: 1,
    active_billing_profiles: 1,
    full_auto_enabled: 0,
  },
};

function buildReadyInput() {
  const smoke = buildAdOsStagingSmokeSummary();
  const learning = buildAdOsLearningEvidence([
    {
      tenant_id: 'tenant-1',
      product_id: 'product-1',
      scenario_id: 'family-danang',
      keyword_text: '부모님 다낭 패키지',
      blog_post_id: 'blog-1',
      content_creative_id: 'creative-1',
      platform: 'naver',
      clicks: 40,
      cta_clicks: 8,
      conversions: 2,
      cost_krw: 20000,
      revenue_krw: 900000,
      margin_krw: 120000,
      sessions: 50,
      bounces: 20,
    },
  ]);
  const operatingInventory = buildAdOsOperatingInventory({
    completionAudit: completionAudit as never,
    stagingSmoke: smoke,
    enterpriseLayer,
    learningLoop: {
      status: {
        margin_learning_ready: true,
        attribution_ready: true,
      },
      metrics: {
        fact_clicks_30d: 40,
        fact_cta_clicks_30d: 8,
        fact_conversions_30d: 2,
        fact_margin_krw_30d: 120000,
        fact_margin_roas_pct_30d: 600,
      },
    },
  });
  const liveSpendPreflight = evaluateLiveSpendPreflight({
    action: 'naver_paused_keyword',
    platform: 'naver',
    requested_mode: 'limited_autopilot',
    tenant_policy_configured: true,
    human_approved: false,
    kill_switch_clear: true,
    automation_level: 3,
    full_auto_enabled: false,
    monthly_budget_cap_krw: 100000,
    daily_budget_cap_krw: 10000,
    max_cpc_krw: 200,
    max_test_loss_krw: 30000,
    spent_today_krw: 0,
    spent_month_krw: 0,
    credentials_ready: true,
    permission_ready: true,
    campaign_ready: true,
    adapter_ready: true,
    rollback_ready: true,
    completion_failed: 0,
    operating_inventory_blocked: 0,
    staging_smoke_passed: true,
    external_write_count: 0,
    blocked_conversions: 0,
  });

  return {
    completionAudit,
    stagingSmoke: smoke,
    operatingInventory,
    liveSpendPreflight,
    learningEvidence: learning,
    enterpriseLayer,
  };
}

describe('buildAdOsStagingValidationPackage', () => {
  it('treats blocked live spend as a staging safety pass', () => {
    const result = buildAdOsStagingValidationPackage(buildReadyInput());

    expect(result.status).toBe('warn');
    expect(result.gates.operating_inventory).toBe('warn');
    expect(result.gates.live_spend_preflight).toBe('pass');
    expect(result.gates.external_write_safety).toBe('pass');
    expect(result.safety.live_spend_krw).toBe(0);
    expect(result.safety.external_api_write).toBe(false);
  });

  it('fails when any external write is detected', () => {
    const input = buildReadyInput();
    const result = buildAdOsStagingValidationPackage({
      ...input,
      enterpriseLayer: {
        ...enterpriseLayer,
        runtime_execution: { external_api_write_count: 1 },
      },
    });

    expect(result.status).toBe('fail');
    expect(result.gates.external_write_safety).toBe('fail');
    expect(result.top_blocker).toBe('External write zero');
  });

  it('fails when full auto is enabled in staging', () => {
    const input = buildReadyInput();
    const result = buildAdOsStagingValidationPackage({
      ...input,
      enterpriseLayer: {
        ...enterpriseLayer,
        saas_packaging: {
          ...enterpriseLayer.saas_packaging,
          full_auto_enabled: 1,
        },
      },
    });

    expect(result.status).toBe('fail');
    expect(result.gates.full_auto_safety).toBe('fail');
    expect(result.next_action).toContain('full auto');
  });
});
