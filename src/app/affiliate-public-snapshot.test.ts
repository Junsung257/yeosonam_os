import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('affiliate and embed public package data boundary', () => {
  it('requires current public snapshots before rendering the embed package widget', () => {
    const text = source('src/app/embed/pkg/[id]/page.tsx');
    const queryIndex = text.indexOf(".from('travel_packages')");
    const snapshotIndex = text.indexOf('const publicRows = await getPublishedPackageCards');

    expect(text).toContain("import { getPublishedPackageCards } from '@/lib/public-packages'");
    expect(text).not.toContain('isEmbedPublicSnapshotCandidate');
    expect(text).not.toContain(".in('publication_state'");
    expect(snapshotIndex).toBeGreaterThan(queryIndex);
    expect(text).toContain('pkg = (publicRows[0] as PackageRow | undefined) ?? null');
  });

  it('requires current public snapshots before using package text in referral metadata', () => {
    const text = source('src/app/r/[code]/[slug]/page.tsx');
    const queryIndex = text.indexOf(".from('travel_packages')");
    const snapshotIndex = text.indexOf('const publicRows = await getPublishedPackageCards');
    const titleIndex = text.indexOf('const packageTitle = p.title || title');

    expect(text).not.toContain('isReferralPublicSnapshotCandidate');
    expect(text).not.toContain(".in('publication_state'");
    expect(snapshotIndex).toBeGreaterThan(queryIndex);
    expect(titleIndex).toBeGreaterThan(snapshotIndex);
  });

  it('builds affiliate landing picks from public snapshots only', () => {
    const text = source('src/app/with/[slug]/page.tsx');
    const helperIndex = text.indexOf('async function toPublicAffiliatePicks');
    const pickedIndex = text.indexOf('picks = await toPublicAffiliatePicks(pickedRows)');
    const fallbackIndex = text.indexOf('picks = await toPublicAffiliatePicks(');

    expect(text).toContain('getPublishedPackageCards');
    expect(text).not.toContain('isWithPublicSnapshotCandidate');
    expect(text).not.toContain(".in('publication_state'");
    expect(helperIndex).toBeGreaterThan(0);
    expect(pickedIndex).toBeGreaterThan(helperIndex);
    expect(fallbackIndex).toBeGreaterThan(helperIndex);
  });

  it('serves affiliate public API packages only from public snapshots', () => {
    const text = source('src/app/api/affiliate/public/[referral_code]/route.ts');
    const packageQueryIndex = text.indexOf(".from('travel_packages')");
    const snapshotIndex = text.indexOf('const publicPackages = await getPublishedPackageCards');
    const responseIndex = text.indexOf('packages = publicPackages.map(toAffiliatePublicPackage)');
    const packageQuery = text.slice(packageQueryIndex, snapshotIndex);

    expect(text).toContain('sanitizeCustomerPackageForClient');
    expect(text).not.toContain('isAffiliatePublicSnapshotCandidate');
    expect(text).not.toContain(".in('publication_state'");
    expect(snapshotIndex).toBeGreaterThan(packageQueryIndex);
    expect(responseIndex).toBeGreaterThan(snapshotIndex);
    expect(packageQuery).not.toMatch(/select\('[^']*\b(title|price|location_summary|original_price|discount_rate|main_image)\b/);
  });

  it('serves influencer marketing assets only after public snapshot merge', () => {
    const text = source('src/app/api/influencer/assets/route.ts');
    const packageQueryIndex = text.indexOf(".from('travel_packages')");
    const snapshotIndex = text.indexOf('const publicPackages = await getPublishedPackageMarketingClaims');
    const responseIndex = text.indexOf('marketing_copies: publicPackages.map');
    const responseSlice = text.slice(responseIndex);

    expect(text).not.toContain('isInfluencerPublicSnapshotCandidate');
    expect(text).not.toContain(".in('publication_state'");
    expect(snapshotIndex).toBeGreaterThan(packageQueryIndex);
    expect(responseIndex).toBeGreaterThan(snapshotIndex);
    expect(responseSlice).not.toContain('(packages || []).map');
  });

  it('renders affiliate OG images from current public snapshots only', () => {
    const text = source('src/app/api/og/affiliate/route.tsx');
    const snapshotIndex = text.indexOf('/rest/v1/published_public_package_cards_v1');
    const productAssignmentIndex = text.indexOf('productTitle = publicProduct.title');

    expect(text).toContain('function publicProductFromSnapshot');
    expect(text).not.toContain('/rest/v1/travel_packages');
    expect(text).not.toContain('/rest/v1/public_package_snapshots');
    expect(snapshotIndex).toBeGreaterThan(0);
    expect(productAssignmentIndex).toBeGreaterThan(snapshotIndex);
  });
});
