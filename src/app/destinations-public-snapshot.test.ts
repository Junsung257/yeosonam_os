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
    const helperIndex = text.indexOf('async function loadDestinationProducts');
    const catalogIndex = text.indexOf('listPublicCatalog(', helperIndex);
    const renderIndex = text.indexOf('products.map((item)');

    expect(text).toContain('listPublicCatalog(');
    expect(text).not.toContain("from('travel_packages')");
    expect(helperIndex).toBeGreaterThan(0);
    expect(catalogIndex).toBeGreaterThan(helperIndex);
    expect(renderIndex).toBeGreaterThan(catalogIndex);
  });

  it('keeps the city route cacheable without mixing force-dynamic and revalidate', () => {
    const text = source('src/app/destinations/[city]/page.tsx');

    expect(text).toContain('export const revalidate = 300;');
    expect(text).not.toContain("export const dynamic = 'force-dynamic';");
    expect(text).not.toContain('export async function generateStaticParams');
  });
});
