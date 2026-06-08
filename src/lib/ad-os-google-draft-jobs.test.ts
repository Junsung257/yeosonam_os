import { describe, expect, it } from 'vitest';
import { buildGoogleDraftPlatformJobFromPacket, type GoogleDraftGateForJob, type GoogleDraftPacketForJob } from './ad-os-google-draft-jobs';

const packet: GoogleDraftPacketForJob = {
  id: 'packet-1',
  tenant_id: null,
  platform: 'google',
  packet_type: 'google_campaign_draft',
  lifecycle_status: 'ready',
  idempotency_key: 'google:packet-1',
  dry_run: true,
  external_api_write: false,
  request_payload: {
    campaign_name: 'YSN Google Draft',
    max_cpc_krw: 400,
    daily_budget_krw: 3000,
  },
  guardrail_snapshot: {},
  response_payload: {},
  blocked_reason: null,
  rollback_payload: {},
};

const monitorGate: GoogleDraftGateForJob = {
  tenant_id: null,
  platform: 'google',
  packet_id: 'packet-1',
  gate_status: 'monitor_only',
  requested_mode: 'approve',
  allowed_mode: 'approve',
  risk_level: 'low',
  risk_score: 20,
  budget_snapshot: { automation_level: 2 },
  adapter_snapshot: {},
  packet_snapshot: {},
  blockers: [],
  required_approvals: ['operator_approval', 'google_draft_only_external_write_disabled'],
  next_action: 'Review Google draft only.',
  external_api_write: false,
};

describe('buildGoogleDraftPlatformJobFromPacket', () => {
  it('creates an approved dry-run sync job for monitor-only Google draft packets', () => {
    const job = buildGoogleDraftPlatformJobFromPacket({ packet, gate: monitorGate, runId: 'run-1' });

    expect(job).toMatchObject({
      platform: 'google',
      job_type: 'sync_asset',
      status: 'approved',
      guardrail_status: 'passed',
      external_api_write: false,
      blocked_reason: null,
    });
    expect(job.request_payload.source_packet_id).toBe('packet-1');
    expect(job.response_payload).toMatchObject({ staging_review_only: true, external_spend_krw: 0 });
  });

  it('blocks packets that have not passed the Google monitor-only gate', () => {
    const job = buildGoogleDraftPlatformJobFromPacket({
      packet,
      gate: { ...monitorGate, gate_status: 'blocked', blockers: ['human_approval_required'] },
    });

    expect(job.status).toBe('blocked');
    expect(job.guardrail_status).toBe('blocked');
    expect(job.blocked_reason).toBe('gate_blocked_not_monitor_only');
    expect(job.external_api_write).toBe(false);
  });
});
