import { NextRequest, NextResponse } from 'next/server';
import { buildTenantAuditExport } from '@/lib/ad-os-v61-v75';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function periodDefaults() {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 30);
  return { periodStart: startDate.toISOString().slice(0, 10), periodEnd: end };
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }
  const tenantId = request.nextUrl.searchParams.get('tenant_id');
  let query = supabaseAdmin.from('ad_os_tenant_audit_exports').select('*').order('created_at', { ascending: false }).limit(50);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, exports: data || [], summary: { exports: data?.length || 0 } });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const tenantId = body.tenant_id || null;
  const defaults = periodDefaults();
  const periodStart = body.period_start || defaults.periodStart;
  const periodEnd = body.period_end || defaults.periodEnd;

  let workspaceQuery = supabaseAdmin.from('tenant_ad_workspaces').select('*').order('created_at', { ascending: false }).limit(1);
  if (tenantId) workspaceQuery = workspaceQuery.eq('tenant_id', tenantId);
  const [workspaceRes, jobRes, uploadRes, planRes, attemptRes] = await Promise.all([
    workspaceQuery,
    supabaseAdmin.from('ad_os_platform_jobs').select('id, status, external_api_write', { count: 'exact' }).limit(500),
    supabaseAdmin.from('ad_os_conversion_upload_jobs').select('id, status', { count: 'exact' }).limit(500),
    supabaseAdmin.from('ad_os_portfolio_budget_plans').select('id, status, plan_type', { count: 'exact' }).limit(500),
    supabaseAdmin.from('ad_os_execution_attempts').select('id, status, external_api_write', { count: 'exact' }).limit(500),
  ]);
  const firstError = workspaceRes.error || jobRes.error || uploadRes.error || planRes.error || attemptRes.error;
  if (firstError) return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });

  const workspace = workspaceRes.data?.[0];
  if (!workspace) {
    return NextResponse.json({
      ok: true,
      export: null,
      summary: {
        workspace_found: false,
        written: 0,
        export_status: 'blocked',
        next_action: '테넌트 워크스페이스를 먼저 생성해 예산, 승인자, full-auto 정책을 고정하세요.',
      },
    });
  }

  const row = buildTenantAuditExport({
    workspace,
    periodStart,
    periodEnd,
    metrics: {
      platform_jobs: jobRes.count || 0,
      platform_jobs_blocked: (jobRes.data || []).filter((item: any) => item.status === 'blocked').length,
      conversion_upload_jobs: uploadRes.count || 0,
      portfolio_plans: planRes.count || 0,
      execution_attempts: attemptRes.count || 0,
      external_api_writes:
        (jobRes.data || []).filter((item: any) => item.external_api_write).length +
        (attemptRes.data || []).filter((item: any) => item.external_api_write).length,
    },
  });

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'tenant_audit_export',
      mode: apply ? 'draft_export' : 'dry_run',
      status: 'running',
      summary: { apply, workspace_id: workspace.id, period_start: periodStart, period_end: periodEnd },
    })
    .select('id')
    .single();
  if (runError || !run) return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });

  let inserted = null;
  if (apply) {
    const { data, error } = await supabaseAdmin.from('ad_os_tenant_audit_exports').insert(row as never).select('*').single();
    if (error) {
      await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] }).eq('id', run.id);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    inserted = data;
  }

  await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'completed', finished_at: new Date().toISOString(), summary: { export_status: row.status, written: apply ? 1 : 0 } }).eq('id', run.id);
  return NextResponse.json({ ok: true, run_id: run.id, export: inserted || row, summary: { export_status: row.status, written: apply ? 1 : 0 } });
});
