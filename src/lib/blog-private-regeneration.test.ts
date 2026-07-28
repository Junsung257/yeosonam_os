import { describe, expect, it } from 'vitest';
import {
  hasPrivateBlogRegenerationIntent,
  isEligiblePrivateBlogRegenerationTarget,
  isPublishedBlogAtomicUpgradeRequest,
  readPrivateBlogRegenerationRequest,
} from './blog-private-regeneration';

describe('private blog regeneration contract', () => {
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
