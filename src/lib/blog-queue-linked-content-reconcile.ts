export type BlogQueueLinkedContentDecision = {
  reconcile: boolean;
  reason: string | null;
};

export function inspectBlogQueueLinkedContentState(input: {
  queueStatus: string | null | undefined;
  contentCreativeId: string | null | undefined;
  linkedCreativeStatus: string | null | undefined;
}): BlogQueueLinkedContentDecision {
  if (input.queueStatus !== 'published') return { reconcile: false, reason: null };
  if (!input.contentCreativeId) {
    return { reconcile: true, reason: 'linked_creative_missing' };
  }
  if (input.linkedCreativeStatus !== 'published') {
    return {
      reconcile: true,
      reason: `linked_creative_not_published:${input.linkedCreativeStatus || 'missing'}`,
    };
  }
  return { reconcile: false, reason: null };
}
