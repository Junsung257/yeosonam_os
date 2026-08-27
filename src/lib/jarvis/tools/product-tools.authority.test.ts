import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src/lib/jarvis/tools/product-tools.ts'), 'utf8');

describe('Jarvis product authority boundary', () => {
  it('bounds the V6.1 publication read model by public catalog eligibility', () => {
    expect(source).toContain('listPublicCatalog');
    expect(source).toContain('getCustomerCatalogFact');
    expect(source).toContain('getCustomerCatalogFacts');
    expect(source).toContain('getPublishedProductFacts');
    expect(source).toContain('getPublishedProductFactById');
    expect(source).not.toContain('travel_packages');
    expect(source).not.toContain('getPriceTierForDate');
    expect(source).not.toContain('getSurchargesForDate');
  });

  it('does not pass internal publication lineage to the customer-facing agent', () => {
    expect(source).not.toContain('source_revision_id:');
    expect(source).not.toContain('snapshot_hash:');
  });

  it('does not interpret excluded dates as flight non-operation dates', () => {
    expect(source).not.toContain('excluded_dates');
    expect(source).toContain('MANUAL_CONFIRMATION_REQUIRED');
    expect(source).toContain('CONFLICTING');
  });
});
