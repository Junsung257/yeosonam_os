import { describe, expect, it } from 'vitest';
import { buildAdOsCompletionAuditSummary } from './ad-os-v361-v380';
import { buildAdOsStagingSmokeSummary } from './ad-os-v541-v560';
import { buildAdOsOperatingInventory } from './ad-os-v581-v600';

function readyCompletion() {
  return buildAdOsCompletionAuditSummary({
    platformJobQueue: { total: 3, blocked: 0, approved_or_running: 1, external_api_write_count: 0 },
    runtimeExecution: { total: 2, blocked: 0, external_api_write_count: 0 },
    channelAdapters: { snapshots: 3, paused_write_ready: 1, draft_ready: 1, executable: 1, blocked: 0, external_api_write_count: 0 },
    writePackets: { total: 2, blocked: 0, external_api_write_count: 0 },
    executionGates: { total: 2, blocked: 0, external_api_write_count: 0 },
    rollbackDrills: { total: 1, blocked: 0, external_api_write_count: 0 },
    limitedWritePilot: { total: 1, blocked: 0, external_api_write_count: 0 },
    conversionDataQuality: { uploadable_conversions: 3, blocked_conversions: 0 },
    learningLoop: { status: { margin_learning_ready: true } },
    tenantPolicy: {
      configured: true,
      full_auto_enabled: false,
      monthly_budget_cap_krw: 1_000_000,
      daily_budget_cap_krw: 100_000,
      max_cpc_krw: 500,
      max_test_loss_krw: 50_000,
      require_human_approval: true,
    },
    tenantGuardrails: [{ status: 'pass' }],
    tenantAdReadiness: [{ status: 'pass' }],
    incidentResponse: { critical: 0, high: 0 },
    agencyReporting: { status: 'ready', readiness_score: 100, full_auto_enabled: 0 },
    experimentStandards: { templates: 4, active: 1, types: 4 },
    runtimeReadiness: { checks: 5, blocked_or_failed: 0, critical: 0 },
    creativeFactory: { variants: 10, duplicate_content_risks: 0 },
  });
}

describe('buildAdOsOperatingInventory', () => {
  it('summarizes all operating areas with explicit read-only safety', () => {
    const inventory = buildAdOsOperatingInventory({
      completionAudit: readyCompletion(),
      stagingSmoke: buildAdOsStagingSmokeSummary(),
      enterpriseLayer: {
        platform_job_queue: { total: 3, blocked: 0, external_api_write_count: 0 },
        runtime_execution: { attempts: 2, succeeded: 2, blocked: 0, external_api_write_count: 0 },
        channel_adapters: { snapshots: 3, paused_write_ready: 1, draft_ready: 1, executable: 1, external_api_write_count: 0 },
        conversion_data_quality: { uploadable_conversions: 3, blocked_conversions: 0 },
        portfolio_optimizer: { candidates: 2 },
        creative_factory: { variants: 8, duplicate_content_risks: 0 },
        saas_packaging: { workspaces: 1, active_billing_profiles: 1, full_auto_enabled: 0 },
        limited_write_pilot: { dry_run_succeeded: 1, live_external_write_enabled: 0, external_api_write_count: 0 },
      },
      learningLoop: { status: { margin_learning_ready: true } },
    });

    expect(inventory.safety).toEqual({
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      live_spend_krw: 0,
    });
    expect(inventory.items).toHaveLength(8);
    expect(inventory.blocked).toBe(0);
    expect(inventory.items.find((row) => row.id === 'control_plane')?.status).toBe('operational');
  });

  it('blocks the inventory when live/full autopilot or external writes are detected', () => {
    const inventory = buildAdOsOperatingInventory({
      completionAudit: readyCompletion(),
      stagingSmoke: buildAdOsStagingSmokeSummary(),
      enterpriseLayer: {
        platform_job_queue: { total: 1, external_api_write_count: 1 },
        runtime_execution: { external_api_write_count: 0 },
        channel_adapters: { snapshots: 1, external_api_write_count: 0 },
        limited_write_pilot: { live_external_write_enabled: 1, external_api_write_count: 0 },
        saas_packaging: { full_auto_enabled: 1 },
      },
      learningLoop: { status: { margin_learning_ready: false } },
    });

    expect(inventory.status).toBe('blocked');
    expect(inventory.items.find((row) => row.id === 'control_plane')?.status).toBe('blocked');
    expect(inventory.items.find((row) => row.id === 'live_autopilot')?.status).toBe('blocked');
    expect(inventory.top_gap).toBe('Control plane safety');
  });
});
