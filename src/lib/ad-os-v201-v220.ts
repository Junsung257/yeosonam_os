import type { ExecutionAttemptRow } from './ad-os-v61-v75';

type JsonRecord = Record<string, unknown>;

export type ExternalResultStatus = 'succeeded' | 'uploaded' | 'failed';

export type PlatformResultJob = {
  id: string;
  tenant_id?: string | null;
  platform: 'naver' | 'google' | 'meta' | 'kakao';
  job_type: string;
  status: 'planned' | 'approved' | 'running' | 'succeeded' | 'failed' | 'rolled_back' | 'blocked';
  change_request_id?: string | null;
  external_mutation_result_id?: string | null;
  response_payload?: JsonRecord | null;
  external_api_write?: boolean | null;
};

export type ConversionResultJob = {
  id: string;
  tenant_id?: string | null;
  platform: 'google' | 'meta';
  status: 'planned' | 'approved' | 'running' | 'uploaded' | 'failed' | 'blocked';
  response_payload?: JsonRecord | null;
  external_upload_id?: string | null;
};

export type ExternalResultConfirmationInput = {
  resultStatus: ExternalResultStatus;
  confirmExternalResult: boolean;
  externalResourceId?: string | null;
  externalUploadId?: string | null;
  externalResponse?: JsonRecord | null;
  errorMessage?: string | null;
  runId?: string | null;
  now?: string;
};

export type PlatformResultConfirmation = {
  attempt: ExecutionAttemptRow;
  action: 'blocked' | 'confirm_success' | 'confirm_failure';
  jobPatch?: JsonRecord;
  mutationPatch?: JsonRecord;
  changeRequestPatch?: JsonRecord;
  blockedReason?: string;
};

