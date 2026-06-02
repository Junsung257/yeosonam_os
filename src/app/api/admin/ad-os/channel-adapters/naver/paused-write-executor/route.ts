import { NextRequest, NextResponse } from 'next/server';
import { decideNaverPausedWriteExecutor, type NaverPausedWriteMode } from '@/lib/ad-os-v221-v240';
import { loadLatestNaverLimitedPilotPolicy, envFlagEnabled } from '@/lib/ad-os-v121-v140-db';
import { withAdminGuard } from '@/lib/admin-guard';
import { createNaverPausedKeywords } from '@/lib/search-ads-api';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function mode(value: unknown): NaverPausedWriteMode {
  return value === 'live_paused_write' ? 'live_paused_write' : 'dry_run';
}

function mergeResponse(base: Record<string, unknown> | null | undefined, extra: Record<string, unknown>) {
  return {
    ...(base || {}),
    ...extra,
    executor_version: 'v221_v240',
  };
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const requestedMode = mode(body.requested_mode);
  const apply = body.apply === true;
  const confirmLiveWrite = body.confirm_live_write === true;
  const limit = Math.min(Math.max(Number(body.limit || 10), 1), 50);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'platform_job_execute',
      mode: requestedMode === 'live_paused_write' && apply ? 'guarded' : 'dry_run',
      platform: 'naver',
      status: 'running',
      summary: {
        requested_mode: requestedMode,
        apply,
        confirm_live_write: confirmLiveWrite,
        external_api_write: false,
        executor: 'naver_paused_write_v221_v240',
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

    let query = supabaseAdmin
      .from('ad_os_platform_jobs')
      .select('*')
      .eq('platform', 'naver')
      .eq('job_type', 'create_paused_keyword')
      .in('status', ['approved', 'running'])
      .order('created_at', { ascending: true })
      .limit(limit);
    if (body.platform_job_id) query = query.eq('id', body.platform_job_id);

    const { data: jobs, error: jobError } = await query;
    if (jobError) throw jobError;

    const results = [];
    let externalWrites = 0;
    let succeeded = 0;
    let failed = 0;
    let blocked = 0;

    for (const job of jobs || []) {
      const decision = decideNaverPausedWriteExecutor({
        job: job as never,
        policy,
        requestedMode,
        apply,
        confirmLiveWrite,
        envFlagEnabled: liveFlag,
        runId: run.id,
      });

      let attempt = decision.attempt;
      let jobPatch: Record<string, unknown> | null = null;
      let externalResult: Record<string, unknown> | null = null;

      if (decision.willCallExternalApi && decision.keyword && decision.bidAmt && decision.nccAdgroupId) {
        const created = await createNaverPausedKeywords({
          nccAdgroupId: decision.nccAdgroupId,
          keywords: [{ keyword: decision.keyword, bidAmt: decision.bidAmt }],
        });
        externalResult = {
          ok: created.ok,
          created_count: created.created.length,
          created_keywords: created.created,
          error: created.error || null,
        };
        externalWrites += 1;
        attempt = {
          ...attempt,
          status: created.ok && created.created.length > 0 ? 'succeeded' : 'failed',
          dry_run: false,
          external_api_write: true,
          response_payload: mergeResponse(attempt.response_payload, {
            external_api_write: true,
            external_result: externalResult,
            next_confirmation_route: '/api/admin/ad-os/external-results/confirm',
          }),
          blocked_reason: created.ok ? null : created.error || 'naver_paused_keyword_create_failed',
          retryable: !created.ok,
        };
        jobPatch = {
          status: created.ok && created.created.length > 0 ? 'running' : 'failed',
          response_payload: mergeResponse((job as any).response_payload, {
            external_api_write: true,
            external_result: externalResult,
            external_result_pending_confirmation: created.ok && created.created.length > 0,
            next_confirmation_route: '/api/admin/ad-os/external-results/confirm',
          }),
          blocked_reason: created.ok ? null : created.error || 'naver_paused_keyword_create_failed',
          started_at: (job as any).started_at || new Date().toISOString(),
          finished_at: created.ok ? null : new Date().toISOString(),
          external_api_write: true,
        };
      } else if (decision.allowed) {
        jobPatch = {
          response_payload: mergeResponse((job as any).response_payload, decision.preflightResponse),
          blocked_reason: null,
          guardrail_status: 'passed',
          external_api_write: false,
        };
      } else {
        jobPatch = {
          status: 'blocked',
          response_payload: mergeResponse((job as any).response_payload, decision.preflightResponse),
          blocked_reason: decision.blockers[0] || 'naver_paused_write_blocked',
          guardrail_status: 'blocked',
          external_api_write: false,
        };
      }

      if (apply) {
        const { error: attemptError } = await supabaseAdmin.from('ad_os_execution_attempts').insert(attempt as never);
        if (attemptError) throw attemptError;
        if (jobPatch) {
          const { error: updateError } = await supabaseAdmin.from('ad_os_platform_jobs').update(jobPatch as never).eq('id', (job as any).id);
          if (updateError) throw updateError;
        }
      }

      if (attempt.status === 'succeeded') succeeded += 1;
      if (attempt.status === 'failed') failed += 1;
      if (attempt.status === 'blocked') blocked += 1;
      results.push({ job_id: (job as any).id, decision, external_result: externalResult });
    }

    const summary = {
      requested_mode: requestedMode,
      apply,
      confirm_live_write: confirmLiveWrite,
      env_flag: flagName,
      env_flag_enabled: liveFlag,
      jobs_checked: jobs?.length || 0,
      succeeded,
      failed,
      blocked,
      external_api_write: externalWrites > 0,
      external_api_write_count: externalWrites,
      note: 'Live Naver paused-keyword writes require policy, env flag, apply=true, and confirm_live_write=true. Successful writes stay pending external-results confirmation before change requests become applied.',
    };

    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
      .eq('id', run.id);

    return NextResponse.json({ ok: true, run_id: run.id, summary, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Naver paused write executor failed';
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});
