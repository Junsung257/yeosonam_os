import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type KeywordRow = {
  id: string;
  keyword_text: string;
  tier: string | null;
  match_type: string | null;
  plan_status: string | null;
  autopilot_status: string | null;
  suggested_bid_krw: number | null;
  max_cpc_krw?: number | null;
};

function jsonState(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value));
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'guarded' || body.mode === 'full' ? body.mode : 'dry_run';
  const apply = mode !== 'dry_run' && body.apply === true;
  const limit = Math.min(Math.max(Number(body.limit || 20), 1), 100);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'analysis',
      mode,
      platform: 'naver',
      status: 'running',
      summary: { apply, limit, action: 'approve_naver_candidates' },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'Failed to create automation run' }, { status: 500 });
  }

  const [budgetRes, keywordRes] = await Promise.all([
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('platform,status,max_cpc_krw')
      .eq('platform', 'naver')
      .maybeSingle(),
    supabaseAdmin
      .from('search_ad_keyword_plans')
      .select('id,keyword_text,tier,match_type,plan_status,autopilot_status,suggested_bid_krw,max_cpc_krw')
      .eq('platform', 'naver')
      .eq('plan_status', 'draft')
      .eq('autopilot_status', 'candidate')
      .neq('tier', 'negative')
      .is('external_keyword_id', null)
      .order('opportunity_score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit * 4),
  ]);

  const firstError = budgetRes.error || keywordRes.error;
  if (firstError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: firstError.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const budget = budgetRes.data as { status?: string | null; max_cpc_krw?: number | null } | null;
  const maxCpc = Number(budget?.max_cpc_krw || 0);
  const rows = ((keywordRes.data || []) as KeywordRow[]).slice(0, limit * 4);
  const eligibleRows = rows
    .filter((row) => {
      const bid = Number(row.suggested_bid_krw || row.max_cpc_krw || 0);
      return maxCpc <= 0 || bid <= maxCpc;
    })
    .slice(0, limit);

  const eligibleIds = new Set(eligibleRows.map((row) => row.id));
  const decisions = rows.slice(0, Math.max(limit, eligibleRows.length)).map((row) => {
    const bid = Number(row.suggested_bid_krw || row.max_cpc_krw || 0);
    const eligible = eligibleIds.has(row.id);
    return {
      run_id: run.id,
      platform: 'naver',
      decision_type: eligible ? 'approve' : 'no_change',
      target_table: 'search_ad_keyword_plans',
      target_id: row.id,
      before_state: jsonState({
        plan_status: row.plan_status,
        autopilot_status: row.autopilot_status,
        suggested_bid_krw: bid,
      }),
      after_state: jsonState({
        plan_status: eligible ? 'approved' : row.plan_status,
        autopilot_status: eligible ? 'approved' : row.autopilot_status,
      }),
      reason: eligible
        ? 'Naver candidate keyword is within the configured Max CPC, so Ad OS can safely approve it for the next guarded step. External ad spend remains 0.'
        : `Suggested CPC ${bid.toLocaleString('ko-KR')} KRW is above Max CPC ${maxCpc.toLocaleString('ko-KR')} KRW or outside the approval limit.`,
      confidence: eligible ? 0.8 : 0.58,
      expected_impact: jsonState({ external_spend_krw: 0, suggested_bid_krw: bid, max_cpc_krw: maxCpc }),
      applied: false,
      blocked_reason: eligible ? null : 'guardrail',
    };
  });

  if (decisions.length > 0) {
    const { error } = await supabaseAdmin.from('ad_os_decision_logs').insert(decisions);
    if (error) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  let approvedCount = 0;
  if (apply && eligibleRows.length > 0) {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('search_ad_keyword_plans')
      .update({
        plan_status: 'approved',
        autopilot_status: 'approved',
        automation_level: 1,
        last_decision_at: now,
        decision_reason: 'Approved by Ad OS Naver safe candidate gate.',
        updated_at: now,
      })
      .in('id', eligibleRows.map((row) => row.id));

    if (error) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: now, errors: [{ message: error.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    approvedCount = eligibleRows.length;
    await supabaseAdmin
      .from('ad_os_decision_logs')
      .update({ applied: true })
      .eq('run_id', run.id)
      .eq('decision_type', 'approve');
  }

  const summary = {
    checked_keywords: rows.length,
    eligible_keywords: eligibleRows.length,
    approved_keywords: approvedCount,
    blocked_by_cpc: rows.filter((row) => maxCpc > 0 && Number(row.suggested_bid_krw || row.max_cpc_krw || 0) > maxCpc).length,
    max_cpc_krw: maxCpc,
    applied: approvedCount > 0,
    external_spend_krw: 0,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, decisions: decisions.slice(0, 30) });
});
