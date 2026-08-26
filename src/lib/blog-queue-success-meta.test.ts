import { describe, expect, it } from 'vitest';
import type { BlogPublishQualityReport } from './blog-publish-quality';
import type { QualityGateReport } from './blog-quality-gate';
import { buildBlogQueueSuccessMeta } from './blog-queue-success-meta';

describe('buildBlogQueueSuccessMeta', () => {
  it('replaces stale failure markers with current successful quality evidence', () => {
    const qualityGate = {
      passed: true,
      summary: '모든 게이트 통과 (info)',
      gates: [{ gate: 'render_integrity', passed: true }],
    } as QualityGateReport;
    const publishQuality = {
      passed: true,
      renderedSeoQuality: { passed: true, issues: [] },
      publicCustomerQuality: { passed: true, score: 100, issues: [] },
      blogQualityScore: {
        score: 100,
        issues: [],
        components: [
          { id: 'render', passed: true, score: 100, issues: [] },
          { id: 'seo', passed: true, score: 100, issues: [] },
        ],
      },
    } as unknown as BlogPublishQualityReport;

    const result = buildBlogQueueSuccessMeta({
      currentMeta: {
        failure_code: 'seo_score',
        failure_retryable: true,
        self_heal_blocked: false,
        self_heal_retry_count: 3,
        last_failed_at: '2026-07-20T00:00:00.000Z',
        last_publish_quality: { score: 75 },
        information_research: { version: 'r18-research-first-v1' },
        private_regeneration: { force_private_review: true },
      },
      qualityGate,
      publishQuality,
      succeededAt: '2026-07-20T17:25:06.000Z',
    });

    expect(result).not.toHaveProperty('failure_code');
    expect(result).not.toHaveProperty('failure_retryable');
    expect(result).not.toHaveProperty('self_heal_blocked');
    expect(result).not.toHaveProperty('self_heal_retry_count');
    expect(result).not.toHaveProperty('last_failed_at');
    expect(result).toMatchObject({
      information_research: { version: 'r18-research-first-v1' },
      private_regeneration: { force_private_review: true },
      last_qa: qualityGate,
      last_publish_quality: {
        score: 100,
        legacy_diagnostic_score: 100,
        issues: [],
        rendered_issues: [],
        components: [
          { id: 'render', passed: true, score: 100, issue_codes: [] },
          { id: 'seo', passed: true, score: 100, issue_codes: [] },
        ],
      },
      last_succeeded_at: '2026-07-20T17:25:06.000Z',
    });
  });
});
