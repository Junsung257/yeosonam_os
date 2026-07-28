import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260728211011_normalize_blog_monthly_climate_composite_values.sql',
  ),
  'utf8',
);

describe('monthly climate composite value backfill', () => {
  it('repairs both evidence scopes and claim values from all four source measurements', () => {
    expect(migration).toContain('UPDATE public.blog_information_evidence');
    expect(migration).toContain('UPDATE public.blog_information_claims');
    expect(migration).toContain("array_to_string(parsed.parts, '|')");
    expect(migration).toContain("'월별 기후 지표'");
    expect(migration).toContain("cardinality(parsed.parts) = 4");
  });
});
