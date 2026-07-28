import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260728214924_add_canadian_rockies_reviewed_transport_sources.sql',
  ),
  'utf8',
);

describe('Canadian Rockies reviewed transport sources', () => {
  it('registers first-party operators and scopes every direct document', () => {
    expect(migration).toContain("'parks.canada.ca'");
    expect(migration).toContain("'roamtransit.com'");
    expect(migration).toContain('2026.Route-8x-Schedule-Summer.pdf');
    expect(migration).toContain("array['캐나다 로키산맥', '밴프', '레이크 루이스']");
    expect(migration).not.toContain("array['캐나다']");
    expect(migration).toContain('on conflict (official_source_registry_id, source_url)');
  });
});
