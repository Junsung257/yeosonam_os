import { NextRequest, NextResponse } from 'next/server';
import {
  decideConversionExternalResultConfirmation,
  decidePlatformExternalResultConfirmation,
  type ExternalResultStatus,
} from '@/lib/ad-os-v201-v220';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type ConfirmBody = {
  result_type?: 'platform_job' | 'conversion_upload';
  platform_job_id?: string;
  conversion_upload_job_id?: string;
  result_status?: ExternalResultStatus;
  confirm_external_result?: boolean;
  apply?: boolean;
  external_resource_id?: string;
  external_upload_id?: string;
  external_response?: Record<string, unknown>;
  error_message?: string;
};

function errorJson(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as ConfirmBody;
  const resultType = body.result_type;
  const resultStatus = body.result_status;
  const apply = body.apply === true;
  const confirmExternalResult = body.confirm_external_result === true;

  if (resultType !== 'platform_job' && resultType !== 'conversion_upload') {
    return errorJson('invalid_result_type');
  }
  if (!resultStatus || !['succeeded', 'uploaded', 'failed'].includes(resultStatus)) {
    return errorJson('invalid_result_status');
  }
  if (resultType === 'conversion_upload' && !body.conversion_upload_job_id) {
    return errorJson('missing_conversion_upload_job_id');
  }
  if (resultType === 'platform_job' && !body.platform_job_id) {
    return errorJson('missing_platform_job_id');
  }

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: resultType === 'platform_job' ? 'platform_job_execute' : 'conversion_upload_execute',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: {
        apply,
        result_type: resultType,
        result_status: resultStatus,
        source: 'external_result_confirmation_v201_v220',
        confirmation_only: true,
        external_api_write: false,
      },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  if (resultType === 'conversion_upload') {
    const { data: job, error: jobError } = await supabaseAdmin
      .from('ad_os_conversion_upload_jobs')
      .select('*')
      .eq('id', body.conversion_upload_job_id)
      .single();

    if (jobError || !job) {
      await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: jobError?.message || 'job not found' }] }).eq('id', run.id);
      return NextResponse.json({ ok: false, error: jobError?.message || 'job not found' }, { status: 404 });
    }

    const decision = decideConversionExternalResultConfirmation(job as never, {
      resultStatus,
      confirmExternalResult,
      externalUploadId: body.external_upload_id || null,
      externalResponse: body.external_response || {},
      errorMessage: body.error_message || null,
      runId: run.id,
    });

    if (apply) {
      const { error: attemptError } = await supabaseAdmin.from('ad_os_execution_attempts').insert(decision.attempt as never);
      if (attemptError) {
        await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: attemptError.message }] }).eq('id', run.id);
        return NextResponse.json({ ok: false, error: attemptError.message }, { status: 500 });
      }
      if (decision.jobPatch) {
        const { error: updateError } = await supabaseAdmin.from('ad_os_conversion_upload_jobs').update(decision.jobPatch as never).eq('id', job.id);
        if (updateError) {
          await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: updateError.message }] }).eq('id', run.id);
          return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
        }
      }
    }

    const summary = {
      apply,
      result_type: resultType,
      action: decision.action,
      blocked_reason: decision.blockedReason || null,
      job_id: job.id,
      external_upload_id: body.external_upload_id || null,
      confirmation_only: true,
      external_api_write: false,
      note: 'This route records an already-returned external upload result. It does not call Google or Meta.',
    };
    await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'completed', finished_at: new Date().toISOString(), summary }).eq('id', run.id);

    return NextResponse.json({ ok: true, run_id: run.id, summary, decision });
  }

  const { data: job, error: jobError } = await supabaseAdmin
    .from('ad_os_platform_jobs')
    .select('*')
    .eq('id', body.platform_job_id)
    .single();

  if (jobError || !job) {
    await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: jobError?.message || 'job not found' }] }).eq('id', run.id);
    return NextResponse.json({ ok: false, error: jobError?.message || 'job not found' }, { status: 404 });
  }

  const decision = decidePlatformExternalResultConfirmation(job as never, {
    resultStatus,
    confirmExternalResult,
    externalResourceId: body.external_resource_id || null,
    externalResponse: body.external_response || {},
    errorMessage: body.error_message || null,
    runId: run.id,
  });

  if (apply) {
    const { error: attemptError } = await supabaseAdmin.from('ad_os_execution_attempts').insert(decision.attempt as never);
    if (attemptError) {
      await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: attemptError.message }] }).eq('id', run.id);
      return NextResponse.json({ ok: false, error: attemptError.message }, { status: 500 });
    }
    if (decision.jobPatch) {
      const { error: updateError } = await supabaseAdmin.from('ad_os_platform_jobs').update(decision.jobPatch as never).eq('id', job.id);
      if (updateError) {
        await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: updateError.message }] }).eq('id', run.id);
        return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
      }
    }
    if (decision.mutationPatch && job.external_mutation_result_id) {
      const { error: mutationError } = await supabaseAdmin.from('ad_os_external_mutation_results').update(decision.mutationPatch as never).eq('id', job.external_mutation_result_id);
      if (mutationError) {
        await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: mutationError.message }] }).eq('id', run.id);
        return NextResponse.json({ ok: false, error: mutationError.message }, { status: 500 });
      }
    }
    if (decision.changeRequestPatch && job.change_request_id) {
      const { error: requestError } = await supabaseAdmin.from('ad_os_change_requests').update(decision.changeRequestPatch as never).eq('id', job.change_request_id);
      if (requestError) {
        await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: requestError.message }] }).eq('id', run.id);
        return NextResponse.json({ ok: false, error: requestError.message }, { status: 500 });
      }
    }
  }

  const summary = {
    apply,
    result_type: resultType,
    action: decision.action,
    blocked_reason: decision.blockedReason || null,
    job_id: job.id,
    change_request_id: job.change_request_id || null,
    external_mutation_result_id: job.external_mutation_result_id || null,
    external_resource_id: body.external_resource_id || null,
    confirmation_only: true,
    external_api_write: false,
    note: 'This route records an already-returned platform result. It does not call Naver, Google, Meta, or Kakao.',
  };
  await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'completed', finished_at: new Date().toISOString(), summary }).eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, decision });
});
