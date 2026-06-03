import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function requestTypeForPlan(planType: string): string {
  if (planType === 'pause_waste' || planType === 'reduce_deadline_risk') return 'pause_keyword';
  if (planType === 'scale_winner') return 'budget_change';
  if (planType === 'landing_repair') return 'replace_landing';
  return 'budget_change';
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = Boolean(body.apply);
  const limit = Math.min(Math.max(Number(body.limit || 50), 1), 200);
  const tenantId = body.tenant_id ? String(body.tenant_id) : null;

  let plansQuery = supabaseAdmin
    .from('ad_os_portfolio_budget_plans')
    .select('*')
    .eq('status', 'approved')
    .order('confidence', { ascending: false })
    .limit(limit);
  if (tenantId) plansQuery = plansQuery.eq('tenant_id', tenantId);

  const { data: plans, error: plansError } = await plansQuery;
  if (plansError) return NextResponse.json({ ok: false, error: plansError.message }, { status: 500 });

  const requests = (plans || []).map((plan: any) => {
    const requestType = requestTypeForPlan(String(plan.plan_type || ''));
    return {
      tenant_id: plan.tenant_id || null,
      platform: plan.platform === 'organic' ? null : plan.platform,
      automation_level: 2,
      request_type: requestType,
      target_table: 'ad_os_portfolio_budget_plans',
      target_id: plan.id,
      status: 'proposed',
      title: `Portfolio optimizer: ${String(plan.plan_type || 'action')}`,
      reason: String(plan.reason || 'Approved portfolio optimizer action').slice(0, 2000),
      risk_level: requestType === 'budget_change' ? 'medium' : 'low',
      expected_impact: {
        expected_margin_delta_krw: plan.expected_margin_delta_krw || 0,
        expected_spend_delta_krw: plan.expected_spend_delta_krw || 0,
        confidence: plan.confidence || 0,
      },
      proposed_change: {
        status: 'applied',
        applied_at: new Date().toISOString(),
      },
      rollback_payload: {
        status: 'approved',
        applied_at: null,
      },
      approval_required: true,
      expires_at: plan.expires_at || null,
    };
  });

  let inserted = 0;
  if (apply && requests.length > 0) {
    const { data, error } = await supabaseAdmin.from('ad_os_change_requests').insert(requests).select('id');
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    inserted = data?.length || 0;
  }

  return NextResponse.json({
    ok: true,
    dry_run: !apply,
    change_requests: requests,
    summary: {
      approved_plans: plans?.length || 0,
      inserted,
      external_api_write: false,
      note: 'Approved portfolio plans are converted to human-reviewed change requests before any platform action.',
    },
  });
});
