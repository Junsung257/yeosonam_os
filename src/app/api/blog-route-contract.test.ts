import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('blog API and editorial audit contracts', () => {
  it('accepts standard content_creatives UUID ids for blog detail lookup', () => {
    const route = source('src/app/api/blog/route.ts');

    expect(route).toContain('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}');
    expect(route).toContain('isValidContentCreativeId(id)');
  });

  it('attaches product data to public blog id responses only through public snapshots', () => {
    const route = source('src/app/api/blog/route.ts');
    const idBranchStart = route.indexOf('if (id) {');
    const adminBranchStart = route.indexOf("if (searchParams.get('admin') === '1')");
    const idBranch = route.slice(idBranchStart, adminBranchStart);

    expect(route).toContain('attachPublicPackageSnapshotToBlogPost');
    expect(route).toContain('fetchAndMergeCurrentPublicPackageCardSnapshots');
    expect(route).toContain('isBlogApiPublicSnapshotCandidate');
    expect(idBranch).not.toContain('travel_packages(');
    expect(idBranch).toContain('product_id, destination');
    expect(idBranch).toContain('const post = await attachPublicPackageSnapshotToBlogPost');
  });

  it('lets the editorial web audit recover the largest rendered body when article is shell-only', () => {
    const audit = source('scripts/audit-blog-editorial-quality.ts');

    expect(audit).toContain('selectRenderedContentRoot');
    expect(audit).toContain("$('article, .prose-blog, .prose, [data-blog-body], main')");
    expect(audit).toContain('articleElement && textLength($, articleElement) >= 200');
  });

  it('does not publish an informational review draft before human approval', () => {
    const route = source('src/app/api/blog/route.ts');

    expect(route).toContain('Human review approval is required before publishing this informational draft');
    expect(route).toContain('getInformationalReviewBlockReason');
    expect(route).toContain('{ status: 409 }');
  });

  it('uses exact list counts and does not index a draft through force revalidation', () => {
    const route = source('src/app/api/blog/route.ts');

    expect(route).toContain(".select(BLOG_LIST_SELECT, { count: 'exact' })");
    expect(route).toContain('.range(offset, offset + limit - 1)');
    expect(route).toContain("target.status !== 'published' || reviewBlock");
    expect(route).toContain('Only an approved published article can be reindexed');
  });
});
