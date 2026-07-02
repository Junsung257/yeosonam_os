import {
  categorizeEditorialBacklogBlocker,
  extractEditorialBacklogBlockers,
  type BlogEditorialBacklogQueueRow,
} from './blog-editorial-backlog-work';

export const BLOG_EDITORIAL_BACKLOG_RECHECK_VERSION = 'blog-editorial-backlog-recheck-20260702';

export type BlogEditorialBacklogRecheckAction =
  | 'requeue'
  | 'skip_duplicate'
  | 'retire_legacy_seed'
  | 'keep_blocked';

export type BlogEditorialBacklogRecheckDecision = {
  action: BlogEditorialBacklogRecheckAction;
  reasons: string[];
  dedup_key: string | null;
  last_error: string | null;
  meta: Record<string, unknown>;
};

export type BlogEditorialBacklogRecheckGuidance = {
  write_recommended: boolean;
  write_reasons: string[];
};

type RecheckRow = BlogEditorialBacklogQueueRow & {
  product_id?: string | null;
  angle_type?: string | null;
  slug?: string | null;
  slug_hint?: string | null;
  priority?: number | null;
  generation_meta?: unknown;
};

const HARD_BLOCKER_CATEGORIES = new Set([
  'topic_fit',
  'image_evidence',
  'self_heal_contract',
]);

const HARD_BLOCKER_PATTERNS = [
  /product_open_contract/i,
  /evidence_insufficient/i,
  /context_missing/i,
  /duplicate_content/i,
  /linked_draft_invalid/i,
  /customer_open_contract/i,
  /registration_evidence_pack/i,
];

