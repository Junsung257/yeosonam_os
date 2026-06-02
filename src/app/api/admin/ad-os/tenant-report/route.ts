import { NextRequest, NextResponse } from 'next/server';
import { buildTenantAdReport } from '@/lib/ad-os-v8-v12';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const GET = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const tenantId = request.nextUrl.searchParams.get('tenant_id');
  const from = request.nextUrl.searchParams.get('from') || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to = request.nextUrl.searchParams.get('to') || new Date().toISOString().slice(0, 10);

  let factsQuery = supabaseAdmin
    .from('ad_os_performance_facts')
    .select('clicks, cta_clicks, conversions, cost_krw, revenue_krw, margin_krw, event_date')
    .gte('event_date', from)
    .lte('event_date', to);
  if (tenantId) factsQuery = factsQuery.eq('tenant_id', tenantId);

  let workspaceQuery = supabaseAdmin
    .from('tenant_ad_workspaces')
    .select('*');
  workspaceQuery = tenantId ? workspaceQuery.eq('tenant_id', tenantId) : workspaceQuery.is('tenant_id', null);

  const [factsRes, budgetRes, searchTermRes] = await Promise.all([
    factsQuery,
    workspaceQuery.maybeSingle(),
    supabaseAdmin
      .from('ad_os_search_terms')
      .select('action, status, cost_krw, conversions, score')
      .gte('created_at', `${from}T00:00:00.000Z`)
      .lte('created_at', `${to}T23:59:59.999Z`),
  ]);

  const firstError = factsRes.error || budgetRes.error || searchTermRes.error;
  if (firstError) {
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const facts = factsRes.data || [];
  const searchTerms = searchTermRes.data || [];
  const workspace = budgetRes.data as { monthly_budget_cap_krw?: number; workspace_name?: string; risk_status?: string } | null;
  const report = buildTenantAdReport({
    spendKrw: facts.reduce((sum, row) => sum + Number(row.cost_krw || 0), 0),
    revenueKrw: facts.reduce((sum, row) => sum + Number(row.revenue_krw || 0), 0),
    marginKrw: facts.reduce((sum, row) => sum + Number(row.margin_krw || 0), 0),
    conversions: facts.reduce((sum, row) => sum + Number(row.conversions || 0), 0),
    ctaClicks: facts.reduce((sum, row) => sum + Number(row.cta_clicks || 0), 0),
    clicks: facts.reduce((sum, row) => sum + Number(row.clicks || 0), 0),
    pausedWasteKeywords: searchTerms.filter((row) => row.action === 'add_negative').length,
    discoveredCheapKeywords: searchTerms.filter((row) => row.action === 'add_keyword' && Number(row.score || 0) >= 70).length,
    budgetCapKrw: Number(workspace?.monthly_budget_cap_krw || 0),
  });

  return NextResponse.json({
    ok: true,
    tenant_id: tenantId || null,
    period: { from, to },
    workspace: workspace || null,
    report,
  });
});
