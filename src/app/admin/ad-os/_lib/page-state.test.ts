import { describe, expect, it } from 'vitest';
import type { Summary } from './types';
import {
  INITIAL_AD_OS_PAGE_STATE,
  reduceAdOsPageState,
} from './page-state';

const summary = {
  ok: true,
  generated_at: '2026-06-05T00:00:00.000Z',
  kpis: {},
  counts: {},
  channel_budgets: [
    {
      platform: 'naver',
      configured: true,
      monthly_budget_krw: 100000,
      daily_budget_cap_krw: 10000,
      max_cpc_krw: 500,
      max_test_loss_krw: 20000,
      automation_level: 1,
      status: 'draft',
    },
  ],
  integration_status: {},
  integration_details: {},
  external_launch_status: {},
  tenant_policy: {
    configured: true,
    allowed_platforms: ['naver'],
    monthly_budget_cap_krw: 100000,
    daily_budget_cap_krw: 10000,
    max_cpc_krw: 500,
    max_test_loss_krw: 20000,
    max_automation_level: 1,
    require_human_approval: true,
    full_auto_enabled: false,
    risk_status: 'guarded',
  },
} as Summary;

describe('Ad OS page state reducer', () => {
  it('loads summary and derives editable drafts from it', () => {
    const next = reduceAdOsPageState(INITIAL_AD_OS_PAGE_STATE, {
      type: 'summary-loaded',
      summary,
    });

    expect(next.summary).toBe(summary);
    expect(next.budgetDrafts).toEqual(summary.channel_budgets);
    expect(next.tenantPolicyDraft).toEqual(summary.tenant_policy);
  });

  it('normalizes numeric budget draft fields from input values', () => {
    const loaded = reduceAdOsPageState(INITIAL_AD_OS_PAGE_STATE, {
      type: 'summary-loaded',
      summary,
    });
    const next = reduceAdOsPageState(loaded, {
      type: 'update-budget-draft',
      platform: 'naver',
      key: 'max_cpc_krw',
      value: '750',
    });

    expect(next.budgetDrafts[0]?.max_cpc_krw).toBe(750);
  });

  it('normalizes numeric tenant policy fields from input values', () => {
    const loaded = reduceAdOsPageState(INITIAL_AD_OS_PAGE_STATE, {
      type: 'summary-loaded',
      summary,
    });
    const next = reduceAdOsPageState(loaded, {
      type: 'update-tenant-policy-draft',
      key: 'max_automation_level',
      value: '2',
    });

    expect(next.tenantPolicyDraft?.max_automation_level).toBe(2);
  });

  it('keeps at least naver selected when toggling the last allowed tenant platform off', () => {
    const loaded = reduceAdOsPageState(INITIAL_AD_OS_PAGE_STATE, {
      type: 'summary-loaded',
      summary,
    });
    const next = reduceAdOsPageState(loaded, {
      type: 'toggle-tenant-platform',
      platform: 'naver',
    });

    expect(next.tenantPolicyDraft?.allowed_platforms).toEqual(['naver']);
  });
});
