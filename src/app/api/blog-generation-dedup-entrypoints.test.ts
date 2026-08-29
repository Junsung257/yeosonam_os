import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('blog generation dedup entrypoints', () => {
  it.each([
    'src/app/api/blog/route.ts',
    'src/app/api/blog/bulk-generate/route.ts',
    'src/app/api/blog/from-card-news/route.ts',
    'src/app/api/blog/mrt-hotel-ranking/route.ts',
    'src/app/api/content-hub/generate/route.ts',
    'src/app/api/admin/ad-os/creative-factory/route.ts',
  ])('routes new blog rows through the shared insert gate: %s', (path) => {
    const contents = source(path);
    expect(contents).toContain('insertBlogCreativeWithDedup');
  });

  it('routes the automatic publisher through the atomic claim before insert/update', () => {
    const contents = source('src/app/api/cron/blog-publisher/route.ts');
    expect(contents).toContain('claimBlogGenerationDedup');
    expect(contents).toContain('bindBlogGenerationDedup');
    expect(contents).toContain('releaseBlogGenerationDedup');
    expect(contents).toContain('blog_generation_dedup');
  });

  it.each([
    'src/app/api/blog/route.ts',
    'src/app/api/content-hub/publish/route.ts',
    'src/app/api/content-queue/route.ts',
  ])('checks existing rows before publishing: %s', (path) => {
    expect(source(path)).toContain('findBlogGenerationDuplicateReport');
  });
});
