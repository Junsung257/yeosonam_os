import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  `${process.cwd()}/supabase/migrations/20260817030000_benchmark_source_disposition_readiness.sql`,
  'utf8',
);

describe('benchmark source-disposition readiness migration', () => {
  it('exposes all source-disposition safety facts from the immutable run summary', () => {
    expect(migration).toContain("l.metrics->>'negativeTerminalOutcomeExactRate'");
    expect(migration).toContain("l.metrics->>'sourceIncompleteDiscardExactRate'");
    expect(migration).toContain("l.metrics->>'falseSourceIncompleteDiscardCount'");
    expect(migration).toContain("l.metrics->>'invalidSourcePublishedCount'");
  });

  it('is service-role only with a pinned search path', () => {
    expect(migration).toContain('set search_path = pg_catalog, public, internal_product_registration, pg_temp');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
  });
});
