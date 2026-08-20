import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src/lib/jarvis/agents/products.ts'), 'utf8');

describe('Jarvis products agent authority boundary', () => {
  it('does not read legacy travel_packages for product search, detail, recommendation, or pairwise comparison', () => {
    expect(source).toContain('getPublishedComparisonFacts');
    expect(source).toContain('getPublishedProductFactById');
    expect(source).toContain('getPublishedProductFacts');
    expect(source).not.toContain("from('travel_packages')");
    expect(source).not.toContain('travel_packages!inner');
  });
});