export type ConversionResultConfirmation = {
  attempt: ExecutionAttemptRow;
  action: 'blocked' | 'confirm_success' | 'confirm_failure';
  jobPatch?: JsonRecord;
  blockedReason?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function mergeResponse(base: JsonRecord | null | undefined, extra: JsonRecord): JsonRecord {
  return {
    ...(base || {}),
    ...extra,
    external_result_confirmation_version: 'v201_v220',
  };
}

export function decidePlatformExternalResultConfirmation(
  job: PlatformResultJob,
  input: ExternalResultConfirmationInput,
): PlatformResultConfirmation {
  const now = input.now || nowIso();
  const baseAttempt: ExecutionAttemptRow = {
    tenant_id: job.tenant_id ?? null,
    platform: job.platform,
    job_id: job.id,
    run_id: input.runId ?? null,
    attempt_type: 'platform_job',
    status: 'blocked',
    dry_run: false,
    external_api_write: false,
    request_payload: {
      result_status: input.resultStatus,
      external_resource_id: input.externalResourceId || null,
      external_mutation_result_id: job.external_mutation_result_id || null,
      change_request_id: job.change_request_id || null,
      confirmation_only: true,
    },
    response_payload: input.externalResponse || {},
    blocked_reason: null,
    retryable: false,
    started_at: now,
    finished_at: now,
  };

  const block = (reason: string): PlatformResultConfirmation => ({
    action: 'blocked',
    blockedReason: reason,
    attempt: {
      ...baseAttempt,
      status: 'blocked',
      blocked_reason: reason,
      response_payload: mergeResponse(input.externalResponse, { blocked_reason: reason, confirmation_only: true }),
    },
  });

  if (!input.confirmExternalResult) return block('missing_confirm_external_result');
  if (!['approved', 'running', 'succeeded'].includes(job.status)) return block(`job_status_${job.status}`);
  if (job.external_api_write) return block('unexpected_job_external_api_write_flag');
  if (!job.change_request_id) return block('missing_change_request_id');
  if (!job.external_mutation_result_id) return block('missing_external_mutation_result_id');

  if (input.resultStatus === 'failed') {
    const response = mergeResponse(job.response_payload, {
      external_result_confirmed: true,
      external_result_status: 'failed',
      external_resource_id: input.externalResourceId || null,
      external_response: input.externalResponse || {},
      error_message: input.errorMessage || 'external_result_failed',
      confirmation_only: true,
      external_api_write: false,
    });
    return {
      action: 'confirm_failure',
      attempt: {
        ...baseAttempt,
        status: 'failed',
        response_payload: response,
        blocked_reason: input.errorMessage || 'external_result_failed',
        retryable: true,
      },
      jobPatch: {
        status: 'failed',
        response_payload: response,
        blocked_reason: input.errorMessage || 'external_result_failed',
        finished_at: now,
        external_api_write: false,
      },
      mutationPatch: {
        status: 'failed',
        response_payload: response,
        error_message: input.errorMessage || 'external_result_failed',
      },
    };
  }

  if (input.resultStatus !== 'succeeded') return block(`invalid_platform_result_status_${input.resultStatus}`);
  if (!input.externalResourceId) return block('missing_external_resource_id');

  const response = mergeResponse(job.response_payload, {
    external_result_confirmed: true,
    external_result_status: 'succeeded',
    external_resource_id: input.externalResourceId,
    external_response: input.externalResponse || {},
    confirmation_only: true,
    external_api_write: false,
  });

  return {
    action: 'confirm_success',
    attempt: {
      ...baseAttempt,
      status: 'succeeded',
      response_payload: response,
    },
    jobPatch: {
      status: 'succeeded',
      response_payload: response,
      blocked_reason: null,
      finished_at: now,
      external_api_write: false,
    },
    mutationPatch: {
      status: 'succeeded',
      response_payload: response,
      error_message: null,
    },
    changeRequestPatch: {
      status: 'applied',
      applied_at: now,
    },
  };
}

export function decideConversionExternalResultConfirmation(
  job: ConversionResultJob,
  input: ExternalResultConfirmationInput,
): ConversionResultConfirmation {
  const now = input.now || nowIso();
  const baseAttempt: ExecutionAttemptRow = {
    tenant_id: job.tenant_id ?? null,
    platform: job.platform,
    conversion_upload_job_id: job.id,
    run_id: input.runId ?? null,
    attempt_type: 'conversion_upload',
    status: 'blocked',
    dry_run: false,
    external_api_write: false,
    request_payload: {
      result_status: input.resultStatus,
      external_upload_id: input.externalUploadId || null,
      confirmation_only: true,
    },
    response_payload: input.externalResponse || {},
    blocked_reason: null,
    retryable: false,
    started_at: now,
    finished_at: now,
  };

  const block = (reason: string): ConversionResultConfirmation => ({
    action: 'blocked',
    blockedReason: reason,
    attempt: {
      ...baseAttempt,
      status: 'blocked',
      blocked_reason: reason,
      response_payload: mergeResponse(input.externalResponse, { blocked_reason: reason, confirmation_only: true }),
    },
  });

  if (!input.confirmExternalResult) return block('missing_confirm_external_result');
  if (!['approved', 'running'].includes(job.status)) return block(`upload_job_status_${job.status}`);

  if (input.resultStatus === 'failed') {
    const response = mergeResponse(job.response_payload, {
      external_result_confirmed: true,
      external_result_status: 'failed',
      external_response: input.externalResponse || {},
      error_message: input.errorMessage || 'external_upload_failed',
      confirmation_only: true,
      external_api_write: false,
    });
    return {
      action: 'confirm_failure',
      attempt: {
        ...baseAttempt,
        status: 'failed',
        response_payload: response,
        blocked_reason: input.errorMessage || 'external_upload_failed',
        retryable: true,
      },
      jobPatch: {
        status: 'failed',
        blocked_reason: input.errorMessage || 'external_upload_failed',
        response_payload: response,
        external_upload_id: null,
        uploaded_at: null,
      },
    };
  }

  if (input.resultStatus !== 'uploaded' && input.resultStatus !== 'succeeded') {
    return block(`invalid_conversion_result_status_${input.resultStatus}`);
  }
  if (!input.externalUploadId) return block('missing_external_upload_id');

  const response = mergeResponse(job.response_payload, {
    external_result_confirmed: true,
    external_result_status: 'uploaded',
    external_upload_id: input.externalUploadId,
    external_response: input.externalResponse || {},
    confirmation_only: true,
    external_api_write: false,
  });

  return {
    action: 'confirm_success',
    attempt: {
      ...baseAttempt,
      status: 'succeeded',
      response_payload: response,
    },
    jobPatch: {
      status: 'uploaded',
      blocked_reason: null,
      response_payload: response,
      external_upload_id: input.externalUploadId,
      uploaded_at: now,
    },
  };
}
