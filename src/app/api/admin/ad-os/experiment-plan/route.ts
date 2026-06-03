import { NextRequest } from 'next/server';
import { buildAdOsExperimentPlan } from '@/lib/ad-os-v8-v12';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id : null;
  const productId = typeof body.product_id === 'string' ? body.product_id : null;
  const apply = body.apply === true;

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      tenant_id: tenantId,
      run_type: 'experiment_plan',
      mode: 'dry_run',
      status: 'running',
      summary: { apply, product_id: productId, source: 'ad_os_v11_experiment_plan' },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return apiResponse({ ok: false, error: sanitizeDbError(runError, 'Experiment plan run create failed') }, { status: 500 });
  }

  let factsQuery = supabaseAdmin
    .from('ad_os_performance_facts')
    .select('product_id, scenario_id, platform, clicks, cta_clicks, conversions, revenue_krw, margin_krw, bounces, sessions')
    .order('event_date', { ascending: false })
    .limit(500);
  if (productId) factsQuery = factsQuery.eq('product_id', productId);
  const { data: facts, error: factsError } = await factsQuery;
  if (factsError) {
    const safeError = sanitizeDbError(factsError);
    await supabaseAdmin.from('ad_os_automation_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      errors: [{ message: safeError }],
    }).eq('id', run.id);
    return apiResponse({ ok: false, error: safeError }, { status: 500 });
  }

  const rows = facts || [];
  const seed = {
    productId: productId || rows.find((row) => row.product_id)?.product_id || null,
    scenarioId: rows.find((row) => row.scenario_id)?.scenario_id || null,
    platform: rows.find((row) => row.platform)?.platform || 'naver',
    clicks: rows.reduce((sum, row) => sum + Number(row.clicks || 0), 0),
    ctaClicks: rows.reduce((sum, row) => sum + Number(row.cta_clicks || 0), 0),
    conversions: rows.reduce((sum, row) => sum + Number(row.conversions || 0), 0),
    revenueKrw: rows.reduce((sum, row) => sum + Number(row.revenue_krw || 0), 0),
    marginKrw: rows.reduce((sum, row) => sum + Number(row.margin_krw || 0), 0),
    bounceRatePct: rows.reduce((sum, row) => sum + Number(row.sessions || 0), 0) > 0
      ? Math.round((rows.reduce((sum, row) => sum + Number(row.bounces || 0), 0) / rows.reduce((sum, row) => sum + Number(row.sessions || 0), 0)) * 1000) / 10
      : null,
  };
  const plans = buildAdOsExperimentPlan(seed);

  let inserted = 0;
  if (plans.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('ad_os_experiments')
      .insert(plans.map((plan) => ({
        tenant_id: tenantId,
        experiment_type: plan.experiment_type,
        name: plan.name,
        hypothesis: plan.hypothesis,
        platform: plan.platform,
        product_id: plan.product_id,
        scenario_id: plan.scenario_id,
        primary_metric: plan.primary_metric,
        status: plan.status,
        minimum_sample: json(plan.minimum_sample),
        split_config: json(plan.split_config),
        guardrails: json(plan.guardrails),
        expected_impact: json(plan.expected_impact),
      })))
      .select('id');
    if (error) {
      const safeError = sanitizeDbError(error);
      await supabaseAdmin.from('ad_os_automation_runs').update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        errors: [{ message: safeError }],
      }).eq('id', run.id);
      return apiResponse({ ok: false, error: safeError }, { status: 500 });
    }
    inserted = data?.length || 0;
  }

  const summary = {
    facts_checked: rows.length,
    experiments_created: inserted,
    bandit_enabled: false,
    reason: '최소 표본 전에는 bandit 자동 배분을 켜지 않고 실험 후보만 생성합니다.',
  };
  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return apiResponse({ ok: true, run_id: run.id, summary, experiments: plans });
});
