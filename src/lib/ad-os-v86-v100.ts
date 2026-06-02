import type { AdapterCapability, PlatformWritePacket } from './ad-os-v76-v85';

type JsonRecord = Record<string, unknown>;

export type ExecutionMode = 'recommend' | 'approve' | 'limited_autopilot' | 'full_autopilot';
export type ExecutionGateStatus = 'eligible' | 'blocked' | 'monitor_only';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type BudgetGuardInput = {
  monthlyBudgetKrw?: number | null;
  dailyBudgetCapKrw?: number | null;
  maxCpcKrw?: number | null;
  maxTestLossKrw?: number | null;
  spentTodayKrw?: number | null;
  spentMonthKrw?: number | null;
  automationLevel?: number | null;
  requireHumanApproval?: boolean | null;
  humanApproved?: boolean | null;
  killSwitchClear?: boolean | null;
  fullAutoEnabled?: boolean | null;
};

export type ExecutionGateInput = {
  platform: 'naver' | 'google' | 'meta' | 'kakao';
  tenantId?: string | null;
  packet?: (PlatformWritePacket & { id?: string | null; lifecycle_status: PlatformWritePacket['lifecycle_status'] }) | null;
  adapter?: AdapterCapability | null;
  budget: BudgetGuardInput;
  requestedMode?: ExecutionMode;
  runId?: string | null;
};

export type ExecutionGateRow = {
  tenant_id: string | null;
  platform: 'naver' | 'google' | 'meta' | 'kakao';
  packet_id: string | null;
  run_id?: string | null;
  gate_status: ExecutionGateStatus;
  requested_mode: ExecutionMode;
  allowed_mode: Exclude<ExecutionMode, 'full_autopilot'>;
  risk_level: RiskLevel;
  risk_score: number;
  budget_snapshot: JsonRecord;
  adapter_snapshot: JsonRecord;
  packet_snapshot: JsonRecord;
  blockers: string[];
  required_approvals: string[];
  next_action: string;
  external_api_write: false;
};

export type RollbackDrillRow = {
  tenant_id: string | null;
  platform: 'naver' | 'google' | 'meta' | 'kakao';
  packet_id: string | null;
  gate_id?: string | null;
  run_id?: string | null;
  drill_status: 'ready' | 'blocked' | 'not_required';
  rollback_type: 'pause_keyword' | 'delete_draft' | 'disable_capi_test' | 'manual_review';
  rollback_payload: JsonRecord;
  verification_steps: string[];
  blocked_reason: string | null;
  external_api_write: false;
};

function int(value: unknown): number {
  return Math.max(0, Math.round(Number(value || 0)));
}

function modeRank(mode: ExecutionMode): number {
  if (mode === 'recommend') return 0;
  if (mode === 'approve') return 1;
  if (mode === 'limited_autopilot') return 2;
  return 3;
}

function allowedMode(level: number, fullAutoEnabled: boolean): Exclude<ExecutionMode, 'full_autopilot'> {
  if (level >= 3) return 'limited_autopilot';
  if (level >= 2) return 'approve';
  return 'recommend';
}

