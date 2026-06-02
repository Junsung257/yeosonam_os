import type { PlatformWritePacket } from './ad-os-v76-v85';
import type { ExecutionGateRow, RollbackDrillRow } from './ad-os-v86-v100';

type JsonRecord = Record<string, unknown>;

export type LimitedPilotRequestedMode = 'dry_run' | 'live_paused_write';
export type LimitedPilotStatus =
  | 'planned'
  | 'ready'
  | 'blocked'
  | 'dry_run_succeeded'
  | 'live_write_blocked'
  | 'failed';

export type LimitedWritePilotPolicy = {
  id?: string | null;
  tenant_id?: string | null;
  platform: 'naver';
  status: 'active' | 'paused' | 'blocked';
  pilot_level: 'dry_run_only' | 'live_paused_write';
  monthly_budget_cap_krw?: number | null;
  daily_budget_cap_krw?: number | null;
  max_cpc_krw?: number | null;
  max_test_loss_krw?: number | null;
  require_gate_eligible?: boolean | null;
  require_rollback_ready?: boolean | null;
  require_human_approval?: boolean | null;
  live_external_write_enabled?: boolean | null;
  env_flag_required?: string | null;
};

export type LimitedWritePilotAttempt = {
  tenant_id: string | null;
  platform: 'naver';
  policy_id: string | null;
  packet_id: string | null;
  gate_id: string | null;
  rollback_drill_id: string | null;
  run_id?: string | null;
  requested_mode: LimitedPilotRequestedMode;
  attempt_status: LimitedPilotStatus;
  external_api_write: false;
  policy_snapshot: JsonRecord;
  gate_snapshot: JsonRecord;
  rollback_snapshot: JsonRecord;
  packet_snapshot: JsonRecord;
  request_payload: JsonRecord;
  response_payload: JsonRecord;
  blockers: string[];
  next_action: string;
};

