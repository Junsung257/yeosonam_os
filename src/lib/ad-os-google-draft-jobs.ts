import type { PlatformJobStatus } from './ad-os-v41-v60';
import type { ExecutionGateRow } from './ad-os-v86-v100';
import type { PlatformWritePacket } from './ad-os-v76-v85';

type JsonRecord = Record<string, unknown>;

export type GoogleDraftPacketForJob = PlatformWritePacket & {
  id: string;
  job_id?: string | null;
};

export type GoogleDraftGateForJob = ExecutionGateRow & {
  id?: string | null;
};

export type GoogleDraftPlatformJobDraft = {
  tenant_id: string | null;
  platform: 'google';
  job_type: 'sync_asset';
  status: PlatformJobStatus;
  automation_level: number;
  change_request_id: null;
  external_mutation_result_id: null;
  run_id: string | null;
  idempotency_key: string;
  external_account_id: null;
  external_campaign_id: null;
  external_ad_group_id: null;
  request_payload: JsonRecord;
  before_payload: JsonRecord;
  after_payload: JsonRecord;
  rollback_payload: JsonRecord;
  guardrail_snapshot: JsonRecord;
  response_payload: JsonRecord;
  guardrail_status: 'passed' | 'blocked';
  external_api_write: false;
  blocked_reason: string | null;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function int(value: unknown): number {
  return Math.max(0, Math.round(Number(value || 0)));
}

function blockReason(packet: GoogleDraftPacketForJob, gate?: GoogleDraftGateForJob | null): string | null {
  if (packet.external_api_write) return 'packet_external_write_unexpected';
  if (packet.packet_type !== 'google_campaign_draft') return `packet_type_${packet.packet_type}`;
  if (packet.lifecycle_status !== 'ready' && packet.lifecycle_status !== 'queued') {
    return `packet_${packet.lifecycle_status}`;
  }
  if (!gate) return 'gate_missing';
  if (gate.external_api_write) return 'gate_external_write_unexpected';
  if (gate.gate_status !== 'monitor_only') return `gate_${gate.gate_status}_not_monitor_only`;
  return null;
}

export function buildGoogleDraftPlatformJobFromPacket(input: {
  packet: GoogleDraftPacketForJob;
  gate?: GoogleDraftGateForJob | null;
  runId?: string | null;
}): GoogleDraftPlatformJobDraft {
  const { packet, gate } = input;
  const reason = blockReason(packet, gate);
  const budgetSnapshot = asRecord(gate?.budget_snapshot);
  const status: PlatformJobStatus = reason ? 'blocked' : 'approved';
  const requestPayload = asRecord(packet.request_payload);

  return {
    tenant_id: packet.tenant_id || gate?.tenant_id || null,
    platform: 'google',
    job_type: 'sync_asset',
    status,
    automation_level: int(budgetSnapshot.automation_level),
    change_request_id: null,
    external_mutation_result_id: null,
    run_id: input.runId || packet.run_id || gate?.run_id || null,
    idempotency_key: `google-draft-job:${packet.idempotency_key}`.slice(0, 240),
    external_account_id: null,
    external_campaign_id: null,
    external_ad_group_id: null,
    request_payload: {
      source: 'google_campaign_draft_packet',
      source_packet_id: packet.id,
      source_gate_id: gate?.id || null,
      packet_idempotency_key: packet.idempotency_key,
      google_campaign_draft: requestPayload,
      external_api_write: false,
      external_spend_krw: 0,
      job_control_plane: true,
    },
    before_payload: {
      packet_response: asRecord(packet.response_payload),
      gate_status: gate?.gate_status || null,
    },
    after_payload: {
      expected_platform_state: 'google_ads_draft_review_only',
      live_publish_enabled: false,
    },
    rollback_payload: {
      rollback_type: 'delete_draft',
      source_packet_id: packet.id,
      external_api_write: false,
    },
    guardrail_snapshot: {
      gate_status: gate?.gate_status || null,
      requested_mode: gate?.requested_mode || null,
      allowed_mode: gate?.allowed_mode || null,
      risk_level: gate?.risk_level || null,
      risk_score: gate?.risk_score || null,
      blockers: gate?.blockers || [],
      required_approvals: gate?.required_approvals || [],
      budget_snapshot: budgetSnapshot,
      packet_lifecycle_status: packet.lifecycle_status,
    },
    response_payload: {
      external_api_write: false,
      external_spend_krw: 0,
      dry_run: true,
      staging_review_only: true,
      next_executor_required: status === 'approved',
      blocked_reason: reason,
    },
    guardrail_status: reason ? 'blocked' : 'passed',
    external_api_write: false,
    blocked_reason: reason,
  };
}
