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

function publicOnlySource(path: string, contents: string): string {
  if (path !== 'src/app/blog/[slug]/page.tsx') return contents;
  const previewStart = contents.indexOf('async function getDraftPreviewPost(');
  const previewEnd = contents.indexOf('function isMissingV3DetailProjection(', previewStart);
  expect(previewStart).toBeGreaterThan(0);
  expect(previewEnd).toBeGreaterThan(previewStart);
  return `${contents.slice(0, previewStart)}${contents.slice(previewEnd)}`;
}

describe('public blog surface contract', () => {
  it.each(PUBLIC_SURFACES)('%s reads blog rows from the canonical public source', (path) => {
    const contents = source(path);
    const publicContents = publicOnlySource(path, contents);
    expect(
      publicContents.includes('PUBLIC_BLOG_READ_SOURCE')
      || publicContents.includes('loadPublicBlogCatalog'),
    ).toBe(true);
    expect(publicContents).not.toContain(".from('content_creatives')");
  });

  it('allows the authenticated noindex draft preview to read only its verified draft row', () => {
    const contents = source('src/app/blog/[slug]/page.tsx');
    const previewStart = contents.indexOf('async function getDraftPreviewPost(');
    const previewEnd = contents.indexOf('function isMissingV3DetailProjection(', previewStart);
    const previewBlock = contents.slice(previewStart, previewEnd);

    expect(previewBlock).toContain('verifyBlogPreviewToken({ token, slug })');
    expect(previewBlock).toContain(".from('content_creatives')");
    expect(previewBlock).toContain(".eq('id', verified.creativeId)");
    expect(previewBlock).toContain(".eq('status', 'draft')");
    expect(previewBlock).toContain('unstable_noStore()');
  });

  it('keeps the shared public catalog on the canonical public source', () => {
    const contents = source('src/lib/blog-public-catalog.ts');
    expect(contents).toContain('.from(PUBLIC_BLOG_READ_SOURCE)');
    expect(contents).not.toContain(".from('content_creatives')");
  });

  it('keeps the mixed public/admin API public reads on the canonical source', () => {
    const contents = source('src/app/api/blog/route.ts');
    const publicSlugBranch = contents.slice(
      contents.indexOf('if (slug) {'),
      contents.indexOf('const offset ='),
    );
    const publicListBranch = contents.slice(
      contents.indexOf('const offset ='),
      contents.indexOf('const payload:'),
    );

    expect(publicSlugBranch).toContain('loadPublicBlogCatalog()');
    expect(publicListBranch).toContain('loadPublicBlogCatalog()');
    expect(source('src/lib/blog-public-catalog.ts')).toContain('.from(PUBLIC_BLOG_READ_SOURCE)');
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
    const revalidateIndex = contents.lastIndexOf('revalidatePublicBlogCache();');
    expect(decisionIndex).toBeGreaterThan(0);
    expect(revalidateIndex).toBeGreaterThan(decisionIndex);
  });

  it('labels taxonomy database outages instead of presenting them as empty categories', () => {
    const angle = source('src/app/blog/angle/[angle]/page.tsx');
    const destination = source('src/app/blog/destination/[dest]/page.tsx');

    expect(angle).toContain('return { posts: [], recommendedPackages: [], unavailable: true }');
    expect(angle).toContain('unavailable ? (');
    expect(angle).toContain('발행 글이 없는 상태가 아니라 DB 응답 지연입니다.');
    expect(destination).toContain('posts: [],');
    expect(destination).toContain('unavailable: true');
    expect(destination).toContain('unavailable ? (');
    expect(destination).toContain('발행 글이 없는 상태가 아니라 DB 응답 지연입니다.');
  });
});
