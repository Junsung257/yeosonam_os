import { NextRequest, NextResponse } from 'next/server';
import { decidePlatformJobExecution, type PlatformExecutionMode } from '@/lib/ad-os-v61-v75';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const mode: PlatformExecutionMode = ['dry_run', 'paused_only', 'active_allowed'].includes(String(body.mode))
    ? String(body.mode) as PlatformExecutionMode
    : 'dry_run';
  const platform = ['naver', 'google', 'meta', 'kakao'].includes(String(body.platform))
    ? String(body.platform)
    : null;
  const limit = Math.min(Math.max(Number(body.limit || 50), 1), 200);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'platform_job_execute',
      mode: apply ? mode : 'dry_run',
      status: 'running',
      summary: { apply, mode, platform, limit, external_api_write: false },
    })
    .select('id')
    .single();
  if (runError || !run) return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });

  let jobQuery = supabaseAdmin
    .from('ad_os_platform_jobs')
    .select('*')
    .in('status', ['approved', 'running'])
    .order('created_at', { ascending: true })
    .limit(limit);
  if (platform) jobQuery = jobQuery.eq('platform', platform);

  const { data: jobs, error } = await jobQuery;
  if (error) {
    await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] }).eq('id', run.id);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const decisions = (jobs || []).map((job: any) => ({ job, decision: decidePlatformJobExecution(job, { mode, runId: run.id }) }));
  const attempts = decisions.map(({ decision }) => decision.attempt);

  if (apply && attempts.length > 0) {
    const { error: attemptError } = await supabaseAdmin.from('ad_os_execution_attempts').insert(attempts as never);
    if (attemptError) {
      await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: attemptError.message }] }).eq('id', run.id);
      return NextResponse.json({ ok: false, error: attemptError.message }, { status: 500 });
    }
    for (const { job, decision } of decisions) {
      const { error: updateError } = await supabaseAdmin.from('ad_os_platform_jobs').update(decision.jobPatch as never).eq('id', job.id);
      if (updateError) {
        await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: updateError.message }] }).eq('id', run.id);
        return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
      }
    }
  }

  const summary = {
    jobs_checked: jobs?.length || 0,
    platform,
    attempts_prepared: attempts.length,
    attempts_written: apply ? attempts.length : 0,
    succeeded: attempts.filter((attempt) => attempt.status === 'succeeded').length,
    blocked: attempts.filter((attempt) => attempt.status === 'blocked').length,
    external_api_write: false,
  };
  await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'completed', finished_at: new Date().toISOString(), summary }).eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, attempts: attempts.slice(0, 50) });
});
