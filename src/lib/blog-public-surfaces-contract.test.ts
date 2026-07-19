import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PUBLIC_SURFACES = [
  'src/app/blog/BlogData.tsx',
  'src/app/blog/[slug]/page.tsx',
  'src/app/blog/[slug]/opengraph-image.tsx',
  'src/app/blog/angle/[angle]/page.tsx',
  'src/app/blog/destination/[dest]/page.tsx',
  'src/app/api/rss/route.ts',
  'src/app/llms.txt/route.ts',
  'src/app/sitemap.ts',
  'src/app/api/blog/reindex/route.ts',
  'src/app/api/blog/bulk-reindex/route.ts',
  'src/app/destinations/[city]/rss.xml/route.ts',
  'src/app/destinations/[city]/page.tsx',
  'src/app/destinations/region/[region]/page.tsx',
  'src/app/destinations/page.tsx',
  'src/app/page.tsx',
  'src/app/api/admin/blog/visibility/route.ts',
  'src/app/api/cron/gsc-index-rank/route.ts',
] as const;

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('public blog surface contract', () => {
  it.each(PUBLIC_SURFACES)('%s reads blog rows from the canonical public source', (path) => {
    const contents = source(path);
    expect(contents).toContain('PUBLIC_BLOG_READ_SOURCE');
    expect(contents).not.toContain(".from('content_creatives')");
  });

  it('keeps the mixed public/admin API public reads on the canonical source', () => {
    const contents = source('src/app/api/blog/route.ts');
    const publicSlugBranch = contents.slice(
      contents.indexOf('if (slug) {'),
      contents.indexOf('const offset ='),
    );
    const publicListBranch = contents.slice(
      contents.indexOf('let query = supabaseAdmin', contents.indexOf('const offset =')),
      contents.indexOf('if (destination)'),
    );

    expect(publicSlugBranch).toContain('.from(PUBLIC_BLOG_READ_SOURCE)');
    expect(publicListBranch).toContain('.from(PUBLIC_BLOG_READ_SOURCE)');
  });

  it('does not synthesize fallback articles for public detail, list, API, or sitemap output', () => {
    for (const path of [
      'src/app/blog/BlogData.tsx',
      'src/app/blog/[slug]/page.tsx',
      'src/app/api/blog/route.ts',
      'src/app/sitemap.ts',
    ]) {
      expect(source(path)).not.toContain("@/lib/blog-public-fallback");
    }
    expect(source('src/app/api/blog/route.ts')).toContain("'Cache-Control': 'no-store'");
  });

  it('demotes ungated material edits so old gate proofs cannot stay public', () => {
    const contents = source('src/app/api/blog/route.ts');
    expect(contents).toContain('changesPublicContract');
    expect(contents).toContain("updateData.status = 'draft'");
    expect(contents).toContain('updateData.quality_gate = null');
  });

  it('invalidates public caches after a review decision changes eligibility', () => {
    const contents = source('src/app/api/content-review/route.ts');
    const decisionIndex = contents.indexOf('await submitReview({');
    const revalidateIndex = contents.indexOf('revalidatePublicBlogCache();');
    expect(decisionIndex).toBeGreaterThan(0);
    expect(revalidateIndex).toBeGreaterThan(decisionIndex);
  });

  it('does not downgrade taxonomy database outages into indexable empty pages', () => {
    const angle = source('src/app/blog/angle/[angle]/page.tsx');
    const destination = source('src/app/blog/destination/[dest]/page.tsx');

    expect(angle).not.toContain('return { posts: [], recommendedPackages: [], unavailable: true }');
    expect(destination).not.toContain('return { destination: fallbackDestination, posts: [], packages: [], unavailable: true }');
  });
});
