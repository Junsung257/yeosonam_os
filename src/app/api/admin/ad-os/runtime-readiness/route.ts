import { NextRequest, NextResponse } from 'next/server';
import { buildRuntimeReadinessChecks } from '@/lib/ad-os-v61-v75';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const TABLES = [
  'ad_os_platform_jobs',
  'ad_os_conversion_upload_jobs',
  'ad_os_data_quality_snapshots',
  'ad_os_portfolio_budget_plans',
  'ad_os_creative_asset_variants',
  'ad_os_travel_intent_signals',
  'ad_os_tenant_billing_profiles',
  'ad_os_runtime_readiness_checks',
  'ad_os_execution_attempts',
  'ad_os_experiment_templates',
  'ad_os_tenant_audit_exports',
  'tenant_ad_workspaces',
];

async function inspectRuntime(tenantId?: string | null) {
  const entries = await Promise.all(
    TABLES.map(async (table) => {
      let query = supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
      if (tenantId && table !== 'ad_os_experiment_templates') query = query.eq('tenant_id', tenantId);
      const { count, error } = await query;
      return [table, { exists: !error, count: count || 0, error: error?.message || null }] as const;
    }),
  );
  const tableStatus = Object.fromEntries(entries.map(([table, result]) => [table, result.exists]));
  const counts = Object.fromEntries(entries.map(([table, result]) => [table, result.count]));
  const errors = Object.fromEntries(entries.filter(([, result]) => result.error).map(([table, result]) => [table, result.error]));

  const [workspaceRes, platformJobRes] = await Promise.all([
    supabaseAdmin.from('tenant_ad_workspaces').select('id, full_auto_enabled', { count: 'exact' }).limit(500),
    supabaseAdmin.from('ad_os_platform_jobs').select('id, external_api_write', { count: 'exact' }).limit(500),
  ]);
  const fullAutoEnabled = (workspaceRes.data || []).filter((row: any) => row.full_auto_enabled).length;
  const externalApiWrites = (platformJobRes.data || []).filter((row: any) => row.external_api_write).length;

  const apiJson = {
    summary: tableStatus.ad_os_platform_jobs && tableStatus.ad_os_conversion_upload_jobs,
    data_quality: tableStatus.ad_os_data_quality_snapshots,
    platform_jobs_run: tableStatus.ad_os_platform_jobs,
    conversion_upload_run: tableStatus.ad_os_conversion_upload_jobs,
    tenant_workspaces: tableStatus.tenant_ad_workspaces && tableStatus.ad_os_tenant_billing_profiles,
    runtime_readiness: tableStatus.ad_os_runtime_readiness_checks && tableStatus.ad_os_execution_attempts,
  };

  return {
    tableStatus,
    counts,
    errors,
    checks: buildRuntimeReadinessChecks({
      tenantId,
      tables: tableStatus,
      apiJson,
      counts,
      fullAutoEnabled,
      externalApiWrites,
    }),
    summary: {
      tables_ready: Object.values(tableStatus).filter(Boolean).length,
      tables_total: TABLES.length,
      missing_tables: Object.entries(tableStatus).filter(([, ready]) => !ready).map(([table]) => table),
      full_auto_enabled: fullAutoEnabled,
      external_api_write_count: externalApiWrites,
    },
  };
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }
  const tenantId = request.nextUrl.searchParams.get('tenant_id');
  const result = await inspectRuntime(tenantId);
  return NextResponse.json({ ok: true, ...result });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const tenantId = body.tenant_id || null;
  const result = await inspectRuntime(tenantId);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'runtime_readiness',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: { apply, ...result.summary },
    })
    .select('id')
    .single();
  if (runError || !run) return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });

  const checks = result.checks.map((row) => ({ ...row, run_id: run.id }));
  if (apply && checks.length > 0) {
    const { error } = await supabaseAdmin.from('ad_os_runtime_readiness_checks').insert(checks as never);
    if (error) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary: { ...result.summary, checks_written: apply ? checks.length : 0 } })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, ...result, checks_written: apply ? checks.length : 0 });
});
