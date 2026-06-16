type BlogQueueFailureCode =
  | 'duplicate_content'
  | 'context_missing'
  | 'keyword_density'
  | 'structure_integrity'
  | 'intent_quality'
  | 'seo_score'
  | 'db_write'
  | 'linked_draft_invalid'
  | 'card_news_render_pending'
  | 'unknown';

export interface BlogQueueFailureDecision {
  code: BlogQueueFailureCode;
  retryable: boolean;
  selfHealAllowed: boolean;
  skipped: boolean;
}

const SELF_HEAL_BLOCKED_CODES = new Set<BlogQueueFailureCode>([
  'duplicate_content',
  'context_missing',
  'keyword_density',
  'structure_integrity',
  'intent_quality',
  'seo_score',
  'linked_draft_invalid',
]);

function hasFailedGate(qa: unknown, gate: string): boolean {
  if (!qa || typeof qa !== 'object') return false;
  const gates = (qa as { gates?: unknown }).gates;
  if (!Array.isArray(gates)) return false;
  return gates.some((row) => {
    if (!row || typeof row !== 'object') return false;
    const record = row as { gate?: unknown; passed?: unknown };
    return record.gate === gate && record.passed === false;
  });
}

export function classifyBlogQueueFailure(reason: string, qa?: unknown): BlogQueueFailureDecision {
  const text = reason || '';
  const lower = text.toLowerCase();

  if (/동일\s*slug|유사\s*slug|이미\s*발행|duplicate|slug already|slug .*exists/i.test(text)) {
    return { code: 'duplicate_content', retryable: false, selfHealAllowed: false, skipped: true };
  }

  if (/컨텍스트\s*부족|관광지\+상품\s*0|context\s+missing|insufficient\s+context/i.test(text)) {
    return { code: 'context_missing', retryable: false, selfHealAllowed: false, skipped: false };
  }

  if (/linked_blog_id|orphan_linked_blog|invalid_linked_draft|linked draft/i.test(text)) {
    return { code: 'linked_draft_invalid', retryable: false, selfHealAllowed: false, skipped: false };
  }

  if (/render_buffer|png .*대기|render pending|card_news.*pending/i.test(text)) {
    return { code: 'card_news_render_pending', retryable: true, selfHealAllowed: true, skipped: false };
  }

  if (hasFailedGate(qa, 'keyword_density') || /\[keyword_density\]|keyword_density|키워드.*밀도/i.test(text)) {
    return { code: 'keyword_density', retryable: true, selfHealAllowed: false, skipped: false };
  }

  if (hasFailedGate(qa, 'structure_integrity') || /\[structure_integrity\]|structure_integrity|raw_directive|checklist_shape/i.test(text)) {
    return { code: 'structure_integrity', retryable: true, selfHealAllowed: false, skipped: false };
  }

  if (hasFailedGate(qa, 'intent_quality') || /\[intent_quality\]|intent_quality|weak_reading_design|weak_list_or_table/i.test(text)) {
    return { code: 'intent_quality', retryable: true, selfHealAllowed: false, skipped: false };
  }

  if (/seo score|seo_score/i.test(text)) {
    return { code: 'seo_score', retryable: true, selfHealAllowed: false, skipped: false };
  }

  if (/db insert|db update|database|supabase/i.test(lower)) {
    return { code: 'db_write', retryable: true, selfHealAllowed: true, skipped: false };
  }

  return { code: 'unknown', retryable: true, selfHealAllowed: true, skipped: false };
}

export function shouldSelfHealBlogQueueItem(input: {
  lastError?: string | null;
  meta?: unknown;
}): boolean {
  const meta = input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta)
    ? input.meta as Record<string, unknown>
    : {};
  const code = typeof meta.failure_code === 'string'
    ? meta.failure_code as BlogQueueFailureCode
    : classifyBlogQueueFailure(input.lastError ?? '').code;
  const blockedByMeta = meta.self_heal_blocked === true || meta.quarantine_reason === 'non_retryable_failure';

  return !blockedByMeta && !SELF_HEAL_BLOCKED_CODES.has(code);
}
