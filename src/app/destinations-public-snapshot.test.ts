import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('destination public package data boundary', () => {
  it('builds the destinations index from publication pointers only', () => {
    const text = source('src/app/destinations/page.tsx');
    const mergeIndex = text.indexOf('const publicStats = await listCurrentPublicPackageCardSnapshots');
    const statsIndex = text.indexOf('const statsByDestination');

    expect(text).toContain('listCurrentPublicPackageCardSnapshots');
    expect(text).not.toContain("from('travel_packages')");
    expect(mergeIndex).toBeGreaterThan(0);
    expect(statsIndex).toBeGreaterThan(mergeIndex);
  });

  it('uses public snapshots for city route inventory and package-derived destination data', () => {
    const text = source('src/app/destinations/[city]/page.tsx');
    const helperIndex = text.indexOf('async function listDestinationPublicSnapshotRows');
    const packageMatchIndex = text.indexOf('const packageMatch =');
    const departureIndex = text.indexOf('const departureCities =');

    expect(text).toContain('listDestinationPublicSnapshotRows(');
    expect(text).not.toContain("from('travel_packages')");
    expect(text.slice(packageMatchIndex - 260, packageMatchIndex)).toContain('listDestinationPublicSnapshotRows');
    expect(text.slice(departureIndex, departureIndex + 450)).toContain('alivePackageRows');
    expect(helperIndex).toBeGreaterThan(0);
  });

  it('lets the page render own existence decisions instead of merging transient metadata noindex', () => {
    const text = source('src/app/destinations/[city]/page.tsx');
    const metadataStart = text.indexOf('export async function generateMetadata');
    const renderStart = text.indexOf('export default async function DestinationPillarPage');
    const metadataSource = text.slice(metadataStart, renderStart);

    expect(metadataSource).not.toContain('destinationHasPublicInventory');
    expect(metadataSource).not.toContain('destinationExistsForMetadata');
    expect(metadataSource).toContain('const socialImage = await getDestinationSocialImage(decoded);');
  });

  it('renders live city routes dynamically to avoid DYNAMIC_SERVER_USAGE 500s', () => {
    const text = source('src/app/destinations/[city]/page.tsx');

    expect(text).toContain("export const dynamic = 'force-dynamic';");
  });
});
