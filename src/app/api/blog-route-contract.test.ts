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

  it('lets the editorial web audit recover the largest rendered body when article is shell-only', () => {
    const audit = source('scripts/audit-blog-editorial-quality.ts');

    expect(audit).toContain('selectRenderedContentRoot');
    expect(audit).toContain("$('article, .prose-blog, .prose, [data-blog-body], main')");
    expect(audit).toContain('articleElement && textLength($, articleElement) >= 200');
  });
});
