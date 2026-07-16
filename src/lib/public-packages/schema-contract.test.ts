import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260715114704_public_package_published_pointer.sql',
);
const MOBILE_PROOF_SCRIPT = path.join(process.cwd(), 'scripts', 'prove-hwp-mobile-render.ts');

describe('public package database boundary', () => {
  it('keeps pointer, projection, evidence, quarantine, and proof contracts connected', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    const publicViewSql = sql.slice(
      sql.indexOf('CREATE OR REPLACE VIEW public.published_public_packages_v1'),
      sql.indexOf('CREATE OR REPLACE VIEW public.published_public_package_cards_v1'),
    );
    for (const token of [
      'candidate_snapshot_id',
      'published_snapshot_id',
      'published_public_package_cards_v1',
      'published_public_package_details_v1',
      'published_public_package_api_v1',
      'published_public_package_marketing_v1',
      'published_public_package_partner_v1',
      'field_evidence_ledger',
      'quarantined_package_fields',
      'package_render_proofs',
      'p_field_evidence_records',
      'p_render_proof_payload',
      'p_revoke_previous',
      'proof_input_hash',
    ]) {
      expect(sql, `migration must contain ${token}`).toContain(token);
    }
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.published_public_packages_v1 FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/ON CONFLICT \(package_id, field_path, original_value_hash, detector_rule_version\)/);
    expect(sql).toContain('idx_public_package_snapshots_package_revision_hash');
    expect(sql).toMatch(/ON CONFLICT \(package_id, package_revision, snapshot_hash\)/);
    expect(sql).toContain('THEN v_previous_published_snapshot_id');
    expect(sql).toContain("WHEN v_previous_published_snapshot_id IS NOT NULL AND NOT COALESCE(p_revoke_previous, false)");
    expect(sql).toContain('AND COALESCE(p_revoke_previous, false)');
    expect(sql).toContain("revocation_reason = COALESCE(NULLIF(p_revocation_reason, ''), 'explicit_candidate_rejection')");
    expect(publicViewSql).not.toContain('AND s.package_revision = p.package_revision');
    expect(publicViewSql).toContain('AND d.package_revision = s.package_revision');
    expect(publicViewSql).not.toContain("WHERE p.publication_state IN ('approved', 'published')");
  });

  it('binds browser proof to the canonical customer proof input', () => {
    const source = fs.readFileSync(MOBILE_PROOF_SCRIPT, 'utf8');
    expect(source).toContain('buildCustomerPackageMobileProofInputHash');
    expect(source).toContain('proof_input_hash: result.proof_input_hash');
    expect(source).toContain("viewport_profile_version: 'mobile-v1'");
    expect(source).toContain("copy_template_version: 'customer-copy-v1'");
    expect(source).toContain("type SurfaceName = 'packages' | 'lp'");
    expect(source).toContain("checkedSurfaces: checkLp ? ['packages', 'lp'] : ['packages']");
  });
});
