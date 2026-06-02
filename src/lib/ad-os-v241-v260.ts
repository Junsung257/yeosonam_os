import type { ConversionUploadRuntimeJob, ExecutionAttemptRow } from './ad-os-v61-v75';

type JsonRecord = Record<string, unknown>;

export type ConversionExternalUploadMode = 'dry_run' | 'live_upload';

export type ConversionExternalUploadInput = {
  job: ConversionUploadRuntimeJob & {
    upload_type?: string | null;
    upload_payload?: JsonRecord | null;
    identifiers?: JsonRecord | null;
  };
  requestedMode?: ConversionExternalUploadMode;
  apply?: boolean;
  confirmExternalUpload?: boolean;
  globalEnvEnabled?: boolean;
  platformEnvEnabled?: boolean;
  credentialsReady?: boolean;
  runId?: string | null;
  now?: Date;
};

export type ConversionExternalUploadDecision = {
  allowed: boolean;
  willCallExternalApi: boolean;
  blockers: string[];
  attempt: ExecutionAttemptRow;
  uploadPayload: JsonRecord;
  preflightResponse: JsonRecord;
};

function nowIso(): string {
  return new Date().toISOString();
}

function daysOld(value?: string | null, now = new Date()): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - time) / 86_400_000);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function hasIdentifier(job: ConversionExternalUploadInput['job']): boolean {
  const identifiers = job.identifiers || {};
  return Object.values(identifiers).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return String(value || '').trim().length > 0;
  });
}

function safePayload(job: ConversionExternalUploadInput['job']): JsonRecord {
  const payload = job.upload_payload || {};
  return {
    ...payload,
    event_name: job.event_name || payload.event_name || 'Purchase',
    event_time: job.event_time || payload.event_time || nowIso(),
    identifiers: job.identifiers || {},
    external_api_write: false,
  };
}

export function decideConversionExternalUpload(input: ConversionExternalUploadInput): ConversionExternalUploadDecision {
  const now = input.now || new Date();
  const nowText = now.toISOString();
  const job = input.job;
  const requestedMode = input.requestedMode || 'dry_run';
  const requestedLive = requestedMode === 'live_upload';
  const blockers: string[] = [];

  if (!['google', 'meta'].includes(job.platform)) blockers.push(`platform_${job.platform}`);
  if (!['approved', 'running'].includes(job.status)) blockers.push(`upload_job_status_${job.status}`);
  if (job.blocked_reason) blockers.push(job.blocked_reason);
  if (job.consent_status !== 'granted') blockers.push('consent_not_granted');
  if (Number(job.signal_quality_score || 0) < 60) blockers.push('signal_quality_below_threshold');
  if (daysOld(job.event_time, now) > 30) blockers.push('event_stale_or_missing');
  if (job.dedupe_status && job.dedupe_status !== 'unique') blockers.push(`dedupe_${job.dedupe_status}`);
  if (!hasIdentifier(job)) blockers.push('identifiers_missing');

  if (requestedLive) {
    if (!input.apply) blockers.push('apply_required_for_live_upload');
    if (!input.confirmExternalUpload) blockers.push('confirm_external_upload_required');
    if (!input.globalEnvEnabled) blockers.push('conversion_upload_env_flag_missing');
    if (!input.platformEnvEnabled) blockers.push(`${job.platform}_upload_env_flag_missing`);
    if (!input.credentialsReady) blockers.push(`${job.platform}_upload_credentials_missing`);
  }

  const blockerList = unique(blockers);
  const allowed = blockerList.length === 0;
  const willCallExternalApi =
    requestedLive &&
    allowed &&
    input.apply === true &&
    input.confirmExternalUpload === true &&
    input.globalEnvEnabled === true &&
    input.platformEnvEnabled === true &&
    input.credentialsReady === true;
  const uploadPayload = safePayload(job);
  const preflightResponse = {
    executor: 'ad_os_v241_v260_conversion_external_upload_adapter',
    requested_mode: requestedMode,
    platform: job.platform,
    preflight_passed: allowed,
    will_call_external_api: willCallExternalApi,
    external_api_write: false,
    blockers: blockerList,
    next_step: willCallExternalApi
      ? 'Call platform conversion API, then use external-results confirmation with the returned upload id.'
      : allowed
        ? 'Dry-run passed. Enable live_upload only with explicit env flags, credentials, apply, and confirmation.'
        : `Resolve ${blockerList[0]} before conversion upload.`,
  };

  return {
    allowed,
    willCallExternalApi,
    blockers: blockerList,
    uploadPayload,
    preflightResponse,
    attempt: {
      tenant_id: job.tenant_id ?? null,
      platform: job.platform,
      conversion_upload_job_id: job.id,
      run_id: input.runId ?? null,
      attempt_type: 'conversion_upload',
      status: allowed ? 'succeeded' : 'blocked',
      dry_run: !willCallExternalApi,
      external_api_write: false,
      request_payload: {
        requested_mode: requestedMode,
        upload_payload: uploadPayload,
        confirm_external_upload: Boolean(input.confirmExternalUpload),
      },
      response_payload: preflightResponse,
      blocked_reason: blockerList[0] || null,
      retryable: blockerList.some((reason) => reason.includes('env_flag') || reason.includes('credentials')),
      started_at: nowText,
      finished_at: nowText,
    },
  };
}
