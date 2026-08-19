import { describe, expect, it } from 'vitest';

import { auditPublicationAuthority } from './publication-authority-audit';

const ids = {
  tenant: '00000000-0000-4000-8000-000000000001',
  catalog: '00000000-0000-4000-8000-000000000002',
  package: '00000000-0000-4000-8000-000000000003',
  revision: '00000000-0000-4000-8000-000000000004',
  snapshot: '00000000-0000-4000-8000-000000000005',
};

function proof() {
  const checks = (surface: string) => surface === 'packages'
    ? [
        { name: 'packages_reservation_cta_visible', ok: true },
        { name: 'packages_reservation_sheet_opens', ok: true },
        { name: 'packages_reservation_sheet_has_product_context', ok: true },
      ]
    : [
        { name: 'lp_lead_cta_visible', ok: true },
        { name: 'lp_lead_sheet_opens', ok: true },
        { name: 'lp_lead_sheet_has_customer_copy', ok: true },
      ];
  return {
    status: 'pass',
    checked_at: '2026-08-11T00:00:00.000Z',
    package_updated_at: '2026-08-11T00:00:00.000Z',
    package_revision: 2,
    public_snapshot_hash: 'a'.repeat(64),
    source: 'hwp-mobile-browser-proof',
    screen_hash: 'b'.repeat(64),
    customer_visible_hash: 'c'.repeat(64),
    surfaces: ['packages', 'lp'],
    surface_results: ['packages', 'lp'].map(surface => ({
      surface,
      status: 'pass',
      screen_hash: 'b'.repeat(64),
      customer_visible_hash: 'c'.repeat(64),
      public_snapshot_hash: 'a'.repeat(64),
      checks: checks(surface),
    })),
  };
}

function validInput() {
  return {
    packageRow: {
      id: ids.package,
      tenant_id: ids.tenant,
      catalog_product_id: ids.catalog,
      canonical_revision_id: ids.revision,
      package_revision: 2,
      status: 'active',
      publication_state: 'published',
      updated_at: '2026-08-11T00:00:00.000Z',
      price_dates: [{ date: '2026-09-01', price: 599000 }],
      audit_report: {
        mobile_browser_proof: proof(),
        customer_open_contract: { ok: true, status: 'pass' },
        registration_evidence_pack_v1: {
          status: 'pass',
          scorecard: { customer_open_candidate: true },
          downstream_eligibility: { customer_open: true },
        },
      },
    },
    pointer: {
      tenant_id: ids.tenant,
      package_id: ids.package,
      catalog_product_id: ids.catalog,
      current_revision_id: ids.revision,
      current_snapshot_id: ids.snapshot,
      state: 'published',
      channel: 'customer',
      locale: 'ko-KR',
    },
    snapshot: {
      id: ids.snapshot,
      tenant_id: ids.tenant,
      package_id: ids.package,
      catalog_product_id: ids.catalog,
      canonical_revision_id: ids.revision,
      package_revision: 2,
      snapshot_hash: 'a'.repeat(64),
      status: 'published',
      snapshot_json: { package: { price_dates: [{ date: '2026-09-01', price: 599000 }] } },
    },
    revision: {
      id: ids.revision,
      tenant_id: ids.tenant,
      package_id: ids.package,
      catalog_product_id: ids.catalog,
      source_document_id: '00000000-0000-4000-8000-000000000006',
      extraction_id: '00000000-0000-4000-8000-000000000007',
      payload_hash: 'd'.repeat(64),
      lineage_hash: 'e'.repeat(64),
      status: 'published',
    },
  };
}

