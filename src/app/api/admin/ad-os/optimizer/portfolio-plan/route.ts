import { NextRequest, NextResponse } from 'next/server';
import { buildPortfolioBudgetPlans } from '@/lib/ad-os-v41-v60';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function daysAgoDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = Boolean(body.apply);
  const tenantId = body.tenant_id ? String(body.tenant_id) : null;
  const days = Math.min(Math.max(Number(body.days || 30), 1), 120);
  const since = daysAgoDate(days);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'portfolio_plan',
      platform: null,
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      started_at: new Date().toISOString(),
      summary: {
        config: { apply, tenant_id: tenantId, days, source: 'portfolio_plan_v1' },
        external_api_write: false,
      },
    })
    .select('*')
    .single();
  if (runError) return NextResponse.json({ ok: false, error: runError.message }, { status: 500 });

  let factsQuery = supabaseAdmin
    .from('ad_os_performance_facts')
    .select('*')
    .gte('event_date', since)
    .order('event_date', { ascending: false })
    .limit(3000);
  let budgetsQuery = supabaseAdmin.from('ad_os_channel_budgets').select('*').limit(500);
  const packagesQuery = supabaseAdmin
    .from('travel_packages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (tenantId) {
    factsQuery = factsQuery.eq('tenant_id', tenantId);
    budgetsQuery = budgetsQuery.eq('tenant_id', tenantId);
  }

  const [factsRes, budgetsRes, packagesRes] = await Promise.all([factsQuery, budgetsQuery, packagesQuery]);
  const firstError = factsRes.error || budgetsRes.error || packagesRes.error;
  if (firstError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', errors: [{ message: firstError.message }], finished_at: new Date().toISOString() })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const plans = buildPortfolioBudgetPlans(factsRes.data || [], budgetsRes.data || [], packagesRes.data || []).map((plan) => ({
    ...plan,
    tenant_id: plan.tenant_id || tenantId,
    run_id: run.id,
  }));

  let inserted = 0;
  if (apply && plans.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('ad_os_portfolio_budget_plans')
      .upsert(plans as never, { onConflict: 'idempotency_key' })
      .select('id');
    if (error) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', errors: [{ message: error.message }], finished_at: new Date().toISOString() })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    inserted = data?.length || 0;
  }

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      summary: {
        plans: plans.length,
        inserted,
        apply,
        by_type: plans.reduce<Record<string, number>>((acc, plan) => {
          acc[plan.plan_type] = (acc[plan.plan_type] || 0) + 1;
          return acc;
        }, {}),
      },
    })
    .eq('id', run.id);

  return NextResponse.json({
    ok: true,
    run_id: run.id,
    dry_run: !apply,
    plans,
    summary: {
      generated: plans.length,
      inserted,
      blocked_external_write: true,
    },
  });
});
