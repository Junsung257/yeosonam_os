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
  'src/app/api/content-hub/generate/route.ts',
  'src/app/api/blog/from-card-news/route.ts',
  'src/app/api/blog/bulk-generate/route.ts',
  'src/app/api/meta/creatives/route.ts',
  'src/app/api/orchestrator/auto-publish/route.ts',
  'src/app/api/influencer/content/route.ts',
  'src/app/api/packages/[id]/regenerate-copies/route.ts',
  'src/lib/marketing-pipeline/agents/content-agent.ts',
  'src/lib/marketing-pipeline/agents/ad-agent.ts',
  'src/lib/search-ads-auto-planner.ts',
  'src/lib/ad-os-product-autopilot.ts',
  'src/app/api/admin/ad-os/generate-candidates/route.ts',
  'src/app/api/admin/ad-os/creative-factory/route.ts',
  'src/app/api/admin/ad-os/creative-factory/search-rsa/route.ts',
  'src/app/api/admin/ad-os/creative-factory/asset-group/route.ts',
];

const retiredContentProductRoutes: Record<string, string> = {
  'src/app/api/packages/[id]/regenerate-copies/route.ts': 'MUTABLE_COPY_REGENERATION_RETIRED',
};

describe('content generation public package gate', () => {
  it('loads product context only through current approved public snapshots', () => {
    const helper = source('src/lib/content-public-package.ts');

    expect(helper).toContain('getCurrentPublicPackage');
    expect(helper).toContain("channel: 'customer'");
    expect(helper).not.toContain(".from('travel_packages')");
    expect(helper).toContain('price_dates: asPriceDates(row.price_dates)');
    expect(helper).toContain('if (!title) return null');
    expect(helper).not.toContain("select('id, title");
    expect(helper).not.toContain("select('title, destination");
    expect(helper).not.toContain('여소남 추천 패키지');
    expect(helper).not.toContain('optional_tours_public');
  });

  it('blocks raw travel_packages title/price/itinerary reads in content product routes', () => {
    for (const path of contentProductRoutes) {
      const text = source(path);
      const retirementCode = retiredContentProductRoutes[path];

      if (retirementCode) {
        expect(text, path).toContain('requireAdminRequest(request)');
        expect(text, path).toContain(retirementCode);
        expect(text, path).toContain('{ status: 410');
        expect(text, path).not.toMatch(/from\('travel_packages'\)[\s\S]{0,260}\.select\('[^']*(title|price|inclusions|itinerary|product_summary|product_highlights)/);
      } else {
        expect(
          text.includes('loadPublicContentPackageForGeneration') ||
            text.includes('loadPublicSearchAdPackage') ||
            text.includes('buildAndSaveSearchAdPackagePlan'),
          path,
        ).toBe(true);
      }
      expect(text, path).not.toContain("select('id, title");
      expect(text, path).not.toContain("select('id,title");
      expect(text, path).not.toContain("select('title, destination");
      expect(text, path).not.toContain("select('title,destination");
      expect(text, path).not.toMatch(/from\('travel_packages'\)[\s\S]{0,260}\.select\('[^']*(title|price|inclusions|itinerary|product_summary|product_highlights)/);
    }
  });
});
