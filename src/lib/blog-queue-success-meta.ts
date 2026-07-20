import type { BlogPublishQualityReport } from './blog-publish-quality';
import type { QualityGateReport } from './blog-quality-gate';

const STALE_FAILURE_META_KEYS = [
  'failure_code',
  'failure_retryable',
  'self_heal_blocked',
  'self_heal_retry_count',
  'self_heal_last_kept_live_at',
  'quarantine_reason',
  'last_failed_at',
  'private_regeneration_blocked',
  'skipped_duplicate',
] as const;

export function buildBlogQueueSuccessMeta(input: {
  currentMeta?: Record<string, unknown> | null;
  qualityGate: QualityGateReport;
  publishQuality: BlogPublishQualityReport;
  succeededAt: string;
}): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...(input.currentMeta ?? {}) };
  for (const key of STALE_FAILURE_META_KEYS) delete meta[key];

  return {
    ...meta,
    last_qa: input.qualityGate,
    last_publish_quality: {
      score: input.publishQuality.blogQualityScore.score,
      issues: input.publishQuality.blogQualityScore.issues.slice(0, 8),
      rendered_issues: (input.publishQuality.renderedSeoQuality?.issues ?? []).slice(0, 8).map((issue) => ({
        code: issue.code,
        message: issue.message,
        evidence: issue.evidence ?? null,
      })),
      components: input.publishQuality.blogQualityScore.components.map((component) => ({
        id: component.id,
        passed: component.passed,
        score: component.score,
        issue_codes: component.issues.map((issue) => issue.code).slice(0, 5),
      })),
    },
    last_succeeded_at: input.succeededAt,
  };
}
