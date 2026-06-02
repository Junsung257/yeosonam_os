import { NextRequest, NextResponse } from 'next/server';
import { decideConversionUploadExecution } from '@/lib/ad-os-v61-v75';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const platform = ['google', 'meta'].includes(String(body.platform)) ? String(body.platform) : null;
  const limit = Math.min(Math.max(Number(body.limit || 100), 1), 300);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'conversion_upload_execute',
      mode: apply ? 'guarded_dry_run' : 'dry_run',
      status: 'running',
      summary: { apply, platform, limit, external_api_write: false },
    })
    .select('id')
    .single();
  if (runError || !run) return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });

  let query = supabaseAdmin
    .from('ad_os_conversion_upload_jobs')
    .select('*')
    .in('status', ['planned', 'approved', 'running'])
    .order('created_at', { ascending: true })
    .limit(limit);
  if (platform) query = query.eq('platform', platform);
  const { data: jobs, error } = await query;
  if (error) {
    await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] }).eq('id', run.id);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const decisions = (jobs || []).map((job: any) => ({ job, decision: decideConversionUploadExecution(job, { runId: run.id }) }));
  const attempts = decisions.map(({ decision }) => decision.attempt);

  if (apply && attempts.length > 0) {
    const { error: attemptError } = await supabaseAdmin.from('ad_os_execution_attempts').insert(attempts as never);
    if (attemptError) {
      await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: attemptError.message }] }).eq('id', run.id);
      return NextResponse.json({ ok: false, error: attemptError.message }, { status: 500 });
    }
    for (const { job, decision } of decisions) {
      const { error: updateError } = await supabaseAdmin.from('ad_os_conversion_upload_jobs').update(decision.jobPatch as never).eq('id', job.id);
      if (updateError) {
        await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: updateError.message }] }).eq('id', run.id);
        return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
      }
    }
  }

  const summary = {
    jobs_checked: jobs?.length || 0,
    attempts_prepared: attempts.length,
    attempts_written: apply ? attempts.length : 0,
    uploaded_dry_run: attempts.filter((attempt) => attempt.status === 'succeeded').length,
    blocked: attempts.filter((attempt) => attempt.status === 'blocked').length,
    external_api_write: false,
  };
  await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'completed', finished_at: new Date().toISOString(), summary }).eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, attempts: attempts.slice(0, 50) });
});
