import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface DetailBundleRow {
  slug: string;
  legacy_markdown: string | null;
  content_document: { markdown?: unknown } | null;
  generation_meta: Record<string, unknown>;
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
    expect(bundle.count).toBeGreaterThanOrEqual(192);
    expect(new Set(bundle.posts.map((post) => post.slug)).size).toBe(bundle.posts.length);
    for (const post of bundle.posts) {
      const body = post.legacy_markdown
        || (typeof post.content_document?.markdown === 'string' ? post.content_document.markdown : '');
      expect(body.replace(/\s+/g, '').length).toBeGreaterThanOrEqual(200);
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
