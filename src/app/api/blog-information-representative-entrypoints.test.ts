import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('informational representative enforcement across publish entrypoints', () => {
  it.each([
    'src/app/api/blog/route.ts',
    'src/app/api/content-hub/publish/route.ts',
    'src/app/api/content-queue/route.ts',
  ])('uses atomic information publication instead of a split public transition in %s', (path) => {
    const route = source(path);
    expect(route).toContain('publishBlogInformationAtomically');
    expect(route).toContain('information_representative');
    expect(route).toContain("status: 'pending_publication'");
  });

  it('keeps automatic information private until the atomic publication RPC succeeds', () => {
    const route = source('src/app/api/cron/blog-publisher/route.ts');
    const insert = route.indexOf('.insert(rowPayload)');
    const atomicPublish = route.indexOf('await publishBlogInformationAtomically({', insert);
    expect(insert).toBeGreaterThan(0);
    expect(atomicPublish).toBeGreaterThan(insert);
    expect(route).toContain("contentBoundary.lane === 'informational' || requiresHumanReview ? 'draft' : 'published'");
    expect(route).not.toContain('await activateBlogInformationRepresentative({');
    expect(route).toContain("status: 'skipped_duplicate'");
    expect(route).toContain("proposed_action: 'update_existing'");
  });

  it('reads only centrally eligible information rows into the sitemap', () => {
    const sitemap = source('src/app/sitemap.ts');
    const catalog = source('src/lib/blog-public-catalog.ts');
    expect(sitemap).toContain("import { loadPublicBlogCatalog } from '@/lib/blog-public-catalog'");
    expect(sitemap).toContain('loadPublicBlogCatalog()');
    expect(catalog).toContain('.from(PUBLIC_BLOG_READ_SOURCE)');
    expect(catalog).not.toContain('generation_meta');
    expect(sitemap).toContain('for (const post of canonicalPosts)');
    expect(sitemap).not.toContain('isCanonicalInformationSitemapPost');
  });
});
