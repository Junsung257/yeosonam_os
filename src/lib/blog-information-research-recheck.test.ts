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

  it.each([
    'evidence_insufficient:auto_research_failed:missing_sources,missing_evidence,missing_claims',
    'evidence_insufficient:auto_research_failed:source_rejected:0:source_type:reputable_price_source',
  ])('recognizes persisted automatic research failure variants: %s', (lastError) => {
    const decision = buildBlogInformationResearchRecheckDecision({
      row: failedResearchRow({
        last_error: lastError,
        meta: {
          micro_angle: 'hotel_area',
          failure_code: 'evidence_insufficient',
          quarantine_reason: 'non_retryable_failure',
        },
      }),
    });

    expect(decision).toMatchObject({
      action: 'requeue',
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

  it('requeues only a controlled canary whose bounded rewrite was cancelled by the legacy queue policy', () => {
    const researchBundle = { version: 'reviewed-source-direct-fetch-v2', claims: [{ id: 'claim-1' }] };
    const decision = buildBlogInformationResearchRecheckDecision({
      row: failedResearchRow({
        source: 'user_seed',
        status: 'skipped',
        last_error: 'blog_quality_v4_rewrite_pro_high:editorial_harness_single_rewrite,publish_gate:duplicate,publish_gate:links',
        meta: {
          micro_angle: 'airport_arrival',
          controlled_publish_canary: true,
          editor_approved_seed: true,
          information_research_bundle: researchBundle,
          failure_code: 'duplicate_content',
          failure_retryable: false,
          quarantine_reason: 'non_retryable_failure',
          self_heal_blocked: true,
          skipped_duplicate: true,
          ai_orchestration_v4: {
            version: 'blog-deepseek-orchestrator-v4',
            route: 'rewrite_pro_high',
            next_stage: 'rewrite_pro_high',
            failure_evidence: ['editorial_harness_single_rewrite', 'publish_gate:duplicate'],
          },
        },
      }),
      checkedAt: '2026-08-30T19:30:00.000Z',
    });

    expect(decision).toMatchObject({
      action: 'requeue',
      intent: 'airport_transport',
      reason: 'bounded_orchestrator_rewrite_retry',
    });
    expect(decision.meta.information_research_bundle).toEqual(researchBundle);
    expect(decision.meta.ai_orchestration_v4).toMatchObject({
      route: 'rewrite_pro_high',
      next_stage: 'rewrite_pro_high',
    });
    expect(decision.meta).not.toHaveProperty('failure_code');
    expect(decision.meta).not.toHaveProperty('quarantine_reason');
    expect(decision.meta).not.toHaveProperty('skipped_duplicate');
  });

  it('keeps lookalike quality rows blocked unless every controlled rewrite marker is present', () => {
    const baseMeta = {
      micro_angle: 'airport_arrival',
      controlled_publish_canary: true,
      editor_approved_seed: true,
      information_research_bundle: { version: 'reviewed-source-direct-fetch-v2' },
      ai_orchestration_v4: {
        version: 'blog-deepseek-orchestrator-v4',
        route: 'rewrite_pro_high',
        next_stage: 'rewrite_pro_high',
        failure_evidence: ['editorial_harness_single_rewrite'],
      },
    };
    for (const row of [
      failedResearchRow({
        source: 'information',
        status: 'skipped',
        last_error: 'blog_quality_v4_rewrite_pro_high:editorial_harness_single_rewrite',
        meta: baseMeta,
      }),
      failedResearchRow({
        source: 'user_seed',
        status: 'skipped',
        last_error: 'blog_quality_v4_rewrite_pro_high:editorial_harness_single_rewrite',
        meta: { ...baseMeta, controlled_publish_canary: false },
      }),
      failedResearchRow({
        source: 'user_seed',
        status: 'skipped',
        last_error: 'blog_quality_v4_rewrite_pro_high:editorial_harness_single_rewrite',
        meta: { ...baseMeta, information_research_bundle: null },
      }),
    ]) {
      expect(buildBlogInformationResearchRecheckDecision({ row }).reason)
        .toBe('not_information_research_failure');
    }
  });

  it('requeues exactly one quarantined controlled canary after the known harness defects', () => {
    const failureMarkers = [
      'editorial_harness_retry_exhausted',
      'stale_claim_present',
      'publish_gate:structure_integrity',
      'publish_gate:intent_quality',
      'publish_gate:engine_v2',
      'editorial_harness_v5:semantic_usefulness',
      'editorial_harness_v5:semantic_completeness',
    ];
    const decision = buildBlogInformationResearchRecheckDecision({
      row: failedResearchRow({
        source: 'user_seed',
        status: 'failed',
        last_error: `blog_quality_v4_quarantine:${failureMarkers.join(',')}`,
        meta: {
          micro_angle: 'airport_arrival',
          controlled_publish_canary: true,
          editor_approved_seed: true,
          information_research_bundle: { version: 'reviewed-source-direct-fetch-v2' },
          information_research_recheck_version: 'blog-information-research-recheck-20260831-v7',
          information_research_recheck_result: 'bounded_orchestrator_rewrite_requeued',
          requeued_by: 'blog-information-research-recheck-20260831-v7',
          failure_code: 'quality_quarantine',
          quarantine_reason: 'quality_retry_exhausted',
          ai_orchestration_v4: {
            version: 'blog-deepseek-orchestrator-v4',
            route: 'quarantine',
            next_stage: null,
            failure_evidence: failureMarkers,
          },
        },
      }),
      checkedAt: '2026-08-31T01:00:00.000Z',
    });

    expect(decision).toMatchObject({
      action: 'requeue',
      intent: 'airport_transport',
      reason: 'controlled_harness_defect_rewrite_retry',
      meta: {
        information_research_recheck_result: 'controlled_harness_defect_rewrite_requeued',
        ai_orchestration_v4: {
          route: 'rewrite_pro_max',
          next_stage: 'rewrite_pro_max',
        },
      },
    });
    expect(decision.meta).not.toHaveProperty('quarantine_reason');
  });

  it('keeps a harness-defect lookalike blocked when one exact marker is missing', () => {
    const decision = buildBlogInformationResearchRecheckDecision({
      row: failedResearchRow({
        source: 'user_seed',
        status: 'failed',
        last_error: 'blog_quality_v4_quarantine:editorial_harness_retry_exhausted,stale_claim_present,publish_gate:structure_integrity,publish_gate:intent_quality,publish_gate:engine_v2,editorial_harness_v5:semantic_usefulness',
        meta: {
          micro_angle: 'airport_arrival',
          controlled_publish_canary: true,
          editor_approved_seed: true,
          information_research_bundle: { version: 'reviewed-source-direct-fetch-v2' },
          information_research_recheck_version: 'blog-information-research-recheck-20260831-v7',
          information_research_recheck_result: 'bounded_orchestrator_rewrite_requeued',
          ai_orchestration_v4: {
            version: 'blog-deepseek-orchestrator-v4',
            route: 'quarantine',
            failure_evidence: [],
          },
        },
      }),
    });

    expect(decision.reason).toBe('not_information_research_failure');
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

  it('allows only a fully contracted human-reviewed published replacement past the original duplicate', () => {
    const replacementMeta = {
      micro_angle: 'entry_requirements',
      failure_code: 'evidence_insufficient',
      quality_upgrade: {
        execution_mode: 'human_review',
        requires_human_review: true,
      },
      private_regeneration: {
        mode: 'replace_published_after_quality_gate',
        atomic_publish_replace: true,
      },
    };

    expect(buildBlogInformationResearchRecheckDecision({
      row: failedResearchRow({
        topic: '태국 입국 요건과 비자',
        destination: '태국',
        meta: replacementMeta,
      }),
      activeDuplicateId: 'published-original',
    })).toMatchObject({
      action: 'requeue',
      reason: 'live_verified_research_retry',
    });

    expect(buildBlogInformationResearchRecheckDecision({
      row: failedResearchRow({
        topic: '태국 입국 요건과 비자',
        destination: '태국',
        meta: {
          ...replacementMeta,
          private_regeneration: {
            mode: 'replace_published_after_quality_gate',
            atomic_publish_replace: false,
          },
        },
      }),
      activeDuplicateId: 'published-original',
    }).action).toBe('skip_duplicate');

    expect(buildBlogInformationResearchRecheckDecision({
      row: failedResearchRow({
        topic: '태국 입국 요건과 비자',
        destination: '태국',
        meta: replacementMeta,
      }),
      activeDuplicateId: 'published-original',
      alreadyRequeuedId: 'replacement-queued-this-run',
    }).action).toBe('skip_duplicate');
  });
});
