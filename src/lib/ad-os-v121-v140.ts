import type { LimitedWritePilotPolicy } from './ad-os-v101-v120';

export type LegacyNaverPublisherAction = 'publish_paused_keyword' | 'activate_paused_keyword';
export type LegacyNaverPublisherMode = 'dry_run' | 'guarded' | 'full' | 'paused_only' | 'active_allowed';

export type LegacyNaverPublisherInterlockInput = {
  action: LegacyNaverPublisherAction;
  mode: LegacyNaverPublisherMode;
  apply: boolean;
  canPublish: boolean;
  policy?: LimitedWritePilotPolicy | null;
  limitedPilotEnvEnabled?: boolean;
  activeKeywordEnvEnabled?: boolean;
  confirmLiveWrite?: boolean;
  confirmActiveSpend?: boolean;
};

export type LegacyNaverPublisherInterlock = {
  allowed: boolean;
  external_api_write: false;
  requested_external_api_write: boolean;
  blockers: string[];
  next_action: string;
  policy_snapshot: Record<string, unknown>;
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function policyReadyForPausedWrite(policy?: LimitedWritePilotPolicy | null): string[] {
  const blockers: string[] = [];
  if (!policy) return ['limited_pilot_policy_missing'];
  if (policy.status !== 'active') blockers.push(`limited_pilot_policy_${policy.status}`);
  if (policy.pilot_level !== 'live_paused_write') blockers.push('limited_pilot_not_live_paused_write');
  if (!policy.live_external_write_enabled) blockers.push('limited_pilot_live_write_disabled');
  if (Number(policy.monthly_budget_cap_krw || 0) <= 0) blockers.push('limited_pilot_monthly_cap_missing');
  if (Number(policy.daily_budget_cap_krw || 0) <= 0) blockers.push('limited_pilot_daily_cap_missing');
  if (Number(policy.max_cpc_krw || 0) <= 0) blockers.push('limited_pilot_max_cpc_missing');
  if (Number(policy.max_test_loss_krw || 0) <= 0) blockers.push('limited_pilot_test_loss_cap_missing');
  return blockers;
}

function snapshot(policy?: LimitedWritePilotPolicy | null): Record<string, unknown> {
  if (!policy) return {};
  return {
    status: policy.status,
    pilot_level: policy.pilot_level,
    live_external_write_enabled: Boolean(policy.live_external_write_enabled),
    monthly_budget_cap_krw: Number(policy.monthly_budget_cap_krw || 0),
    daily_budget_cap_krw: Number(policy.daily_budget_cap_krw || 0),
    max_cpc_krw: Number(policy.max_cpc_krw || 0),
    max_test_loss_krw: Number(policy.max_test_loss_krw || 0),
    env_flag_required: policy.env_flag_required || 'AD_OS_NAVER_LIMITED_WRITE_ENABLED',
  };
}

export function evaluateLegacyNaverPublisherInterlock(
  input: LegacyNaverPublisherInterlockInput,
): LegacyNaverPublisherInterlock {
  const requestedExternalWrite = Boolean(input.apply && input.canPublish && input.mode !== 'dry_run');
  const blockers: string[] = [];

  if (!requestedExternalWrite) {
    return {
      allowed: false,
      external_api_write: false,
      requested_external_api_write: false,
      blockers: [],
      next_action: 'Dry-run or blocked upstream. No external publisher call is allowed.',
      policy_snapshot: snapshot(input.policy),
    };
  }

  if (input.mode === 'full') blockers.push('full_autopilot_legacy_publisher_disabled');
  blockers.push(...policyReadyForPausedWrite(input.policy));
  if (!input.limitedPilotEnvEnabled) blockers.push('limited_pilot_env_flag_missing');
  if (!input.confirmLiveWrite) blockers.push('explicit_live_write_confirmation_missing');

  if (input.action === 'activate_paused_keyword') {
    if (!input.activeKeywordEnvEnabled) blockers.push('active_keyword_env_flag_missing');
    if (!input.confirmActiveSpend) blockers.push('active_keyword_spend_confirmation_missing');
  }

  const blockerList = unique(blockers);
  return {
    allowed: blockerList.length === 0,
    external_api_write: false,
    requested_external_api_write: true,
    blockers: blockerList,
    next_action: blockerList.length > 0
      ? `Resolve ${blockerList[0]} before any legacy Naver publisher can call the external API.`
      : input.action === 'publish_paused_keyword'
        ? 'Paused keyword write is eligible for the future limited executor. Record external write through the audited adapter path.'
        : 'Active keyword activation is eligible only under explicit spend controls. Record activation through an audited executor.',
    policy_snapshot: snapshot(input.policy),
  };
}
