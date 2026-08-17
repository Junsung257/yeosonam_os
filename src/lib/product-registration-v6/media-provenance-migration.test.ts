import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  `${process.cwd()}/supabase/migrations/20260816112631_product_registration_free_media_provenance.sql`,
  'utf8',
);

describe('free-first product registration media migration', () => {
  it('stores provider, rights, subject, relevance and safety provenance', () => {
    for (const field of [
      'provider_asset_id',
      'source_page_url',
      'license_code',
      'license_snapshot_at',
      'subject_key',
      'reference_only',
      'quality_score',
      'content_safety_state',
      'relevance_state',
      'product-public-media',
    ]) {
      expect(migration).toContain(field);
    }
  });

  it('reuses only an exact tenant destination candidate with safe rights', () => {
    expect(migration).toContain('get_product_registration_reference_media_candidate');
    expect(migration).toContain('a.tenant_id = p_tenant_id');
    expect(migration).toContain("a.subject_key = lower(btrim(p_subject_key))");
    expect(migration).toContain("a.rights_status in ('verified', 'attribution_required')");
    expect(migration).toContain("a.content_safety_state = 'safe'");
    expect(migration).toContain("a.relevance_state = 'verified'");
  });

  it('limits automatic external reference providers and keeps RPCs service-role only', () => {
    expect(migration).toContain("v_provider not in ('pexels', 'wikimedia_commons')");
    expect(migration).toContain('REGISTRATION_MEDIA_LICENSE_REQUIRED');
    expect(migration).toContain('REGISTRATION_MEDIA_LICENSED_CACHE_INVALID');
    expect(migration).toContain('REGISTRATION_MEDIA_REVISION_LINEAGE_MISMATCH');
    expect(migration).toContain('REGISTRATION_MEDIA_REVISION_ALREADY_SNAPSHOTTED');
    expect(migration).toContain('s.canonical_revision_id = v_revision_id');
    expect(migration).toContain('revoke all on function public.link_product_registration_reference_media(jsonb) from public, anon, authenticated');
    expect(migration).toContain('grant execute on function public.link_product_registration_reference_media(jsonb) to service_role');
  });

  it('returns the complete provenance contract in the immutable revision aggregate', () => {
    expect(migration).toContain("'provider_asset_id', a.provider_asset_id");
    expect(migration).toContain("'source_page_url', a.source_page_url");
    expect(migration).toContain("'license_reference', a.license_reference");
    expect(migration).toContain("'reference_only', a.reference_only");
  });
});
