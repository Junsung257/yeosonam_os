import { describe, expect, it } from 'vitest';
import { decideNaverPausedWriteExecutor } from './ad-os-v221-v240';

const readyPolicy = {
  id: 'policy-1',
  tenant_id: null,
  platform: 'naver' as const,
  status: 'active' as const,
  pilot_level: 'live_paused_write' as const,
  monthly_budget_cap_krw: 100000,
  daily_budget_cap_krw: 10000,
  max_cpc_krw: 300,
  max_test_loss_krw: 10000,
  require_gate_eligible: true,
  require_rollback_ready: true,
  require_human_approval: true,
  live_external_write_enabled: true,
  env_flag_required: 'AD_OS_NAVER_LIMITED_WRITE_ENABLED',
};

const readyJob = {
  id: 'job-1',
  tenant_id: null,
  platform: 'naver' as const,
  job_type: 'create_paused_keyword',
  status: 'approved' as const,
  automation_level: 3,
  external_ad_group_id: 'grp-a',
  external_api_write: false,
  request_payload: {
    keyword: '부산 부모님 다낭 패키지',
    max_cpc_krw: 250,
  },
};

describe('ad-os-v221-v240 Naver paused write executor', () => {
  it('passes dry-run preflight without external API write', () => {
    const decision = decideNaverPausedWriteExecutor({
      job: readyJob,
      policy: readyPolicy,
      requestedMode: 'dry_run',
      apply: false,
      confirmLiveWrite: false,
      envFlagEnabled: false,
      runId: 'run-1',
    });

    expect(decision.allowed).toBe(true);
    expect(decision.willCallExternalApi).toBe(false);
    expect(decision.attempt).toMatchObject({ status: 'succeeded', dry_run: true, external_api_write: false });
    expect(decision.keyword).toBe('부산 부모님 다낭 패키지');
    expect(decision.bidAmt).toBe(250);
  });

  it('blocks live write unless policy, env, apply, and confirmation all pass', () => {
    const decision = decideNaverPausedWriteExecutor({
      job: readyJob,
      policy: { ...readyPolicy, live_external_write_enabled: false },
      requestedMode: 'live_paused_write',
      apply: false,
      confirmLiveWrite: false,
      envFlagEnabled: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.willCallExternalApi).toBe(false);
    expect(decision.blockers).toEqual(expect.arrayContaining([
      'limited_pilot_live_write_disabled',
      'apply_required_for_live_write',
      'confirm_live_write_required',
      'limited_write_env_flag_missing',
    ]));
    expect(decision.attempt.external_api_write).toBe(false);
  });

  it('allows live paused write only at the final explicit gate', () => {
    const decision = decideNaverPausedWriteExecutor({
      job: readyJob,
      policy: readyPolicy,
      requestedMode: 'live_paused_write',
      apply: true,
      confirmLiveWrite: true,
      envFlagEnabled: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.willCallExternalApi).toBe(true);
    expect(decision.attempt).toMatchObject({ status: 'succeeded', dry_run: false, external_api_write: false });
    expect(decision.nccAdgroupId).toBe('grp-a');
  });

  it('blocks malformed jobs before any external call', () => {
    const decision = decideNaverPausedWriteExecutor({
      job: {
        ...readyJob,
        job_type: 'activate_keyword',
        request_payload: {},
        external_ad_group_id: null,
      },
      policy: readyPolicy,
      requestedMode: 'live_paused_write',
      apply: true,
      confirmLiveWrite: true,
      envFlagEnabled: true,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.willCallExternalApi).toBe(false);
    expect(decision.blockers).toEqual(expect.arrayContaining(['job_type_activate_keyword', 'keyword_missing', 'ncc_adgroup_id_missing']));
  });
});
