import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function routeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/user-actions/route.ts'), 'utf8');
}

describe('user action package recommendations publication boundary', () => {
  it('serves recent and similar package cards only through the public catalog', () => {
    const source = routeSource();

    expect(source).toContain('listPublicCatalog');
    expect(source).toContain('getSimilarPackages');
    expect(source).not.toContain(".from('travel_packages')");
    expect(source).not.toContain('fetchAndMergeCurrentPublicPackageCardSnapshots');
    expect(source).not.toContain('NextResponse.json');
  });

  it('does not return raw travel_packages rows from recent or similar modes', () => {
    const source = routeSource();
    const getIndex = source.indexOf('export async function GET');
    const getSource = source.slice(getIndex);

    expect(getSource).not.toContain(".from('travel_packages')");
    expect(getSource).toContain('toPublicPackageCards(data, order)');
    expect(getSource).toContain('apiResponse({ packages: similar })');
  });
});