describe('auditPublicationAuthority', () => {
  it('accepts one tenant-bound revision, snapshot, proof and pointer chain', () => {
    const result = auditPublicationAuthority(validInput());

    expect(result.authoritativePublic).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails a legacy-public package without an authoritative pointer', () => {
    const input = validInput() as any;
    input.pointer = null as never;
    input.snapshot = null as never;

    const result = auditPublicationAuthority(input);

    expect(result.authoritativePublic).toBe(false);
    expect(result.failures).toContain('publication_pointer_missing');
  });

  it('cannot hide a blocked evidence pack behind a passing top-level audit', () => {
    const input = validInput() as any;
    input.packageRow.audit_report.registration_evidence_pack_v1.status = 'blocked';
    input.packageRow.audit_report.registration_evidence_pack_v1.scorecard.customer_open_candidate = false;

    const result = auditPublicationAuthority(input);

    expect(result.authoritativePublic).toBe(false);
    expect(result.failures).toContain('registration_evidence_pack_blocked');
    expect(result.failures).toContain('customer_open_candidate_false');
  });

  it('fails stale snapshot prices and proof hashes', () => {
    const input = validInput() as any;
    input.snapshot.snapshot_json.package.price_dates = [];
    input.packageRow.audit_report.mobile_browser_proof.public_snapshot_hash = 'f'.repeat(64);

    const result = auditPublicationAuthority(input);

    expect(result.failures).toContain('snapshot_price_date_count_mismatch');
    expect(result.failures).toContain('mobile_browser_proof_invalid_or_stale');
  });

  it('accepts a V6 catalog-bound revision with a separately persisted browser proof', () => {
    const input = validInput() as any;
    input.packageRow.audit_report = null;
    input.revision = {
      ...input.revision,
      package_id: null,
      schema_version: 'product-registration-v5-canonical-1',
      normalization_version: 'v6-canonical-2026-08-17.57',
      status: 'verified',
    };
    input.proof = {
      status: 'passed',
      result: {
        status: 'pass',
        source: 'hwp-mobile-browser-proof',
        snapshotHash: 'a'.repeat(64),
        surfaces: ['packages', 'lp'],
        surface_results: ['packages', 'lp'].map(surface => ({
          surface,
          status: 'pass',
          public_snapshot_hash: 'a'.repeat(64),
          checks: [{ name: `${surface}_cta`, ok: true }],
        })),
      },
    };

    const result = auditPublicationAuthority(input);

    expect(result.authoritativePublic).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('accepts the persisted nested chromeProof contract used by the live workflow', () => {
    const input = validInput() as any;
    input.packageRow.audit_report = null;
    input.revision = {
      ...input.revision,
      package_id: null,
      schema_version: 'product-registration-v5-canonical-1',
      normalization_version: 'v6-canonical-2026-08-19.76',
      status: 'verified',
    };
    input.proof = {
      status: 'passed',
      renderer_build_id: '082c1b0f',
      route: 'https://example.test/product-registration-proof/packages/snapshot|https://example.test/product-registration-proof/lp/snapshot',
      viewport: { width: 390, height: 844, deviceScaleFactor: 3 },
      device_profile: 'mobile-customer',
      result: {
        chromeProof: {
          status: 'passed',
          surfaces: ['packages', 'lp'].map(surface => ({
            surface,
            status: 'passed',
            snapshotHash: 'a'.repeat(64),
            rendererBuildId: '082c1b0f',
            ctaOpened: true,
            hydrationErrors: [],
            brokenImageCount: 0,
            missingRequiredText: [],
            forbiddenTextFound: [],
          })),
        },
      },
    };

    const result = auditPublicationAuthority(input);

    expect(result.v6Authority).toBe(true);
    expect(result.authoritativePublic).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('still rejects a V6 proof when one surface is missing or hash-bound differently', () => {
    const input = validInput() as any;
    input.packageRow.audit_report = null;
    input.revision = {
      ...input.revision,
      package_id: null,
      schema_version: 'product-registration-v5-canonical-1',
      normalization_version: 'v6-canonical-2026-08-17.57',
      status: 'verified',
    };
    input.proof = {
      status: 'passed',
      result: {
        status: 'pass',
        source: 'hwp-mobile-browser-proof',
        snapshotHash: 'a'.repeat(64),
        surfaces: ['packages'],
        surface_results: [{
          surface: 'packages',
          status: 'pass',
          public_snapshot_hash: 'f'.repeat(64),
          checks: [{ name: 'packages_cta', ok: true }],
        }],
      },
    };

    const result = auditPublicationAuthority(input);

    expect(result.authoritativePublic).toBe(false);
    expect(result.failures).toContain('registration_evidence_pack_missing');
    expect(result.failures).toContain('mobile_browser_proof_invalid_or_stale');
  });
});
