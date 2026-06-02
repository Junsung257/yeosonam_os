import { NextRequest, NextResponse } from 'next/server';
import { decidePlatformExternalResultConfirmation, decideConversionExternalResultConfirmation } from '@/lib/ad-os-v201-v220';
import { decidePlatformJobExecution, decideConversionUploadExecution } from '@/lib/ad-os-v61-v75';
import { decideOpsQueueAction, type OpsQueueAction } from '@/lib/ad-os-v281-v300';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type Body = {
  source?: string;
  id?: string;
  action?: OpsQueueAction;
  apply?: boolean;
  error_message?: string;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function finishRun(runId: string, status: 'completed' | 'failed', summary: Record<string, unknown>, errors?: Array<Record<string, unknown>>) {
  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      summary,
      ...(errors ? { errors } : {}),
    })
    .eq('id', runId);
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const id = String(body.id || '');
  const apply = body.apply !== false;
  const actionDecision = decideOpsQueueAction({
    source: String(body.source || ''),
    action: String(body.action || ''),
  });

  if (!id) return jsonError('missing_ops_queue_row_id');
  if (!actionDecision.allowed) {
    return jsonError(actionDecision.blockedReason || 'ops_queue_action_blocked');
  }

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'ops_queue_action',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: {
        action: actionDecision.action,
        source: actionDecision.source,
        target_type: actionDecision.targetType,
        apply,
        external_api_write: false,
      },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  try {
    if (actionDecision.targetType === 'platform_job') {
      const { data: job, error } = await supabaseAdmin
        .from('ad_os_platform_jobs')
        .select('*')
        .eq('id', id)
        .single();
      if (error || !job) {
        await finishRun(run.id, 'failed', { action: actionDecision.action, id, error: error?.message || 'platform job not found' }, [{ message: error?.message || 'platform job not found' }]);
        return NextResponse.json({ ok: false, error: error?.message || 'platform job not found' }, { status: 404 });
      }

      if (actionDecision.action === 'executor_dry_run') {
        const decision = decidePlatformJobExecution(job as never, { mode: 'paused_only', runId: run.id });
        if (apply) {
          const { error: attemptError } = await supabaseAdmin.from('ad_os_execution_attempts').insert(decision.attempt as never);
          if (attemptError) throw attemptError;
          const { error: updateError } = await supabaseAdmin.from('ad_os_platform_jobs').update(decision.jobPatch as never).eq('id', job.id);
          if (updateError) throw updateError;
        }
        const summary = {
          action: actionDecision.action,
          target_type: actionDecision.targetType,
          id,
          apply,
          attempt_status: decision.attempt.status,
          blocked_reason: decision.attempt.blocked_reason || null,
          external_api_write: false,
        };
        await finishRun(run.id, 'completed', summary);
        return NextResponse.json({ ok: true, run_id: run.id, summary, decision });
      }

      if (actionDecision.action === 'acknowledge_blocker') {
        const summary = {
          action: actionDecision.action,
          target_type: actionDecision.targetType,
          id,
          apply,
          acknowledged: true,
          status: job.status || null,
          blocked_reason: job.blocked_reason || null,
          external_api_write: false,
        };
        await finishRun(run.id, 'completed', summary);
        return NextResponse.json({ ok: true, run_id: run.id, summary });
      }

      const decision = decidePlatformExternalResultConfirmation(job as never, {
        resultStatus: 'failed',
        confirmExternalResult: true,
        errorMessage: body.error_message || 'operator_marked_external_result_failed',
        externalResponse: { source: 'ops_queue_action' },
        runId: run.id,
      });
      if (apply) {
        const { error: attemptError } = await supabaseAdmin.from('ad_os_execution_attempts').insert(decision.attempt as never);
        if (attemptError) throw attemptError;
        if (decision.jobPatch) {
          const { error: updateError } = await supabaseAdmin.from('ad_os_platform_jobs').update(decision.jobPatch as never).eq('id', job.id);
          if (updateError) throw updateError;
        }
        if (decision.mutationPatch && job.external_mutation_result_id) {
          const { error: mutationError } = await supabaseAdmin.from('ad_os_external_mutation_results').update(decision.mutationPatch as never).eq('id', job.external_mutation_result_id);
          if (mutationError) throw mutationError;
        }
      }
      const summary = {
        action: actionDecision.action,
        target_type: actionDecision.targetType,
        id,
        apply,
        decision_action: decision.action,
        blocked_reason: decision.blockedReason || null,
        external_api_write: false,
      };
      await finishRun(run.id, 'completed', summary);
      return NextResponse.json({ ok: true, run_id: run.id, summary, decision });
    }

    if (actionDecision.targetType === 'conversion_upload_job') {
      const { data: job, error } = await supabaseAdmin
        .from('ad_os_conversion_upload_jobs')
        .select('*')
        .eq('id', id)
        .single();
      if (error || !job) {
        await finishRun(run.id, 'failed', { action: actionDecision.action, id, error: error?.message || 'conversion upload job not found' }, [{ message: error?.message || 'conversion upload job not found' }]);
        return NextResponse.json({ ok: false, error: error?.message || 'conversion upload job not found' }, { status: 404 });
      }

      if (actionDecision.action === 'executor_dry_run') {
        const decision = decideConversionUploadExecution(job as never, { runId: run.id });
        if (apply) {
          const { error: attemptError } = await supabaseAdmin.from('ad_os_execution_attempts').insert(decision.attempt as never);
          if (attemptError) throw attemptError;
          const { error: updateError } = await supabaseAdmin.from('ad_os_conversion_upload_jobs').update(decision.jobPatch as never).eq('id', job.id);
          if (updateError) throw updateError;
        }
        const summary = {
          action: actionDecision.action,
          target_type: actionDecision.targetType,
          id,
          apply,
          attempt_status: decision.attempt.status,
          blocked_reason: decision.attempt.blocked_reason || null,
          external_api_write: false,
          uploaded: false,
        };
        await finishRun(run.id, 'completed', summary);
        return NextResponse.json({ ok: true, run_id: run.id, summary, decision });
      }

      if (actionDecision.action === 'acknowledge_blocker') {
        const summary = {
          action: actionDecision.action,
          target_type: actionDecision.targetType,
          id,
          apply,
          acknowledged: true,
          status: job.status || null,
          blocked_reason: job.blocked_reason || null,
          external_api_write: false,
        };
        await finishRun(run.id, 'completed', summary);
        return NextResponse.json({ ok: true, run_id: run.id, summary });
      }

      const decision = decideConversionExternalResultConfirmation(job as never, {
        resultStatus: 'failed',
        confirmExternalResult: true,
        errorMessage: body.error_message || 'operator_marked_external_upload_failed',
        externalResponse: { source: 'ops_queue_action' },
        runId: run.id,
      });
      if (apply) {
        const { error: attemptError } = await supabaseAdmin.from('ad_os_execution_attempts').insert(decision.attempt as never);
        if (attemptError) throw attemptError;
        if (decision.jobPatch) {
          const { error: updateError } = await supabaseAdmin.from('ad_os_conversion_upload_jobs').update(decision.jobPatch as never).eq('id', job.id);
          if (updateError) throw updateError;
        }
      }
      const summary = {
        action: actionDecision.action,
        target_type: actionDecision.targetType,
        id,
        apply,
        decision_action: decision.action,
        blocked_reason: decision.blockedReason || null,
        external_api_write: false,
        uploaded: false,
      };
      await finishRun(run.id, 'completed', summary);
      return NextResponse.json({ ok: true, run_id: run.id, summary, decision });
    }

    const { data: attempt, error } = await supabaseAdmin
      .from('ad_os_execution_attempts')
      .select('id, platform, attempt_type, status, blocked_reason')
      .eq('id', id)
      .single();
    if (error || !attempt) {
      await finishRun(run.id, 'failed', { action: actionDecision.action, id, error: error?.message || 'execution attempt not found' }, [{ message: error?.message || 'execution attempt not found' }]);
      return NextResponse.json({ ok: false, error: error?.message || 'execution attempt not found' }, { status: 404 });
    }

    const summary = {
      action: actionDecision.action,
      target_type: actionDecision.targetType,
      id,
      apply,
      acknowledged: true,
      blocked_reason: attempt.blocked_reason || null,
      external_api_write: false,
    };
    await finishRun(run.id, 'completed', summary);
    return NextResponse.json({ ok: true, run_id: run.id, summary, attempt });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ops queue action failed';
    await finishRun(run.id, 'failed', { action: actionDecision.action, id, error: message, external_api_write: false }, [{ message }]);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});
