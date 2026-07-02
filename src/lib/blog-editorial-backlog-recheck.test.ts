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
      requeued_by: 'blog-editorial-backlog-recheck-20260702',
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
    })).toEqual({
      write_recommended: true,
      write_reasons: ['requeue_repaired_editorial_rows', 'skip_duplicate_editorial_rows'],
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