const RECOVERABLE_PATTERNS = [
  /blog_content_brief_failed/i,
  /missing_primary_keyword/i,
  /stale_generating/i,
  /stale_generating_or_non_retryable_failure/i,
  /intent_quality/i,
  /early_strong_cta/i,
  /missing_answer_first/i,
  /unsupported_yeosonam_data/i,
  /forbidden_sales_tone/i,
  /missing_intent_contract/i,
  /structure_integrity/i,
  /table_integrity/i,
  /too_few_table_rows/i,
  /missing_header_separator/i,
  /cell_count_mismatch/i,
  /keyword_density/i,
  /engine_v2/i,
  /sales_pressure/i,
  /engine_task_incomplete/i,
  /ai_naturalness/i,
  /seo_score/i,
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNestedString(...values: unknown[]): string | null {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function readWriterType(row: RecheckRow): string {
  const meta = asRecord(row.meta);
  const generationMeta = asRecord(row.generation_meta);
  return readNestedString(meta.writer_type, meta.writer, generationMeta.writer)
    ?? (row.product_id ? 'product_consultant_writer' : 'info_writer');
}

function readExpectedSlug(row: RecheckRow): string | null {
  const meta = asRecord(row.meta);
  return readNestedString(meta.expected_slug, meta.spun_slug, row.slug_hint, row.slug);
}

function readMicroAngle(row: RecheckRow): string | null {
  const meta = asRecord(row.meta);
  const generationMeta = asRecord(row.generation_meta);
  return readNestedString(meta.micro_angle, generationMeta.micro_angle);
}

function readProductDedupKey(row: RecheckRow): string | null {
  const meta = asRecord(row.meta);
  const generationMeta = asRecord(row.generation_meta);
  return readNestedString(meta.product_dedup_key, generationMeta.product_dedup_key, meta.dedup_key, row.product_id);
}

export function readBlogEditorialBacklogDedupKey(row: RecheckRow): string | null {
  const writer = readWriterType(row);
  const productKey = readProductDedupKey(row);
  if (productKey) return `${writer}::product::${normalized(productKey)}`;

  const microAngle = readMicroAngle(row);
  if (row.destination && microAngle) {
    return `${writer}::${normalized(row.destination)}::${normalized(microAngle)}`;
  }

  const slug = readExpectedSlug(row);
  if (slug) return `${writer}::slug::${normalized(slug)}`;

  if (row.topic) return `${writer}::topic::${normalized(row.topic)}`;
  return null;
}

function hasPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(value));
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function recoverableReasons(blockers: string[], categories: string[]): string[] {
  const joined = blockers.join(' ');
  if (HARD_BLOCKER_PATTERNS.some(pattern => pattern.test(joined))) return [];
  if (categories.some(category => HARD_BLOCKER_CATEGORIES.has(category))) return [];
  return unique(blockers.filter(blocker => hasPattern(blocker, RECOVERABLE_PATTERNS)));
}

function isRetirableLegacySeed(row: RecheckRow, blockers: string[], categories: string[]): boolean {
  const source = normalized(String(row.source ?? ''));
  const topic = normalized(String(row.topic ?? ''));
  const joined = blockers.join(' ');
  return source === 'pillar'
    && topic.includes('pillar')
    && categories.includes('self_heal_contract')
    && /context_missing|non_retryable_failure|self_heal/i.test(joined);
}

function clearEditorialBlockMeta(meta: Record<string, unknown>, checkedAt: string): Record<string, unknown> {
  const next = { ...meta };
  delete next.failure_code;
  delete next.quarantine_reason;
  delete next.self_heal_blocked;
  delete next.quality_gate_failures;
  delete next.failed_gates;
  delete next.repair_failures;
  return {
    ...next,
    editorial_backlog_rechecked_at: checkedAt,
    editorial_backlog_recheck_version: BLOG_EDITORIAL_BACKLOG_RECHECK_VERSION,
  };
}

export function buildBlogEditorialBacklogRecheckGuidance(input: {
  requeue: number;
  duplicateSkipped: number;
  retiredLegacySeeds?: number;
}): BlogEditorialBacklogRecheckGuidance {
  const writeReasons: string[] = [];
  if (input.requeue > 0) writeReasons.push('requeue_repaired_editorial_rows');
  if (input.duplicateSkipped > 0) writeReasons.push('skip_duplicate_editorial_rows');
  if ((input.retiredLegacySeeds ?? 0) > 0) writeReasons.push('retire_legacy_pillar_rows');
  return {
    write_recommended: writeReasons.length > 0,
    write_reasons: writeReasons,
  };
}

export function buildBlogEditorialBacklogRecheckDecision(input: {
  row: RecheckRow;
  checkedAt?: string;
  activeDuplicateId?: string | null;
  alreadyRequeuedId?: string | null;
}): BlogEditorialBacklogRecheckDecision {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const meta = asRecord(input.row.meta);
  const blockers = extractEditorialBacklogBlockers(input.row);
  const categories = unique(blockers.map(categorizeEditorialBacklogBlocker));
  const reasons = recoverableReasons(blockers, categories);
  const dedupKey = readBlogEditorialBacklogDedupKey(input.row);

  if (isRetirableLegacySeed(input.row, blockers, categories)) {
    return {
      action: 'retire_legacy_seed',
      reasons: blockers,
      dedup_key: dedupKey,
      last_error: 'editorial_backlog_recheck_retired_legacy_pillar_seed',
      meta: {
        ...meta,
        editorial_backlog_rechecked_at: checkedAt,
        editorial_backlog_recheck_result: 'retired_legacy_seed',
        editorial_backlog_recheck_version: BLOG_EDITORIAL_BACKLOG_RECHECK_VERSION,
        editorial_backlog_recheck_blockers: blockers,
        retired_legacy_pillar_seed: true,
        retired_legacy_pillar_seed_at: checkedAt,
      },
    };
  }

  if (reasons.length === 0) {
    return {
      action: 'keep_blocked',
      reasons: reasons.length > 0 ? reasons : blockers,
      dedup_key: dedupKey,
      last_error: input.row.last_error ?? 'editorial_backlog_recheck_blocked',
      meta: {
        ...meta,
        editorial_backlog_rechecked_at: checkedAt,
        editorial_backlog_recheck_result: 'blocked',
        editorial_backlog_recheck_version: BLOG_EDITORIAL_BACKLOG_RECHECK_VERSION,
        editorial_backlog_recheck_blockers: blockers,
      },
    };
  }

  if (input.activeDuplicateId || input.alreadyRequeuedId) {
    return {
      action: 'skip_duplicate',
      reasons,
      dedup_key: dedupKey,
      last_error: 'editorial_backlog_recheck_duplicate_candidate',
      meta: {
        ...clearEditorialBlockMeta(meta, checkedAt),
        editorial_backlog_recheck_result: 'duplicate',
        duplicate_editorial_recheck: true,
        duplicate_key: dedupKey,
        duplicate_keep_id: input.activeDuplicateId ?? input.alreadyRequeuedId,
        quarantine_reason: 'duplicate_preclaim',
        self_heal_blocked: true,
      },
    };
  }

  return {
    action: 'requeue',
    reasons,
    dedup_key: dedupKey,
    last_error: null,
    meta: {
      ...clearEditorialBlockMeta(meta, checkedAt),
      editorial_backlog_recheck_result: 'requeue',
      editorial_backlog_recheck_reasons: reasons,
      requeued_by: BLOG_EDITORIAL_BACKLOG_RECHECK_VERSION,
      requeued_at: checkedAt,
    },
  };
}
