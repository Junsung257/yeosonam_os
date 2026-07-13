import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

const contentProductRoutes = [
  'src/app/api/content-brief/route.ts',
  'src/app/api/content/generate-all/route.ts',
  'src/app/api/content/instagram-caption/route.ts',
  'src/app/api/content/threads-post/route.ts',
  'src/app/api/content/meta-ads/route.ts',
  'src/app/api/content/google-ads-rsa/route.ts',
  'src/app/api/content/kakao-channel/route.ts',
  'src/app/api/content/blog-body/route.ts',
  'src/app/api/content/cover-critic/route.ts',
  'src/app/api/card-news/route.ts',
  'src/app/api/card-news/campaign/route.ts',
];

describe('content generation public package gate', () => {
  it('loads product context only through current approved public snapshots', () => {
    const helper = source('src/lib/content-public-package.ts');

    expect(helper).toContain('fetchAndMergeCurrentPublicPackageCardSnapshots');
    expect(helper).toContain('isCustomerPubliclyOpenable');
    expect(helper).toContain('isPublicPublicationState');
    expect(helper).toContain(".in('publication_state', ['approved', 'published'])");
    expect(helper).not.toContain("select('id, title");
    expect(helper).not.toContain("select('title, destination");
    expect(helper).not.toContain('optional_tours_public');
  });

  it('blocks raw travel_packages title/price/itinerary reads in content product routes', () => {
    for (const path of contentProductRoutes) {
      const text = source(path);

      expect(text, path).toContain('loadPublicContentPackageForGeneration');
      expect(text, path).not.toContain("select('id, title");
      expect(text, path).not.toContain("select('title, destination");
      expect(text, path).not.toMatch(/from\('travel_packages'\)[\s\S]{0,260}\.select\('[^']*(title|price|inclusions|itinerary|product_summary|product_highlights)/);
    }
  });
});
