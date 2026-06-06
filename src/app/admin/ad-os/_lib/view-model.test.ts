import { describe, expect, it } from 'vitest';
import {
  buildLaunchSteps,
  buildLaunchWizardSteps,
  getActiveModeByPlatform,
  getCompletionDrilldown,
  getExecutionStateEntries,
  getTenantReportView,
  getTotalMappingStatus,
} from './view-model';
import type { Summary } from './types';

function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    ok: true,
    generated_at: '2026-06-05T00:00:00Z',
    kpis: {},
    counts: {
      mappings_by_status: { candidate: 2, approved: 3 },
      keyword_plans_by_status: { approved: 2, testing: 1 },
    },
    channel_budgets: [
      {
        platform: 'naver',
        configured: true,
        status: 'active',
        monthly_budget_krw: 100000,
        daily_budget_cap_krw: 10000,
        max_cpc_krw: 500,
        max_test_loss_krw: 20000,
        automation_level: 2,
        external_ad_group_id: 'grp_1',
      },
    ],
    integration_status: { naver: true, google: false },
    integration_details: {},
    external_launch_status: {},
    recent_decisions: [],
    samples: {
      mappings: [],
      keyword_plans: [],
      learning_events: [],
      product_scenarios: [],
      landing_evolution_queue: [],
      change_requests: [],
    },
    enterprise_layer: {
      completion_audit: {
        status: 'needs_attention',
        readiness_score: 50,
        passed: 1,
        warnings: 1,
        failed: 1,
        top_blocker: 'missing approval',
        next_action: 'review',
        requirements: [
          { id: 'pass', label: 'Pass', status: 'pass', evidence: 'ok', next_action: 'none' },
          { id: 'fail', label: 'Fail', status: 'fail', evidence: 'bad', next_action: 'fix' },
          { id: 'warn', label: 'Warn', status: 'warn', evidence: 'risk', next_action: 'watch' },
        ],
      },
    },
    channel_execution_states: {
      naver: {
        state: 'executable',
        label: 'Executable',
        tone: 'good',
        canSpend: true,
        summary: 'ready',
        nextAction: 'run',
      },
      meta: {
        state: 'missing_credentials',
        label: 'Missing',
        tone: 'warn',
        canSpend: false,
        summary: 'blocked',
        nextAction: 'connect',
      },
    },
    active_automation_modes: [{ platform: 'naver', level: 2, mode: 'limited_auto', status: 'active' }],
    ...overrides,
  } as Summary;
}

describe('Ad OS view model helpers', () => {
  it('totals mapping status counts', () => {
    expect(getTotalMappingStatus(null)).toBe(0);
    expect(getTotalMappingStatus(makeSummary())).toBe(5);
  });

  it('keeps execution state cards scoped to search publishers', () => {
    expect(getExecutionStateEntries(makeSummary()).map(([platform]) => platform)).toEqual(['naver']);
  });

  it('indexes active automation modes by platform', () => {
    expect(getActiveModeByPlatform(makeSummary()).get('naver')?.mode).toBe('limited_auto');
  });

  it('sorts completion drilldown by blocker severity', () => {
    expect(getCompletionDrilldown(makeSummary()).map((item) => item.id)).toEqual(['fail', 'warn', 'pass']);
  });

  it('builds launch checklist and wizard steps from the same launch fields', () => {
    const summary = makeSummary({
      kpis: {
        keyword_candidates: 12,
        draft_campaigns: 1,
        active_campaigns: 0,
      },
    });

    expect(buildLaunchSteps(summary).map((step) => [step.label, step.done])).toEqual([
      ['Publisher API', true],
      ['Search budget', true],
      ['Keyword candidates', true],
      ['Guarded keywords', true],
      ['Draft campaigns', true],
    ]);
    expect(buildLaunchWizardSteps(summary).map((step) => [step.label, step.status])).toEqual([
      ['1. Publisher API', 'ready'],
      ['2. Budget cap', 'active'],
      ['3. Draft campaign', 'ready'],
      ['4. Naver ad group', 'id stored'],
    ]);
  });

  it('derives tenant report display values', () => {
    const view = getTenantReportView({ report: { conversions: 2 }, period: { from: '2026-06-01' } });

    expect(view.tenantReportBody?.conversions).toBe(2);
    expect(view.tenantReportPeriod?.from).toBe('2026-06-01');
  });
});
