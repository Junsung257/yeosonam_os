import { classifyBlogQueueFailure } from './blog-queue-failure-policy';

export type BlogQueueOperationalAction =
  | 'publish_ready'
  | 'recover_stale_generating'
  | 'retry_failed'
  | 'collect_product_evidence'
  | 'editorial_backlog'
  | 'hidden_terminal'
  | 'history';

export interface BlogQueueOperationalRow {
  status?: string | null;
  attempts?: number | null;
  last_error?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  target_publish_at?: string | null;
  meta?: unknown;
}

export interface BlogQueueOperationalState {
  issue: string;
  attention: boolean;
  manualReview: boolean;
  history: boolean;
  retryable: boolean;
  terminal: boolean;
  action: BlogQueueOperationalAction;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const STALE_GENERATING_MS = 30 * 60 * 1000;
const QUEUED_OVERDUE_GRACE_MS = 24 * 60 * 60 * 1000;
const HISTORY_FAILED_MS = 14 * 24 * 60 * 60 * 1000;
const NON_RETRYABLE_OPERATIONAL_ISSUES = new Set([
  'duplicate_content',
  'context_missing',
  'product_open_contract',
  'evidence_insufficient',
  'topic_fit',
  'linked_draft_invalid',
]);

function readMeta(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? meta as Record<string, unknown>
    : {};
}

function storedFailureCode(meta: Record<string, unknown>): string | null {
  const raw = typeof meta.failure_code === 'string' ? meta.failure_code.trim() : '';
  return raw && raw !== 'unknown' ? raw : null;
}

export function classifyBlogQueueOperationalIssue(row: BlogQueueOperationalRow): string {
  const meta = readMeta(row.meta);
  const stored = storedFailureCode(meta);
  const text = [stored, meta.quarantine_reason, row.last_error].filter(Boolean).join(' ');
  const decision = classifyBlogQueueFailure(text);
  if (decision.code !== 'unknown') return decision.code;

  const lower = String(row.last_error || '').toLowerCase();
  if (!lower) return row.status === 'failed' ? 'unknown_failure' : 'none';
  if (lower.includes('self-heal') || lower.includes('self_heal')) return 'self_heal_blocked';
  if (lower.includes('timeout')) return 'timeout';
  if (lower.includes('image')) return 'image_quality';
  if (lower.includes('constraint')) return 'schema_constraint';
  return 'other';
}

export function getBlogQueueOperationalState(
  row: BlogQueueOperationalRow,
  now = new Date(),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): BlogQueueOperationalState {
  const status = String(row.status || '');
  const meta = readMeta(row.meta);
  const issue = classifyBlogQueueOperationalIssue(row);
  const attempts = Number(row.attempts || 0);
  const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
  const createdAt = row.created_at ? new Date(row.created_at) : null;
  const targetAt = row.target_publish_at ? new Date(row.target_publish_at) : null;
  const decision = classifyBlogQueueFailure(row.last_error || issue);
  const nonRetryableIssue = NON_RETRYABLE_OPERATIONAL_ISSUES.has(issue);
  const hasQuarantine =
    meta.self_heal_blocked === true ||
    Boolean(meta.self_heal_closed_at) ||
    typeof meta.quarantine_reason === 'string';

  if (['published', 'skipped', 'deferred'].includes(status)) {
    return {
      issue,
      attention: false,
      manualReview: false,
      history: true,
      retryable: false,
      terminal: true,
      action: 'history',
    };
  }

  if (status === 'queued') {
    const overdue = Boolean(targetAt && now.getTime() - targetAt.getTime() > QUEUED_OVERDUE_GRACE_MS);
    const oldQueued = createdAt
      ? now.getTime() - createdAt.getTime() > HISTORY_FAILED_MS && !overdue
      : false;
    return {
      issue,
      attention: overdue,
      manualReview: false,
      history: oldQueued,
      retryable: false,
      terminal: false,
      action: 'publish_ready',
    };
  }

  if (status === 'generating') {
    const basis = updatedAt ?? createdAt;
    const stale = !basis || now.getTime() - basis.getTime() > STALE_GENERATING_MS;
    return {
      issue,
      attention: stale,
      manualReview: false,
      history: false,
      retryable: stale,
      terminal: false,
      action: stale ? 'recover_stale_generating' : 'publish_ready',
    };
  }

  if (status === 'failed') {
    const retryable = !nonRetryableIssue && decision.retryable && !hasQuarantine && attempts < maxAttempts;
    const productEvidence =
      issue === 'product_open_contract' ||
      issue === 'evidence_insufficient' ||
      meta.quarantine_reason === 'product_open_contract';
    const terminal = hasQuarantine || !retryable || attempts >= maxAttempts;
    const oldFailure = updatedAt ? now.getTime() - updatedAt.getTime() > HISTORY_FAILED_MS : false;
    const action: BlogQueueOperationalAction = retryable
      ? 'retry_failed'
      : productEvidence
        ? 'collect_product_evidence'
        : hasQuarantine
          ? 'editorial_backlog'
          : 'hidden_terminal';

    return {
      issue,
      attention: retryable,
      manualReview: terminal,
      history: oldFailure && terminal,
      retryable,
      terminal,
      action,
    };
  }

  return {
    issue,
    attention: false,
    manualReview: false,
    history: true,
    retryable: false,
    terminal: true,
    action: 'history',
  };
}

export function summarizeBlogQueueOperationalHealth(rows: BlogQueueOperationalRow[], now = new Date()) {
  const issueCounts: Record<string, number> = {};
  const actionCounts: Record<string, number> = {};
  let actionableFailed = 0;
  let manualReview = 0;
  let staleGenerating = 0;
  let overdueQueued = 0;
  let hiddenHistory = 0;

  for (const row of rows) {
    const state = getBlogQueueOperationalState(row, now);
    issueCounts[state.issue] = (issueCounts[state.issue] || 0) + 1;
    actionCounts[state.action] = (actionCounts[state.action] || 0) + 1;
    if (row.status === 'failed' && state.retryable) actionableFailed += 1;
    if (state.manualReview) manualReview += 1;
    if (state.action === 'recover_stale_generating') staleGenerating += 1;
    if (row.status === 'queued' && state.attention) overdueQueued += 1;
    if (state.history) hiddenHistory += 1;
  }

  return {
    actionable_failed_count: actionableFailed,
    manual_review_count: manualReview,
    stale_generating_count: staleGenerating,
    overdue_queued_count: overdueQueued,
    hidden_history_count: hiddenHistory,
    issue_counts: issueCounts,
    action_counts: actionCounts,
  };
}
