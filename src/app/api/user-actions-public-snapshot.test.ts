import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function routeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/api/user-actions/route.ts'), 'utf8');
}

describe('user action package recommendations publication boundary', () => {
  it('serves recent and similar package cards only after public snapshot merge', () => {
    const source = routeSource();
    const queryIndex = source.indexOf(".from('travel_packages')");
    const helperIndex = source.indexOf('async function toPublicPackageCards');
    const responseIndex = source.indexOf('return NextResponse.json({ packages: await toPublicPackageCards');

    expect(source).toContain('getPublishedPackageCards');
    expect(source).not.toContain('isUserActionPublicSnapshotCandidate');
    expect(source).not.toContain('isCustomerPubliclyOpenable');
    expect(source).not.toContain('isPublicPublicationState');
    expect(source).not.toContain(".in('publication_state'");
    expect(helperIndex).toBeGreaterThan(0);
    expect(responseIndex).toBeGreaterThan(queryIndex);
  });

  it('does not return raw travel_packages rows from recent or similar modes', () => {
    const source = routeSource();
    const getIndex = source.indexOf('export async function GET');
    const getSource = source.slice(getIndex);

    expect(getSource).not.toContain('normalizePackageCards(data)');
    expect(getSource).not.toContain('normalizePackageCards(packages)');
    expect(getSource).toContain('await toPublicPackageCards(data)');
    expect(getSource).toContain('await toPublicPackageCards(data, order)');
  });
});