function int(value: unknown): number {
  return Math.max(0, Math.round(Number(value || 0)));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function packetSnapshot(packet?: (PlatformWritePacket & { id?: string | null }) | null): JsonRecord {
  if (!packet) return {};
  return {
    packet_type: packet.packet_type,
    lifecycle_status: packet.lifecycle_status,
    dry_run: packet.dry_run,
    external_api_write: packet.external_api_write,
    idempotency_key: packet.idempotency_key,
    blocked_reason: packet.blocked_reason,
  };
}

function gateSnapshot(gate?: (ExecutionGateRow & { id?: string | null }) | null): JsonRecord {
  if (!gate) return {};
  return {
    gate_status: gate.gate_status,
    requested_mode: gate.requested_mode,
    allowed_mode: gate.allowed_mode,
    risk_level: gate.risk_level,
    risk_score: gate.risk_score,
    blockers: gate.blockers,
    external_api_write: gate.external_api_write,
  };
}

function rollbackSnapshot(drill?: (RollbackDrillRow & { id?: string | null }) | null): JsonRecord {
  if (!drill) return {};
  return {
    drill_status: drill.drill_status,
    rollback_type: drill.rollback_type,
    blocked_reason: drill.blocked_reason,
    external_api_write: drill.external_api_write,
  };
}

export function defaultLimitedWritePilotPolicy(): LimitedWritePilotPolicy {
  return {
    tenant_id: null,
    platform: 'naver',
    status: 'paused',
    pilot_level: 'dry_run_only',
    monthly_budget_cap_krw: 0,
    daily_budget_cap_krw: 0,
    max_cpc_krw: 0,
    max_test_loss_krw: 0,
    require_gate_eligible: true,
    require_rollback_ready: true,
    require_human_approval: true,
    live_external_write_enabled: false,
    env_flag_required: 'AD_OS_NAVER_LIMITED_WRITE_ENABLED',
  };
}

export function evaluateLimitedWritePilot(input: {
  policy?: LimitedWritePilotPolicy | null;
  packet?: (PlatformWritePacket & { id?: string | null }) | null;
  gate?: (ExecutionGateRow & { id?: string | null }) | null;
  rollbackDrill?: (RollbackDrillRow & { id?: string | null }) | null;
  requestedMode?: LimitedPilotRequestedMode;
  envFlagEnabled?: boolean;
  runId?: string | null;
}): LimitedWritePilotAttempt {
  const policy = input.policy || defaultLimitedWritePilotPolicy();
  const requestedMode = input.requestedMode || 'dry_run';
  const packet = input.packet || null;
  const gate = input.gate || null;
  const drill = input.rollbackDrill || null;
  const blockers: string[] = [];

  if (policy.platform !== 'naver') blockers.push('unsupported_platform');
  if (policy.status !== 'active') blockers.push(`policy_${policy.status}`);
  if (policy.pilot_level === 'dry_run_only' && requestedMode === 'live_paused_write') blockers.push('policy_dry_run_only');
  if (int(policy.monthly_budget_cap_krw) <= 0) blockers.push('monthly_budget_cap_missing');
  if (int(policy.daily_budget_cap_krw) <= 0) blockers.push('daily_budget_cap_missing');
  if (int(policy.max_cpc_krw) <= 0) blockers.push('max_cpc_missing');
  if (int(policy.max_test_loss_krw) <= 0) blockers.push('test_loss_cap_missing');

  if (!packet) blockers.push('packet_missing');
  if (packet && packet.platform !== 'naver') blockers.push('packet_not_naver');
  if (packet && packet.packet_type !== 'naver_paused_keyword') blockers.push(`packet_type_${packet.packet_type}`);
  if (packet && packet.lifecycle_status !== 'ready') blockers.push(`packet_${packet.lifecycle_status}`);
  if (packet && packet.external_api_write) blockers.push('packet_external_write_unexpected');

  if (policy.require_gate_eligible !== false) {
    if (!gate) blockers.push('gate_missing');
    else if (gate.gate_status !== 'eligible') blockers.push(`gate_${gate.gate_status}`);
  }
  if (gate?.external_api_write) blockers.push('gate_external_write_unexpected');
  if (policy.require_human_approval !== false && gate) {
    const gateBudget = gate.budget_snapshot || {};
    if (gateBudget.human_approved !== true) blockers.push('human_approval_required');
  }
  if (policy.require_rollback_ready !== false) {
    if (!drill) blockers.push('rollback_drill_missing');
    else if (drill.drill_status !== 'ready') blockers.push(`rollback_${drill.drill_status}`);
  }
  if (drill?.external_api_write) blockers.push('rollback_external_write_unexpected');

  if (requestedMode === 'live_paused_write') {
    if (!policy.live_external_write_enabled) blockers.push('live_external_write_disabled');
    if (!input.envFlagEnabled) blockers.push('env_flag_missing');
  }

  const blockerList = unique(blockers);
  let attemptStatus: LimitedPilotStatus = blockerList.length > 0 ? 'blocked' : 'ready';
  if (attemptStatus === 'ready' && requestedMode === 'dry_run') attemptStatus = 'dry_run_succeeded';
  if (requestedMode === 'live_paused_write' && blockerList.includes('live_external_write_disabled')) {
    attemptStatus = 'live_write_blocked';
  }

  return {
    tenant_id: policy.tenant_id ?? packet?.tenant_id ?? gate?.tenant_id ?? drill?.tenant_id ?? null,
    platform: 'naver',
    policy_id: policy.id || null,
    packet_id: packet?.id || gate?.packet_id || drill?.packet_id || null,
    gate_id: gate?.id || null,
    rollback_drill_id: drill?.id || null,
    run_id: input.runId ?? null,
    requested_mode: requestedMode,
    attempt_status: attemptStatus,
    external_api_write: false,
    policy_snapshot: {
      status: policy.status,
      pilot_level: policy.pilot_level,
      monthly_budget_cap_krw: int(policy.monthly_budget_cap_krw),
      daily_budget_cap_krw: int(policy.daily_budget_cap_krw),
      max_cpc_krw: int(policy.max_cpc_krw),
      max_test_loss_krw: int(policy.max_test_loss_krw),
      live_external_write_enabled: Boolean(policy.live_external_write_enabled),
      env_flag_required: policy.env_flag_required || 'AD_OS_NAVER_LIMITED_WRITE_ENABLED',
    },
    gate_snapshot: gateSnapshot(gate),
    rollback_snapshot: rollbackSnapshot(drill),
    packet_snapshot: packetSnapshot(packet),
    request_payload: {
      requested_mode: requestedMode,
      env_flag_enabled: Boolean(input.envFlagEnabled),
      external_api_write: false,
    },
    response_payload: {
      live_keyword_activation: false,
      naver_paused_keyword_create: false,
      dry_run_only: requestedMode === 'dry_run',
    },
    blockers: blockerList,
    next_action: blockerList.length > 0
      ? `Resolve ${blockerList[0]} before Naver limited pilot.`
      : requestedMode === 'dry_run'
        ? 'Dry-run pilot passed. Keep live write disabled until policy and environment are explicitly enabled.'
        : 'Ready for live paused-write executor, but external API write remains disabled in this control-plane result.',
  };
}

export function summarizeLimitedWritePilot(attempts: LimitedWritePilotAttempt[]) {
  return {
    attempts: attempts.length,
    ready: attempts.filter((row) => row.attempt_status === 'ready').length,
    dry_run_succeeded: attempts.filter((row) => row.attempt_status === 'dry_run_succeeded').length,
    blocked: attempts.filter((row) => row.attempt_status === 'blocked').length,
    live_write_blocked: attempts.filter((row) => row.attempt_status === 'live_write_blocked').length,
    external_api_write_count: attempts.filter((row) => row.external_api_write).length,
    first_blocker: attempts.find((row) => row.blockers.length > 0)?.blockers[0] || null,
  };
}
