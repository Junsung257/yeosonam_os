import { describe, expect, it } from 'vitest';
import { decideOpsQueueAction } from './ad-os-v281-v300';

describe('ad-os-v281-v300 ops queue action guard', () => {
  it('allows row-level executor dry-run only for executor queue sources', () => {
    expect(decideOpsQueueAction({ source: 'platform_job', action: 'executor_dry_run' })).toMatchObject({
      allowed: true,
      targetType: 'platform_job',
      externalApiWrite: false,
    });
    expect(decideOpsQueueAction({ source: 'conversion_upload_job', action: 'executor_dry_run' })).toMatchObject({
      allowed: true,
      targetType: 'conversion_upload_job',
      externalApiWrite: false,
    });
    expect(decideOpsQueueAction({ source: 'platform_job_confirmation', action: 'executor_dry_run' })).toMatchObject({
      allowed: false,
      blockedReason: 'executor_dry_run_requires_executor_queue_row',
      externalApiWrite: false,
    });
  });

  it('allows failure confirmation only for confirmation queue sources', () => {
    expect(decideOpsQueueAction({ source: 'platform_job_confirmation', action: 'confirm_failed' })).toMatchObject({
      allowed: true,
      targetType: 'platform_job',
      resultStatus: 'failed',
      externalApiWrite: false,
    });
    expect(decideOpsQueueAction({ source: 'conversion_upload_confirmation', action: 'confirm_failed' })).toMatchObject({
      allowed: true,
      targetType: 'conversion_upload_job',
      resultStatus: 'failed',
      externalApiWrite: false,
    });
    expect(decideOpsQueueAction({ source: 'platform_job', action: 'confirm_failed' })).toMatchObject({
      allowed: false,
      blockedReason: 'confirm_failed_requires_confirmation_queue_row',
      externalApiWrite: false,
    });
  });

  it('rejects unknown actions and sources without enabling external writes', () => {
    expect(decideOpsQueueAction({ source: 'platform_job', action: 'live_write' })).toMatchObject({
      allowed: false,
      blockedReason: 'invalid_ops_queue_action',
      externalApiWrite: false,
    });
    expect(decideOpsQueueAction({ source: 'unknown', action: 'executor_dry_run' })).toMatchObject({
      allowed: false,
      blockedReason: 'invalid_ops_queue_source',
      externalApiWrite: false,
    });
  });
});
