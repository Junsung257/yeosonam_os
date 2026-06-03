import { NextRequest, NextResponse } from 'next/server';
import { decideExperimentRun } from '@/lib/ad-os-v31-v40';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const limit = Math.min(Math.max(Number(body.limit || 50), 1), 200);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'experiment_plan',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: { apply, limit },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  const { data: experiments, error } = await supabaseAdmin
    .from('ad_os_experiments')
    .select('*')
    .in('status', ['approved', 'running'])
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const { data: facts, error: factsError } = await supabaseAdmin
    .from('ad_os_performance_facts')
    .select('*')
    .order('event_date', { ascending: false })
    .limit(1000);

  if (factsError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: factsError.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: factsError.message }, { status: 500 });
  }

  const decisions = (experiments || []).map((experiment: any) => {
    const scopedFacts = (facts || []).filter((fact: any) => {
      if (experiment.product_id && fact.product_id !== experiment.product_id) return false;
      if (experiment.platform && fact.platform !== experiment.platform) return false;
      return true;
    });
    return decideExperimentRun(experiment, scopedFacts);
  });

  if (apply) {
    for (const decision of decisions) {
      const { error: updateError } = await supabaseAdmin
        .from('ad_os_experiments')
        .update(decision.patch)
        .eq('id', decision.experiment_id);
      if (updateError) {
        await supabaseAdmin
          .from('ad_os_automation_runs')
          .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: updateError.message }] })
          .eq('id', run.id);
        return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
      }
    }
  }

  const summary = {
    experiments_checked: experiments?.length || 0,
    decisions: decisions.length,
    started: decisions.filter((decision) => decision.next_status === 'running').length,
    completed: decisions.filter((decision) => decision.next_status === 'completed').length,
    applied: apply,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, decisions });
});
