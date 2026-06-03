import { describe, expect, it } from 'vitest';
import { defaultLimitedWritePilotPolicy } from './ad-os-v101-v120';
import { evaluateLegacyNaverPublisherInterlock } from './ad-os-v121-v140';

const readyPolicy = {
  ...defaultLimitedWritePilotPolicy(),
  status: 'active' as const,
  pilot_level: 'live_paused_write' as const,
  live_external_write_enabled: true,
  monthly_budget_cap_krw: 100000,
  daily_budget_cap_krw: 10000,
  max_cpc_krw: 250,
  max_test_loss_krw: 10000,
};

describe('ad-os-v121-v140 legacy Naver publisher interlock', () => {
  it('does not allow external writes for dry-runs or upstream-blocked publishers', () => {
    const interlock = evaluateLegacyNaverPublisherInterlock({
      action: 'publish_paused_keyword',
      mode: 'dry_run',
      apply: false,
      canPublish: true,
    });

    expect(interlock.allowed).toBe(false);
    expect(interlock.requested_external_api_write).toBe(false);
    expect(interlock.external_api_write).toBe(false);
    expect(interlock.blockers).toEqual([]);
  });

  it('blocks legacy paused keyword writes without the limited pilot policy and explicit flags', () => {
    const interlock = evaluateLegacyNaverPublisherInterlock({
      action: 'publish_paused_keyword',
      mode: 'guarded',
      apply: true,
      canPublish: true,
      policy: defaultLimitedWritePilotPolicy(),
      limitedPilotEnvEnabled: false,
      confirmLiveWrite: false,
    });

    expect(interlock.allowed).toBe(false);
    expect(interlock.blockers).toEqual(expect.arrayContaining([
      'limited_pilot_policy_paused',
      'limited_pilot_not_live_paused_write',
      'limited_pilot_live_write_disabled',
      'limited_pilot_env_flag_missing',
      'explicit_live_write_confirmation_missing',
    ]));
    expect(interlock.external_api_write).toBe(false);
  });

  it('can declare a paused write eligible but still leaves actual external write to audited executor path', () => {
    const interlock = evaluateLegacyNaverPublisherInterlock({
      action: 'publish_paused_keyword',
      mode: 'guarded',
      apply: true,
      canPublish: true,
      policy: readyPolicy,
      limitedPilotEnvEnabled: true,
      confirmLiveWrite: true,
    });

    expect(interlock.allowed).toBe(true);
    expect(interlock.blockers).toEqual([]);
    expect(interlock.external_api_write).toBe(false);
  });

  it('requires separate active-keyword spend controls before activation can be considered', () => {
    const interlock = evaluateLegacyNaverPublisherInterlock({
      action: 'activate_paused_keyword',
      mode: 'guarded',
      apply: true,
      canPublish: true,
      policy: readyPolicy,
      limitedPilotEnvEnabled: true,
      confirmLiveWrite: true,
      activeKeywordEnvEnabled: false,
      confirmActiveSpend: false,
    });

    expect(interlock.allowed).toBe(false);
    expect(interlock.blockers).toEqual(expect.arrayContaining([
      'active_keyword_env_flag_missing',
      'active_keyword_spend_confirmation_missing',
    ]));
    expect(interlock.external_api_write).toBe(false);
  });
});
