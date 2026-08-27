import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PUBLIC_ATTRACTION_SURFACES = [
  'src/app/destinations/page.tsx',
  'src/app/destinations/region/[region]/page.tsx',
  'src/app/things-to-do/page.tsx',
] as const;

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('public attraction surface gates', () => {
  it.each(PUBLIC_ATTRACTION_SURFACES)('%s filters direct attraction rows through the customer render gate', (path) => {
    const text = source(path);

    expect(text).toContain('isCustomerRenderableAttraction');
    expect(text).toContain('customer_publishable');
    expect(text).toContain('is_active');
  });

  it('does not query raw attraction rows for home imagery', () => {
    const text = source('src/app/page.tsx');
    expect(text).not.toContain(".from('attractions')");
    expect(text).not.toContain('pickAttractionPhotoUrl');
    expect(text).toContain('item.heroImage');
  });

  it('does not let destination index fallback images use raw attraction photos', () => {
    const text = source('src/app/destinations/page.tsx');
    const normalizeIndex = text.indexOf('function normalizeAttractionSample');
    const gateIndex = text.indexOf('isCustomerRenderableAttraction', normalizeIndex);
    const fallbackImageIndex = text.indexOf('pickAttractionPhotoUrl(sample.photos)');

    expect(normalizeIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeGreaterThan(normalizeIndex);
    expect(fallbackImageIndex).toBeGreaterThan(gateIndex);
  });

  it('does not let things-to-do regions count or cover unsafe attractions', () => {
    const text = source('src/app/things-to-do/page.tsx');
    const safeRowsIndex = text.indexOf('const safeRegionRows');
    const countLoopIndex = text.indexOf('for (const r of safeRegionRows)');
    const coverRowsIndex = text.indexOf('const safeCoverRows');
    const coverLoopIndex = text.indexOf('for (const r of safeCoverRows)');

    expect(safeRowsIndex).toBeGreaterThan(-1);
    expect(countLoopIndex).toBeGreaterThan(safeRowsIndex);
    expect(coverRowsIndex).toBeGreaterThan(-1);
    expect(coverLoopIndex).toBeGreaterThan(coverRowsIndex);
  });
});
