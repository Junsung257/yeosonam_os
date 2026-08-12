import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(): string {
  return readFileSync(join(process.cwd(), 'src/app/things-to-do/[region]/page.tsx'), 'utf8');
}

describe('things-to-do public package data boundary', () => {
  it('renders recommended packages only after current public snapshot merge', () => {
    const text = source();
    const snapshotMergeIndex = text.indexOf('listCurrentPublicPackageCardSnapshots');
    const normalizeIndex = text.indexOf('packages: publicPackages');

    expect(text).not.toContain(".from('travel_packages')");
    expect(snapshotMergeIndex).toBeGreaterThan(0);
    expect(normalizeIndex).toBeGreaterThan(snapshotMergeIndex);
  });

  it('does not select raw customer package title, price, duration, airline, or photos for cards', () => {
    const text = source();
    expect(text).not.toContain(".from('travel_packages')");
    expect(text).toContain('listCurrentPublicPackageCardSnapshots');
  });
});