function riskLevel(score: number): RiskLevel {
  if (score >= 85) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function evaluateExecutionGate(input: ExecutionGateInput): ExecutionGateRow {
  const budget = input.budget;
  const automationLevel = int(budget.automationLevel);
  const fullAutoEnabled = Boolean(budget.fullAutoEnabled);
  const requestedMode = input.requestedMode || 'limited_autopilot';
  const maxAllowedMode = allowedMode(automationLevel, fullAutoEnabled);
  const monthlyBudgetKrw = int(budget.monthlyBudgetKrw);
  const dailyBudgetCapKrw = int(budget.dailyBudgetCapKrw);
  const maxCpcKrw = int(budget.maxCpcKrw);
  const maxTestLossKrw = int(budget.maxTestLossKrw);
  const spentTodayKrw = int(budget.spentTodayKrw);
  const spentMonthKrw = int(budget.spentMonthKrw);
  const blockers: string[] = [];
  const approvals: string[] = [];

  if (!input.packet) blockers.push('packet_missing');
  if (input.packet && input.packet.lifecycle_status !== 'ready') blockers.push(`packet_${input.packet.lifecycle_status}`);
  if (!input.adapter) blockers.push('adapter_health_missing');
  if (input.adapter && !['paused_write_ready', 'executable'].includes(input.adapter.adapter_state)) {
    blockers.push(`adapter_${input.adapter.adapter_state}`);
  }
  if (input.platform !== 'naver') blockers.push(`${input.platform}_limited_write_disabled`);
  if (modeRank(requestedMode) > modeRank(maxAllowedMode)) blockers.push('requested_mode_exceeds_tenant_automation_level');
  if (requestedMode === 'full_autopilot') blockers.push('full_autopilot_disabled');
  if (budget.requireHumanApproval !== false && !budget.humanApproved) blockers.push('human_approval_required');
  if (budget.killSwitchClear === false) blockers.push('kill_switch_active');
  if (monthlyBudgetKrw <= 0 || dailyBudgetCapKrw <= 0 || maxCpcKrw <= 0) blockers.push('budget_caps_missing');
  if (maxTestLossKrw <= 0) blockers.push('test_loss_cap_missing');
  if (spentTodayKrw >= dailyBudgetCapKrw && dailyBudgetCapKrw > 0) blockers.push('daily_budget_exhausted');
  if (spentMonthKrw >= monthlyBudgetKrw && monthlyBudgetKrw > 0) blockers.push('monthly_budget_exhausted');

  if (budget.requireHumanApproval !== false) approvals.push('operator_approval');
  if (requestedMode === 'limited_autopilot') approvals.push('limited_budget_policy');
  if (input.platform === 'naver') approvals.push('naver_paused_write_only');

  const blockerList = unique(blockers);
  const budgetPressure = monthlyBudgetKrw > 0 ? Math.round((spentMonthKrw / monthlyBudgetKrw) * 30) : 20;
  const modeRisk = requestedMode === 'limited_autopilot' ? 20 : requestedMode === 'full_autopilot' ? 60 : 5;
  const riskScore = Math.min(100, blockerList.length * 12 + budgetPressure + modeRisk);
  const gateStatus: ExecutionGateStatus =
    blockerList.length > 0 ? 'blocked' :
    requestedMode === 'recommend' || requestedMode === 'approve' ? 'monitor_only' :
    'eligible';

  return {
    tenant_id: input.tenantId ?? input.packet?.tenant_id ?? input.adapter?.tenant_id ?? null,
    platform: input.platform,
    packet_id: input.packet?.id || null,
    run_id: input.runId ?? null,
    gate_status: gateStatus,
    requested_mode: requestedMode,
    allowed_mode: maxAllowedMode,
    risk_level: riskLevel(riskScore),
    risk_score: riskScore,
    budget_snapshot: {
      monthly_budget_krw: monthlyBudgetKrw,
      daily_budget_cap_krw: dailyBudgetCapKrw,
      max_cpc_krw: maxCpcKrw,
      max_test_loss_krw: maxTestLossKrw,
      spent_today_krw: spentTodayKrw,
      spent_month_krw: spentMonthKrw,
      automation_level: automationLevel,
      require_human_approval: budget.requireHumanApproval !== false,
      human_approved: Boolean(budget.humanApproved),
      kill_switch_clear: budget.killSwitchClear !== false,
      full_auto_enabled: fullAutoEnabled,
    },
    adapter_snapshot: input.adapter ? {
      adapter_state: input.adapter.adapter_state,
      capability_level: input.adapter.capability_level,
      capabilities: input.adapter.capabilities,
      blocked_reasons: input.adapter.blocked_reasons,
    } : {},
    packet_snapshot: input.packet ? {
      packet_type: input.packet.packet_type,
      lifecycle_status: input.packet.lifecycle_status,
      dry_run: input.packet.dry_run,
      external_api_write: input.packet.external_api_write,
      idempotency_key: input.packet.idempotency_key,
    } : {},
    blockers: blockerList,
    required_approvals: unique(approvals),
    next_action: blockerList.length > 0
      ? `Resolve ${blockerList[0]} before limited autopilot.`
      : gateStatus === 'eligible'
        ? 'Eligible for Naver paused-only limited write executor after rollback drill.'
        : 'Monitor-only mode. Keep external write disabled.',
    external_api_write: false,
  };
}

export function buildRollbackDrill(input: {
  gate: ExecutionGateRow;
  packet?: (PlatformWritePacket & { id?: string | null }) | null;
  runId?: string | null;
}): RollbackDrillRow {
  const packet = input.packet;
  if (!packet) {
    return {
      tenant_id: input.gate.tenant_id,
      platform: input.gate.platform,
      packet_id: null,
      run_id: input.runId ?? input.gate.run_id ?? null,
      drill_status: 'blocked',
      rollback_type: 'manual_review',
      rollback_payload: {},
      verification_steps: ['Locate write packet before rollback drill.'],
      blocked_reason: 'packet_missing',
      external_api_write: false,
    };
  }

  if (input.gate.gate_status === 'blocked') {
    return {
      tenant_id: input.gate.tenant_id,
      platform: input.gate.platform,
      packet_id: packet.id || input.gate.packet_id,
      run_id: input.runId ?? input.gate.run_id ?? null,
      drill_status: 'blocked',
      rollback_type: 'manual_review',
      rollback_payload: { blockers: input.gate.blockers },
      verification_steps: ['Resolve execution gate blockers first.'],
      blocked_reason: input.gate.blockers[0] || 'execution_gate_blocked',
      external_api_write: false,
    };
  }

  if (packet.packet_type === 'naver_paused_keyword') {
    return {
      tenant_id: input.gate.tenant_id,
      platform: 'naver',
      packet_id: packet.id || input.gate.packet_id,
      run_id: input.runId ?? input.gate.run_id ?? null,
      drill_status: 'ready',
      rollback_type: 'pause_keyword',
      rollback_payload: {
        idempotency_key: packet.idempotency_key,
        external_keyword_status: 'paused',
        external_api_write: false,
      },
      verification_steps: [
        'Confirm keyword external id before activation.',
        'If activation fails, force keyword status to paused.',
        'Record rollback execution attempt with external_api_write=false in dry-run.',
      ],
      blocked_reason: null,
      external_api_write: false,
    };
  }

  if (packet.packet_type === 'google_campaign_draft') {
    return {
      tenant_id: input.gate.tenant_id,
      platform: 'google',
      packet_id: packet.id || input.gate.packet_id,
      run_id: input.runId ?? input.gate.run_id ?? null,
      drill_status: 'not_required',
      rollback_type: 'delete_draft',
      rollback_payload: { draft_only: true, live_publish_disabled: true },
      verification_steps: ['Keep Google draft unpublished.', 'Archive draft packet if rejected.'],
      blocked_reason: null,
      external_api_write: false,
    };
  }

  return {
    tenant_id: input.gate.tenant_id,
    platform: input.gate.platform,
    packet_id: packet.id || input.gate.packet_id,
    run_id: input.runId ?? input.gate.run_id ?? null,
    drill_status: packet.packet_type === 'meta_capi_test_event' ? 'not_required' : 'blocked',
    rollback_type: packet.packet_type === 'meta_capi_test_event' ? 'disable_capi_test' : 'manual_review',
    rollback_payload: { packet_type: packet.packet_type, campaign_publish_disabled: true },
    verification_steps: ['No live campaign publish is allowed for this packet type.'],
    blocked_reason: packet.packet_type === 'meta_capi_test_event' ? null : 'unsupported_packet_type',
    external_api_write: false,
  };
}

export function summarizeExecutionGates(gates: ExecutionGateRow[], drills: RollbackDrillRow[]) {
  return {
    gates: gates.length,
    eligible: gates.filter((gate) => gate.gate_status === 'eligible').length,
    blocked: gates.filter((gate) => gate.gate_status === 'blocked').length,
    monitor_only: gates.filter((gate) => gate.gate_status === 'monitor_only').length,
    high_or_critical_risk: gates.filter((gate) => ['high', 'critical'].includes(gate.risk_level)).length,
    rollback_drills: drills.length,
    rollback_ready: drills.filter((drill) => drill.drill_status === 'ready').length,
    external_api_write_count: 0,
  };
}
