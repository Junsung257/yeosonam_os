import { describe, expect, it } from 'vitest';
import {
  buildBlogPublishableDuplicateMeta,
  planBlogPublishableDuplicateCleanup,
} from './blog-publishable-duplicate-cleanup';

describe('blog publishable duplicate cleanup', () => {
  it('skips queued duplicates while keeping the first active candidate', () => {
    const actions = planBlogPublishableDuplicateCleanup({
      activeRows: [
        { id: 'keep', status: 'queued', topic: 'Bali food budget', destination: 'Bali', meta: { micro_angle: 'food_budget' } },
        { id: 'drop', status: 'queued', topic: 'Bali food budget duplicate', destination: 'Bali', meta: { micro_angle: 'food_budget' } },
      ],
    });

    expect(actions).toEqual([{
      id: 'drop',
      duplicate_key: 'info_writer::bali::food_budget',
      duplicate_keep_id: 'keep',
      reason: 'queued_duplicate',
    }]);
  });

  it('skips candidates that duplicate recent published posts', () => {
    const actions = planBlogPublishableDuplicateCleanup({
      activeRows: [
        { id: 'queued', status: 'queued', topic: 'Bali airport', meta: { expected_slug: 'bali-airport' } },
      ],
      recentPublishedRows: [
        { id: 'published', status: 'published', slug: 'bali-airport' },
      ],
    });

    expect(actions).toEqual([{
      id: 'queued',
      duplicate_key: 'info_writer::slug::bali-airport',
      duplicate_keep_id: 'published',
      reason: 'recent_published_duplicate',
    }]);
  });

  it('does not clean pillar or evidence-blocked candidates', () => {
    const actions = planBlogPublishableDuplicateCleanup({
      activeRows: [
        { id: 'pillar-1', source: 'pillar', topic: 'Bali guide' },
        { id: 'pillar-2', source: 'pillar', topic: 'Bali guide' },
        { id: 'blocked-1', topic: 'Blocked', meta: { failure_code: 'evidence_insufficient' } },
        { id: 'blocked-2', topic: 'Blocked', meta: { failure_code: 'evidence_insufficient' } },
      ],
    });

    expect(actions).toEqual([]);
  });

  it('keeps an atomic published upgrade ahead of a higher-priority refill candidate', () => {
    const actions = planBlogPublishableDuplicateCleanup({
      activeRows: [
        {
          id: 'refill',
          content_creative_id: null,
          priority: 90,
          destination: 'Cebu',
          meta: { micro_angle: 'weather_packing' },
        },
        {
          id: 'upgrade',
          content_creative_id: 'published-creative',
          priority: 70,
          destination: 'Cebu',
          meta: {
            micro_angle: 'weather_packing',
            private_regeneration: {
              mode: 'replace_published_after_quality_gate',
              atomic_publish_replace: true,
            },
          },
        },
      ],
    });

    expect(actions).toEqual([{
      id: 'refill',
      duplicate_key: 'info_writer::cebu::weather_packing',
      duplicate_keep_id: 'upgrade',
      reason: 'queued_duplicate',
    }]);
  });

  it('allows an atomic upgrade to overlap its published target', () => {
    const actions = planBlogPublishableDuplicateCleanup({
      activeRows: [{
        id: 'upgrade',
        content_creative_id: 'published',
        destination: 'Cebu',
        meta: {
          micro_angle: 'weather_packing',
          private_regeneration: {
            mode: 'replace_published_after_quality_gate',
            atomic_publish_replace: true,
          },
        },
      }],
      recentPublishedRows: [{
        id: 'published',
        destination: 'Cebu',
        generation_meta: { micro_angle: 'weather_packing' },
      }],
    });

    expect(actions).toEqual([]);
  });

  it('does not protect malformed upgrade metadata without a target creative', () => {
    const actions = planBlogPublishableDuplicateCleanup({
      activeRows: [{
        id: 'malformed',
        destination: 'Cebu',
        meta: {
          micro_angle: 'weather_packing',
          private_regeneration: {
            mode: 'replace_published_after_quality_gate',
            atomic_publish_replace: true,
          },
        },
      }],
      recentPublishedRows: [{
        id: 'published',
        destination: 'Cebu',
        generation_meta: { micro_angle: 'weather_packing' },
      }],
    });

    expect(actions).toEqual([{
      id: 'malformed',
      duplicate_key: 'info_writer::cebu::weather_packing',
      duplicate_keep_id: 'published',
      reason: 'recent_published_duplicate',
    }]);
  });

  it('builds durable duplicate quarantine metadata', () => {
    expect(buildBlogPublishableDuplicateMeta({
      meta: { previous: true },
      duplicateKey: 'info_writer::slug::bali-airport',
      duplicateKeepId: 'keep',
      reason: 'queued_duplicate',
      checkedAt: '2026-07-02T00:00:00.000Z',
    })).toMatchObject({
      previous: true,
      self_heal_blocked: true,
      quarantine_reason: 'duplicate_preclaim',
      duplicate_key: 'info_writer::slug::bali-airport',
      duplicate_keep_id: 'keep',
      duplicate_reason: 'queued_duplicate',
      quarantined_by: 'blog-publishable-duplicate-cleanup',
      quarantined_at: '2026-07-02T00:00:00.000Z',
    });
  });
});
