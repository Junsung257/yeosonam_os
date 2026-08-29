import { describe, expect, it } from 'vitest';

import {
  buildBlogPublisherOperationResponseV4,
  isBlogPublisherOperationResponseV4,
} from './publisher-response';

describe('Blog V4 targeted publisher response contract', () => {
  it('returns a stable success contract without a nullable result status', () => {
    const response = buildBlogPublisherOperationResponseV4({
      operationId: 'operation-1',
      queueId: 'queue-1',
      result: { status: 'pending_review', reason: 'human_review_required', creativeId: 'creative-1' },
    });

    expect(response).toEqual({
      schemaVersion: 1,
      ok: true,
      targetedContentOperation: true,
      operationId: 'operation-1',
      queueId: 'queue-1',
      resultStatus: 'pending_review',
      generationRunId: null,
      creativeId: 'creative-1',
      retryable: false,
      reason: 'human_review_required',
    });
    expect(isBlogPublisherOperationResponseV4(response, 'operation-1')).toBe(true);
  });

  it('makes resource-saver and transient outcomes explicitly retryable', () => {
    const response = buildBlogPublisherOperationResponseV4({
      operationId: 'operation-1',
      reason: 'db_resource_saver_mode',
      resultStatus: 'retryable',
    });

    expect(response.ok).toBe(false);
    expect(response.resultStatus).toBe('retryable');
    expect(response.retryable).toBe(true);
    expect(isBlogPublisherOperationResponseV4(response, 'operation-1')).toBe(true);
  });

  it('rejects legacy batch payloads and mismatched operation ids', () => {
    expect(isBlogPublisherOperationResponseV4({ ok: true, results: [{ status: 'pending_review' }] })).toBe(false);
    expect(isBlogPublisherOperationResponseV4(
      buildBlogPublisherOperationResponseV4({ operationId: 'operation-1', resultStatus: 'failed' }),
      'operation-2',
    )).toBe(false);
  });
});
