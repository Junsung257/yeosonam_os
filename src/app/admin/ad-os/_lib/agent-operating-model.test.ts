import { describe, expect, it } from 'vitest';
import { buildAdOsAgentOperatingModel } from './agent-operating-model';
import type { Summary } from './types';

function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    ok: true,
    generated_at: '2026-06-22T00:00:00Z',
    kpis: {
      keyword_candidates: 24,
      draft_campaigns: 2,
      learning_events: 7,
    },
    counts: { mappings_by_status: {}, keyword_plans_by_status: {} },
    channel_budgets: [
      {
        platform: 'naver',
        configured: true,
        monthly_budget_krw: 300000,
        daily_budget_cap_krw: 30000,
        max_cpc_krw: 700,
        max_test_loss_krw: 50000,
        automation_level: 2,
        status: 'active',
      },
    ],
    integration_status: {},
    integration_details: {},
    external_launch_status: {},
    recent_decisions: [],
    readiness_audit: {
      score: 0,
      maxScore: 0,
      grade: 'n/a',
      summary: '',
      items: [],
    },
    expiring_packages: [],
    samples: {
      mappings: [],
      keyword_plans: [],
      learning_events: [],
      search_term_candidates: [{ term: 'danang family package' }],
      product_scenarios: [{ id: 'scenario-1' }],
      landing_evolution_queue: [],
      budget_pacing: [],
      tenant_ad_accounts: [],
      change_requests: [],
    },
    automation_ladder: [],
    learning_loop: {
      scope: ['naver'],
      metrics: {
        clicks: 100,
        cta_clicks: 8,
        conversions: 2,
        spend_krw: 100000,
        conversion_value_krw: 450000,
        cpa_krw: 50000,
        roas_pct: 450,
        cta_rate_pct: 8,
        conversion_rate_pct: 2,
        bounce_rate_pct: 45,
        engagement_sessions_30d: 100,
        avg_time_on_page_seconds: 80,
        avg_scroll_depth_pct: 60,
      },
      status: { has_click_signal: true, has_booking_signal: true },
      next_action: 'Scale the safest keyword cluster.',
    },
    enterprise_layer: {
      platform_job_queue: {
        total: 0,
        blocked: 0,
        approved_or_running: 0,
        external_api_write_count: 0,
        safety_note: 'read only',
      },
      conversion_data_quality: {},
      portfolio_optimizer: {
        candidates: 0,
        approved: 0,
        applied: 0,
        expected_spend_delta_krw: 0,
        expected_margin_delta_krw: 0,
      },
      creative_factory: {
        variants: 4,
        testing: 1,
        fatigued: 0,
        duplicate_content_risks: 0,
      },
      saas_packaging: {
        workspaces: 1,
        active_billing_profiles: 1,
        full_auto_enabled: 0,
      },
      completion_audit: {
        status: 'needs_attention',
        readiness_score: 84,
        passed: 8,
        warnings: 2,
        failed: 0,
        top_blocker: '',
        next_action: 'Keep live write disabled.',
        requirements: [],
      },
      agency_reporting: {
        status: 'ready',
        readiness_score: 90,
        workspaces: 1,
        billable_tenants: 1,
        active_billing_profiles: 1,
        monthly_reports: 1,
        ready_or_draft_reports: 1,
        audit_exports: 1,
        ready_audit_exports: 1,
        full_auto_enabled: 0,
        open_incidents: 0,
        missing: [],
        next_action: 'Send advertiser report after review.',
      },
    },
    launch_action_queue: [],
    ...overrides,
  } as Summary;
}

describe('Ad OS agent operating model', () => {
  it('builds role-split AI ad team status and campaign memory', () => {
    const model = buildAdOsAgentOperatingModel(makeSummary());

    expect(model.roles.map((role) => role.id)).toEqual([
      'campaign_planner',
      'performance_analyst',
      'copywriter',
      'reporter',
    ]);
    expect(model.teamScore).toBeGreaterThanOrEqual(80);
    expect(model.campaignMemory.facts.map((fact) => fact.label)).toContain('승인 기준');
    expect(model.campaignMemory.nextTests).toHaveLength(3);
  });

  it('surfaces fixed ROAS diagnosis when evidence is missing or weak', () => {
    const model = buildAdOsAgentOperatingModel(makeSummary({
      channel_budgets: [],
      kpis: { keyword_candidates: 0, draft_campaigns: 0, learning_events: 3 },
      samples: {
        ...makeSummary().samples,
        search_term_candidates: [],
      },
      learning_loop: {
        ...makeSummary().learning_loop!,
        metrics: {
          ...makeSummary().learning_loop!.metrics,
          roas_pct: 120,
          cta_rate_pct: 1,
          conversion_rate_pct: 0,
        },
      },
    }));

    expect(model.roasDiagnostic.status).not.toBe('ready');
    expect(model.roasDiagnostic.hypotheses.map((row) => row.id)).toEqual(expect.arrayContaining([
      'missing-search-terms',
      'low-roas',
      'weak-click-intent',
      'conversion-gap',
      'budget-not-active',
    ]));
  });
});
