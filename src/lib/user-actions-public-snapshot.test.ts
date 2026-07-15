import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(): string {
  return readFileSync(join(process.cwd(), 'src/lib/user-actions.ts'), 'utf8');
}

describe('user action package helper publication boundary', () => {
  it('requires public snapshots before returning similar package cards', () => {
    const text = source();
    const helperIndex = text.indexOf('async function toPublicSimilarPackageCards');
    const similarIndex = text.indexOf('export async function getSimilarPackages');
    const snapshotIndex = text.indexOf('getPublishedPackageCards', similarIndex);

    expect(text).not.toContain('isUserActionPublicSnapshotCandidate');
    expect(text).not.toContain('isCustomerPubliclyOpenable');
    expect(text).not.toContain('isPublicPublicationState');
    expect(text).not.toContain(".in('publication_state'");
    expect(helperIndex).toBeGreaterThan(0);
    expect(snapshotIndex).toBeGreaterThan(similarIndex);
  });

  it('does not cast raw travel_packages rows as similar package cards', () => {
    const text = source();
    const similarIndex = text.indexOf('export async function getSimilarPackages');
    const similarSource = text.slice(similarIndex);

    expect(similarSource).not.toContain("select('id, title, destination, price')");
    expect(similarSource).not.toContain('as Array<{ id: string; title: string; destination: string; price: number }>');
    expect(similarSource).toContain('return toPublicSimilarPackageCards(similar)');
    expect(similarSource).toContain('return toPublicSimilarPackageCards(catSimilar)');
  });
});
