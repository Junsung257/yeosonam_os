import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const LIVE_STATUSES = ['testing', 'active', 'winning', 'scaled'];

function jsonState(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value));
}

async function failRun(runId: string, message: string) {
  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message }] })
    .eq('id', runId);
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'guarded' || body.mode === 'full' ? body.mode : 'dry_run';
  const apply = mode !== 'dry_run' && body.apply === true;
  const reason = typeof body.reason === 'string' && body.reason.trim()
    ? body.reason.trim().slice(0, 240)
    : 'Operator requested Ad OS kill switch.';

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'full_autopilot',
      mode,
      status: 'running',
      summary: { action: 'kill_switch', apply, reason },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'Failed to create kill switch run.' }, { status: 500 });
  }

  const [budgetRes, keywordRes, mappingRes] = await Promise.all([
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('id, platform, status, automation_level, monthly_budget_krw, daily_budget_cap_krw')
      .is('tenant_id', null)
      .eq('status', 'active'),
    supabaseAdmin
      .from('search_ad_keyword_plans')
      .select('id, platform, keyword_text, autopilot_status, plan_status')
      .in('autopilot_status', LIVE_STATUSES)
      .limit(1000),
    supabaseAdmin
      .from('ad_landing_mappings')
      .select('id, platform, keyword, operational_status, active')
      .in('operational_status', LIVE_STATUSES)
      .limit(1000),
  ]);

  const firstError = budgetRes.error || keywordRes.error || mappingRes.error;
  if (firstError) {
    await failRun(run.id, firstError.message);
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const decisions: Array<Record<string, unknown>> = [];

  for (const budget of budgetRes.data || []) {
    decisions.push({
      run_id: run.id,
      platform: budget.platform,
      decision_type: 'pause',
      target_table: 'ad_os_channel_budgets',
      target_id: String(budget.id),
      before_state: jsonState({
        status: budget.status,
        automation_level: budget.automation_level,
        monthly_budget_krw: budget.monthly_budget_krw,
        daily_budget_cap_krw: budget.daily_budget_cap_krw,
      }),
      after_state: jsonState({ status: 'paused', automation_level: 0 }),
      reason,
      confidence: 0.99,
      expected_impact: jsonState({ external_spend_risk: 'stopped_at_internal_guardrail' }),
      applied: false,
    });
  }

  for (const keyword of keywordRes.data || []) {
    decisions.push({
      run_id: run.id,
      platform: keyword.platform,
      decision_type: 'pause',
      target_table: 'search_ad_keyword_plans',
      target_id: String(keyword.id),
      before_state: jsonState({ autopilot_status: keyword.autopilot_status, plan_status: keyword.plan_status }),
      after_state: jsonState({ autopilot_status: 'paused', plan_status: keyword.plan_status }),
      reason,
      confidence: 0.98,
      expected_impact: jsonState({ keyword_text: keyword.keyword_text, external_spend_risk: 'new_publishing_blocked' }),
      applied: false,
    });
  }

  for (const mapping of mappingRes.data || []) {
    decisions.push({
      run_id: run.id,
      platform: mapping.platform,
      decision_type: 'pause',
      target_table: 'ad_landing_mappings',
      target_id: String(mapping.id),
      before_state: jsonState({ operational_status: mapping.operational_status, active: mapping.active }),
      after_state: jsonState({ operational_status: 'paused', active: false }),
      reason,
      confidence: 0.98,
      expected_impact: jsonState({ keyword: mapping.keyword, external_spend_risk: 'landing_activation_blocked' }),
      applied: false,
    });
  }

  if (decisions.length > 0) {
    const { error } = await supabaseAdmin.from('ad_os_decision_logs').insert(decisions);
    if (error) {
      await failRun(run.id, error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  if (apply && decisions.length > 0) {
    const budgetIds = decisions.filter((d) => d.target_table === 'ad_os_channel_budgets').map((d) => String(d.target_id));
    const keywordIds = decisions.filter((d) => d.target_table === 'search_ad_keyword_plans').map((d) => String(d.target_id));
    const mappingIds = decisions.filter((d) => d.target_table === 'ad_landing_mappings').map((d) => String(d.target_id));

    if (budgetIds.length) {
      const { error } = await supabaseAdmin
        .from('ad_os_channel_budgets')
        .update({ status: 'paused', automation_level: 0, notes: reason, updated_at: new Date().toISOString() })
        .in('id', budgetIds);
      if (error) {
        await failRun(run.id, error.message);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    if (keywordIds.length) {
      const { error } = await supabaseAdmin
        .from('search_ad_keyword_plans')
        .update({
          autopilot_status: 'paused',
          last_decision_at: new Date().toISOString(),
          decision_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .in('id', keywordIds);
      if (error) {
        await failRun(run.id, error.message);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    if (mappingIds.length) {
      const { error } = await supabaseAdmin
        .from('ad_landing_mappings')
        .update({
          operational_status: 'paused',
          active: false,
          last_decision_at: new Date().toISOString(),
          decision_reason: reason,
        })
        .in('id', mappingIds);
      if (error) {
        await failRun(run.id, error.message);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    await supabaseAdmin.from('ad_os_decision_logs').update({ applied: true }).eq('run_id', run.id);
  }

  const summary = {
    action: 'kill_switch',
    applied: apply,
    active_budget_channels: (budgetRes.data || []).length,
    keyword_targets: (keywordRes.data || []).length,
    mapping_targets: (mappingRes.data || []).length,
    decisions: decisions.length,
    external_api_actions: 0,
    external_spend_krw: 0,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, decisions: decisions.slice(0, 30) });
});
