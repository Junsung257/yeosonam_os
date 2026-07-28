import { readBlogEditorialBacklogDedupKey } from './blog-editorial-backlog-recheck';
import { PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE } from './blog-private-regeneration';

export type BlogDuplicateCleanupRow = {
  id?: string | null;
  product_id?: string | null;
  topic?: string | null;
  destination?: string | null;
  status?: string | null;
  source?: string | null;
  angle_type?: string | null;
  content_creative_id?: string | null;
  priority?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
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

export function isPublishedBlogQualityUpgradeCandidate(row: BlogDuplicateCleanupRow): boolean {
  const meta = asRecord(row.meta);
  const privateRegeneration = asRecord(meta.private_regeneration);
  return typeof row.content_creative_id === 'string'
    && row.content_creative_id.trim().length > 0
    && privateRegeneration.mode === PUBLISHED_BLOG_ATOMIC_UPGRADE_MODE
    && privateRegeneration.atomic_publish_replace === true;
}

function candidatePreference(row: BlogDuplicateCleanupRow): [number, number, number] {
  const createdAt = typeof row.created_at === 'string' ? Date.parse(row.created_at) : Number.NaN;
  return [
    isPublishedBlogQualityUpgradeCandidate(row) ? 1 : 0,
    typeof row.priority === 'number' && Number.isFinite(row.priority) ? row.priority : 0,
    Number.isFinite(createdAt) ? -createdAt : 0,
  ];
}

export function compareBlogDuplicateCandidatePreference(
  left: BlogDuplicateCleanupRow,
  right: BlogDuplicateCleanupRow,
): number {
  const leftPreference = candidatePreference(left);
  const rightPreference = candidatePreference(right);
  for (let index = 0; index < leftPreference.length; index += 1) {
    const leftValue = leftPreference[index]!;
    const rightValue = rightPreference[index]!;
    if (leftValue === rightValue) continue;
    return rightValue - leftValue;
  }
  return 0;
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

  const grouped = new Map<string, BlogDuplicateCleanupRow[]>();
  const actions: BlogDuplicateCleanupAction[] = [];
  for (const row of input.activeRows) {
    if (!row.id || row.source === 'pillar' || isBlockedCandidate(row)) continue;
    const key = readBlogEditorialBacklogDedupKey(row);
    if (!key) continue;
    const recentPublishedId = recentKeys.get(key);
    if (recentKeys.has(key) && !isPublishedBlogQualityUpgradeCandidate(row)) {
      actions.push({
        id: row.id,
        duplicate_key: key,
        duplicate_keep_id: recentPublishedId ?? null,
        reason: 'recent_published_duplicate',
      });
      continue;
    }
    const rows = grouped.get(key) ?? [];
    rows.push(row);
    grouped.set(key, rows);
  }

  for (const [key, rows] of grouped) {
    const [keep, ...duplicates] = [...rows].sort(compareBlogDuplicateCandidatePreference);
    for (const row of duplicates) {
      if (!row.id) continue;
      actions.push({
        id: row.id,
        duplicate_key: key,
        duplicate_keep_id: keep?.id ?? null,
        reason: 'queued_duplicate',
      });
    }
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
