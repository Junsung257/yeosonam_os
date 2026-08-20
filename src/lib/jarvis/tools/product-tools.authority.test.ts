import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src/lib/jarvis/tools/product-tools.ts'), 'utf8');

describe('Jarvis product authority boundary', () => {
  it('uses the V6.1 publication read model instead of legacy package tables', () => {
    expect(source).toContain('getPublishedProductFacts');
    expect(source).toContain('getPublishedProductFactById');
    expect(source).not.toContain('travel_packages');
    expect(source).not.toContain('getPriceTierForDate');
    expect(source).not.toContain('getSurchargesForDate');
  });

  it('does not interpret excluded dates as flight non-operation dates', () => {
    expect(source).not.toContain('excluded_dates');
    expect(source).toContain('MANUAL_CONFIRMATION_REQUIRED');
    expect(source).toContain('CONFLICTING');
  });
});
