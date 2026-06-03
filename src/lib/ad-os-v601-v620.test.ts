import { describe, expect, it } from 'vitest';
import { evaluateLiveSpendPreflight, type LiveSpendPreflightInput } from './ad-os-v601-v620';

const base: LiveSpendPreflightInput = {
  action: 'naver_paused_keyword',
  platform: 'naver',
  requested_mode: 'limited_autopilot',
  tenant_policy_configured: true,
  human_approved: true,
  kill_switch_clear: true,
  automation_level: 3,
  full_auto_enabled: false,
  monthly_budget_cap_krw: 100_000,
  daily_budget_cap_krw: 10_000,
  max_cpc_krw: 300,
  max_test_loss_krw: 20_000,
  spent_today_krw: 1_000,
  spent_month_krw: 20_000,
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
};

describe('evaluateLiveSpendPreflight', () => {
  it('marks a fully guarded Naver paused keyword as eligible without allowing live writes', () => {
    const result = evaluateLiveSpendPreflight(base);

    expect(result.status).toBe('eligible');
    expect(result.limited_paused_write_candidate).toBe(true);
    expect(result.live_write_allowed).toBe(false);
    expect(result.safety).toMatchObject({
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      live_spend_krw: 0,
      full_auto_allowed: false,
    });
  });

  it('blocks when approval, budget, or smoke evidence is missing', () => {
    const result = evaluateLiveSpendPreflight({
      ...base,
      human_approved: false,
      daily_budget_cap_krw: 0,
      staging_smoke_passed: false,
    });

    expect(result.status).toBe('blocked');
    expect(result.blockers).toEqual(expect.arrayContaining([
      'human_approval_required',
      'daily_budget_cap_missing',
      'staging_smoke_not_passing',
    ]));
    expect(result.live_write_allowed).toBe(false);
  });

  it('blocks active/live campaign paths even when other guardrails pass', () => {
    const result = evaluateLiveSpendPreflight({
      ...base,
      action: 'google_campaign_publish',
      platform: 'google',
      credentials_ready: true,
      permission_ready: true,
      campaign_ready: true,
      adapter_ready: true,
    });

    expect(result.status).toBe('blocked');
    expect(result.blockers).toEqual(expect.arrayContaining([
      'google_live_publish_disabled',
      'active_campaign_spend_disabled_by_default',
    ]));
    expect(result.required_approvals).toContain('separate_live_spend_approval');
  });

  it('blocks full autopilot regardless of budget and approval state', () => {
    const result = evaluateLiveSpendPreflight({
      ...base,
      requested_mode: 'full_autopilot',
      full_auto_enabled: true,
    });

    expect(result.status).toBe('blocked');
    expect(result.blockers).toEqual(expect.arrayContaining([
      'full_autopilot_disabled',
      'requested_mode_not_allowed',
    ]));
    expect(result.safety.full_auto_allowed).toBe(false);
  });
});
