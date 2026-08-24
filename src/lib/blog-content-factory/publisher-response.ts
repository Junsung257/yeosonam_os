export const BLOG_PUBLISHER_OPERATION_RESULT_STATUSES = [
  'approved_for_slot',
  'pending_review',
  'human_review',
  'quarantined',
  'retryable',
  'failed',
] as const;

export type BlogPublisherOperationResultStatus =
  (typeof BLOG_PUBLISHER_OPERATION_RESULT_STATUSES)[number];

export interface BlogPublisherOperationResponseV4 {
  [key: string]: unknown;
  schemaVersion: 1;
  ok: boolean;
  targetedContentOperation: true;
  operationId: string;
  queueId: string | null;
  resultStatus: BlogPublisherOperationResultStatus;
  generationRunId: string | null;
  creativeId: string | null;
  retryable: boolean;
  reason: string | null;
}

export interface BlogPublisherOperationResultInput {
  status?: unknown;
  reason?: unknown;
  creativeId?: unknown;
  generationRunId?: unknown;
}

const SUCCESS_STATUSES = new Set<BlogPublisherOperationResultStatus>([
  'approved_for_slot',
  'pending_review',
  'human_review',
]);

const RETRYABLE_INTERNAL_STATUSES = new Set([
  'deferred_buffer',
  'deferred_time_budget',
  'retryable',
  'rewrite_queued',
  'upgrade_blocked',
]);

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function normalizeBlogPublisherOperationResultStatus(
  status: unknown,
  reason?: unknown,
): BlogPublisherOperationResultStatus {
  const value = typeof status === 'string' ? status : '';
  if (BLOG_PUBLISHER_OPERATION_RESULT_STATUSES.includes(value as BlogPublisherOperationResultStatus)) {
    return value as BlogPublisherOperationResultStatus;
  }
  if (RETRYABLE_INTERNAL_STATUSES.has(value) || stringOrNull(reason)?.startsWith('retryable:')) {
    return 'retryable';
  }
  if (value === 'quarantined' || value.endsWith('quarantine')) return 'quarantined';
  return 'failed';
}

export function buildBlogPublisherOperationResponseV4(input: {
  operationId: string;
  queueId?: string | null;
  result?: BlogPublisherOperationResultInput | null;
  resultStatus?: unknown;
  reason?: unknown;
  generationRunId?: string | null;
  creativeId?: string | null;
}): BlogPublisherOperationResponseV4 {
  const reason = stringOrNull(input.reason ?? input.result?.reason);
  const resultStatus = normalizeBlogPublisherOperationResultStatus(
    input.resultStatus ?? input.result?.status,
    reason,
  );
  const retryable = resultStatus === 'retryable';
  const ok = SUCCESS_STATUSES.has(resultStatus);

  return {
    schemaVersion: 1,
    ok,
    targetedContentOperation: true,
    operationId: input.operationId,
    queueId: input.queueId ?? null,
    resultStatus,
    generationRunId: input.generationRunId ?? stringOrNull(input.result?.generationRunId),
    creativeId: input.creativeId ?? stringOrNull(input.result?.creativeId),
    retryable,
    reason,
  };
}

export function isBlogPublisherOperationResponseV4(
  value: unknown,
  expectedOperationId?: string,
): value is BlogPublisherOperationResponseV4 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Partial<BlogPublisherOperationResponseV4>;
  return payload.schemaVersion === 1
    && payload.ok === (SUCCESS_STATUSES.has(payload.resultStatus as BlogPublisherOperationResultStatus))
    && payload.targetedContentOperation === true
    && typeof payload.operationId === 'string'
    && (!expectedOperationId || payload.operationId === expectedOperationId)
    && (payload.queueId === null || typeof payload.queueId === 'string')
    && BLOG_PUBLISHER_OPERATION_RESULT_STATUSES.includes(payload.resultStatus as BlogPublisherOperationResultStatus)
    && (payload.generationRunId === null || typeof payload.generationRunId === 'string')
    && (payload.creativeId === null || typeof payload.creativeId === 'string')
    && payload.retryable === (payload.resultStatus === 'retryable')
    && (payload.reason === null || typeof payload.reason === 'string');
}
