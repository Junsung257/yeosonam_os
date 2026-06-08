import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { buildAdOsAdminSurfaceQaMatrix } from '@/lib/ad-os-v681-v700';
import { buildAdOsOperatingInventory } from '@/lib/ad-os-v581-v600';
import { evaluateLiveSpendPreflight } from '@/lib/ad-os-v601-v620';
import { buildAdOsLearningEvidence } from '@/lib/ad-os-v621-v640';
import { buildAdOsStagingValidationPackage } from '@/lib/ad-os-v641-v660';
import { buildAdOsStagingSmokeSummary } from '@/lib/ad-os-v541-v560';
import { withTimeout } from '@/lib/promise-timeout';
import { fetchAdOsSummaryJson } from '../_lib/summary-fetch';

export const dynamic = 'force-dynamic';
const AD_OS_ADMIN_SURFACE_QA_TIMEOUT_MS = 8000;

type SummaryRow = Record<string, unknown>;

function numberValue(value: unknown): number {
  return Number(value || 0);
}

function asArray(value: unknown): SummaryRow[] {
  return Array.isArray(value) ? value as SummaryRow[] : [];
}

function firstByPlatform(rows: SummaryRow[], platform: string): SummaryRow | null {
  return rows.find((row) => row.platform === platform) || null;
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  try {
    const summary = await withTimeout(
      fetchAdOsSummaryJson(request),
      AD_OS_ADMIN_SURFACE_QA_TIMEOUT_MS,
      'ad os admin surface qa',
    );
    const smoke = buildAdOsStagingSmokeSummary();
    const enterprise = summary.enterprise_layer as Record<string, any>;
    const completion = enterprise?.completion_audit || null;
    const facts = Array.isArray(summary?.samples?.performance_facts)
      ? summary.samples.performance_facts
      : [];
    const learningEvidence = buildAdOsLearningEvidence(facts);
    const operatingInventory = buildAdOsOperatingInventory({
      completionAudit: completion,
      stagingSmoke: smoke,
      enterpriseLayer: enterprise,
      learningLoop: summary?.learning_loop || null,
    });
    const tenantPolicy = summary.tenant_policy as Record<string, any>;
    const channelBudgets = asArray(summary?.channel_budgets);
    const naverBudget = firstByPlatform(channelBudgets, 'naver');
    const naverState = summary?.channel_execution_states?.naver;
    const preflight = evaluateLiveSpendPreflight({
      action: 'naver_paused_keyword',
      platform: 'naver',
      requested_mode: 'limited_autopilot',
      tenant_policy_configured: Boolean(tenantPolicy?.configured),
      human_approved: false,
      kill_switch_clear: tenantPolicy?.risk_status !== 'kill_switch_active',
      automation_level: numberValue(tenantPolicy?.max_automation_level || naverBudget?.automation_level),
      full_auto_enabled: Boolean(tenantPolicy?.full_auto_enabled),
      monthly_budget_cap_krw: numberValue(tenantPolicy?.monthly_budget_cap_krw || naverBudget?.monthly_budget_krw),
      daily_budget_cap_krw: numberValue(tenantPolicy?.daily_budget_cap_krw || naverBudget?.daily_budget_cap_krw),
      max_cpc_krw: numberValue(tenantPolicy?.max_cpc_krw || naverBudget?.max_cpc_krw),
      max_test_loss_krw: numberValue(tenantPolicy?.max_test_loss_krw || naverBudget?.max_test_loss_krw),
      spent_today_krw: 0,
      spent_month_krw: 0,
      credentials_ready: Boolean(summary?.integration_status?.naver),
      permission_ready: naverState?.state !== 'permission_denied',
      campaign_ready: Boolean(
        naverBudget?.external_campaign_id ||
        naverBudget?.external_ad_group_id ||
        naverState?.state === 'executable',
      ),
      adapter_ready:
        numberValue(enterprise?.channel_adapters?.paused_write_ready) > 0 ||
        numberValue(enterprise?.channel_adapters?.executable) > 0,
      rollback_ready: numberValue(enterprise?.rollback_drills?.ready) > 0,
      completion_failed: numberValue(completion?.failed),
      operating_inventory_blocked: operatingInventory.blocked,
      staging_smoke_passed: smoke.status === 'pass',
      external_write_count:
        numberValue(enterprise?.platform_job_queue?.external_api_write_count) +
        numberValue(enterprise?.runtime_execution?.external_api_write_count) +
        numberValue(enterprise?.channel_adapters?.external_api_write_count) +
        numberValue(enterprise?.execution_gates?.external_api_write_count) +
        numberValue(enterprise?.limited_write_pilot?.external_api_write_count),
      blocked_conversions: numberValue(enterprise?.conversion_data_quality?.blocked_conversions),
    });
    const stagingValidation = buildAdOsStagingValidationPackage({
      completionAudit: completion,
      stagingSmoke: smoke,
      operatingInventory,
      liveSpendPreflight: preflight,
      learningEvidence,
      enterpriseLayer: enterprise || null,
    });
    const qa = buildAdOsAdminSurfaceQaMatrix({
      stagingValidation,
      channelExecutionStates: summary?.channel_execution_states || null,
      enterpriseLayer: enterprise || null,
      counts: summary?.counts || null,
      learningLoop: summary?.learning_loop || null,
    });

    return NextResponse.json({
      ok: qa.status !== 'fail',
      generated_at: summary?.generated_at || new Date().toISOString(),
      qa,
      summary: {
        status: qa.status,
        readiness_score: qa.readiness_score,
        passed: qa.passed,
        warnings: qa.warnings,
        failed: qa.failed,
        top_gap: qa.top_gap,
        next_action: qa.next_action,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: 'blocked',
        error: error instanceof Error ? error.message : 'admin surface qa unavailable',
        next_action: 'Recover /api/admin/ad-os/summary before running admin surface QA.',
        safety: {
          read_only: true,
          database_mutation: false,
          external_api_write: false,
          live_spend_krw: 0,
        },
      },
      { status: 503 },
    );
  }
});
