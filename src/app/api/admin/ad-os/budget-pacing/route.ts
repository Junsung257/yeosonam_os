import { NextRequest, NextResponse } from 'next/server';
import { decideAdOsBudgetPacing } from '@/lib/ad-os-budget-pacing';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type BudgetRow = {
  id: string;
  tenant_id: string | null;
  platform: string;
  monthly_budget_krw: number | null;
  daily_budget_cap_krw: number | null;
  automation_level: number | null;
  status: string | null;
};

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'guarded' || body.mode === 'full' ? body.mode : 'dry_run';
  const apply = mode !== 'dry_run' && body.apply === true;
  const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id : null;

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      tenant_id: tenantId,
      run_type: 'budget_pacing',
      mode,
      status: 'running',
      summary: { apply, tenant_id: tenantId, engine: 'budget_pacing_v3' },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || '페이싱 실행 로그 생성 실패' }, { status: 500 });
  }

  let budgetQuery = supabaseAdmin
    .from('ad_os_channel_budgets')
    .select('id, tenant_id, platform, monthly_budget_krw, daily_budget_cap_krw, automation_level, status')
    .order('platform', { ascending: true });
  budgetQuery = tenantId ? budgetQuery.eq('tenant_id', tenantId) : budgetQuery.is('tenant_id', null);
  const { data: budgets, error: budgetError } = await budgetQuery;

  if (budgetError) {
    await supabaseAdmin.from('ad_os_automation_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      errors: [{ message: budgetError.message }],
    }).eq('id', run.id);
    return NextResponse.json({ ok: false, error: budgetError.message }, { status: 500 });
  }

  const periodStart = new Date();
  periodStart.setUTCDate(1);
  const fromDate = periodStart.toISOString().slice(0, 10);
  const { data: perfRows, error: perfError } = await supabaseAdmin
    .from('keyword_performance_daily')
    .select('platform, cost_krw, cost_micros, date')
    .gte('date', fromDate);

  if (perfError) {
    await supabaseAdmin.from('ad_os_automation_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      errors: [{ message: perfError.message }],
    }).eq('id', run.id);
    return NextResponse.json({ ok: false, error: perfError.message }, { status: 500 });
  }

  const spendByPlatform = new Map<string, number>();
  for (const row of (perfRows ?? []) as Array<{ platform: string | null; cost_krw?: number | null; cost_micros?: number | null }>) {
    const platform = row.platform || 'unknown';
    const costKrw = Number(row.cost_krw || 0) || Math.round(Number(row.cost_micros || 0) / 1_000_000);
    spendByPlatform.set(platform, (spendByPlatform.get(platform) || 0) + costKrw);
  }

  const decisions = ((budgets ?? []) as BudgetRow[]).map((budget) => ({
    budget,
    pacing: decideAdOsBudgetPacing({
      platform: budget.platform,
      monthlyBudgetKrw: Number(budget.monthly_budget_krw || 0),
      dailyBudgetCapKrw: Number(budget.daily_budget_cap_krw || 0),
      actualSpendKrw: spendByPlatform.get(budget.platform) || 0,
      automationLevel: Number(budget.automation_level || 0),
      status: budget.status || 'paused',
    }),
  }));

  if (decisions.length > 0) {
    const snapshotRows = decisions.map(({ budget, pacing }) => ({
      tenant_id: budget.tenant_id,
      platform: budget.platform,
      budget_id: budget.id,
      period_start: pacing.periodStart,
      period_end: pacing.periodEnd,
      days_elapsed: pacing.daysElapsed,
      days_total: pacing.daysTotal,
      monthly_budget_krw: pacing.monthlyBudgetKrw,
      expected_spend_krw: pacing.expectedSpendKrw,
      actual_spend_krw: pacing.actualSpendKrw,
      pace_ratio: pacing.paceRatio,
      status: pacing.status,
      recommended_action: pacing.recommendedAction,
      reason: pacing.reason,
    }));
    const { error: snapshotError } = await supabaseAdmin.from('ad_os_budget_pacing_snapshots').insert(snapshotRows);
    if (snapshotError) {
      await supabaseAdmin.from('ad_os_automation_runs').update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        errors: [{ message: snapshotError.message }],
      }).eq('id', run.id);
      return NextResponse.json({ ok: false, error: snapshotError.message }, { status: 500 });
    }

    const decisionRows = decisions.map(({ budget, pacing }) => ({
      run_id: run.id,
      tenant_id: budget.tenant_id,
      platform: budget.platform,
      decision_type: pacing.recommendedAction === 'pause_channel' ? 'pause' : pacing.recommendedAction === 'no_change' ? 'no_change' : 'budget_change',
      target_table: 'ad_os_channel_budgets',
      target_id: budget.id,
      before_state: json({
        status: budget.status,
        daily_budget_cap_krw: budget.daily_budget_cap_krw,
        monthly_budget_krw: budget.monthly_budget_krw,
      }),
      after_state: json({
        status: pacing.recommendedAction === 'pause_channel' ? 'paused' : budget.status,
        daily_budget_cap_krw: pacing.nextDailyBudgetCapKrw,
        pacing_status: pacing.status,
        recommended_action: pacing.recommendedAction,
      }),
      reason: pacing.reason,
      confidence: pacing.status === 'on_track' ? 0.65 : 0.82,
      expected_impact: json(pacing),
      applied: false,
      blocked_reason: pacing.canApplyInternally ? null : 'automation_level_or_budget_not_ready',
    }));
    await supabaseAdmin.from('ad_os_decision_logs').insert(decisionRows);

    const changeRequests = decisions
      .filter(({ pacing }) => pacing.recommendedAction !== 'no_change')
      .map(({ budget, pacing }) => ({
        run_id: run.id,
        tenant_id: budget.tenant_id,
        platform: budget.platform,
        automation_level: Number(budget.automation_level || 0),
        request_type: pacing.recommendedAction === 'pause_channel' ? 'pause_channel' : 'budget_change',
        target_table: 'ad_os_channel_budgets',
        target_id: budget.id,
        status: 'proposed',
        title: pacing.recommendedAction === 'pause_channel' ? '월 예산 소진 채널 정지' : '예산 페이싱 일상한 조정',
        reason: pacing.reason,
        risk_level: pacing.recommendedAction === 'pause_channel' ? 'high' : 'medium',
        expected_impact: json(pacing),
        proposed_change: json({
          status: pacing.recommendedAction === 'pause_channel' ? 'paused' : budget.status,
          daily_budget_cap_krw: pacing.nextDailyBudgetCapKrw,
        }),
        rollback_payload: json({
          status: budget.status,
          daily_budget_cap_krw: budget.daily_budget_cap_krw,
        }),
        approval_required: true,
      }));
    if (changeRequests.length > 0) {
      const { error: requestError } = await supabaseAdmin.from('ad_os_change_requests').insert(changeRequests);
      if (requestError) {
        await supabaseAdmin.from('ad_os_automation_runs').update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          errors: [{ message: requestError.message }],
        }).eq('id', run.id);
        return NextResponse.json({ ok: false, error: requestError.message }, { status: 500 });
      }
    }
  }

  let appliedCount = 0;
  if (apply) {
    for (const { budget, pacing } of decisions) {
      if (!pacing.canApplyInternally || pacing.recommendedAction === 'no_change' || pacing.recommendedAction === 'increase_tests') continue;
      const patch = pacing.recommendedAction === 'pause_channel'
        ? {
            status: 'paused',
            daily_budget_cap_krw: 0,
            notes: 'Ad OS budget pacing paused this channel after monthly budget exhaustion.',
            updated_at: new Date().toISOString(),
          }
        : {
            daily_budget_cap_krw: pacing.nextDailyBudgetCapKrw,
            notes: 'Ad OS budget pacing adjusted the daily cap to stay within monthly budget.',
            updated_at: new Date().toISOString(),
          };
      const { error: updateError } = await supabaseAdmin
        .from('ad_os_channel_budgets')
        .update(patch)
        .eq('id', budget.id);
      if (updateError) {
        await supabaseAdmin.from('ad_os_automation_runs').update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          errors: [{ message: updateError.message }],
        }).eq('id', run.id);
        return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
      }
      appliedCount += 1;
    }

    if (appliedCount > 0) {
      await supabaseAdmin
        .from('ad_os_decision_logs')
        .update({ applied: true })
        .eq('run_id', run.id)
        .in('decision_type', ['pause', 'budget_change']);
    }
  }

  const summary = {
    checked_channels: decisions.length,
    overspend: decisions.filter(({ pacing }) => pacing.status === 'overspend').length,
    underspend: decisions.filter(({ pacing }) => pacing.status === 'underspend').length,
    exhausted: decisions.filter(({ pacing }) => pacing.status === 'exhausted').length,
    on_track: decisions.filter(({ pacing }) => pacing.status === 'on_track').length,
    applied_count: appliedCount,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({
    ok: true,
    run_id: run.id,
    summary,
    decisions: decisions.map(({ budget, pacing }) => ({ budget_id: budget.id, ...pacing })),
  });
});
