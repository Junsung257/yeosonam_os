import { describe, expect, it } from 'vitest';

import {
  BLOG_INFORMATION_RESEARCH_RECHECK_VERSION,
  buildBlogInformationResearchRecheckDecision,
} from './blog-information-research-recheck';

function failedResearchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'queue-1',
    product_id: null,
    topic: '괌 가족여행 4인 예산과 교통비',
    destination: '괌',
    source: 'information',
    status: 'failed',
    last_error: 'BLOG_RESEARCH_GROUNDING_EMPTY',
    angle_type: 'value',
    meta: {
      micro_angle: 'budget_family',
      expected_slug: 'guam-family-budget',
      self_heal_blocked: true,
      failure_code: 'coverage_gap',
    },
    ...overrides,
  };
}

describe('blog information research backlog recheck', () => {
  it('requeues only a live-verified informational research failure', () => {
    const decision = buildBlogInformationResearchRecheckDecision({
      row: failedResearchRow(),
      checkedAt: '2026-07-28T00:00:00.000Z',
    });

    expect(decision).toMatchObject({
      action: 'requeue',
      intent: 'family_budget',
      reason: 'live_verified_research_retry',
    });
    expect(decision.meta).not.toHaveProperty('self_heal_blocked');
    expect(decision.meta.requeued_by).toBe(BLOG_INFORMATION_RESEARCH_RECHECK_VERSION);
  });

  it('requeues a scheduler-quarantined research failure with durable research markers', () => {
    const decision = buildBlogInformationResearchRecheckDecision({
      row: failedResearchRow({
        status: 'skipped',
        last_error: 'evidence_insufficient',
        meta: {
          micro_angle: 'airport_arrival',
          research_failed_at: '2026-07-28T00:00:00.000Z',
          research_issues: ['claim_type_below_minimum:price:0/2'],
        },
      }),
    });

    expect(decision).toMatchObject({
      action: 'requeue',
      intent: 'airport_transport',
      reason: 'live_verified_research_retry',
    });
  });

  it('does not treat a generic skipped quality row as an automatic research retry', () => {
    expect(buildBlogInformationResearchRecheckDecision({
      row: failedResearchRow({
        status: 'skipped',
        last_error: 'evidence_insufficient',
        meta: { micro_angle: 'airport_arrival' },
      }),
    }).reason).toBe('not_information_research_failure');
  });

  it('does not retry product rows or unsupported general topics', () => {
    expect(buildBlogInformationResearchRecheckDecision({
      row: failedResearchRow({ product_id: 'product-1' }),
    }).reason).toBe('product_row_excluded');
    expect(buildBlogInformationResearchRecheckDecision({
      row: failedResearchRow({
        topic: '괌 여행 일반 가이드',
        meta: { micro_angle: 'general' },
      }),
    }).reason).toBe('intent_not_live_verified');
  });

  it('suppresses duplicate and repeated retries', () => {
    expect(buildBlogInformationResearchRecheckDecision({
      row: failedResearchRow(),
      activeDuplicateId: 'queue-2',
    }).action).toBe('skip_duplicate');
    expect(buildBlogInformationResearchRecheckDecision({
      row: failedResearchRow({
        meta: {
          micro_angle: 'budget_family',
          requeued_by: BLOG_INFORMATION_RESEARCH_RECHECK_VERSION,
        },
      }),
    }).reason).toBe('repeat_suppressed');
  });
});
