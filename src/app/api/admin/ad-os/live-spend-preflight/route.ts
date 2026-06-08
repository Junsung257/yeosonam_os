import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { evaluateLiveSpendPreflight, type LiveSpendPreflightAction } from '@/lib/ad-os-v601-v620';
import { buildAdOsStagingSmokeSummary } from '@/lib/ad-os-v541-v560';
import { withTimeout } from '@/lib/promise-timeout';
import { fetchAdOsSummaryJson } from '../_lib/summary-fetch';

export const dynamic = 'force-dynamic';
const AD_OS_LIVE_SPEND_PREFLIGHT_TIMEOUT_MS = 8000;

function parseAction(value: string | null): LiveSpendPreflightAction {
  if (
    value === 'naver_paused_keyword' ||
    value === 'naver_activate_keyword' ||
    value === 'google_campaign_publish' ||
    value === 'meta_campaign_publish' ||
    value === 'conversion_upload' ||
    value === 'dry_run'
  ) {
    return value;
  }
  return 'naver_paused_keyword';
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  try {
    const action = parseAction(request.nextUrl.searchParams.get('action'));
    const platform = action.startsWith('google') ? 'google' : action.startsWith('meta') ? 'meta' : 'naver';
    const summary = await withTimeout(
      fetchAdOsSummaryJson(request),
      AD_OS_LIVE_SPEND_PREFLIGHT_TIMEOUT_MS,
      'ad os live spend preflight',
    );
    const smoke = buildAdOsStagingSmokeSummary();
    const tenantPolicy = summary.tenant_policy as Record<string, any>;
    const channelState = summary.channel_execution_states?.[platform];
    const channelBudget = (summary.channel_budgets || []).find((row: { platform?: string }) => row.platform === platform);
    const enterprise = summary.enterprise_layer as Record<string, any>;
    const result = evaluateLiveSpendPreflight({
      action,
      platform,
      requested_mode: action === 'dry_run' ? 'recommend' : 'limited_autopilot',
      tenant_policy_configured: Boolean(tenantPolicy?.configured),
      human_approved: false,
      kill_switch_clear: tenantPolicy?.risk_status !== 'kill_switch_active',
      automation_level: Number(tenantPolicy?.max_automation_level || channelBudget?.automation_level || 0),
      full_auto_enabled: Boolean(tenantPolicy?.full_auto_enabled),
      monthly_budget_cap_krw: Number(tenantPolicy?.monthly_budget_cap_krw || channelBudget?.monthly_budget_krw || 0),
      daily_budget_cap_krw: Number(tenantPolicy?.daily_budget_cap_krw || channelBudget?.daily_budget_cap_krw || 0),
      max_cpc_krw: Number(tenantPolicy?.max_cpc_krw || channelBudget?.max_cpc_krw || 0),
      max_test_loss_krw: Number(tenantPolicy?.max_test_loss_krw || channelBudget?.max_test_loss_krw || 0),
      spent_today_krw: 0,
      spent_month_krw: 0,
      credentials_ready: Boolean(summary.integration_status?.[platform]),
      permission_ready: channelState?.state !== 'permission_denied',
      campaign_ready: Boolean(channelBudget?.external_campaign_id || channelBudget?.external_ad_group_id || channelState?.state === 'executable'),
      adapter_ready: Number(enterprise?.channel_adapters?.paused_write_ready || 0) > 0 || Number(enterprise?.channel_adapters?.executable || 0) > 0,
      rollback_ready: Number(enterprise?.rollback_drills?.ready || 0) > 0,
      completion_failed: Number(enterprise?.completion_audit?.failed || 0),
      operating_inventory_blocked: 0,
      staging_smoke_passed: smoke.status === 'pass',
      external_write_count: Number(enterprise?.runtime_execution?.external_api_write_count || 0),
      blocked_conversions: Number(enterprise?.conversion_data_quality?.blocked_conversions || 0),
    });

    return NextResponse.json({
      ok: true,
      generated_at: summary.generated_at || new Date().toISOString(),
      action,
      platform,
      preflight: result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: 'blocked',
        error: error instanceof Error ? error.message : 'live spend preflight unavailable',
        next_action: 'Recover /api/admin/ad-os/summary before evaluating paid execution readiness.',
        safety: {
          read_only: true,
          database_mutation: false,
          external_api_write: false,
          live_spend_krw: 0,
          full_auto_allowed: false,
        },
      },
      { status: 503 },
    );
  }
});
