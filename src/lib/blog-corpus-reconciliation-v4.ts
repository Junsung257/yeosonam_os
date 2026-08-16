export type BlogFailedQueueActionV4 = 'retry_transient' | 'archive_terminal' | 'manual_review';

export interface BlogFailedQueueRowV4 {
  id: string;
  attempts: number | null;
  lastError: string | null;
  updatedAt: string | null;
  contentCreativeId: string | null;
}

export interface BlogFailedQueueDecisionV4 extends BlogFailedQueueRowV4 {
  action: BlogFailedQueueActionV4;
  reason: string;
  retryAfter: string | null;
}

export interface BlogReviewBlockedRowV4 {
  creativeId: string;
  slug: string;
  reviewStatus: string;
  canonicalTarget: string | null;
  existingAction: string | null;
}

export interface BlogReviewBlockedDispositionV4 {
  creativeId: string;
  slug: string;
  action: 'REDIRECT' | 'QUARANTINE';
  canonicalTarget: string | null;
  httpStatus: 301 | 410 | null;
  reason: string;
  alreadyRecorded: boolean;
}

const TRANSIENT_FAILURE = /(?:timeout|timed out|rate.?limit|429|5\d\d|econn|network|fetch failed|database|temporar|provider_unavailable|budget_reservation_unavailable)/i;
const TERMINAL_FAILURE = /(?:duplicate|cannibali|missing[_ ]demand|unsupported[_ ](?:number|claim)|claim_conflict|quality_quarantine|fake_experience|malformed_korean|invalid_destination|deterministic_fallback)/i;

export function classifyFailedBlogQueueV4(
  row: BlogFailedQueueRowV4,
  now = new Date(),
): BlogFailedQueueDecisionV4 {
  const attempts = Math.max(0, row.attempts ?? 0);
  const error = String(row.lastError ?? '').trim();
  if (TERMINAL_FAILURE.test(error) || attempts >= 3) {
    return {
      ...row,
      action: 'archive_terminal',
      reason: TERMINAL_FAILURE.test(error) ? 'terminal_quality_or_policy_failure' : 'attempt_limit_exhausted',
      retryAfter: null,
    };
  }
  if (TRANSIENT_FAILURE.test(error)) {
    const delayMinutes = Math.min(360, 15 * (2 ** attempts));
    return {
      ...row,
      action: 'retry_transient',
      reason: 'transient_infrastructure_or_provider_failure',
      retryAfter: new Date(now.getTime() + delayMinutes * 60_000).toISOString(),
    };
  }
  return {
    ...row,
    action: 'manual_review',
    reason: error ? 'unclassified_failure' : 'missing_failure_evidence',
    retryAfter: null,
  };
}

export function planReviewBlockedDispositionV4(
  row: BlogReviewBlockedRowV4,
): BlogReviewBlockedDispositionV4 {
  const hasCanonical = Boolean(row.canonicalTarget?.trim());
  const plannedAction = hasCanonical ? 'REDIRECT' : 'QUARANTINE';
  return {
    creativeId: row.creativeId,
    slug: row.slug,
    action: plannedAction,
    canonicalTarget: hasCanonical ? row.canonicalTarget!.trim() : null,
    httpStatus: hasCanonical ? 301 : 410,
    reason: hasCanonical
      ? `review_blocked_${row.reviewStatus}_with_replacement`
      : `review_blocked_${row.reviewStatus}_without_replacement`,
    alreadyRecorded: row.existingAction === plannedAction,
  };
}

export function reconcilePublishedQueueV4(rows: Array<{
  queueId: string;
  queueStatus: string;
  creativeId: string | null;
  creativeStatus: string | null;
}>): Array<{ queueId: string; issue: string }> {
  return rows.flatMap((row) => {
    if (row.queueStatus !== 'published') return [];
    if (!row.creativeId) return [{ queueId: row.queueId, issue: 'published_queue_missing_creative' }];
    if (row.creativeStatus !== 'published') {
      return [{ queueId: row.queueId, issue: `published_queue_creative_status_${row.creativeStatus ?? 'missing'}` }];
    }
    return [];
  });
}
