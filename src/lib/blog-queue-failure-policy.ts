type BlogQueueFailureCode =
  | 'duplicate_content'
  | 'context_missing'
  | 'product_open_contract'
  | 'length'
  | 'links'
  | 'keyword_density'
  | 'structure_integrity'
  | 'table_integrity'
  | 'render_integrity'
  | 'article_quality_v2'
  | 'intent_quality'
  | 'engine_v2'
  | 'research_extraction'
  | 'evidence_insufficient'
  | 'topic_fit'
  | 'candidate_pre_publish_contract'
  | 'seo_score'
  | 'db_write'
  | 'linked_draft_invalid'
  | 'card_news_render_pending'
  | 'deterministic_fallback_blocked'
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
  'product_open_contract',
  'evidence_insufficient',
  'topic_fit',
  'candidate_pre_publish_contract',
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

/**
 * Detects an actual duplicate/canonical collision.
 *
 * `publish_gate:duplicate` is an editorial quality dimension emitted by the
 * V4 quality harness. It means the draft needs one bounded rewrite; it is not
 * evidence that another canonical article already owns the topic or slug.
 */
export function isBlogDuplicateQueueFailure(reason: string): boolean {
  const text = (reason || '').replace(/\bpublish_gate:duplicate\b/gi, 'publish_gate:quality');
  return /동일\s*slug|유사\s*slug|이미\s*발행|최근\s*\d+\s*일\s*내|중복|\[duplicate\]|duplicate|slug already|slug .*exists/i.test(text);
}

export function classifyBlogQueueFailure(reason: string, qa?: unknown): BlogQueueFailureDecision {
  const text = reason || '';
  const lower = text.toLowerCase();

  if (isBlogDuplicateQueueFailure(text)) {
    return { code: 'duplicate_content', retryable: false, selfHealAllowed: false, skipped: true };
  }

  if (/컨텍스트\s*부족|관광지\+상품\s*0|context\s+missing|insufficient\s+context/i.test(text)) {
    return { code: 'context_missing', retryable: false, selfHealAllowed: false, skipped: false };
  }

  if (/linked_blog_id|orphan_linked_blog|invalid_linked_draft|linked draft/i.test(text)) {
    return { code: 'linked_draft_invalid', retryable: false, selfHealAllowed: false, skipped: false };
  }

  if (/product_customer_open_contract_failed|customer_open_contract|mobile_proof|registration_evidence_pack|blog_publish/i.test(text)) {
    return { code: 'product_open_contract', retryable: false, selfHealAllowed: false, skipped: false };
  }

  if (/render_buffer|png .*대기|render pending|card_news.*pending/i.test(text)) {
    return { code: 'card_news_render_pending', retryable: true, selfHealAllowed: true, skipped: false };
  }

  if (/deterministic_(?:info|fast)_fallback_not_publishable|deterministic_fallback_blocked/i.test(text)) {
    return { code: 'deterministic_fallback_blocked', retryable: true, selfHealAllowed: true, skipped: false };
  }

  if (hasFailedGate(qa, 'keyword_density') || /\[keyword_density\]|keyword_density|키워드.*밀도/i.test(text)) {
    return { code: 'keyword_density', retryable: true, selfHealAllowed: true, skipped: false };
  }

  if (hasFailedGate(qa, 'length') || /\[length\]|thin content|최소\s*\d+\s*자\s*미달|minimum length|min length/i.test(text)) {
    return { code: 'length', retryable: true, selfHealAllowed: true, skipped: false };
  }

  if (hasFailedGate(qa, 'links') || /\[links\]|내부링크|internal link|external authority|authority link/i.test(text)) {
    return { code: 'links', retryable: true, selfHealAllowed: true, skipped: false };
  }

  if (hasFailedGate(qa, 'structure_integrity') || /\[structure_integrity\]|structure_integrity|raw_directive|checklist_shape/i.test(text)) {
    return { code: 'structure_integrity', retryable: true, selfHealAllowed: true, skipped: false };
  }

  if (hasFailedGate(qa, 'table_integrity') || /\[table_integrity\]|table_integrity|table_shape|markdown_table/i.test(text)) {
    return { code: 'table_integrity', retryable: true, selfHealAllowed: true, skipped: false };
  }

  if (hasFailedGate(qa, 'render_integrity') || /\[render_integrity\]|render_integrity|literal_markdown|rendered_table/i.test(text)) {
    return { code: 'render_integrity', retryable: true, selfHealAllowed: true, skipped: false };
  }

  if (hasFailedGate(qa, 'article_quality_v2') || /\[article_quality_v2\]|article quality v2|standalone_markdown|legacy_highlight_markup/i.test(text)) {
    return { code: 'article_quality_v2', retryable: true, selfHealAllowed: true, skipped: false };
  }

  if (hasFailedGate(qa, 'intent_quality') || /\[intent_quality\]|intent_quality|weak_reading_design|weak_list_or_table/i.test(text)) {
    return { code: 'intent_quality', retryable: true, selfHealAllowed: true, skipped: false };
  }

  if (/auto_research_extraction_empty/i.test(text)) {
    return { code: 'research_extraction', retryable: true, selfHealAllowed: true, skipped: false };
  }

  if (/evidence_insufficient|source_support|근거\s*부족/i.test(text)) {
    return { code: 'evidence_insufficient', retryable: false, selfHealAllowed: false, skipped: false };
  }

  if (hasFailedGate(qa, 'engine_v2') || /\[engine_v2\]|engine v2|product_decision_helpfulness|engine_task_incomplete|ai_naturalness|sales_pressure/i.test(text)) {
    return { code: 'engine_v2', retryable: true, selfHealAllowed: true, skipped: false };
  }

  if (hasFailedGate(qa, 'topic_fit') || /topic_fit|topic fit/i.test(text)) {
    return { code: 'topic_fit', retryable: false, selfHealAllowed: false, skipped: true };
  }

  if (/candidate_pre_publish_contract|candidate contract|editorial_cliche_topic|risky_numeric_slug_topic|weak_expected_slug|machine_topic_separator/i.test(text)) {
    return { code: 'candidate_pre_publish_contract', retryable: false, selfHealAllowed: false, skipped: true };
  }

  if (/seo score|seo_score|Blog quality score|publish_quality_failed|overbuilt_mechanical_structure|meta_description/i.test(text)) {
    return { code: 'seo_score', retryable: true, selfHealAllowed: true, skipped: false };
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
  const storedCode = typeof meta.failure_code === 'string' && meta.failure_code !== 'unknown'
    ? meta.failure_code as BlogQueueFailureCode
    : null;
  const code = storedCode ?? classifyBlogQueueFailure(input.lastError ?? '').code;
  const blockedByMeta = meta.self_heal_blocked === true || typeof meta.quarantine_reason === 'string';

  return !blockedByMeta && !SELF_HEAL_BLOCKED_CODES.has(code);
}
