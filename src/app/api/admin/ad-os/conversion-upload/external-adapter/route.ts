import { NextRequest, NextResponse } from 'next/server';
import { decideConversionExternalUpload, type ConversionExternalUploadMode } from '@/lib/ad-os-v241-v260';
import { withAdminGuard } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type UploadJob = {
  id: string;
  platform: 'google' | 'meta';
  event_name?: string | null;
  event_time?: string | null;
  idempotency_key?: string | null;
  identifiers?: Record<string, unknown> | null;
  upload_payload?: Record<string, unknown> | null;
};

function envFlagEnabled(name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase());
}

function requestedMode(value: unknown): ConversionExternalUploadMode {
  return value === 'live_upload' ? 'live_upload' : 'dry_run';
}

function metaCredentialsReady() {
  return Boolean(
    (getSecret('META_PIXEL_ID') || getSecret('NEXT_PUBLIC_META_PIXEL_ID')) &&
      (getSecret('META_CAPI_ACCESS_TOKEN') || getSecret('META_ACCESS_TOKEN') || getSecret('META_ADS_ACCESS_TOKEN')),
  );
}

function googleCredentialsReady() {
  return Boolean(
    getSecret('GOOGLE_ADS_DEVELOPER_TOKEN') &&
      getSecret('GOOGLE_ADS_CUSTOMER_ID') &&
      (getSecret('GOOGLE_ADS_ACCESS_TOKEN') || getSecret('GOOGLE_ADS_REFRESH_TOKEN')) &&
      getSecret('GOOGLE_ADS_CONVERSION_ACTION_ID'),
  );
}

function mergeResponse(base: Record<string, unknown> | null | undefined, extra: Record<string, unknown>) {
  return {
    ...(base || {}),
    ...extra,
    executor_version: 'v241_v260',
  };
}

function seconds(value?: string | null): number {
  const time = value ? new Date(value).getTime() : Date.now();
  return Math.floor((Number.isFinite(time) ? time : Date.now()) / 1000);
}

function metaEventPayload(job: UploadJob) {
  const payload = job.upload_payload || {};
  const identifiers = job.identifiers || {};
  const userData: Record<string, unknown> = {};
  const customData: Record<string, unknown> = {
    currency: payload.currency || 'KRW',
  };

  for (const [key, value] of Object.entries(identifiers)) {
    if (value === undefined || value === null || value === '') continue;
    if (key === 'hashed_email' || key === 'em') userData.em = Array.isArray(value) ? value : [value];
    else if (key === 'hashed_phone' || key === 'ph') userData.ph = Array.isArray(value) ? value : [value];
    else if (['fbp', 'fbc', 'client_ip_address', 'client_user_agent'].includes(key)) userData[key] = value;
  }

  if (typeof payload.value_krw === 'number') customData.value = payload.value_krw;
  if (typeof payload.value === 'number') customData.value = payload.value;
  if (payload.content_name) customData.content_name = payload.content_name;
  if (payload.content_ids) customData.content_ids = payload.content_ids;

  return {
    data: [
      {
        event_name: job.event_name || payload.event_name || 'Purchase',
        event_time: seconds(job.event_time),
        event_id: String(payload.event_id || job.idempotency_key || job.id),
        action_source: payload.action_source || 'website',
        event_source_url: payload.event_source_url || undefined,
        user_data: userData,
        custom_data: customData,
      },
    ],
    ...(getSecret('META_TEST_EVENT_CODE') ? { test_event_code: getSecret('META_TEST_EVENT_CODE') } : {}),
  };
}

