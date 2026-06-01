import { describe, expect, it } from 'vitest';
import { decideAdOsBudgetPacing } from './ad-os-budget-pacing';

describe('decideAdOsBudgetPacing', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  it('blocks channels without a monthly budget', () => {
    const decision = decideAdOsBudgetPacing({
      platform: 'naver',
      monthlyBudgetKrw: 0,
      dailyBudgetCapKrw: 10000,
      actualSpendKrw: 0,
      automationLevel: 3,
      status: 'active',
      now,
    });

    expect(decision.status).toBe('no_budget');
    expect(decision.canApplyInternally).toBe(false);
  });

  it('reduces daily cap when spend pace is too fast', () => {
    const decision = decideAdOsBudgetPacing({
      platform: 'naver',
      monthlyBudgetKrw: 300000,
      dailyBudgetCapKrw: 30000,
      actualSpendKrw: 220000,
      automationLevel: 3,
      status: 'active',
      now,
    });

    expect(decision.status).toBe('overspend');
    expect(decision.recommendedAction).toBe('decrease_daily_cap');
    expect(decision.nextDailyBudgetCapKrw).toBeLessThan(30000);
  });

  it('pauses exhausted budgets', () => {
    const decision = decideAdOsBudgetPacing({
      platform: 'google',
      monthlyBudgetKrw: 100000,
      dailyBudgetCapKrw: 10000,
      actualSpendKrw: 100000,
      automationLevel: 4,
      status: 'active',
      now,
    });

    expect(decision.status).toBe('exhausted');
    expect(decision.recommendedAction).toBe('pause_channel');
    expect(decision.nextDailyBudgetCapKrw).toBe(0);
  });
});
