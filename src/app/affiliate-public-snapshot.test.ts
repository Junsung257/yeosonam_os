import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('affiliate and embed public package data boundary', () => {
  it('requires current public snapshots before rendering the embed package widget', () => {
    const text = source('src/app/embed/pkg/[id]/page.tsx');
    expect(text).toContain('getCurrentPublicPackage');
    expect(text).toContain("channel: 'customer'");
    expect(text).not.toContain(".from('travel_packages')");
    expect(text).toContain('pkg = (current?.package as PackageRow | undefined) ?? null');
  });

  it('requires current public snapshots before using package text in referral metadata', () => {
    const text = source('src/app/r/[code]/[slug]/page.tsx');
    const snapshotIndex = text.indexOf('const current = await getCurrentPublicPackage');
    const titleIndex = text.indexOf('const packageTitle = p.title || title');

    expect(text).toContain("channel: 'customer'");
    expect(text).not.toContain(".from('travel_packages')");
    expect(snapshotIndex).toBeGreaterThan(0);
    expect(titleIndex).toBeGreaterThan(snapshotIndex);
  });

  it('builds affiliate landing picks from public snapshots only', () => {
    const text = source('src/app/with/[slug]/page.tsx');
    expect(text).toContain('listCurrentPublicPackageCardSnapshots');
    expect(text).not.toContain(".from('travel_packages')");
    expect(text).toContain(".filter(item => pickIds.includes(String(item.id ?? '')))");
    expect(text).toContain('picks = published.slice(0, 6)');
  });

  it('serves affiliate public API packages only from public snapshots', () => {
    const text = source('src/app/api/affiliate/public/[referral_code]/route.ts');
    const snapshotIndex = text.indexOf('const publicPackages = (await listCurrentPublicPackageCardSnapshots');
    const responseIndex = text.indexOf('packages = publicPackages.map(toAffiliatePublicPackage)');

    expect(text).toContain('listCurrentPublicPackageCardSnapshots');
    expect(text).toContain('sanitizeCustomerPackageForClient');
    expect(text).not.toContain(".from('travel_packages')");
    expect(snapshotIndex).toBeGreaterThan(0);
    expect(responseIndex).toBeGreaterThan(snapshotIndex);
  });

  it('serves influencer marketing assets only after public snapshot merge', () => {
    const text = source('src/app/api/influencer/assets/route.ts');
    const packageQueryIndex = text.indexOf(".from('travel_packages')");
    const snapshotIndex = text.indexOf('const publicPackages = await fetchAndMergeCurrentPublicPackageCardSnapshots');
    const responseIndex = text.indexOf('marketing_copies: publicPackages.map');
    const responseSlice = text.slice(responseIndex);

    expect(text).toContain('function isInfluencerPublicSnapshotCandidate');
    expect(text).toContain(".in('publication_state', ['approved', 'published'])");
    expect(snapshotIndex).toBeGreaterThan(packageQueryIndex);
    expect(responseIndex).toBeGreaterThan(snapshotIndex);
    expect(responseSlice).not.toContain('(packages || []).map');
  });

  it('renders affiliate OG images from current public snapshots only', () => {
    const text = source('src/app/api/og/affiliate/route.tsx');
    const packageGateIndex = text.indexOf('/rest/v1/product_registration_v5_publication_pointers');
    const snapshotIndex = text.indexOf('/rest/v1/public_package_snapshots');
    const packageGateQuery = text.slice(packageGateIndex, snapshotIndex);
    const productAssignmentIndex = text.indexOf('productTitle = publicProduct.title');

    expect(text).toContain('function publicProductFromSnapshot');
    expect(text).toContain('state=eq.published');
    expect(text).toContain('current_snapshot_id');
    expect(text).toContain('catalog_product_id=eq.');
    expect(snapshotIndex).toBeGreaterThan(packageGateIndex);
    expect(productAssignmentIndex).toBeGreaterThan(snapshotIndex);
    expect(packageGateQuery).not.toMatch(/select=[^`]*(title|destination|price|product_summary|display_title)/);
  });
});
