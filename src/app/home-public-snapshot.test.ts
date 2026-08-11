import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function homeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');
}

describe('home public package data boundary', () => {
  it('builds package-derived home sections from publication pointers only', () => {
    const source = homeSource();
    const pointerCatalogIndex = source.indexOf('listCurrentPublicPackageCardSnapshots');
    const aggregateMergeIndex = source.indexOf('const allPkgs =');
    const rankingMergeIndex = source.indexOf('const rankingPkgs =');
    const destinationMapIndex = source.indexOf('const destMap');
    const rankingItemsIndex = source.indexOf('const overseas: RankingItem[]');

    expect(source).toContain('listCurrentPublicPackageCardSnapshots');
    expect(source).not.toContain("from('travel_packages')");
    expect(aggregateMergeIndex).toBeGreaterThan(pointerCatalogIndex);
    expect(rankingMergeIndex).toBeGreaterThan(pointerCatalogIndex);
    expect(destinationMapIndex).toBeGreaterThan(aggregateMergeIndex);
    expect(rankingItemsIndex).toBeGreaterThan(rankingMergeIndex);
  });
});
