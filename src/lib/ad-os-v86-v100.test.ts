import { describe, expect, it } from 'vitest';
import { buildChannelAdapterCapability, buildGoogleCampaignDraftPacket, buildNaverPausedKeywordPacket } from './ad-os-v76-v85';
import { buildRollbackDrill, evaluateExecutionGate, summarizeExecutionGates } from './ad-os-v86-v100';

const naverCapability = buildChannelAdapterCapability({
  platform: 'naver',
  credentialsReady: true,
  connectionStatus: 'ready',
  externalCampaignId: 'cmp-1',
  externalAdGroupId: 'grp-1',
  budgetStatus: 'active',
  monthlyBudgetKrw: 100000,
  dailyBudgetCapKrw: 10000,
  maxCpcKrw: 300,
  automationLevel: 3,
  canPublishKeywords: true,
});

describe('ad-os-v86-v100 execution gates', () => {
  it('allows Naver paused packet only after approval, budget caps, and limited autopilot level', () => {
    const packet = { id: 'packet-1', ...buildNaverPausedKeywordPacket(naverCapability, { keyword: '부산 부모님 다낭 여행' }) };
    const gate = evaluateExecutionGate({
      platform: 'naver',
      packet,
      adapter: naverCapability,
      requestedMode: 'limited_autopilot',
      budget: {
        monthlyBudgetKrw: 100000,
        dailyBudgetCapKrw: 10000,
        maxCpcKrw: 300,
        maxTestLossKrw: 10000,
        spentTodayKrw: 0,
        spentMonthKrw: 1000,
        automationLevel: 3,
        requireHumanApproval: true,
        humanApproved: true,
        killSwitchClear: true,
      },
    });

    expect(gate).toMatchObject({
      gate_status: 'eligible',
      allowed_mode: 'limited_autopilot',
      external_api_write: false,
    });
    expect(gate.blockers).toEqual([]);
  });

  it('blocks limited writes without human approval or test loss cap', () => {
    const packet = { id: 'packet-2', ...buildNaverPausedKeywordPacket(naverCapability, { keyword: '부산 다낭 마감임박' }) };
    const gate = evaluateExecutionGate({
      platform: 'naver',
      packet,
      adapter: naverCapability,
      requestedMode: 'limited_autopilot',
      budget: {
        monthlyBudgetKrw: 100000,
        dailyBudgetCapKrw: 10000,
        maxCpcKrw: 300,
        maxTestLossKrw: 0,
        automationLevel: 3,
        requireHumanApproval: true,
        humanApproved: false,
        killSwitchClear: true,
      },
    });

    expect(gate.gate_status).toBe('blocked');
    expect(gate.blockers).toEqual(expect.arrayContaining(['human_approval_required', 'test_loss_cap_missing']));
    expect(gate.external_api_write).toBe(false);
  });

  it('keeps Google draft packets out of limited write execution', () => {
    const googleCapability = buildChannelAdapterCapability({
      platform: 'google',
      credentialsReady: true,
      connectionStatus: 'ready',
      budgetStatus: 'active',
      monthlyBudgetKrw: 100000,
      dailyBudgetCapKrw: 10000,
      maxCpcKrw: 500,
      automationLevel: 3,
    });
    const packet = { id: 'packet-3', ...buildGoogleCampaignDraftPacket(googleCapability, { campaignName: 'Danang draft' }) };
    const gate = evaluateExecutionGate({
      platform: 'google',
      packet,
      adapter: googleCapability,
      requestedMode: 'limited_autopilot',
      budget: {
        monthlyBudgetKrw: 100000,
        dailyBudgetCapKrw: 10000,
        maxCpcKrw: 500,
        maxTestLossKrw: 10000,
        automationLevel: 3,
        humanApproved: true,
        killSwitchClear: true,
      },
    });

    expect(gate.gate_status).toBe('blocked');
    expect(gate.blockers).toContain('google_limited_write_disabled');
  });

  it('requires a ready rollback drill before Naver limited write can be considered operational', () => {
    const packet = { id: 'packet-4', ...buildNaverPausedKeywordPacket(naverCapability, { keyword: '부산출발 에어부산 다낭' }) };
    const gate = evaluateExecutionGate({
      platform: 'naver',
      packet,
      adapter: naverCapability,
      requestedMode: 'limited_autopilot',
      budget: {
        monthlyBudgetKrw: 100000,
        dailyBudgetCapKrw: 10000,
        maxCpcKrw: 300,
        maxTestLossKrw: 10000,
        automationLevel: 3,
        humanApproved: true,
        killSwitchClear: true,
      },
    });
    const drill = buildRollbackDrill({ gate, packet });

    expect(drill).toMatchObject({
      drill_status: 'ready',
      rollback_type: 'pause_keyword',
      external_api_write: false,
    });
    expect(drill.verification_steps.length).toBeGreaterThan(1);
  });

  it('summarizes gate and rollback readiness for admin KPI cards', () => {
    const packet = { id: 'packet-5', ...buildNaverPausedKeywordPacket(naverCapability, { keyword: '다낭 50만원대 패키지' }) };
    const eligible = evaluateExecutionGate({
      platform: 'naver',
      packet,
      adapter: naverCapability,
      requestedMode: 'limited_autopilot',
      budget: {
        monthlyBudgetKrw: 100000,
        dailyBudgetCapKrw: 10000,
        maxCpcKrw: 300,
        maxTestLossKrw: 10000,
        automationLevel: 3,
        humanApproved: true,
        killSwitchClear: true,
      },
    });
    const blocked = evaluateExecutionGate({
      platform: 'naver',
      packet,
      adapter: naverCapability,
      requestedMode: 'limited_autopilot',
      budget: { automationLevel: 1, humanApproved: false },
    });
    const summary = summarizeExecutionGates([eligible, blocked], [buildRollbackDrill({ gate: eligible, packet })]);

    expect(summary).toMatchObject({ gates: 2, eligible: 1, blocked: 1, rollback_ready: 1, external_api_write_count: 0 });
  });
});
