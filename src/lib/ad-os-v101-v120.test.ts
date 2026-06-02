import { describe, expect, it } from 'vitest';
import { buildChannelAdapterCapability, buildNaverPausedKeywordPacket } from './ad-os-v76-v85';
import { buildRollbackDrill, evaluateExecutionGate } from './ad-os-v86-v100';
import { defaultLimitedWritePilotPolicy, evaluateLimitedWritePilot, summarizeLimitedWritePilot } from './ad-os-v101-v120';

const capability = buildChannelAdapterCapability({
  platform: 'naver',
  credentialsReady: true,
  connectionStatus: 'ready',
  externalCampaignId: 'cmp-1',
  externalAdGroupId: 'grp-1',
  budgetStatus: 'active',
  monthlyBudgetKrw: 100000,
  dailyBudgetCapKrw: 10000,
  maxCpcKrw: 250,
  automationLevel: 3,
  canPublishKeywords: true,
});

function readyPreflight() {
  const packet = { id: 'packet-101', ...buildNaverPausedKeywordPacket(capability, { keyword: 'busan parents danang', maxCpcKrw: 250 }) };
  const gate = {
    id: 'gate-101',
    ...evaluateExecutionGate({
      platform: 'naver',
      packet,
      adapter: capability,
      requestedMode: 'limited_autopilot',
      budget: {
        monthlyBudgetKrw: 100000,
        dailyBudgetCapKrw: 10000,
        maxCpcKrw: 250,
        maxTestLossKrw: 10000,
        automationLevel: 3,
        requireHumanApproval: true,
        humanApproved: true,
        killSwitchClear: true,
      },
    }),
  };
  const rollbackDrill = { id: 'drill-101', ...buildRollbackDrill({ gate, packet }) };
  return { packet, gate, rollbackDrill };
}

describe('ad-os-v101-v120 limited write pilot', () => {
  it('blocks the default policy so production keys cannot spend by accident', () => {
    const { packet, gate, rollbackDrill } = readyPreflight();
    const attempt = evaluateLimitedWritePilot({
      policy: defaultLimitedWritePilotPolicy(),
      packet,
      gate,
      rollbackDrill,
      requestedMode: 'dry_run',
    });

    expect(attempt.attempt_status).toBe('blocked');
    expect(attempt.blockers).toContain('policy_paused');
    expect(attempt.external_api_write).toBe(false);
  });

  it('passes only a dry-run attempt when policy, gate, rollback, and budget caps are ready', () => {
    const { packet, gate, rollbackDrill } = readyPreflight();
    const attempt = evaluateLimitedWritePilot({
      policy: {
        ...defaultLimitedWritePilotPolicy(),
        id: 'policy-101',
        status: 'active',
        monthly_budget_cap_krw: 100000,
        daily_budget_cap_krw: 10000,
        max_cpc_krw: 250,
        max_test_loss_krw: 10000,
      },
      packet,
      gate,
      rollbackDrill,
      requestedMode: 'dry_run',
    });

    expect(attempt.attempt_status).toBe('dry_run_succeeded');
    expect(attempt.blockers).toEqual([]);
    expect(attempt.response_payload).toMatchObject({ naver_paused_keyword_create: false });
  });

  it('blocks live paused writes without both policy and environment enablement', () => {
    const { packet, gate, rollbackDrill } = readyPreflight();
    const attempt = evaluateLimitedWritePilot({
      policy: {
        ...defaultLimitedWritePilotPolicy(),
        id: 'policy-102',
        status: 'active',
        pilot_level: 'live_paused_write',
        monthly_budget_cap_krw: 100000,
        daily_budget_cap_krw: 10000,
        max_cpc_krw: 250,
        max_test_loss_krw: 10000,
        live_external_write_enabled: false,
      },
      packet,
      gate,
      rollbackDrill,
      requestedMode: 'live_paused_write',
      envFlagEnabled: false,
    });

    expect(attempt.attempt_status).toBe('live_write_blocked');
    expect(attempt.blockers).toEqual(expect.arrayContaining(['live_external_write_disabled', 'env_flag_missing']));
    expect(attempt.external_api_write).toBe(false);
  });

  it('summarizes dry-run, blocked, and live-blocked states for the dashboard', () => {
    const { packet, gate, rollbackDrill } = readyPreflight();
    const readyPolicy = {
      ...defaultLimitedWritePilotPolicy(),
      status: 'active' as const,
      monthly_budget_cap_krw: 100000,
      daily_budget_cap_krw: 10000,
      max_cpc_krw: 250,
      max_test_loss_krw: 10000,
    };
    const attempts = [
      evaluateLimitedWritePilot({ policy: readyPolicy, packet, gate, rollbackDrill }),
      evaluateLimitedWritePilot({ policy: defaultLimitedWritePilotPolicy(), packet, gate, rollbackDrill }),
    ];

    expect(summarizeLimitedWritePilot(attempts)).toMatchObject({
      attempts: 2,
      dry_run_succeeded: 1,
      blocked: 1,
      external_api_write_count: 0,
    });
  });
});
