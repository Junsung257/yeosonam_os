import { NextRequest, NextResponse } from 'next/server';
import { buildTenantWorkspaceDefaults } from '@/lib/ad-os-v41-v60';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const tenantId = request.nextUrl.searchParams.get('tenant_id');
  let workspaceQuery = supabaseAdmin
    .from('tenant_ad_workspaces')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  let billingQuery = supabaseAdmin
    .from('ad_os_tenant_billing_profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (tenantId) {
    workspaceQuery = workspaceQuery.eq('tenant_id', tenantId);
    billingQuery = billingQuery.eq('tenant_id', tenantId);
  }

  const [workspaceRes, billingRes] = await Promise.all([workspaceQuery, billingQuery]);
  const firstError = workspaceRes.error || billingRes.error;
  if (firstError) return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });

  const billingByWorkspace = new Map((billingRes.data || []).map((row: any) => [row.workspace_id, row]));
  const workspaces = (workspaceRes.data || []).map((workspace: any) => ({
    ...workspace,
    billing_profile: billingByWorkspace.get(workspace.id) || null,
  }));

  return NextResponse.json({
    ok: true,
    workspaces,
    billing_profiles: billingRes.data || [],
    summary: {
      workspaces: workspaces.length,
      active_billing_profiles: (billingRes.data || []).filter((row: any) => row.invoice_status === 'active').length,
      full_auto_enabled: workspaces.filter((row: any) => row.full_auto_enabled).length,
      restricted: workspaces.filter((row: any) => ['restricted', 'blocked'].includes(row.risk_status || '')).length,
    },
  });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const defaults = buildTenantWorkspaceDefaults({
    tenantId: body.tenant_id || null,
    workspaceName: body.workspace_name || body.name || null,
    billingPlan: body.billing_plan || 'agency',
    monthlyBudgetCapKrw: body.monthly_budget_cap_krw,
    dailyBudgetCapKrw: body.daily_budget_cap_krw,
    maxCpcKrw: body.max_cpc_krw,
    automationLevel: body.automation_level,
  });

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from('tenant_ad_workspaces')
    .upsert(defaults.workspace as never, { onConflict: 'tenant_id' })
    .select('*')
    .single();
  if (workspaceError) return NextResponse.json({ ok: false, error: workspaceError.message }, { status: 500 });

  const billingRow = {
    ...defaults.billing,
    tenant_id: workspace.tenant_id || null,
    workspace_id: workspace.id,
  };
  const { data: billing, error: billingError } = await supabaseAdmin
    .from('ad_os_tenant_billing_profiles')
    .upsert(billingRow as never, { onConflict: 'workspace_id' })
    .select('*')
    .single();
  if (billingError) return NextResponse.json({ ok: false, error: billingError.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    workspace,
    billing_profile: billing,
    summary: {
      automation_level: workspace.automation_level,
      require_human_approval: workspace.require_human_approval,
      full_auto_enabled: workspace.full_auto_enabled,
      billing_plan: billing.billing_plan,
    },
  });
});
