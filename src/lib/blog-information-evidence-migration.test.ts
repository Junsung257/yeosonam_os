import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('blog information evidence migration', () => {
  const source = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260715082549_blog_information_evidence_model.sql',
    ),
    'utf8',
  );

  it.each([
    'blog_information_sources',
    'blog_information_evidence',
    'blog_information_claims',
    'blog_information_claim_evidence',
  ])('creates the additive %s table', (table) => {
    expect(source).toContain(`create table if not exists public.${table}`);
    expect(source).toContain(`alter table public.${table} enable row level security`);
    expect(source).toContain(`revoke all on table public.${table} from public, anon, authenticated`);
  });

  it('stores the minimum source, freshness, destination, claim, risk, and review fields', () => {
    for (const column of [
      'source_type',
      'source_url',
      'internal_identifier',
      'publisher',
      'retrieved_at',
      'valid_from',
      'valid_until',
      'destination',
      'country',
      'claim_type',
      'risk_level',
      'reviewer_id',
      'reviewed_at',
    ]) {
      expect(source).toContain(column);
    }
  });

  it('does not alter product evidence or snapshot tables', () => {
    expect(source).not.toMatch(/alter table\s+public\.(?:travel_packages|products|product_snapshots)/i);
    expect(source).not.toMatch(/package_publication|final_product_snapshot/i);
  });
});
