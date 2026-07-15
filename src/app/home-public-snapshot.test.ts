import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function homeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');
}

describe('home public package data boundary', () => {
  it('builds package-derived home sections only after current public snapshot merge', () => {
    const source = homeSource();
    const aggregateQueryIndex = source.indexOf("label: 'home.packages.aggregate'");
    const rankingQueryIndex = source.indexOf("label: 'home.ranking.packages'");
    const aggregateMergeIndex = source.indexOf('const allPkgs =');
    const rankingMergeIndex = source.indexOf('const rankingPkgs =');
    const destinationMapIndex = source.indexOf('const destMap');
    const rankingItemsIndex = source.indexOf('const overseas: RankingItem[]');

    expect(source).toContain('getPublishedPackageCards');
    expect(source).not.toContain('isHomePublicSnapshotCandidate');
    expect(source).toContain('function fetchHomePublicSnapshotRows');
    expect(source).not.toContain(".in('publication_state'");
    expect(aggregateMergeIndex).toBeGreaterThan(aggregateQueryIndex);
    expect(rankingMergeIndex).toBeGreaterThan(rankingQueryIndex);
    expect(destinationMapIndex).toBeGreaterThan(aggregateMergeIndex);
    expect(rankingItemsIndex).toBeGreaterThan(rankingMergeIndex);
  });
});
