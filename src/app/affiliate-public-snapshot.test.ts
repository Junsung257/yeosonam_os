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
    const snapshotIndex = text.indexOf('const publicRows = await fetchAndMergeCurrentPublicPackageCardSnapshots');

    expect(text).toContain('function isEmbedPublicSnapshotCandidate');
    expect(text).toContain(".in('publication_state', ['approved', 'published'])");
    expect(snapshotIndex).toBeGreaterThan(queryIndex);
    expect(text).toContain('pkg = (publicRows[0] as PackageRow | undefined) ?? null');
  });

  it('requires current public snapshots before using package text in referral metadata', () => {
    const text = source('src/app/r/[code]/[slug]/page.tsx');
    const queryIndex = text.indexOf(".from('travel_packages')");
    const snapshotIndex = text.indexOf('const publicRows = await fetchAndMergeCurrentPublicPackageCardSnapshots');
    const titleIndex = text.indexOf('const packageTitle = p.title || title');

    expect(text).toContain('function isReferralPublicSnapshotCandidate');
    expect(text).toContain(".in('publication_state', ['approved', 'published'])");
    expect(snapshotIndex).toBeGreaterThan(queryIndex);
    expect(titleIndex).toBeGreaterThan(snapshotIndex);
  });

  it('builds affiliate landing picks from public snapshots only', () => {
    const text = source('src/app/with/[slug]/page.tsx');
    const helperIndex = text.indexOf('async function toPublicAffiliatePicks');
    const pickedIndex = text.indexOf('picks = await toPublicAffiliatePicks(pickedRows)');
    const fallbackIndex = text.indexOf('picks = await toPublicAffiliatePicks(');

    expect(text).toContain('function isWithPublicSnapshotCandidate');
    expect(text).toContain(".in('publication_state', ['approved', 'published'])");
    expect(helperIndex).toBeGreaterThan(0);
    expect(pickedIndex).toBeGreaterThan(helperIndex);
    expect(fallbackIndex).toBeGreaterThan(helperIndex);
  });

  it('serves affiliate public API packages only from public snapshots', () => {
    const text = source('src/app/api/affiliate/public/[referral_code]/route.ts');
    const packageQueryIndex = text.indexOf(".from('travel_packages')");
    const snapshotIndex = text.indexOf('const publicPackages = await fetchAndMergeCurrentPublicPackageCardSnapshots');
    const responseIndex = text.indexOf('packages = publicPackages.map(toAffiliatePublicPackage)');
    const packageQuery = text.slice(packageQueryIndex, snapshotIndex);

    expect(text).toContain('function isAffiliatePublicSnapshotCandidate');
    expect(text).toContain('sanitizeCustomerPackageForClient');
    expect(text).toContain(".in('publication_state', ['approved', 'published'])");
    expect(snapshotIndex).toBeGreaterThan(packageQueryIndex);
    expect(responseIndex).toBeGreaterThan(snapshotIndex);
    expect(packageQuery).not.toMatch(/select\('[^']*\b(title|price|location_summary|original_price|discount_rate|main_image)\b/);
  });
});
