import { NextRequest, NextResponse } from 'next/server';
import { buildBidOptimizerCandidates } from '@/lib/ad-os-v31-v40';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const limit = Math.min(Math.max(Number(body.limit || 200), 1), 500);
  const targetCpaKrw = Number(body.target_cpa_krw || 80000);
  const targetMarginRoasPct = Number(body.target_margin_roas_pct || 250);
  const minSpendKrw = Number(body.min_spend_krw || 5000);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'bid_optimization',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: { apply, limit, target_cpa_krw: targetCpaKrw, target_margin_roas_pct: targetMarginRoasPct, min_spend_krw: minSpendKrw },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  const { data: facts, error } = await supabaseAdmin
    .from('ad_os_performance_facts')
    .select('*')
    .neq('platform', 'organic')
    .order('event_date', { ascending: false })
    .limit(limit);

  if (error) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const candidates = buildBidOptimizerCandidates(facts || [], { targetCpaKrw, targetMarginRoasPct, minSpendKrw });

  if (apply && candidates.length > 0) {
    const { error: requestError } = await supabaseAdmin.from('ad_os_change_requests').insert(
      candidates.map((candidate) => ({
        tenant_id: candidate.tenant_id,
        run_id: run.id,
        platform: candidate.platform,
        automation_level: candidate.request_type === 'increase_bid' ? 3 : 2,
        request_type: candidate.request_type,
        target_table: candidate.target_table,
        target_id: candidate.target_id,
        status: 'proposed',
        title: candidate.title,
        reason: candidate.reason,
        risk_level: candidate.risk_level,
        expected_impact: json(candidate.expected_impact),
        proposed_change: json(candidate.proposed_change),
        rollback_payload: json({ source: 'ad_os_bid_optimizer_v31', fact_id: candidate.fact_id }),
        approval_required: true,
      })),
    );
    if (requestError) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: requestError.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: requestError.message }, { status: 500 });
    }
  }

  const summary = {
    facts_checked: facts?.length || 0,
    candidates: candidates.length,
    change_requests_created: apply ? candidates.length : 0,
    pause_candidates: candidates.filter((row) => row.request_type === 'pause_keyword').length,
    scale_candidates: candidates.filter((row) => row.request_type === 'increase_bid').length,
    landing_candidates: candidates.filter((row) => ['replace_landing', 'update_blog_cta'].includes(row.request_type)).length,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, candidates: candidates.slice(0, 50) });
});
