import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('/blog/angle/[angle] rendering contract', () => {
  it('uses the shared cached catalog without nesting unstable_cache calls', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/blog/angle/[angle]/page.tsx'),
      'utf8',
    );

    expect(source).toContain('export const revalidate = 300;');
    expect(source).toContain("export const dynamic = 'force-dynamic';");
    expect(source).toContain('export const dynamicParams = true;');
    expect(source).not.toContain('generateStaticParams');
    expect(source).toContain('loadPublicBlogCatalogPage({');
    expect(source).not.toContain('unstable_cache');
  });
});
