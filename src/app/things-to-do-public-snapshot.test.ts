import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(): string {
  return readFileSync(join(process.cwd(), 'src/app/things-to-do/[region]/page.tsx'), 'utf8');
}

describe('things-to-do public package data boundary', () => {
  it('renders recommended packages only after the exact public catalog lookup', () => {
    const text = source();
    const catalogIndex = text.indexOf('listPublicCatalog');
    const normalizeIndex = text.indexOf('packages: publicPackages');

    expect(text).not.toContain(".from('travel_packages')");
    expect(catalogIndex).toBeGreaterThan(0);
    expect(text).toContain('destination: region');
    expect(normalizeIndex).toBeGreaterThan(catalogIndex);
  });

  it('does not select raw customer package title, price, duration, airline, or photos for cards', () => {
    const text = source();
    expect(text).not.toContain(".from('travel_packages')");
    expect(text).toContain('listPublicCatalog');
  });
});
