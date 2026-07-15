import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createBlogInformationSourceIdentityScopeKey,
  createBlogInformationSourceVersionKey,
  type BlogInformationSourceInput,
} from './blog-information-evidence';

const source = (overrides: Partial<BlogInformationSourceInput> = {}): BlogInformationSourceInput => ({
  sourceKey: 'japan-entry-policy',
  sourceType: 'immigration',
  authorityLevel: 'official_primary',
  sourceUrl: 'https://example.go.jp/entry',
  publisher: 'Japan Immigration',
  retrievedAt: '2026-07-15T08:00:00.000Z',
  contentHash: 'a'.repeat(64),
  destination: '일본',
  country: '일본',
  claimTypes: ['entry_visa'],
  riskLevel: 'HIGH',
  ...overrides,
});

describe('blog information source versions', () => {
  const migration = readFileSync(join(
    process.cwd(),
    'supabase/migrations/20260715226000_blog_information_source_versions.sql',
  ), 'utf8');
  const repository = readFileSync(join(
    process.cwd(),
    'src/lib/blog-information-evidence-repository.ts',
  ), 'utf8');
  const gate = readFileSync(join(
    process.cwd(),
    'src/lib/blog-information-claim-publish-gate.ts',
  ), 'utf8');

  it('creates a new version for a later fetch of the same URL', () => {
    const first = createBlogInformationSourceVersionKey(source());
    const second = createBlogInformationSourceVersionKey(source({
      retrievedAt: '2026-07-16T08:00:00.000Z',
      contentHash: 'b'.repeat(64),
    }));

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
  });

  it('scopes the same logical source key independently per tenant and site', () => {
    const first = createBlogInformationSourceIdentityScopeKey({
      tenantId: 'tenant-a',
      siteScope: 'www.yeosonam.com',
      sourceKey: 'entry-policy',
    });
    const second = createBlogInformationSourceIdentityScopeKey({
      tenantId: 'tenant-b',
      siteScope: 'partner.example',
      sourceKey: 'entry-policy',
    });

    expect(first).not.toBe(second);
    expect(migration).toContain('UNIQUE (tenant_scope_key, source_key)');
  });

  it('pins evidence and historical claims to one immutable source version', () => {
    expect(repository).toContain('source_version_id: sourceVersionIds[evidence.sourceKey]');
    expect(repository).toContain("onConflict: 'content_key,logical_evidence_key,source_version_id'");
    expect(gate).toContain("from('blog_information_source_versions')");
    expect(gate).toContain('sourceVersionById.get(item.source_version_id)');
    expect(migration).toContain('UNIQUE (source_id, version_key)');
    expect(migration).toContain('blog_information_source_versions_immutable');
    expect(migration).toContain('BEFORE UPDATE OR DELETE');
  });

  it('backfills existing identities and evidence without touching product data', () => {
    expect(migration).toContain('WITH legacy_versions AS');
    expect(migration).toContain('legacy_backfill');
    expect(migration).toContain('SET source_version_id = v.id');
    expect(migration).not.toMatch(/travel_packages|product_snapshot|package_publication/);
  });

  it('enforces a service-role-only RLS matrix with no update or delete grant', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON TABLE public.blog_information_source_versions FROM public, anon, authenticated');
    expect(migration).toContain('GRANT SELECT, INSERT ON TABLE public.blog_information_source_versions TO service_role');
    expect(migration).not.toContain('GRANT SELECT, INSERT, UPDATE');
    expect(migration).toContain('SET search_path =');
  });

  it('provides a read-only collision and backfill dry run', () => {
    const dryRun = readFileSync(join(
      process.cwd(),
      'db/blog-information-source-version-backfill-dry-run.sql',
    ), 'utf8');
    expect(dryRun).toContain('SELECT');
    expect(dryRun).toContain('HAVING COUNT(*) > 1');
    expect(dryRun).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
  });
});
