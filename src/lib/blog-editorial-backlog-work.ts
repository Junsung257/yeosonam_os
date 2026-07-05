import {
  classifyBlogQueueOperationalIssue,
  getBlogQueueOperationalState,
  type BlogQueueOperationalRow,
} from './blog-queue-operational-health';

export interface BlogEditorialBacklogQueueRow extends BlogQueueOperationalRow {
  id?: string | null;
  topic?: string | null;
  destination?: string | null;
  source?: string | null;
}

export interface BlogEditorialBacklogWorkItem {
  queue_id: string | null;
  topic: string | null;
  destination: string | null;
  source: string | null;
  queue_status: string | null;
  attempts: number;
  issue: string;
  blocker_categories: string[];
  blockers: string[];
  next_action: string;
  updated_at: string | null;
}

export interface BlogEditorialBacklogWorkReport {
  total: number;
  issue_counts: Record<string, number>;
  category_counts: Record<string, number>;
  next_actions: string[];
  samples: BlogEditorialBacklogWorkItem[];
}

function readMeta(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === 'object' && !Array.isArray(meta)
    ? meta as Record<string, unknown>
    : {};
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function extractBracketedFailures(error: string): string[] {
  const failures: string[] = [];
  const pattern = /\[([a-z0-9_]+)\]\s*([^,[\n]+)/gi;
  let match = pattern.exec(error);
  while (match) {
    const gate = match[1]?.trim();
    const reason = match[2]?.trim();
    failures.push(reason ? `${gate}:${reason}` : gate);
    match = pattern.exec(error);
  }
  return failures;
}

function extractNamedFailures(error: string): string[] {
  const failures: string[] = [];
  if (!error) return failures;

  const briefFailure = error.match(/\bblog_content_brief_failed:([a-z0-9_:-]+)/i);
  if (briefFailure?.[1]) {
    failures.push(`blog_content_brief_failed:${briefFailure[1].toLowerCase()}`);
  }

  if (/stale_generating_or_non_retryable_failure/i.test(error)) {
    failures.push('stale_generating_or_non_retryable_failure');
  } else if (/stale generating/i.test(error)) {
    failures.push('stale_generating');
  }

  if (/context_missing/i.test(error)) failures.push('context_missing');
  if (/missing_primary_keyword/i.test(error)) failures.push('missing_primary_keyword');
  return failures;
}

export function extractEditorialBacklogBlockers(row: BlogEditorialBacklogQueueRow): string[] {
  const meta = readMeta(row.meta);
  const metaFailures = [
    meta.failure_code,
    meta.quarantine_reason,
    ...(Array.isArray(meta.quality_gate_failures) ? meta.quality_gate_failures : []),
    ...(Array.isArray(meta.failed_gates) ? meta.failed_gates : []),
    ...(Array.isArray(meta.repair_failures) ? meta.repair_failures : []),
  ]
    .map(cleanString)
    .filter((value): value is string => Boolean(value));
  const error = row.last_error ?? '';
  return unique([
    ...metaFailures,
    ...extractBracketedFailures(error),
    ...extractNamedFailures(error),
    classifyBlogQueueOperationalIssue(row),
  ]);
}

export function categorizeEditorialBacklogBlocker(blocker: string): string {
  const lower = blocker.toLowerCase();
  if (lower.includes('intent_quality') || lower.includes('weak_reading') || lower.includes('early_strong_cta')) {
    return 'reader_intent';
  }
  if (
    lower.includes('structure_integrity') ||
    lower.includes('table_integrity') ||
    lower.includes('raw_directive') ||
    lower.includes('checklist_shape') ||
    lower.includes('render_integrity')
  ) {
    return 'structure';
  }
  if (lower.includes('keyword_density') || lower.includes('keyword')) return 'keyword_use';
  if (
    lower.includes('engine_v2') ||
    lower.includes('product_decision') ||
    lower.includes('engine_task') ||
    lower.includes('ai_naturalness') ||
    lower.includes('sales_pressure')
  ) {
    return 'engine_contract';
  }
  if (lower.includes('topic_fit') || lower.includes('intent_mismatch')) return 'topic_fit';
  if (lower.includes('blog_content_brief') || lower.includes('missing_primary_keyword')) return 'brief_contract';
  if (lower.includes('stale_generating')) return 'stale_recovery';
  if (lower.includes('seo_score') || lower.includes('seo')) return 'seo_metadata';
  if (lower.includes('image')) return 'image_evidence';
  if (lower.includes('self_heal')) return 'self_heal_contract';
  return 'other';
}

function actionForCategories(categories: string[]): string {
  if (categories.includes('reader_intent')) return 'repair_info_or_product_writer_intent_contract';
  if (categories.includes('structure')) return 'repair_structure_or_table_generation_contract';
  if (categories.includes('keyword_use')) return 'repair_keyword_density_and_surface_copy';
  if (categories.includes('engine_contract')) return 'repair_engine_v2_brief_or_product_consult_sections';
  if (categories.includes('topic_fit')) return 'retire_or_regenerate_topic_seed';
  if (categories.includes('brief_contract')) return 'repair_content_brief_contract';
  if (categories.includes('stale_recovery')) return 'requeue_stale_generation_after_contract_fix';
  if (categories.includes('seo_metadata')) return 'repair_seo_metadata_generation';
  if (categories.includes('image_evidence')) return 'repair_image_selection_or_alt_evidence';
  if (categories.includes('self_heal_contract')) return 'inspect_non_retryable_self_heal_contract';
  return 'inspect_editorial_failure_sample';
}

export function buildBlogEditorialBacklogWorkReport(input: {
  rows: BlogEditorialBacklogQueueRow[];
  limit?: number;
  now?: Date;
}): BlogEditorialBacklogWorkReport {
  const issueCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const items: BlogEditorialBacklogWorkItem[] = [];
  const now = input.now ?? new Date();

  for (const row of input.rows) {
    const state = getBlogQueueOperationalState(row, now);
    if (state.action !== 'editorial_backlog') continue;

    const issue = state.issue;
    issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
    const blockers = extractEditorialBacklogBlockers(row);
    const categories = unique(blockers.map(categorizeEditorialBacklogBlocker));
    for (const category of categories) {
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    }

    items.push({
      queue_id: row.id ?? null,
      topic: row.topic ?? null,
      destination: row.destination ?? null,
      source: row.source ?? null,
      queue_status: row.status ?? null,
      attempts: Number(row.attempts ?? 0),
      issue,
      blocker_categories: categories,
      blockers,
      next_action: actionForCategories(categories),
      updated_at: row.updated_at ?? null,
    });
  }

  items.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
  const samples = items.slice(0, Math.max(0, input.limit ?? 10));

  return {
    total: items.length,
    issue_counts: issueCounts,
    category_counts: categoryCounts,
    next_actions: unique(items.map(item => item.next_action)),
    samples,
  };
}
