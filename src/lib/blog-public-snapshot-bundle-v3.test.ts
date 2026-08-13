import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isBlogPublicDetailSnapshotPolicySafeV3,
  type BlogPublicDetailSnapshotV3,
} from './blog-public-snapshot-v3';
import { getBlogPublicSurfacePolicyBlockReason } from './blog-public-eligibility';

interface DetailBundleRow {
  slug: string;
  legacy_markdown: string | null;
  content_document: { markdown?: unknown } | null;
  generation_meta: Record<string, unknown>;
  review_status?: string | null;
}

describe('bundled public detail snapshot v3', () => {
  const path = join(process.cwd(), 'src/data/blog-public-detail-snapshot-v3.json');
  const bundle = JSON.parse(readFileSync(path, 'utf8')) as {
    generated_at: string | null;
    count: number;
    posts: DetailBundleRow[];
  };

  it('contains one usable full body for every recorded public article', () => {
    expect(bundle.generated_at).toBeTruthy();
    expect(bundle.count).toBe(bundle.posts.length);
    expect(bundle.count).toBeGreaterThanOrEqual(170);
    expect(new Set(bundle.posts.map((post) => post.slug)).size).toBe(bundle.posts.length);
    for (const post of bundle.posts) {
      const body = post.legacy_markdown
        || (typeof post.content_document?.markdown === 'string' ? post.content_document.markdown : '');
      expect(body.replace(/\s+/g, '').length).toBeGreaterThanOrEqual(200);
      expect(isBlogPublicDetailSnapshotPolicySafeV3(
        post as unknown as BlogPublicDetailSnapshotV3,
      )).toBe(true);
    }
  });

  it('stays below the guarded server bundle size and omits bulky prompt metadata', () => {
    expect(statSync(path).size).toBeLessThan(8 * 1024 * 1024);
    for (const post of bundle.posts) {
      expect(post.generation_meta).not.toHaveProperty('prompt_manifest');
      expect(post.generation_meta).not.toHaveProperty('auto_research');
    }
  });
});

describe('bundled public catalog snapshot v3', () => {
  const path = join(process.cwd(), 'src/data/blog-public-catalog-snapshot-v3.json');
  const bundle = JSON.parse(readFileSync(path, 'utf8')) as {
    count: number;
    posts: Array<Record<string, unknown>>;
  };

  it('contains no review-blocked, redirected, noindex, or unapproved high-risk row', () => {
    expect(bundle.count).toBe(bundle.posts.length);
    expect(bundle.posts.length).toBeGreaterThanOrEqual(170);
    for (const post of bundle.posts) {
      expect(getBlogPublicSurfacePolicyBlockReason({
        productId: typeof post.product_id === 'string' ? post.product_id : null,
        reviewStatus: typeof post.review_status === 'string' ? post.review_status : null,
        title: typeof post.seo_title === 'string' ? post.seo_title : null,
        category: typeof post.category === 'string' ? post.category : null,
        contentType: typeof post.content_type === 'string' ? post.content_type : null,
        topic: typeof post.topic_source === 'string' ? post.topic_source : null,
        generationMeta: post.generation_meta && typeof post.generation_meta === 'object'
          ? post.generation_meta as Record<string, unknown> : null,
      })).toBeNull();
    }
  });
});
