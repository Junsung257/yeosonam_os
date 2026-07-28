import { describe, expect, it } from 'vitest';
import { inspectBlogCandidatePrepublishContract } from './blog-candidate-prepublish-contract';
import {
  buildPublishedBlogUpgradeQueueTopic,
  hasPrivateBlogRegenerationIntent,
  isEligiblePrivateBlogRegenerationTarget,
  isPublishedBlogAtomicUpgradeRequest,
  preservePublishedBlogAtomicUpgradeSlug,
  readPrivateBlogRegenerationRequest,
} from './blog-private-regeneration';

describe('private blog regeneration contract', () => {
  it('builds a reader-facing queue topic from the canonical slug', () => {
    expect(buildPublishedBlogUpgradeQueueTopic({
      slug: 'bohol-monthly-weather_and-clothes|2026',
      destination: '보홀',
    })).toBe('bohol monthly weather and clothes 2026');
    expect(buildPublishedBlogUpgradeQueueTopic({
      slug: '%EB%B3%B4%ED%99%80-%EC%9A%B0%EA%B8%B0-%EB%82%A0%EC%94%A8',
      destination: '보홀',
    })).toBe('보홀 우기 날씨');
    expect(buildPublishedBlogUpgradeQueueTopic({
      slug: '보홀-6월-날씨와-옷차림-완벽-가이드',
      destination: '보홀',
    })).toBe('보홀 6월 날씨와 옷차림');
    expect(buildPublishedBlogUpgradeQueueTopic({
      slug: '2026-bohol-weather-guide',
      destination: '보홀',
    })).toBe('보홀 2026 bohol weather guide');
  });

  it('uses a safe destination fallback when a legacy slug is empty or malformed', () => {
    expect(buildPublishedBlogUpgradeQueueTopic({
      slug: '',
      destination: '보홀|필리핀',
    })).toBe('보홀 필리핀 현지 여행 정보');
    expect(buildPublishedBlogUpgradeQueueTopic({
      slug: '%E0%A4%A',
      destination: '보홀',
    })).toBe('보홀 현지 여행 정보');
  });

  it('produces topics that pass the candidate pre-publish contract', () => {
    for (const slug of [
      '보홀-월별-날씨와-옷차림-가이드',
      '보홀-6월-날씨와-옷차림-완벽-가이드',
      '2026-bohol-weather-guide',
      'bohol-weather|clothes',
    ]) {
      const topic = buildPublishedBlogUpgradeQueueTopic({ slug, destination: '보홀' });
      expect(inspectBlogCandidatePrepublishContract({
        topic,
        destination: '보홀',
      }).passed).toBe(true);
    }
  });

  it('preserves the canonical slug for atomic published upgrades', () => {
    expect(preservePublishedBlogAtomicUpgradeSlug({
      publishedAtomicUpgrade: true,
      originalSlug: '보홀-월별-날씨와-옷차림-가이드',
      generatedSlug: 'bohol-weather',
    })).toBe('보홀-월별-날씨와-옷차림-가이드');
    expect(preservePublishedBlogAtomicUpgradeSlug({
      publishedAtomicUpgrade: false,
      originalSlug: 'existing-slug',
      generatedSlug: 'new-generated-slug',
    })).toBe('new-generated-slug');
  });

  it('accepts only an explicit private replacement request linked to an existing creative', () => {
    expect(hasPrivateBlogRegenerationIntent({
      meta: { private_regeneration: {} },
    })).toBe(true);
    expect(readPrivateBlogRegenerationRequest({
      content_creative_id: 'creative-1',
      meta: {
        private_regeneration: {
          mode: 'replace_existing_fallback_draft',
          force_private_review: true,
        },
      },
    })).toEqual({
      mode: 'replace_existing_fallback_draft',
      contentCreativeId: 'creative-1',
    });
    expect(readPrivateBlogRegenerationRequest({
      content_creative_id: 'creative-1',
      meta: { private_regeneration: { mode: 'replace_existing_fallback_draft' } },
    })).toBeNull();
    expect(hasPrivateBlogRegenerationIntent({ meta: {} })).toBe(false);
  });

  it('accepts an explicit published replacement that preserves the canonical row', () => {
    const request = readPrivateBlogRegenerationRequest({
      content_creative_id: 'creative-1',
      meta: {
        private_regeneration: {
          mode: 'replace_published_after_quality_gate',
          atomic_publish_replace: true,
        },
      },
    });
    expect(request).toEqual({
      mode: 'replace_published_after_quality_gate',
      contentCreativeId: 'creative-1',
    });
    expect(isPublishedBlogAtomicUpgradeRequest(request)).toBe(true);
    expect(isEligiblePrivateBlogRegenerationTarget({
      id: 'creative-1',
      channel: 'naver_blog',
      status: 'published',
      product_id: null,
      generation_meta: {},
    }, request!)).toBe(true);
    expect(isEligiblePrivateBlogRegenerationTarget({
      id: 'creative-1',
      channel: 'naver_blog',
      status: 'published',
      product_id: 'product-1',
      generation_meta: {},
    }, request!)).toBe(false);
  });

  it('allows replacement only when the linked post is a private fallback draft', () => {
    const request = {
      mode: 'replace_existing_fallback_draft' as const,
      contentCreativeId: 'creative-1',
    };
    expect(isEligiblePrivateBlogRegenerationTarget({
      id: 'creative-1',
      channel: 'naver_blog',
      status: 'draft',
      generation_meta: { deterministic_info_fallback: true },
    }, request)).toBe(true);
    expect(isEligiblePrivateBlogRegenerationTarget({
      id: 'creative-1',
      channel: 'naver_blog',
      status: 'published',
      generation_meta: { deterministic_info_fallback: true },
    }, request)).toBe(false);
    expect(isEligiblePrivateBlogRegenerationTarget({
      id: 'creative-1',
      channel: 'naver_blog',
      status: 'draft',
      generation_meta: {},
    }, request)).toBe(false);
  });
});
