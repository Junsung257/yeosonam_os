import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function homeSource(): string {
  return readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');
}

describe('home public package data boundary', () => {
  it('builds package-derived home sections from the exact public catalog only', () => {
    const source = homeSource();
    const catalogIndex = source.indexOf('listPublicCatalog');
    const cardIndex = source.indexOf('catalog.map((item)');

    expect(source).toContain('listPublicCatalog');
    expect(source).not.toContain("from('travel_packages')");
    expect(cardIndex).toBeGreaterThan(catalogIndex);
  });
});
