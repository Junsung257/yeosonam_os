import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('/blog/angle/[angle] rendering contract', () => {
  it('uses on-demand ISR while retaining the cached catalog', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/blog/angle/[angle]/page.tsx'),
      'utf8',
    );

    expect(source).toContain('export const revalidate = 300;');
    expect(source).toContain("export const dynamic = 'force-dynamic';");
    expect(source).toContain('export const dynamicParams = true;');
    expect(source).not.toContain('generateStaticParams');
    expect(source).toContain('const getCachedAnglePageData = unstable_cache(');
  });
});
