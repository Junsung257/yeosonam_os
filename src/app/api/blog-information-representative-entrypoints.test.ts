import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('informational representative enforcement across publish entrypoints', () => {
  it.each([
    'src/app/api/blog/route.ts',
    'src/app/api/content-hub/publish/route.ts',
    'src/app/api/content-queue/route.ts',
  ])('enforces the representative registry before public state in %s', (path) => {
    const route = source(path);
    expect(route).toContain('ensureBlogInformationRepresentativeForPublish');
    expect(route).toContain('information_representative');
    expect(route).toContain("status: 'active'");
  });

  it('reserves before insert and activates only after the automatic creative exists', () => {
    const route = source('src/app/api/cron/blog-publisher/route.ts');
    const reserve = route.indexOf('await reserveBlogInformationRepresentative({');
    const insert = route.indexOf('.insert(rowPayload)', reserve);
    const activate = route.indexOf('await activateBlogInformationRepresentative({', insert);
    expect(reserve).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(reserve);
    expect(activate).toBeGreaterThan(insert);
    expect(route).toContain("status: 'skipped_duplicate'");
    expect(route).toContain("proposed_action: 'update_existing'");
  });

  it('keeps only canonical-active new information rows in the sitemap', () => {
    const sitemap = source('src/app/sitemap.ts');
    expect(sitemap).toContain('isCanonicalInformationSitemapPost');
    expect(sitemap).toContain('generation_meta');
    expect(sitemap).toContain('for (const post of canonicalPosts)');
  });
});
