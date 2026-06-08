import { NextRequest, NextResponse } from 'next/server';
import { decideNaverPausedWriteExecutor } from '@/lib/ad-os-v221-v240';
import { loadLatestNaverLimitedPilotPolicy, envFlagEnabled } from '@/lib/ad-os-v121-v140-db';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const limit = Math.min(Math.max(Number(body.limit || 20), 1), 50);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'naver_live_preflight',
      mode: 'read_only',
      platform: 'naver',
      status: 'running',
      summary: {
        limit,
        simulated_confirm_live_write: true,
        external_api_write: false,
      },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  try {
    const policy = await loadLatestNaverLimitedPilotPolicy();
    const flagName = policy?.env_flag_required || 'AD_OS_NAVER_LIMITED_WRITE_ENABLED';
    const liveFlag = envFlagEnabled(flagName);
    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from('ad_os_platform_jobs')
      .select('*')
      .eq('platform', 'naver')
      .eq('job_type', 'create_paused_keyword')
      .in('status', ['approved', 'running'])
      .order('created_at', { ascending: true })
      .limit(limit);
    if (jobsError) throw jobsError;

    const decisions = (jobs || []).map((job) => decideNaverPausedWriteExecutor({
      job: job as never,
      policy,
      requestedMode: 'live_paused_write',
      apply: true,
      confirmLiveWrite: true,
      envFlagEnabled: liveFlag,
      runId: run.id,
    }));
    const results = decisions.map((decision) => ({
      job_id: decision.attempt.job_id,
      would_pass_live_gate: decision.allowed,
      blockers: decision.blockers,
      keyword: decision.keyword,
      bid_amt: decision.bidAmt,
      ncc_adgroup_id_present: Boolean(decision.nccAdgroupId),
      preflight_only: true,
      external_api_write: false,
    }));
    const blockers = Array.from(new Set(decisions.flatMap((decision) => decision.blockers)));
    if ((jobs || []).length === 0) blockers.push('approved_naver_platform_job_missing');

    const summary = {
      policy_found: Boolean(policy),
      policy_status: policy?.status || null,
      pilot_level: policy?.pilot_level || null,
      live_external_write_enabled: Boolean(policy?.live_external_write_enabled),
      env_flag: flagName,
      env_flag_enabled: liveFlag,
      approved_jobs_checked: jobs?.length || 0,
      ready_jobs: decisions.filter((decision) => decision.allowed).length,
      blocked_jobs: decisions.filter((decision) => !decision.allowed).length + ((jobs || []).length === 0 ? 1 : 0),
      blockers,
      preflight_status: blockers.length === 0 ? 'ready' : 'blocked',
      simulated_confirm_live_write: true,
      external_api_write: false,
      external_api_write_count: 0,
      next_action: blockers.length === 0
        ? 'Live paused-write preflight is ready. Actual executor still requires an explicit live request and confirmation.'
        : `Resolve ${blockers[0]} before live paused-write execution.`,
    };

    if (apply) {
      const attempts = decisions.map((decision) => ({
        ...decision.attempt,
        status: decision.allowed ? 'succeeded' : 'blocked',
        dry_run: true,
        external_api_write: false,
        response_payload: {
          ...decision.preflightResponse,
          live_preflight_only: true,
          will_call_external_api: false,
          external_api_write: false,
        },
      }));
      if (attempts.length > 0) {
        const { error: insertError } = await supabaseAdmin.from('ad_os_execution_attempts').insert(attempts as never);
        if (insertError) throw insertError;
      }
    }

    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
      .eq('id', run.id);

    return NextResponse.json({ ok: true, run_id: run.id, summary, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Naver live preflight failed';
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});
