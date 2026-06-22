import { describe, expect, it } from 'vitest';
import { buildAdOsAgentOperatingModel } from '@/app/admin/ad-os/_lib/agent-operating-model';
import type { Summary } from '@/app/admin/ad-os/_lib/types';
import { buildAdOsCampaignMemoryRecord } from './ad-os-campaign-memory';

function summaryFixture(): Summary {
  return {
    ok: true,
    generated_at: '2026-06-22T00:00:00.000Z',
    kpis: {
      keyword_candidates: 12,
      draft_campaigns: 2,
      learning_events: 4,
    },
    counts: {},
    channel_budgets: [{
      platform: 'naver',
      configured: true,
      monthly_budget_krw: 3000000,
      daily_budget_cap_krw: 100000,
      max_cpc_krw: 800,
      max_test_loss_krw: 200000,
      automation_level: 2,
      status: 'active',
    }],
    integration_status: {},
    integration_details: {},
    external_launch_status: {},
    tenant_policy: {
      configured: true,
      allowed_platforms: ['naver', 'google'],
      monthly_budget_cap_krw: 3000000,
      daily_budget_cap_krw: 100000,
      max_cpc_krw: 800,
      max_test_loss_krw: 200000,
      max_automation_level: 2,
      require_human_approval: true,
      full_auto_enabled: false,
      risk_status: 'watch',
    },
    tenant_guardrails: [],
    tenant_ad_readiness: [],
    learning_loop: {
      scope: ['keyword'],
      metrics: {
        clicks: 100,
        cta_clicks: 3,
        conversions: 1,
        spend_krw: 120000,
        conversion_value_krw: 240000,
        cpa_krw: 120000,
        roas_pct: 200,
        cta_rate_pct: 3,
        conversion_rate_pct: 1,
        bounce_rate_pct: null,
        engagement_sessions_30d: 10,
        avg_time_on_page_seconds: 45,
        avg_scroll_depth_pct: 50,
      },
      status: { attribution_ready: true },
      next_action: 'Review search terms.',
    },
    enterprise_layer: {
      platform_job_queue: { total: 0, blocked: 0, approved_or_running: 0, external_api_write_count: 0, safety_note: '' },
      conversion_data_quality: {},
      portfolio_optimizer: { candidates: 0, approved: 0, applied: 0, expected_spend_delta_krw: 0, expected_margin_delta_krw: 0 },
      creative_factory: { variants: 3, testing: 1, fatigued: 0, duplicate_content_risks: 0 },
      saas_packaging: { workspaces: 1, active_billing_profiles: 0, full_auto_enabled: 0 },
      agency_reporting: {
        status: 'ready',
        readiness_score: 90,
        workspaces: 1,
        billable_tenants: 1,
        active_billing_profiles: 0,
        monthly_reports: 1,
        ready_or_draft_reports: 1,
        audit_exports: 1,
        ready_audit_exports: 1,
        full_auto_enabled: 0,
        open_incidents: 0,
        missing: [],
        next_action: 'Send weekly report.',
      },
      completion_audit: {
        status: 'ready',
        readiness_score: 90,
        passed: 9,
        warnings: 0,
        failed: 0,
        top_blocker: '',
        next_action: 'Proceed.',
        requirements: [],
      },
    },
    launch_action_queue: [],
    recent_decisions: [],
    readiness_audit: { score: 0, maxScore: 0, grade: '', summary: '', items: [] },
    expiring_packages: [],
    samples: {
      mappings: [],
      keyword_plans: [],
      learning_events: [{ id: 'learning-1' }],
      search_term_candidates: [{ id: 'term-1' }],
      product_scenarios: [],
      landing_evolution_queue: [],
      budget_pacing: [],
      tenant_ad_accounts: [],
      change_requests: [],
      tenant_workspaces: [{ id: 'workspace-1', tenant_id: 'tenant-1' }],
      experiments: [{ id: 'exp-1', status: 'failed' }],
    },
    automation_ladder: [],
  };
}

describe('ad-os campaign memory persistence payload', () => {
  it('packages tenant context, approvals, diagnostics, and failed experiments', () => {
    const summary = summaryFixture();
    const model = buildAdOsAgentOperatingModel(summary);
    const record = buildAdOsCampaignMemoryRecord({
      tenantId: 'tenant-1',
      model,
      summary,
      diagnostic: { run_id: 'run-1' },
      pipelineResults: [{ key: 'budget_pacing', ok: true }],
    });

    expect(record.tenant_id).toBe('tenant-1');
    expect(record.workspace_id).toBe('workspace-1');
    expect(record.guardrails.budget).toMatchObject({
      monthly_budget_cap_krw: 3000000,
      active_channel_budgets: 1,
    });
    expect(record.approval_rules.role_approvals).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'performance_analyst' })]),
    );
    expect(record.failed_experiments).toHaveLength(1);
    expect(record.last_diagnostic.pipeline_results).toEqual([expect.objectContaining({ key: 'budget_pacing' })]);
    expect(record.next_tests.length).toBeGreaterThan(0);
  });
});
