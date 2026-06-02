import { describe, expect, it } from 'vitest';
import {
  decideConversionExternalResultConfirmation,
  decidePlatformExternalResultConfirmation,
} from './ad-os-v201-v220';

describe('ad-os-v201-v220 external result confirmation', () => {
  it('applies a platform change request only after confirmed external success', () => {
    const decision = decidePlatformExternalResultConfirmation({
      id: 'job-1',
      tenant_id: null,
      platform: 'naver',
      job_type: 'create_paused_keyword',
      status: 'approved',
      change_request_id: 'change-1',
      external_mutation_result_id: 'mutation-1',
      external_api_write: false,
    }, {
      resultStatus: 'succeeded',
      confirmExternalResult: true,
      externalResourceId: 'naver-keyword-1',
      externalResponse: { platform_status: 'ok' },
      now: '2026-06-03T00:00:00.000Z',
    });

    expect(decision.action).toBe('confirm_success');
    expect(decision.attempt).toMatchObject({ status: 'succeeded', external_api_write: false, dry_run: false });
    expect(decision.jobPatch).toMatchObject({ status: 'succeeded', external_api_write: false });
    expect(decision.mutationPatch).toMatchObject({ status: 'succeeded' });
    expect(decision.changeRequestPatch).toEqual({ status: 'applied', applied_at: '2026-06-03T00:00:00.000Z' });
  });

  it('keeps platform confirmation blocked without explicit confirmation or external id', () => {
    const missingConfirm = decidePlatformExternalResultConfirmation({
      id: 'job-2',
      platform: 'naver',
      job_type: 'create_paused_keyword',
      status: 'approved',
      change_request_id: 'change-2',
      external_mutation_result_id: 'mutation-2',
      external_api_write: false,
    }, {
      resultStatus: 'succeeded',
      confirmExternalResult: false,
      externalResourceId: 'naver-keyword-2',
    });
    const missingExternalId = decidePlatformExternalResultConfirmation({
      id: 'job-3',
      platform: 'naver',
      job_type: 'create_paused_keyword',
      status: 'approved',
      change_request_id: 'change-3',
      external_mutation_result_id: 'mutation-3',
      external_api_write: false,
    }, {
      resultStatus: 'succeeded',
      confirmExternalResult: true,
    });

    expect(missingConfirm.action).toBe('blocked');
    expect(missingConfirm.blockedReason).toBe('missing_confirm_external_result');
    expect(missingExternalId.action).toBe('blocked');
    expect(missingExternalId.blockedReason).toBe('missing_external_resource_id');
  });

  it('records platform failures without applying the change request', () => {
    const decision = decidePlatformExternalResultConfirmation({
      id: 'job-4',
      platform: 'naver',
      job_type: 'create_paused_keyword',
      status: 'running',
      change_request_id: 'change-4',
      external_mutation_result_id: 'mutation-4',
      external_api_write: false,
    }, {
      resultStatus: 'failed',
      confirmExternalResult: true,
      errorMessage: 'platform rejected keyword',
      now: '2026-06-03T00:00:00.000Z',
    });

    expect(decision.action).toBe('confirm_failure');
    expect(decision.jobPatch).toMatchObject({ status: 'failed', blocked_reason: 'platform rejected keyword' });
    expect(decision.mutationPatch).toMatchObject({ status: 'failed', error_message: 'platform rejected keyword' });
    expect(decision.changeRequestPatch).toBeUndefined();
  });

  it('marks conversion jobs uploaded only with a confirmed external upload id', () => {
    const decision = decideConversionExternalResultConfirmation({
      id: 'upload-1',
      platform: 'google',
      status: 'approved',
    }, {
      resultStatus: 'uploaded',
      confirmExternalResult: true,
      externalUploadId: 'google-upload-1',
      externalResponse: { accepted: 1 },
      now: '2026-06-03T00:00:00.000Z',
    });

    expect(decision.action).toBe('confirm_success');
    expect(decision.attempt).toMatchObject({ status: 'succeeded', external_api_write: false, dry_run: false });
    expect(decision.jobPatch).toMatchObject({
      status: 'uploaded',
      external_upload_id: 'google-upload-1',
      uploaded_at: '2026-06-03T00:00:00.000Z',
    });
  });

  it('blocks conversion upload confirmation without an external upload id', () => {
    const decision = decideConversionExternalResultConfirmation({
      id: 'upload-2',
      platform: 'meta',
      status: 'approved',
    }, {
      resultStatus: 'uploaded',
      confirmExternalResult: true,
    });

    expect(decision.action).toBe('blocked');
    expect(decision.blockedReason).toBe('missing_external_upload_id');
    expect(decision.jobPatch).toBeUndefined();
  });
});
