import { describe, expect, it } from 'vitest';
import {
  buildBlogEditorialBacklogRecheckDecision,
  buildBlogEditorialBacklogRecheckGuidance,
  readBlogEditorialBacklogDedupKey,
} from './blog-editorial-backlog-recheck';

describe('blog editorial backlog recheck', () => {
  it('requeues rows with failures covered by the current editorial repair contract', () => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      checkedAt: '2026-07-02T00:00:00.000Z',
      row: {
        id: 'queue-1',
        status: 'failed',
        attempts: 2,
        topic: 'Mongolia food budget',
        destination: 'Mongolia',
        last_error: '1/19 failed: [intent_quality] early_strong_cta, [engine_v2] sales_pressure',
        meta: {
          failure_code: 'intent_quality',
          quarantine_reason: 'intent_quality',
          self_heal_blocked: true,
        },
      },
    });

    expect(decision.action).toBe('requeue');
    expect(decision.last_error).toBeNull();
    expect(decision.meta).not.toHaveProperty('failure_code');
    expect(decision.meta).not.toHaveProperty('quarantine_reason');
    expect(decision.meta).toMatchObject({
      editorial_backlog_recheck_result: 'requeue',
      requeued_by: 'blog-editorial-backlog-recheck-20260728',
      editorial_backlog_requeue_count: 1,
    });
  });

  it('suppresses the same repaired row after it fails again under the same contract version', () => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      checkedAt: '2026-07-28T01:00:00.000Z',
      row: {
        id: 'queue-repeat',
        status: 'failed',
        attempts: 2,
        topic: '세부 공항 이동',
        destination: '세부',
        last_error: '1/19 failed: [image_quality] image_count_below_minimum',
        meta: {
          failure_code: 'image_quality',
          requeued_by: 'blog-editorial-backlog-recheck-20260728',
          requeued_at: '2026-07-28T00:00:00.000Z',
          editorial_backlog_requeue_count: 1,
        },
      },
    });

    expect(decision.action).toBe('keep_blocked');
    expect(decision.meta).toMatchObject({
      editorial_backlog_recheck_result: 'repeat_suppressed',
      editorial_backlog_repeat_suppressed: true,
      editorial_backlog_requeue_count: 1,
    });
  });

  it('keeps topic and evidence blockers closed until the underlying source is fixed', () => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      row: {
        id: 'queue-topic',
        status: 'failed',
        attempts: 2,
        topic: 'Unsupported honeymoon topic',
        destination: 'Shijiazhuang',
        last_error: '1/19 failed: [topic_fit] destination intent mismatch',
        meta: {
          failure_code: 'topic_fit',
          quarantine_reason: 'topic_fit',
          self_heal_blocked: true,
        },
      },
    });

    expect(decision.action).toBe('keep_blocked');
    expect(decision.meta).toMatchObject({
      editorial_backlog_recheck_result: 'blocked',
    });
  });

  it('requeues product rows when only the generator contract caused the failure', () => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      checkedAt: '2026-07-02T00:00:00.000Z',
      row: {
        id: 'queue-product',
        status: 'failed',
        attempts: 2,
        topic: '푸꾸옥 PKG ZE 푸꾸옥 2색골프 4박6일 가성비 리뷰',
        destination: '푸꾸옥',
        product_id: 'pkg-1',
        last_error: '2/19 failed: [keyword_density] stuffing risk, [engine_v2] faithfulness',
        meta: {
          writer_type: 'product_consultant_writer',
          product_dedup_key: 'pkg-1|2026-07-11|6d|ZE',
          failure_code: 'keyword_density',
          quarantine_reason: 'keyword_density',
        },
      },
    });

    expect(decision.action).toBe('requeue');
    expect(decision.dedup_key).toBe('product_consultant_writer::product::pkg-1|2026-07-11|6d|ze');
    expect(decision.last_error).toBeNull();
  });

  it('keeps product evidence failures blocked until product proof is repaired', () => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      row: {
        id: 'queue-product-proof',
        status: 'failed',
        attempts: 0,
        topic: '광저우 품격패키지 가성비 리뷰',
        destination: '광저우',
        product_id: 'pkg-proof',
        last_error: 'product_open_contract: quality_scorecard price_dates mismatch',
        meta: {
          writer_type: 'product_consultant_writer',
          failure_code: 'product_open_contract',
          quarantine_reason: 'product_open_contract',
        },
      },
    });

    expect(decision.action).toBe('keep_blocked');
  });

  it('requeues image shortage rows because the current publisher can insert inline images', () => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      checkedAt: '2026-07-04T00:00:00.000Z',
      row: {
        id: 'queue-image-shortage',
        status: 'failed',
        attempts: 2,
        topic: '세부 공항 도착 후 입국 심사 환전 픽업 순서',
        destination: '세부',
        last_error: '1/19 failed: [image_quality] image_count_below_minimum',
        meta: {
          failure_code: 'image_quality',
          quarantine_reason: 'image_quality',
          quality_gate_failures: ['image_count_below_minimum'],
          self_heal_blocked: true,
        },
      },
    });

    expect(decision.action).toBe('requeue');
    expect(decision.reasons).toContain('image_count_below_minimum');
    expect(decision.last_error).toBeNull();
  });

  it('requeues residual markdown bold failures after render repair support is deployed', () => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      checkedAt: '2026-07-07T00:00:00.000Z',
      row: {
        id: 'queue-markdown-bold',
        status: 'failed',
        attempts: 2,
        topic: 'Bali shopping budget checklist',
        destination: 'Bali',
        last_error: '2/20 실패: [render_integrity] 렌더 결과에 마크다운 잔여물 감지: literal_markdown_bold · [article_quality_v2] article quality v2 failed: standalone_markdown_bold',
        meta: {
          failure_code: 'other',
          quarantine_reason: 'other',
          quality_gate_failures: ['standalone_markdown_bold'],
          self_heal_blocked: true,
        },
      },
    });

    expect(decision.action).toBe('requeue');
    expect(decision.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('literal_markdown_bold'),
      expect.stringContaining('standalone_markdown_bold'),
    ]));
    expect(decision.last_error).toBeNull();
  });

  it('keeps unsafe image evidence blocked when the issue is not just image count', () => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      row: {
        id: 'queue-bad-image',
        status: 'failed',
        attempts: 2,
        topic: 'Bali airport transfer',
        destination: 'Bali',
        last_error: '2/19 failed: [image_quality] malformed_image_url, [image_quality] no_contextual_alt_or_caption',
        meta: {
          failure_code: 'image_quality',
          quarantine_reason: 'image_quality',
          quality_gate_failures: ['malformed_image_url', 'no_contextual_alt_or_caption'],
          self_heal_blocked: true,
        },
      },
    });

    expect(decision.action).toBe('keep_blocked');
    expect(decision.meta).toMatchObject({
      editorial_backlog_recheck_result: 'blocked',
    });
  });

  it('requeues content brief failures after the current brief contract can rebuild the keyword', () => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      checkedAt: '2026-07-02T00:00:00.000Z',
      row: {
        id: 'queue-brief',
        status: 'failed',
        attempts: 2,
        topic: 'Guam budget guide',
        destination: 'Guam',
        last_error: 'blog_content_brief_failed:missing_primary_keyword',
        meta: {
          failure_code: 'other',
          quarantine_reason: 'other',
          self_heal_blocked: true,
        },
      },
    });

    expect(decision.action).toBe('requeue');
    expect(decision.reasons).toContain('blog_content_brief_failed:missing_primary_keyword');
    expect(decision.last_error).toBeNull();
  });

  it('requeues stale generation quarantines when there is no topic or evidence blocker', () => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      checkedAt: '2026-07-02T00:00:00.000Z',
      row: {
        id: 'queue-stale',
        status: 'failed',
        attempts: 2,
        topic: 'Da Nang weather guide',
        destination: 'Da Nang/Hoi An',
        last_error: 'publisher quarantined stale generating 2026-06-27T14:02:48.227Z',
        meta: {
          expected_slug: 'danang-hoian-weather',
          quarantine_reason: 'stale_generating_or_non_retryable_failure',
          self_heal_blocked: true,
        },
      },
    });

    expect(decision.action).toBe('requeue');
    expect(decision.reasons).toContain('stale_generating_or_non_retryable_failure');
  });

  it('requeues timeout-only editorial rows so the publisher can retry with the repaired engine', () => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      checkedAt: '2026-07-09T00:00:00.000Z',
      row: {
        id: 'queue-timeout',
        status: 'failed',
        attempts: 2,
        topic: '세부 공항 도착 후 입국 심사 환전 픽업 순서',
        destination: '세부',
        source: 'coverage_gap',
        last_error: 'topic_generation_timeout:84106ms',
        meta: {
          micro_angle: 'airport_arrival',
          failure_code: 'timeout',
          self_heal_blocked: true,
        },
      },
    });

    expect(decision.action).toBe('requeue');
    expect(decision.last_error).toBeNull();
    expect(decision.meta).toMatchObject({
      editorial_backlog_recheck_result: 'requeue',
    });
  });

  it('retires legacy pillar seeds that were blocked by missing context', () => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      checkedAt: '2026-07-02T00:00:00.000Z',
      row: {
        id: 'queue-pillar',
        status: 'failed',
        attempts: 3,
        topic: 'Phu Quoc travel guide (Pillar)',
        destination: 'Phu Quoc',
        source: 'pillar',
        last_error: 'self-heal quarantined 2026-06-16: context_missing requires manual/editorial rebuild',
        meta: {
          failure_code: 'self_heal_blocked',
          quarantine_reason: 'non_retryable_failure',
          self_heal_blocked: true,
        },
      },
    });

    expect(decision.action).toBe('retire_legacy_seed');
    expect(decision.last_error).toBe('editorial_backlog_recheck_retired_legacy_pillar_seed');
    expect(decision.meta).toMatchObject({
      editorial_backlog_recheck_result: 'retired_legacy_seed',
      retired_legacy_pillar_seed: true,
    });
  });

  it('retires a legacy pillar row even when its stored metadata omits the self-heal marker', () => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      checkedAt: '2026-07-29T00:00:00.000Z',
      row: {
        id: 'queue-pillar-with-narrow-metadata',
        status: 'failed',
        attempts: 1,
        topic: '다낭/호이안 여행 완벽 가이드 (Pillar)',
        destination: '다낭/호이안',
        source: 'pillar',
        last_error: 'context_missing',
        meta: {
          quarantine_reason: 'non_retryable_failure',
        },
      },
    });

    expect(decision.action).toBe('retire_legacy_seed');
    expect(decision.meta).toMatchObject({
      retired_legacy_pillar_seed: true,
      editorial_backlog_recheck_version: 'blog-editorial-backlog-recheck-20260728',
    });
  });

  it('skips recoverable rows when an active duplicate is already available', () => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      activeDuplicateId: 'active-queue',
      row: {
        id: 'queue-dup',
        status: 'failed',
        attempts: 2,
        topic: 'Bali airport transfer',
        destination: 'Bali',
        last_error: '1/19 failed: [structure_integrity] table_integrity:missing_header_separator',
        meta: {
          failure_code: 'structure_integrity',
          quarantine_reason: 'structure_integrity',
          expected_slug: 'bali-airport-transfer',
        },
      },
    });

    expect(decision.action).toBe('skip_duplicate');
    expect(decision.meta).toMatchObject({
      quarantine_reason: 'duplicate_preclaim',
      duplicate_keep_id: 'active-queue',
    });
  });

  it.each([
    'deterministic_info_fallback_not_publishable',
    '2/20 실패: [length] 본문 2493자 — info 최소 2500자 미달 · [article_quality_v2] info_intro_intent_mismatch',
    '2/20 실패: [intent_quality] missing:shopping_items · [image_quality] no_contextual_alt_or_caption',
  ])('requeues current-engine generation failures once: %s', (lastError) => {
    const decision = buildBlogEditorialBacklogRecheckDecision({
      row: {
        id: 'queue-current-engine-retry',
        status: 'failed',
        attempts: 2,
        topic: '괌 여행 정보',
        destination: '괌',
        last_error: lastError,
        meta: {
          expected_slug: 'guam-current-engine-retry',
        },
      },
    });

    expect(decision.action).toBe('requeue');
    expect(decision.meta).toMatchObject({
      editorial_backlog_recheck_result: 'requeue',
      editorial_backlog_requeue_count: 1,
    });
  });

  it('uses product, micro-angle, slug, then topic as stable dedup keys', () => {
    expect(readBlogEditorialBacklogDedupKey({
      topic: 'fallback',
      product_id: 'PKG-1',
      meta: { writer_type: 'product_consultant_writer' },
    })).toBe('product_consultant_writer::product::pkg-1');

    expect(readBlogEditorialBacklogDedupKey({
      topic: 'fallback',
      destination: 'Bali',
      meta: { micro_angle: 'food_budget' },
    })).toBe('info_writer::bali::food_budget');

    expect(readBlogEditorialBacklogDedupKey({
      topic: 'fallback',
      meta: { expected_slug: 'Bali-Food-Budget' },
    })).toBe('info_writer::slug::bali-food-budget');
  });

  it('recommends writes only when recovered or duplicate rows exist', () => {
    expect(buildBlogEditorialBacklogRecheckGuidance({
      requeue: 2,
      duplicateSkipped: 1,
      retiredLegacySeeds: 1,
    })).toEqual({
      write_recommended: true,
      write_reasons: ['requeue_repaired_editorial_rows', 'skip_duplicate_editorial_rows', 'retire_legacy_pillar_rows'],
    });

    expect(buildBlogEditorialBacklogRecheckGuidance({
      requeue: 0,
      duplicateSkipped: 0,
    })).toEqual({
      write_recommended: false,
      write_reasons: [],
    });
  });
});
