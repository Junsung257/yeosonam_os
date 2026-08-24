import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('affiliate and embed public package data boundary', () => {
  it('requires the marketing-eligible catalog before rendering the embed package widget', () => {
    const text = source('src/app/embed/pkg/[id]/page.tsx');
    expect(text).toContain('getPublicCatalogDetail');
    expect(text).not.toContain(".from('travel_packages')");
    expect(text).toContain('lastVerifiedAt: current.item.lastVerifiedAt');
    expect(text).not.toContain('product_summary');
  });

  it('requires the marketing-eligible catalog before using package text in referral metadata', () => {
    const text = source('src/app/r/[code]/[slug]/page.tsx');
    const catalogIndex = text.indexOf('const current = await getPublicCatalogDetail');
    const titleIndex = text.indexOf('const packageTitle = current.item.title || title');

    expect(text).not.toContain(".from('travel_packages')");
    expect(catalogIndex).toBeGreaterThan(0);
    expect(titleIndex).toBeGreaterThan(catalogIndex);
  });

  it('builds affiliate landing picks from the marketing-eligible catalog only', () => {
    const text = source('src/app/with/[slug]/page.tsx');
    expect(text).toContain('listPublicCatalog');
    expect(text).not.toContain(".from('travel_packages')");
    expect(text).toContain('ids: pickIds');
    expect(text).not.toContain('Math.floor(pkg.price * 0.95)');
    expect(text).not.toContain('campaignEndsAt');
    expect(text).not.toContain('직접 검증한 팬 전용');
  });

  it('serves affiliate public API packages only from the marketing-eligible catalog', () => {
    const text = source('src/app/api/affiliate/public/[referral_code]/route.ts');
    const catalogIndex = text.indexOf('const publicPackages = (await listPublicCatalog');
    const responseIndex = text.indexOf('packages = publicPackages.map(toAffiliatePublicPackage)');

    expect(text).toContain('listPublicCatalog');
    expect(text).not.toContain('sanitizeCustomerPackageForClient');
    expect(text).not.toContain(".from('travel_packages')");
    expect(catalogIndex).toBeGreaterThan(0);
    expect(responseIndex).toBeGreaterThan(catalogIndex);
  });

  it('serves influencer marketing assets only through the marketing-eligible catalog', () => {
    const text = source('src/app/api/influencer/assets/route.ts');
    const catalogIndex = text.indexOf('const catalogItems = await listPublicCatalog');
    const detailIndex = text.indexOf('getPublicCatalogDetail');
    const responseIndex = text.indexOf('marketing_copies: publicPackages.map');

    expect(text).not.toContain(".from('travel_packages')");
    expect(text).toContain('eligiblePackageIds');
    expect(catalogIndex).toBeGreaterThan(0);
    expect(detailIndex).toBeGreaterThan(0);
    expect(responseIndex).toBeGreaterThan(catalogIndex);
  });

  it('renders affiliate OG images from the marketing-eligible catalog only', () => {
    const text = source('src/app/api/og/affiliate/route.tsx');
    const catalogIndex = text.indexOf('/rest/v1/public_catalog_view');
    const productAssignmentIndex = text.indexOf('productTitle = publicTitle');

    expect(text).toContain('getPublicCatalogProductViaRest');
    expect(text).not.toContain('/rest/v1/public_package_snapshots');
    expect(text).not.toContain('/rest/v1/product_registration_v5_publication_pointers');
    expect(catalogIndex).toBeGreaterThan(0);
    expect(productAssignmentIndex).toBeGreaterThan(catalogIndex);
  });
});
