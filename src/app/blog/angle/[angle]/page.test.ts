import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('/blog/angle/[angle] rendering contract', () => {
  it('renders uncached route shells while retaining the cached catalog', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/blog/angle/[angle]/page.tsx'),
      'utf8',
    );

    expect(source).toContain("export const dynamic = 'force-dynamic';");
    expect(source).toContain('const getCachedAnglePageData = unstable_cache(');
  });
});
