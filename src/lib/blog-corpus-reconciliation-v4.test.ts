import { describe, expect, it } from 'vitest';
import {
  classifyFailedBlogQueueV4,
  planReviewBlockedDispositionV4,
  reconcilePublishedQueueV4,
} from './blog-corpus-reconciliation-v4';

describe('blog corpus reconciliation v4', () => {
  it('retries only classified transient failures below the attempt limit', () => {
    const decision = classifyFailedBlogQueueV4({
      id: 'q1', attempts: 1, lastError: 'provider_unavailable: 503', updatedAt: null, contentCreativeId: null,
    }, new Date('2026-08-16T00:00:00Z'));
    expect(decision).toMatchObject({ action: 'retry_transient', retryAfter: '2026-08-16T00:30:00.000Z' });
  });

  it('archives terminal quality failures and exhausted attempts instead of looping', () => {
    expect(classifyFailedBlogQueueV4({
      id: 'q2', attempts: 1, lastError: 'unsupported_claim', updatedAt: null, contentCreativeId: null,
    }).action).toBe('archive_terminal');
    expect(classifyFailedBlogQueueV4({
      id: 'q3', attempts: 3, lastError: 'timeout', updatedAt: null, contentCreativeId: null,
    }).action).toBe('archive_terminal');
  });

  it('never invents a retry classification without failure evidence', () => {
    expect(classifyFailedBlogQueueV4({
      id: 'q4', attempts: 0, lastError: null, updatedAt: null, contentCreativeId: null,
    })).toMatchObject({ action: 'manual_review', reason: 'missing_failure_evidence' });
  });

  it('uses a redirect only when a canonical replacement is explicit', () => {
    expect(planReviewBlockedDispositionV4({
      creativeId: 'c1', slug: 'old', reviewStatus: 'changes_requested', canonicalTarget: '/blog/new', existingAction: null,
    })).toMatchObject({ action: 'REDIRECT', httpStatus: 301, canonicalTarget: '/blog/new' });
    expect(planReviewBlockedDispositionV4({
      creativeId: 'c2', slug: 'unsafe', reviewStatus: 'rejected', canonicalTarget: null, existingAction: null,
    })).toMatchObject({ action: 'QUARANTINE', httpStatus: 410, canonicalTarget: null });
  });

  it('detects queue rows that claim publication without a published creative', () => {
    expect(reconcilePublishedQueueV4([
      { queueId: 'ok', queueStatus: 'published', creativeId: 'c1', creativeStatus: 'published' },
      { queueId: 'missing', queueStatus: 'published', creativeId: null, creativeStatus: null },
      { queueId: 'draft', queueStatus: 'published', creativeId: 'c2', creativeStatus: 'draft' },
    ])).toEqual([
      { queueId: 'missing', issue: 'published_queue_missing_creative' },
      { queueId: 'draft', issue: 'published_queue_creative_status_draft' },
    ]);
  });
});
