import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(): string {
  return readFileSync(join(process.cwd(), 'src/lib/user-actions.ts'), 'utf8');
}

describe('user action package helper publication boundary', () => {
  it('requires public catalog eligibility before returning similar package cards', () => {
    const text = source();
    const similarIndex = text.indexOf('export async function getSimilarPackages');

    expect(text).toContain('listPublicCatalog');
    expect(text).toContain('ids: [packageId]');
    expect(text).not.toContain(".from('travel_packages')");
    expect(similarIndex).toBeGreaterThan(0);
  });

  it('does not cast raw travel_packages rows as similar package cards', () => {
    const text = source();
    const similarIndex = text.indexOf('export async function getSimilarPackages');
    const similarSource = text.slice(similarIndex);

    expect(similarSource).not.toContain(".from('travel_packages')");
    expect(similarSource).toContain('.map(toSimilarPackageCard)');
  });
});
