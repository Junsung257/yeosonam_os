import { readBlogEditorialBacklogDedupKey } from './blog-editorial-backlog-recheck';

export type BlogDuplicateCleanupRow = {
  id?: string | null;
  product_id?: string | null;
  topic?: string | null;
  destination?: string | null;
  status?: string | null;
  source?: string | null;
  angle_type?: string | null;
  slug?: string | null;
  slug_hint?: string | null;
  meta?: unknown;
  generation_meta?: unknown;
};

export type BlogDuplicateCleanupAction = {
  id: string;
  duplicate_key: string;
  duplicate_keep_id: string | null;
  reason: 'recent_published_duplicate' | 'queued_duplicate';
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isBlockedCandidate(row: BlogDuplicateCleanupRow): boolean {
  const meta = asRecord(row.meta);
  const generationMeta = asRecord(row.generation_meta);
  return meta.evidence_insufficient === true ||
    meta.failure_code === 'evidence_insufficient' ||
    meta.failure_code === 'product_open_contract' ||
    meta.quarantine_reason === 'product_open_contract' ||
    generationMeta.failure_bucket === 'evidence_insufficient' ||
    generationMeta.failure_bucket === 'product_open_contract';
}

export function planBlogPublishableDuplicateCleanup(input: {
  activeRows: BlogDuplicateCleanupRow[];
  recentPublishedRows?: BlogDuplicateCleanupRow[];
}): BlogDuplicateCleanupAction[] {
  const recentKeys = new Map<string, string | null>();
  for (const row of input.recentPublishedRows ?? []) {
    const key = readBlogEditorialBacklogDedupKey(row);
    if (key && !recentKeys.has(key)) recentKeys.set(key, row.id ?? null);
  }

  const seen = new Map<string, string | null>();
  const actions: BlogDuplicateCleanupAction[] = [];
  for (const row of input.activeRows) {
    if (!row.id || row.source === 'pillar' || isBlockedCandidate(row)) continue;
    const key = readBlogEditorialBacklogDedupKey(row);
    if (!key) continue;
    const recentPublishedId = recentKeys.get(key);
    if (recentKeys.has(key)) {
      actions.push({
        id: row.id,
        duplicate_key: key,
        duplicate_keep_id: recentPublishedId ?? null,
        reason: 'recent_published_duplicate',
      });
      continue;
    }
    const queuedKeepId = seen.get(key);
    if (seen.has(key)) {
      actions.push({
        id: row.id,
        duplicate_key: key,
        duplicate_keep_id: queuedKeepId ?? null,
        reason: 'queued_duplicate',
      });
      continue;
    }
    seen.set(key, row.id);
  }
  return actions;
}

export function buildBlogPublishableDuplicateMeta(input: {
  meta?: unknown;
  duplicateKey: string;
  duplicateKeepId?: string | null;
  reason: BlogDuplicateCleanupAction['reason'];
  checkedAt?: string;
}): Record<string, unknown> {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  return {
    ...asRecord(input.meta),
    self_heal_blocked: true,
    quarantine_reason: 'duplicate_preclaim',
    duplicate_key: input.duplicateKey,
    duplicate_keep_id: input.duplicateKeepId ?? null,
    duplicate_reason: input.reason,
    quarantined_by: 'blog-publishable-duplicate-cleanup',
    quarantined_at: checkedAt,
  };
}
