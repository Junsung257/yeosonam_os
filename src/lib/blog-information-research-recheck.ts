import {
  inferBlogInformationIntent,
  type BlogInformationIntent,
} from './blog-information-contract';
import { readBlogEditorialBacklogDedupKey } from './blog-editorial-backlog-recheck';

export const BLOG_INFORMATION_RESEARCH_RECHECK_VERSION =
  'blog-information-research-recheck-20260831-v8';

const AUTOMATED_RESEARCH_INTENTS = new Set<BlogInformationIntent>([
  'food_budget',
  'monthly_weather',
  'airport_transport',
  'local_transport',
  'hotel_areas',
  'family_budget',
  'itinerary',
  'shopping_souvenirs',
  'currency_payment',
  'entry_requirements',
  'travel_insurance',
]);

export type BlogInformationResearchRecheckRow = {
  id: string;
  product_id?: string | null;
  topic?: string | null;
  destination?: string | null;
  source?: string | null;
  status?: string | null;
  last_error?: string | null;
  angle_type?: string | null;
  meta?: unknown;
};

export type BlogInformationResearchRecheckDecision = {
  action: 'requeue' | 'skip_duplicate' | 'keep_blocked';
  intent: BlogInformationIntent;
  dedupKey: string | null;
  reason: string;
  meta: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isHumanReviewedPublishedReplacement(meta: Record<string, unknown>): boolean {
  const qualityUpgrade = asRecord(meta.quality_upgrade);
  const privateRegeneration = asRecord(meta.private_regeneration);
  return qualityUpgrade.execution_mode === 'human_review'
    && qualityUpgrade.requires_human_review === true
    && privateRegeneration.mode === 'replace_published_after_quality_gate'
    && privateRegeneration.atomic_publish_replace === true;
}

function isResearchFailure(row: BlogInformationResearchRecheckRow): boolean {
  const meta = asRecord(row.meta);
  const joined = [
    row.last_error,
    meta.failure_code,
    meta.quarantine_reason,
    meta.research_failure,
  ].filter(Boolean).join(' ');
  if (/BLOG_RESEARCH|research_(?:grounding|preflight|bundle)|evidence_insufficient:(?:research|auto_research_failed)|grounding_empty|claim_semantic_coverage_missing/i.test(joined)) {
    return true;
  }
  return Boolean(
    meta.research_failed_at
    && Array.isArray(meta.research_issues)
    && /^(?:evidence_insufficient|research_exception)$/i.test(String(row.last_error ?? '')),
  );
}

function isControlledBoundedRewriteFailure(
  row: BlogInformationResearchRecheckRow,
  meta: Record<string, unknown>,
): boolean {
  const orchestration = asRecord(meta.ai_orchestration_v4);
  const failureEvidence = Array.isArray(orchestration.failure_evidence)
    ? orchestration.failure_evidence.map(String)
    : [];
  return row.source === 'user_seed'
    && meta.controlled_publish_canary === true
    && meta.editor_approved_seed === true
    && meta.information_research_bundle !== null
    && typeof meta.information_research_bundle === 'object'
    && orchestration.version === 'blog-deepseek-orchestrator-v4'
    && orchestration.route === 'rewrite_pro_high'
    && orchestration.next_stage === 'rewrite_pro_high'
    && failureEvidence.includes('editorial_harness_single_rewrite')
    && /^blog_quality_v4_rewrite_pro_high:/i.test(String(row.last_error ?? ''));
}

function isControlledHarnessDefectFailure(
  row: BlogInformationResearchRecheckRow,
  meta: Record<string, unknown>,
): boolean {
  const orchestration = asRecord(meta.ai_orchestration_v4);
  const failureEvidence = Array.isArray(orchestration.failure_evidence)
    ? orchestration.failure_evidence.map(String)
    : [];
  const joinedFailure = [row.last_error, ...failureEvidence].join(' ');
  const requiredFailureMarkers = [
    'editorial_harness_retry_exhausted',
    'stale_claim_present',
    'publish_gate:structure_integrity',
    'publish_gate:intent_quality',
    'publish_gate:engine_v2',
    'editorial_harness_v5:semantic_usefulness',
    'editorial_harness_v5:semantic_completeness',
  ];
  return row.source === 'user_seed'
    && row.status === 'failed'
    && meta.controlled_publish_canary === true
    && meta.editor_approved_seed === true
    && meta.information_research_bundle !== null
    && typeof meta.information_research_bundle === 'object'
    && meta.information_research_recheck_version === 'blog-information-research-recheck-20260831-v7'
    && meta.information_research_recheck_result === 'bounded_orchestrator_rewrite_requeued'
    && orchestration.version === 'blog-deepseek-orchestrator-v4'
    && orchestration.route === 'quarantine'
    && /^blog_quality_v4_quarantine:/i.test(String(row.last_error ?? ''))
    && requiredFailureMarkers.every((marker) => joinedFailure.includes(marker));
}

function clearedResearchFailureMeta(
  meta: Record<string, unknown>,
  checkedAt: string,
  intent: BlogInformationIntent,
): Record<string, unknown> {
  const next = { ...meta };
  for (const key of [
    'failure_code',
    'quarantine_reason',
    'self_heal_blocked',
    'self_heal_closed_at',
    'research_failure',
    'research_preflight',
    'information_research_bundle',
  ]) {
    delete next[key];
  }
  return {
    ...next,
    information_research_rechecked_at: checkedAt,
    information_research_recheck_version: BLOG_INFORMATION_RESEARCH_RECHECK_VERSION,
    information_research_recheck_intent: intent,
    information_research_recheck_result: 'requeued',
    requeued_by: BLOG_INFORMATION_RESEARCH_RECHECK_VERSION,
  };
}

function clearedBoundedRewriteFailureMeta(
  meta: Record<string, unknown>,
  checkedAt: string,
  intent: BlogInformationIntent,
): Record<string, unknown> {
  const next = { ...meta };
  for (const key of [
    'failure_code',
    'failure_retryable',
    'quarantine_reason',
    'self_heal_blocked',
    'skipped_duplicate',
  ]) {
    delete next[key];
  }
  return {
    ...next,
    information_research_rechecked_at: checkedAt,
    information_research_recheck_version: BLOG_INFORMATION_RESEARCH_RECHECK_VERSION,
    information_research_recheck_intent: intent,
    information_research_recheck_result: 'bounded_orchestrator_rewrite_requeued',
    bounded_orchestrator_rewrite_recovered_at: checkedAt,
    requeued_by: BLOG_INFORMATION_RESEARCH_RECHECK_VERSION,
  };
}

function clearedHarnessDefectFailureMeta(
  meta: Record<string, unknown>,
  checkedAt: string,
  intent: BlogInformationIntent,
): Record<string, unknown> {
  const next = { ...meta };
  for (const key of [
    'failure_code',
    'failure_retryable',
    'quarantine_reason',
    'self_heal_blocked',
    'skipped_duplicate',
  ]) {
    delete next[key];
  }
  const orchestration = asRecord(meta.ai_orchestration_v4);
  return {
    ...next,
    ai_orchestration_v4: {
      ...orchestration,
      route: 'rewrite_pro_max',
      next_stage: 'rewrite_pro_max',
      publishable: false,
      reasons: ['controlled_harness_defect_rewrite'],
      failure_evidence: [
        ...new Set([
          ...(Array.isArray(orchestration.failure_evidence)
            ? orchestration.failure_evidence.map(String)
            : []),
          'controlled_harness_defect_rewrite',
        ]),
      ],
    },
    information_research_rechecked_at: checkedAt,
    information_research_recheck_version: BLOG_INFORMATION_RESEARCH_RECHECK_VERSION,
    information_research_recheck_intent: intent,
    information_research_recheck_result: 'controlled_harness_defect_rewrite_requeued',
    controlled_harness_defect_recovered_at: checkedAt,
    requeued_by: BLOG_INFORMATION_RESEARCH_RECHECK_VERSION,
  };
}

export function buildBlogInformationResearchRecheckDecision(input: {
  row: BlogInformationResearchRecheckRow;
  checkedAt?: string;
  activeDuplicateId?: string | null;
  alreadyRequeuedId?: string | null;
}): BlogInformationResearchRecheckDecision {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const meta = asRecord(input.row.meta);
  const intent = inferBlogInformationIntent({
    topic: input.row.topic,
    destination: input.row.destination,
    category: typeof meta.category === 'string' ? meta.category : null,
    microAngle: typeof meta.micro_angle === 'string' ? meta.micro_angle : null,
    primaryKeyword: typeof meta.primary_keyword === 'string' ? meta.primary_keyword : null,
  });
  const dedupKey = readBlogEditorialBacklogDedupKey(input.row);
  const reviewedPublishedReplacement = isHumanReviewedPublishedReplacement(meta);
  const boundedRewriteFailure = isControlledBoundedRewriteFailure(input.row, meta);
  const harnessDefectFailure = isControlledHarnessDefectFailure(input.row, meta);
  const blocked = (reason: string): BlogInformationResearchRecheckDecision => ({
    action: 'keep_blocked',
    intent,
    dedupKey,
    reason,
    meta: {
      ...meta,
      information_research_rechecked_at: checkedAt,
      information_research_recheck_version: BLOG_INFORMATION_RESEARCH_RECHECK_VERSION,
      information_research_recheck_intent: intent,
      information_research_recheck_result: reason,
    },
  });

  if (input.row.product_id) return blocked('product_row_excluded');
  if (!['failed', 'skipped'].includes(String(input.row.status ?? ''))) {
    return blocked('status_not_research_failure_state');
  }
  if (!input.row.destination || !input.row.topic) return blocked('research_context_missing');
  if (!AUTOMATED_RESEARCH_INTENTS.has(intent)) return blocked('intent_not_live_verified');
  if (!isResearchFailure(input.row) && !boundedRewriteFailure && !harnessDefectFailure) {
    return blocked('not_information_research_failure');
  }
  if (meta.requeued_by === BLOG_INFORMATION_RESEARCH_RECHECK_VERSION) {
    return blocked('repeat_suppressed');
  }

  if (
    (input.activeDuplicateId && !reviewedPublishedReplacement)
    || input.alreadyRequeuedId
  ) {
    return {
      action: 'skip_duplicate',
      intent,
      dedupKey,
      reason: 'active_or_published_duplicate',
      meta: {
        ...meta,
        information_research_rechecked_at: checkedAt,
        information_research_recheck_version: BLOG_INFORMATION_RESEARCH_RECHECK_VERSION,
        information_research_recheck_intent: intent,
        information_research_recheck_result: 'duplicate',
        duplicate_keep_id: input.activeDuplicateId ?? input.alreadyRequeuedId,
      },
    };
  }

  return {
    action: 'requeue',
    intent,
    dedupKey,
    reason: harnessDefectFailure
      ? 'controlled_harness_defect_rewrite_retry'
      : boundedRewriteFailure
        ? 'bounded_orchestrator_rewrite_retry'
        : 'live_verified_research_retry',
    meta: harnessDefectFailure
      ? clearedHarnessDefectFailureMeta(meta, checkedAt, intent)
      : boundedRewriteFailure
        ? clearedBoundedRewriteFailureMeta(meta, checkedAt, intent)
        : clearedResearchFailureMeta(meta, checkedAt, intent),
  };
}
