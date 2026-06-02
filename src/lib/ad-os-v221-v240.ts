import type { LimitedWritePilotPolicy } from './ad-os-v101-v120';
import type { ExecutionAttemptRow, PlatformExecutionJob } from './ad-os-v61-v75';

type JsonRecord = Record<string, unknown>;

export type NaverPausedWriteMode = 'dry_run' | 'live_paused_write';

export type NaverPausedWriteExecutorInput = {
  job: PlatformExecutionJob & {
    external_ad_group_id?: string | null;
    request_payload?: JsonRecord | null;
  };
  policy?: LimitedWritePilotPolicy | null;
  requestedMode?: NaverPausedWriteMode;
  apply?: boolean;
  confirmLiveWrite?: boolean;
  envFlagEnabled?: boolean;
  runId?: string | null;
  now?: string;
};

export type NaverPausedWriteExecutorDecision = {
  allowed: boolean;
  dryRun: boolean;
  willCallExternalApi: boolean;
  blockers: string[];
  attempt: ExecutionAttemptRow;
  keyword: string | null;
  bidAmt: number | null;
  nccAdgroupId: string | null;
  preflightResponse: JsonRecord;
};

function nowIso(): string {
  return new Date().toISOString();
}

function int(value: unknown): number {
  return Math.max(0, Math.round(Number(value || 0)));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function readKeyword(payload: JsonRecord): string | null {
  return text(payload.keyword || payload.keyword_text || payload.naver_keyword) || null;
}

function readBid(payload: JsonRecord, policy?: LimitedWritePilotPolicy | null): number | null {
  const raw = int(payload.bidAmt || payload.bid_amt || payload.max_cpc_krw || payload.maxCpcKrw);
  if (raw > 0) return Math.max(70, raw);
  const policyMax = int(policy?.max_cpc_krw);
  return policyMax > 0 ? Math.max(70, Math.min(policyMax, 300)) : null;
}

function readAdgroupId(job: NaverPausedWriteExecutorInput['job']): string | null {
  const payload = job.request_payload || {};
  return text(job.external_ad_group_id || payload.nccAdgroupId || payload.ncc_adgroup_id || payload.external_ad_group_id) || null;
}

function policyBlockers(policy?: LimitedWritePilotPolicy | null): string[] {
  const blockers: string[] = [];
  if (!policy) return ['limited_pilot_policy_missing'];
  if (policy.platform !== 'naver') blockers.push('limited_pilot_platform_mismatch');
  if (policy.status !== 'active') blockers.push(`limited_pilot_policy_${policy.status}`);
  if (policy.pilot_level !== 'live_paused_write') blockers.push('limited_pilot_not_live_paused_write');
  if (!policy.live_external_write_enabled) blockers.push('limited_pilot_live_write_disabled');
  if (int(policy.monthly_budget_cap_krw) <= 0) blockers.push('limited_pilot_monthly_cap_missing');
  if (int(policy.daily_budget_cap_krw) <= 0) blockers.push('limited_pilot_daily_cap_missing');
  if (int(policy.max_cpc_krw) <= 0) blockers.push('limited_pilot_max_cpc_missing');
  if (int(policy.max_test_loss_krw) <= 0) blockers.push('limited_pilot_test_loss_cap_missing');
  return blockers;
}

export function decideNaverPausedWriteExecutor(input: NaverPausedWriteExecutorInput): NaverPausedWriteExecutorDecision {
  const requestedMode = input.requestedMode || 'dry_run';
  const now = input.now || nowIso();
  const job = input.job;
  const payload = job.request_payload || {};
  const keyword = readKeyword(payload);
  const bidAmt = readBid(payload, input.policy);
  const nccAdgroupId = readAdgroupId(job);
  const blockers: string[] = [];

  if (job.platform !== 'naver') blockers.push('job_not_naver');
  if (job.job_type !== 'create_paused_keyword') blockers.push(`job_type_${job.job_type}`);
  if (!['approved', 'running'].includes(job.status)) blockers.push(`job_status_${job.status}`);
  if (job.external_api_write) blockers.push('unexpected_job_external_api_write_flag');
  if (Number(job.automation_level || 0) < 3 && requestedMode === 'live_paused_write') blockers.push('limited_autopilot_required');
  if (!keyword) blockers.push('keyword_missing');
  if (!bidAmt) blockers.push('bid_missing');
  if (!nccAdgroupId) blockers.push('ncc_adgroup_id_missing');

  const requestedLive = requestedMode === 'live_paused_write';
  if (requestedLive) {
    blockers.push(...policyBlockers(input.policy));
    if (!input.apply) blockers.push('apply_required_for_live_write');
    if (!input.confirmLiveWrite) blockers.push('confirm_live_write_required');
    if (!input.envFlagEnabled) blockers.push('limited_write_env_flag_missing');
  }

  const blockerList = unique(blockers);
  const dryRun = !requestedLive;
  const allowed = blockerList.length === 0;
  const willCallExternalApi = allowed && requestedLive && input.apply === true && input.confirmLiveWrite === true && input.envFlagEnabled === true;
  const responsePayload = {
    executor: 'ad_os_v221_v240_naver_paused_write_executor',
    requested_mode: requestedMode,
    dry_run: dryRun,
    preflight_passed: allowed,
    will_call_external_api: willCallExternalApi,
    external_api_write: false,
    blockers: blockerList,
    keyword,
    bid_amt: bidAmt,
    ncc_adgroup_id: nccAdgroupId,
    next_step: willCallExternalApi
      ? 'Call createNaverPausedKeywords, then record the returned keyword id through external-results confirmation.'
      : allowed
        ? 'Dry-run passed. Enable live mode only with explicit policy, env flag, apply, and confirm_live_write.'
        : `Resolve ${blockerList[0]} before Naver paused write.`,
  };

  return {
    allowed,
    dryRun,
    willCallExternalApi,
    blockers: blockerList,
    keyword,
    bidAmt,
    nccAdgroupId,
    preflightResponse: responsePayload,
    attempt: {
      tenant_id: job.tenant_id ?? null,
      platform: 'naver',
      job_id: job.id,
      run_id: input.runId ?? null,
      attempt_type: 'platform_job',
      status: allowed ? 'succeeded' : 'blocked',
      dry_run: !willCallExternalApi,
      external_api_write: false,
      request_payload: {
        requested_mode: requestedMode,
        keyword,
        bid_amt: bidAmt,
        ncc_adgroup_id: nccAdgroupId,
        confirm_live_write: Boolean(input.confirmLiveWrite),
      },
      response_payload: responsePayload,
      blocked_reason: blockerList[0] || null,
      retryable: blockerList.includes('limited_write_env_flag_missing') || blockerList.includes('limited_pilot_policy_missing'),
      started_at: now,
      finished_at: now,
    },
  };
}