async function uploadMeta(job: UploadJob) {
  const pixelId = getSecret('META_PIXEL_ID') || getSecret('NEXT_PUBLIC_META_PIXEL_ID');
  const accessToken = getSecret('META_CAPI_ACCESS_TOKEN') || getSecret('META_ACCESS_TOKEN') || getSecret('META_ADS_ACCESS_TOKEN');
  if (!pixelId || !accessToken) return { ok: false, error: 'meta_capi_credentials_missing', response: null, external_upload_id: null };

  const version = getSecret('META_GRAPH_API_VERSION') || 'v23.0';
  const response = await fetch(`https://graph.facebook.com/${version}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metaEventPayload(job)),
  });
  const body = await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }));
  const eventId = String((job.upload_payload || {}).event_id || job.idempotency_key || job.id);
  return {
    ok: response.ok,
    error: response.ok ? null : `meta_capi_http_${response.status}`,
    response: body,
    external_upload_id: response.ok ? `meta:${pixelId}:${eventId}` : null,
  };
}

async function uploadGoogle(job: UploadJob) {
  const developerToken = getSecret('GOOGLE_ADS_DEVELOPER_TOKEN');
  const customerId = getSecret('GOOGLE_ADS_CUSTOMER_ID')?.replace(/-/g, '');
  const accessToken = getSecret('GOOGLE_ADS_ACCESS_TOKEN');
  const conversionActionId = getSecret('GOOGLE_ADS_CONVERSION_ACTION_ID');
  if (!developerToken || !customerId || !accessToken || !conversionActionId) {
    return { ok: false, error: 'google_offline_conversion_credentials_missing', response: null, external_upload_id: null };
  }

  const identifiers = job.identifiers || {};
  const payload = job.upload_payload || {};
  const gclid = String(identifiers.gclid || payload.gclid || '');
  const gbraid = String(identifiers.gbraid || payload.gbraid || '');
  const wbraid = String(identifiers.wbraid || payload.wbraid || '');
  const clickIdPayload = gclid ? { gclid } : gbraid ? { gbraid } : wbraid ? { wbraid } : {};
  const conversion = {
    ...clickIdPayload,
    conversionAction: `customers/${customerId}/conversionActions/${conversionActionId}`,
    conversionDateTime: String(payload.conversion_date_time || job.event_time || new Date().toISOString()).replace('Z', '+00:00'),
    conversionValue: Number(payload.value || payload.value_krw || 0),
    currencyCode: String(payload.currency || 'KRW'),
    orderId: String(payload.order_id || payload.event_id || job.idempotency_key || job.id),
  };
  const response = await fetch(`https://googleads.googleapis.com/${getSecret('GOOGLE_ADS_API_VERSION') || 'v22'}/customers/${customerId}:uploadClickConversions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ conversions: [conversion], partialFailure: true }),
  });
  const body = await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }));
  return {
    ok: response.ok,
    error: response.ok ? null : `google_upload_http_${response.status}`,
    response: body,
    external_upload_id: response.ok ? `google:${customerId}:${conversion.orderId}` : null,
  };
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = requestedMode(body.requested_mode);
  const apply = body.apply === true;
  const confirmExternalUpload = body.confirm_external_upload === true;
  const platform = ['google', 'meta'].includes(String(body.platform)) ? String(body.platform) : null;
  const limit = Math.min(Math.max(Number(body.limit || 25), 1), 100);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'conversion_upload_execute',
      mode: mode === 'live_upload' && apply ? 'guarded' : 'dry_run',
      platform,
      status: 'running',
      summary: {
        requested_mode: mode,
        apply,
        confirm_external_upload: confirmExternalUpload,
        external_api_write: false,
        executor: 'conversion_external_adapter_v241_v260',
      },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  try {
    let query = supabaseAdmin
      .from('ad_os_conversion_upload_jobs')
      .select('*')
      .in('status', ['approved', 'running'])
      .order('created_at', { ascending: true })
      .limit(limit);
    if (platform) query = query.eq('platform', platform);
    if (body.conversion_upload_job_id) query = query.eq('id', body.conversion_upload_job_id);

    const { data: jobs, error: jobError } = await query;
    if (jobError) throw jobError;

    const results = [];
    let externalWrites = 0;
    let succeeded = 0;
    let failed = 0;
    let blocked = 0;

    for (const job of jobs || []) {
      const jobPlatform = String((job as UploadJob).platform) as 'google' | 'meta';
      const credentialsReady = jobPlatform === 'meta' ? metaCredentialsReady() : googleCredentialsReady();
      const platformFlag = jobPlatform === 'meta'
        ? envFlagEnabled('AD_OS_META_CAPI_UPLOAD_ENABLED')
        : envFlagEnabled('AD_OS_GOOGLE_CONVERSION_UPLOAD_ENABLED');
      const decision = decideConversionExternalUpload({
        job: job as never,
        requestedMode: mode,
        apply,
        confirmExternalUpload,
        globalEnvEnabled: envFlagEnabled('AD_OS_CONVERSION_UPLOAD_ENABLED'),
        platformEnvEnabled: platformFlag,
        credentialsReady,
        runId: run.id,
      });

      let attempt = decision.attempt;
      let jobPatch: Record<string, unknown> | null = null;
      let externalResult: Record<string, unknown> | null = null;

      if (decision.willCallExternalApi) {
        const uploaded = jobPlatform === 'meta' ? await uploadMeta(job as UploadJob) : await uploadGoogle(job as UploadJob);
        externalResult = uploaded;
        externalWrites += 1;
        attempt = {
          ...attempt,
          status: uploaded.ok ? 'succeeded' : 'failed',
          dry_run: false,
          external_api_write: true,
          response_payload: mergeResponse(attempt.response_payload, {
            external_api_write: true,
            external_result: uploaded,
            external_upload_id: uploaded.external_upload_id,
            next_confirmation_route: '/api/admin/ad-os/external-results/confirm',
          }),
          blocked_reason: uploaded.ok ? null : uploaded.error || 'conversion_upload_failed',
          retryable: !uploaded.ok,
        };
        jobPatch = {
          status: uploaded.ok ? 'running' : 'failed',
          response_payload: mergeResponse((job as any).response_payload, {
            external_api_write: true,
            external_result: uploaded,
            external_upload_id_pending_confirmation: uploaded.external_upload_id,
            next_confirmation_route: '/api/admin/ad-os/external-results/confirm',
          }),
          blocked_reason: uploaded.ok ? null : uploaded.error || 'conversion_upload_failed',
          external_upload_id: null,
          uploaded_at: null,
        };
      } else if (decision.allowed) {
        jobPatch = {
          response_payload: mergeResponse((job as any).response_payload, decision.preflightResponse),
          blocked_reason: null,
        };
      } else {
        jobPatch = {
          status: 'blocked',
          response_payload: mergeResponse((job as any).response_payload, decision.preflightResponse),
          blocked_reason: decision.blockers[0] || 'conversion_external_upload_blocked',
        };
      }

      if (apply) {
        const { error: attemptError } = await supabaseAdmin.from('ad_os_execution_attempts').insert(attempt as never);
        if (attemptError) throw attemptError;
        if (jobPatch) {
          const { error: updateError } = await supabaseAdmin.from('ad_os_conversion_upload_jobs').update(jobPatch as never).eq('id', (job as any).id);
          if (updateError) throw updateError;
        }
      }

      if (attempt.status === 'succeeded') succeeded += 1;
      if (attempt.status === 'failed') failed += 1;
      if (attempt.status === 'blocked') blocked += 1;
      results.push({ job_id: (job as any).id, decision, external_result: externalResult });
    }

    const summary = {
      requested_mode: mode,
      apply,
      confirm_external_upload: confirmExternalUpload,
      jobs_checked: jobs?.length || 0,
      succeeded,
      failed,
      blocked,
      external_api_write: externalWrites > 0,
      external_api_write_count: externalWrites,
      note: 'Live Google/Meta conversion uploads require global and platform env flags, credentials, apply=true, and confirm_external_upload=true. Successful uploads stay pending external-results confirmation before jobs become uploaded.',
    };
    await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'completed', finished_at: new Date().toISOString(), summary }).eq('id', run.id);

    return NextResponse.json({ ok: true, run_id: run.id, summary, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'conversion external adapter failed';
    await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message }] }).eq('id', run.id);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});
