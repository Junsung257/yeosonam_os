import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('destination public package data boundary', () => {
  it('builds the destinations index from the exact public catalog only', () => {
    const text = source('src/app/destinations/page.tsx');
    const mergeIndex = text.indexOf('const publicStats = await listPublicCatalog');
    const statsIndex = text.indexOf('const statsByDestination');

    expect(text).toContain('listPublicCatalog');
    expect(text).not.toContain("from('travel_packages')");
    expect(mergeIndex).toBeGreaterThan(0);
    expect(statsIndex).toBeGreaterThan(mergeIndex);
  });

  it('uses the exact public catalog for city route inventory', () => {
    const text = source('src/app/destinations/[city]/page.tsx');
    const helperIndex = text.indexOf('async function listDestinationPublicSnapshotRows');
    const catalogIndex = text.indexOf('listPublicCatalog(', helperIndex);
    const renderIndex = text.indexOf('listDestinationPublicSnapshotRows()', catalogIndex);

    expect(text).toContain('listPublicCatalog(');
    expect(text).not.toContain("from('travel_packages')");
    expect(helperIndex).toBeGreaterThan(0);
    expect(catalogIndex).toBeGreaterThan(helperIndex);
    expect(renderIndex).toBeGreaterThan(catalogIndex);
  });

  it('keeps current-main dynamic rendering to avoid uncached destination 500s', () => {
    const text = source('src/app/destinations/[city]/page.tsx');

    expect(text).toContain('export const revalidate = 300;');
    expect(text).toContain("export const dynamic = 'force-dynamic';");
    expect(text).toContain('export async function generateStaticParams');
    expect(text).toContain('DESTINATION_STATIC_PRERENDER_LIMIT');
  });
});
