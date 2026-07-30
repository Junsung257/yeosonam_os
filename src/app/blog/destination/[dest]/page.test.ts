import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isObviouslyInvalidDestinationRoute } from '../public-route';

describe('/blog/destination/[dest] public route guard', () => {
  it.each(['3', '5', 'top', '대학생', 'kualalumpursingaporemalacca', 'foo%2Fbar'])(
    'rejects an obvious non-destination route: %s',
    (destination) => {
      expect(isObviouslyInvalidDestinationRoute(destination)).toBe(true);
    },
  );

  it.each(['다낭', '푸꾸옥', 'osaka', 'huangshan'])(
    'allows a plausible destination to continue to entity/content resolution: %s',
    (destination) => {
      expect(isObviouslyInvalidDestinationRoute(destination)).toBe(false);
    },
  );

  it('returns 404 for a healthy resolved destination page without published posts', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/blog/destination/[dest]/page.tsx'),
      'utf8',
    );

    expect(source).toContain('if (!unavailable && posts.length === 0) notFound();');
    expect(source).toContain('const destination = await resolveDestinationRouteParam(dest);');
  });

  it('renders uncached route shells while retaining the cached catalog', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/blog/destination/[dest]/page.tsx'),
      'utf8',
    );

    expect(source).toContain("export const dynamic = 'force-dynamic';");
    expect(source).toContain('const getCachedDestinationPageData = unstable_cache(');
  });
});
