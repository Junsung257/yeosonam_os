import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('V6.1 blog product authority boundary', () => {
  it('loads product generation from the published fact view', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/cron/blog-publisher/route.ts'), 'utf8');
    expect(route).toContain('getPublishedBlogContentFactById');
    expect(route).toContain('buildProductBlogBriefFromPublishedFact');
    expect(route).not.toContain(".from('travel_packages')");
  });

  it('keeps the published brief bound to source revision and refresh metadata', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/blog-product-brief.ts'), 'utf8');
    expect(source).toContain('source_revision_id');
    expect(source).toContain('refresh_required_at');
    expect(source).toContain('product-template-v6.1-published-fact-1');
  });
});
