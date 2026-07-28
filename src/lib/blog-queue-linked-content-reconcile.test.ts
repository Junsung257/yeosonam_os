import { describe, expect, it } from 'vitest';

import { inspectBlogQueueLinkedContentState } from './blog-queue-linked-content-reconcile';

describe('blog queue linked content reconciliation', () => {
  it('closes queue rows that claim published while the linked post is archived', () => {
    expect(inspectBlogQueueLinkedContentState({
      queueStatus: 'published',
      contentCreativeId: 'creative-1',
      linkedCreativeStatus: 'archived',
    })).toEqual({
      reconcile: true,
      reason: 'linked_creative_not_published:archived',
    });
  });

  it('keeps a genuinely published link unchanged', () => {
    expect(inspectBlogQueueLinkedContentState({
      queueStatus: 'published',
      contentCreativeId: 'creative-1',
      linkedCreativeStatus: 'published',
    })).toEqual({ reconcile: false, reason: null });
  });
});
