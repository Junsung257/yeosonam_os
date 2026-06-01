import { describe, expect, it } from 'vitest';
import {
  automationLevelToMode,
  buildTenantRiskGuardrails,
  classifyChannelExecutionState,
} from './ad-os-governance';

describe('automationLevelToMode', () => {
  it('maps automation levels to the fixed four operating modes', () => {
    expect(automationLevelToMode(0)).toBe('recommendation');
    expect(automationLevelToMode(1)).toBe('recommendation');
    expect(automationLevelToMode(2)).toBe('approval');
    expect(automationLevelToMode(3)).toBe('limited_auto');
    expect(automationLevelToMode(4)).toBe('full_auto');
    expect(automationLevelToMode(5)).toBe('full_auto');
  });

  it('clamps out-of-range levels', () => {
    expect(automationLevelToMode(-5)).toBe('recommendation');
    expect(automationLevelToMode(99)).toBe('full_auto');
    expect(automationLevelToMode(null)).toBe('recommendation');
  });
});

describe('classifyChannelExecutionState', () => {
  const base = {
    integrationReady: true,
    permissionOk: true,
    hasCampaign: true,
    hasAdGroup: true,
    budgetReady: true,
    approvedKeywords: 10,
    internalDrafts: 2,
    platformLabel: 'Google',
  };

  it('blocks spend when credentials are missing', () => {
    const state = classifyChannelExecutionState({ ...base, integrationReady: false });
    expect(state.state).toBe('missing_credentials');
    expect(state.canSpend).toBe(false);
  });

  it('shows permission denial before campaign readiness', () => {
    const state = classifyChannelExecutionState({ ...base, permissionOk: false, hasCampaign: false });
    expect(state.state).toBe('permission_denied');
    expect(state.canSpend).toBe(false);
  });

  it('requires campaign and ad group before execution', () => {
    const state = classifyChannelExecutionState({ ...base, hasAdGroup: false });
    expect(state.state).toBe('no_campaign');
    expect(state.canSpend).toBe(false);
  });

  it('allows spend only when budget, keywords, and drafts are ready', () => {
    const executable = classifyChannelExecutionState(base);
    expect(executable.state).toBe('executable');
    expect(executable.canSpend).toBe(true);

    const waiting = classifyChannelExecutionState({ ...base, approvedKeywords: 0 });
    expect(waiting.state).toBe('integration_ready');
    expect(waiting.canSpend).toBe(false);
  });
});

describe('buildTenantRiskGuardrails', () => {
  it('marks budget and automation guardrails as pass/fail signals', () => {
    const safe = buildTenantRiskGuardrails({
      tenantScopedTables: 3,
      monthlyBudgetKrw: 100000,
      activeBudgetChannels: 2,
      maxAutomationLevel: 3,
    });
    expect(safe.find((item) => item.id === 'budget_cap')?.status).toBe('pass');
    expect(safe.find((item) => item.id === 'automation_cap')?.status).toBe('pass');

    const risky = buildTenantRiskGuardrails({
      tenantScopedTables: 0,
      monthlyBudgetKrw: 0,
      activeBudgetChannels: 4,
      maxAutomationLevel: 5,
    });
    expect(risky.find((item) => item.id === 'tenant_scope')?.status).toBe('fail');
    expect(risky.find((item) => item.id === 'budget_cap')?.status).toBe('fail');
    expect(risky.find((item) => item.id === 'automation_cap')?.status).toBe('warn');
    expect(risky.find((item) => item.id === 'active_channels')?.status).toBe('warn');
  });
});
