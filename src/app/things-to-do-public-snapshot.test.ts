import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(): string {
  return readFileSync(join(process.cwd(), 'src/app/things-to-do/[region]/page.tsx'), 'utf8');
}

describe('things-to-do public package data boundary', () => {
  it('renders recommended packages only after current public snapshot merge', () => {
    const text = source();
    const packageQueryIndex = text.indexOf(".from('travel_packages')");
    const snapshotMergeIndex = text.indexOf('const publicPackages = await getPublishedPackageCards');
    const normalizeIndex = text.indexOf('packages: publicPackages');

    expect(text).not.toContain('isThingsToDoPublicSnapshotCandidate');
    expect(text).not.toContain('isCustomerPubliclyOpenable');
    expect(text).not.toContain(".in('publication_state'");
    expect(snapshotMergeIndex).toBeGreaterThan(packageQueryIndex);
    expect(normalizeIndex).toBeGreaterThan(snapshotMergeIndex);
  });

  it('does not select raw customer package title, price, duration, airline, or photos for cards', () => {
    const text = source();
    const packageSelectStart = text.indexOf(".from('travel_packages')");
    const packageSelectEnd = text.indexOf(").catch(() => [{ data: null }, { data: null }]);", packageSelectStart);
    const packageQuery = text.slice(packageSelectStart, packageSelectEnd);

    expect(packageQuery).toContain("publication_state");
    expect(packageQuery).not.toMatch(/select\('[^']*\b(title|price|duration|nights|airline|photos|photo_urls)\b/);
  });
});
