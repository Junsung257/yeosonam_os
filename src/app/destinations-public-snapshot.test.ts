import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('destination public package data boundary', () => {
  it('builds the destinations index from current public package snapshots', () => {
    const text = source('src/app/destinations/page.tsx');
    const queryIndex = text.indexOf(".from('travel_packages')");
    const mergeIndex = text.indexOf('const publicStats = await getPublishedPackageCards');
    const statsIndex = text.indexOf('const statsByDestination');

    expect(text).toContain('getPublishedPackageCards');
    expect(text).not.toContain('isPublicPublicationState');
    expect(text).not.toContain(".in('publication_state'");
    expect(mergeIndex).toBeGreaterThan(queryIndex);
    expect(statsIndex).toBeGreaterThan(mergeIndex);
  });

  it('uses public snapshots for city route inventory and package-derived destination data', () => {
    const text = source('src/app/destinations/[city]/page.tsx');
    const helperIndex = text.indexOf('async function fetchDestinationPublicSnapshotRows');
    const inventoryIndex = text.indexOf('async function destinationHasPublicInventory');
    const packageMatchIndex = text.indexOf('const packageMatch =');
    const departureIndex = text.indexOf('const departureCities =');

    expect(text).toContain('fetchDestinationPublicSnapshotRows(');
    expect(text).not.toContain('isDestinationPublicSnapshotCandidate');
    expect(text).not.toContain(".in('publication_state'");
    expect(text.slice(inventoryIndex, packageMatchIndex)).toContain('fetchDestinationPublicSnapshotRows');
    expect(text.slice(packageMatchIndex - 260, packageMatchIndex)).toContain('fetchDestinationPublicSnapshotRows');
    expect(text.slice(departureIndex, departureIndex + 450)).toContain('fetchDestinationPublicSnapshotRows');
    expect(helperIndex).toBeGreaterThan(0);
  });
});
