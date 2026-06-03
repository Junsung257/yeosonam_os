export type LiveSpendPreflightStatus = 'eligible' | 'monitor_only' | 'blocked';
export type LiveSpendPreflightAction =
  | 'naver_paused_keyword'
  | 'naver_activate_keyword'
  | 'google_campaign_publish'
  | 'meta_campaign_publish'
  | 'conversion_upload'
  | 'dry_run';

export type LiveSpendPreflightInput = {
  action: LiveSpendPreflightAction;
  platform: 'naver' | 'google' | 'meta' | 'kakao';
  requested_mode: 'recommend' | 'approve' | 'limited_autopilot' | 'full_autopilot';
  tenant_policy_configured?: boolean | null;
  human_approved?: boolean | null;
  kill_switch_clear?: boolean | null;
  automation_level?: number | null;
  full_auto_enabled?: boolean | null;
  monthly_budget_cap_krw?: number | null;
  daily_budget_cap_krw?: number | null;
  max_cpc_krw?: number | null;
  max_test_loss_krw?: number | null;
  spent_today_krw?: number | null;
  spent_month_krw?: number | null;
  credentials_ready?: boolean | null;
  permission_ready?: boolean | null;
  campaign_ready?: boolean | null;
  adapter_ready?: boolean | null;
  rollback_ready?: boolean | null;
  completion_failed?: number | null;
  operating_inventory_blocked?: number | null;
  staging_smoke_passed?: boolean | null;
  external_write_count?: number | null;
  blocked_conversions?: number | null;
};

export type LiveSpendPreflightResult = {
  status: LiveSpendPreflightStatus;
  live_write_allowed: false;
  limited_paused_write_candidate: boolean;
  blockers: string[];
  warnings: string[];
  required_approvals: string[];
  next_action: string;
  safety: {
    read_only: true;
    database_mutation: false;
    external_api_write: false;
    live_spend_krw: 0;
    full_auto_allowed: false;
  };
};

function positive(value: unknown): boolean {
  return Number(value || 0) > 0;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function modeRank(mode: LiveSpendPreflightInput['requested_mode']): number {
  if (mode === 'recommend') return 0;
  if (mode === 'approve') return 1;
  if (mode === 'limited_autopilot') return 2;
  return 3;
}

export function evaluateLiveSpendPreflight(input: LiveSpendPreflightInput): LiveSpendPreflightResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const approvals = ['operator_approval'];
  const actionRequiresLiveCampaign =
    input.action === 'naver_activate_keyword' ||
    input.action === 'google_campaign_publish' ||
    input.action === 'meta_campaign_publish';

  if (Number(input.external_write_count || 0) > 0) blockers.push('external_write_already_detected');
  if (Number(input.completion_failed || 0) > 0) blockers.push('completion_audit_failed');
  if (Number(input.operating_inventory_blocked || 0) > 0) blockers.push('operating_inventory_blocked');
  if (!input.staging_smoke_passed) blockers.push('staging_smoke_not_passing');
  if (!input.tenant_policy_configured) blockers.push('tenant_policy_missing');
  if (input.kill_switch_clear === false) blockers.push('kill_switch_active');
  if (!input.human_approved) blockers.push('human_approval_required');
  if (input.full_auto_enabled || input.requested_mode === 'full_autopilot') blockers.push('full_autopilot_disabled');
  if (modeRank(input.requested_mode) > 2) blockers.push('requested_mode_not_allowed');
  if (Number(input.automation_level || 0) < 2) blockers.push('automation_level_below_approval');
  if (input.requested_mode === 'limited_autopilot' && Number(input.automation_level || 0) < 3) {
    blockers.push('limited_autopilot_level_required');
  }
  if (!positive(input.monthly_budget_cap_krw)) blockers.push('monthly_budget_cap_missing');
  if (!positive(input.daily_budget_cap_krw)) blockers.push('daily_budget_cap_missing');
  if (!positive(input.max_cpc_krw)) blockers.push('max_cpc_missing');
  if (!positive(input.max_test_loss_krw)) blockers.push('test_loss_cap_missing');
  if (
    positive(input.daily_budget_cap_krw) &&
    Number(input.spent_today_krw || 0) >= Number(input.daily_budget_cap_krw || 0)
  ) {
    blockers.push('daily_budget_exhausted');
  }
  if (
    positive(input.monthly_budget_cap_krw) &&
    Number(input.spent_month_krw || 0) >= Number(input.monthly_budget_cap_krw || 0)
  ) {
    blockers.push('monthly_budget_exhausted');
  }
  if (!input.credentials_ready) blockers.push('credentials_not_ready');
  if (!input.permission_ready) blockers.push('permission_not_ready');
  if (!input.campaign_ready) blockers.push('campaign_not_ready');
  if (!input.adapter_ready) blockers.push('adapter_not_ready');
  if (Number(input.blocked_conversions || 0) > 0) warnings.push('conversion_quality_has_blockers');
  if (!input.rollback_ready) warnings.push('rollback_drill_not_ready');

  if (input.platform !== 'naver' && input.action !== 'conversion_upload' && input.action !== 'dry_run') {
    blockers.push(`${input.platform}_live_publish_disabled`);
  }
  if (actionRequiresLiveCampaign) {
    blockers.push('active_campaign_spend_disabled_by_default');
  }

  const blockerList = unique(blockers);
  const warningList = unique(warnings);
  const limitedPausedWriteCandidate =
    blockerList.length === 0 &&
    input.platform === 'naver' &&
    input.action === 'naver_paused_keyword' &&
    input.requested_mode === 'limited_autopilot';
  const status: LiveSpendPreflightStatus =
    blockerList.length > 0 ? 'blocked' :
    input.requested_mode === 'recommend' || input.requested_mode === 'approve' ? 'monitor_only' :
    'eligible';

  return {
    status,
    live_write_allowed: false,
    limited_paused_write_candidate: limitedPausedWriteCandidate,
    blockers: blockerList,
    warnings: warningList,
    required_approvals: unique([
      ...approvals,
      input.requested_mode === 'limited_autopilot' ? 'limited_budget_policy' : '',
      input.platform === 'naver' ? 'naver_paused_write_only' : '',
      actionRequiresLiveCampaign ? 'separate_live_spend_approval' : '',
    ]),
    next_action: blockerList.length > 0
      ? `Resolve ${blockerList[0]} before any paid execution.`
      : limitedPausedWriteCandidate
        ? 'Eligible only as a limited Naver paused-keyword candidate. The preflight still performs no external write.'
        : 'Monitor-only. Keep recommendations and approvals separate from paid execution.',
    safety: {
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      live_spend_krw: 0,
      full_auto_allowed: false,
    },
  };
}
