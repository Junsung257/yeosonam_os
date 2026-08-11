import { describe, expect, it } from 'vitest';

import { evaluateCustomerMobileProof } from './customer-mobile-proof';

function passingSurfaceResults() {
  return [
    {
      surface: 'packages',
      status: 'pass',
      screen_hash: 'packages-screen',
      customer_visible_hash: 'packages-visible',
      checks: [
        { name: 'packages_reservation_cta_visible', ok: true },
        { name: 'packages_reservation_sheet_opens', ok: true },
        { name: 'packages_reservation_sheet_has_product_context', ok: true },
      ],
    },
    {
      surface: 'lp',
      status: 'pass',
      screen_hash: 'lp-screen',
      customer_visible_hash: 'lp-visible',
      checks: [
        { name: 'lp_lead_cta_visible', ok: true },
        { name: 'lp_lead_sheet_opens', ok: true },
        { name: 'lp_lead_sheet_has_customer_copy', ok: true },
      ],
    },
  ];
}

function passingProof(extra: Record<string, unknown> = {}) {
  return {
    status: 'pass',
    checked_at: '2026-06-22T09:00:00.000Z',
    package_updated_at: '2026-06-22T08:59:00.000Z',
    source: 'hwp-mobile-browser-proof',
    screen_hash: 'screen-hash',
    customer_visible_hash: 'visible-hash',
    surfaces: ['packages', 'lp'],
    surface_results: passingSurfaceResults(),
    ...extra,
  };
}

describe('evaluateCustomerMobileProof', () => {
  it('blocks customer publication when actual packages mobile proof is missing', () => {
    const result = evaluateCustomerMobileProof({ auditReport: null });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('/packages mobile browser proof is missing');
  });

  it('blocks when lp proof surface is missing', () => {
    const result = evaluateCustomerMobileProof({
      auditReport: {
        mobile_browser_proof: {
          status: 'pass',
          checked_at: '2026-06-22T09:00:00.000Z',
          package_updated_at: '2026-06-22T08:59:00.000Z',
          source: 'hwp-mobile-browser-proof',
          screen_hash: 'screen-hash',
          customer_visible_hash: 'visible-hash',
          surfaces: ['packages'],
        },
      },
      packageUpdatedAt: '2026-06-22T08:59:00.000Z',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('lp surface');
  });

  it('passes only when packages and lp mobile browser proof are successful', () => {
    const result = evaluateCustomerMobileProof({
      auditReport: {
        mobile_browser_proof: {
          status: 'pass',
          checked_at: '2026-06-22T09:00:00.000Z',
          package_updated_at: '2026-06-22T08:59:00.000Z',
          source: 'hwp-mobile-browser-proof',
          screen_hash: 'screen-hash',
          customer_visible_hash: 'visible-hash',
          surfaces: ['packages', 'lp'],
          surface_results: passingSurfaceResults(),
        },
      },
      packageUpdatedAt: '2026-06-22T08:59:00.000Z',
    });

    expect(result.ok).toBe(true);
  });

  it('blocks stale proof from an older saved package row', () => {
    const result = evaluateCustomerMobileProof({
      auditReport: {
        mobile_browser_proof: {
          status: 'pass',
          checked_at: '2026-06-22T09:00:00.000Z',
          package_updated_at: '2026-06-22T08:59:00.000Z',
          source: 'hwp-mobile-browser-proof',
          screen_hash: 'screen-hash',
          customer_visible_hash: 'visible-hash',
          surfaces: ['packages', 'lp'],
          surface_results: passingSurfaceResults(),
        },
      },
      packageUpdatedAt: '2026-06-22T09:10:00.000Z',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('stale');
  });

  it('does not stale a passing proof when only the autopilot audit log updated the row', () => {
    const result = evaluateCustomerMobileProof({
      auditReport: {
        upload_to_open_autopilot: {
          stage: 'blocked_after_mobile_proof',
          checked_at: '2026-06-22T09:10:02.000Z',
        },
        mobile_browser_proof: {
          status: 'pass',
          checked_at: '2026-06-22T09:00:00.000Z',
          package_updated_at: '2026-06-22T08:59:00.000Z',
          source: 'hwp-mobile-browser-proof',
          screen_hash: 'screen-hash',
          customer_visible_hash: 'visible-hash',
          surfaces: ['packages', 'lp'],
          surface_results: passingSurfaceResults(),
        },
      },
      packageUpdatedAt: '2026-06-22T09:10:00.000Z',
    });

    expect(result.ok).toBe(true);
  });

  it('uses the content revision as the authority across audit-only updated_at changes', () => {
    const result = evaluateCustomerMobileProof({
      auditReport: { mobile_browser_proof: passingProof({ package_revision: 8 }) },
      packageUpdatedAt: '2026-06-22T10:30:00.000Z',
      packageRevision: 8,
    });

    expect(result.ok).toBe(true);
  });

  it('accepts a passing proof after a previous stale-only autopilot audit block', () => {
    const result = evaluateCustomerMobileProof({
      auditReport: {
        upload_to_open_autopilot: {
          stage: 'blocked_after_mobile_proof',
          checked_at: '2026-06-22T10:30:00.000Z',
          reasons: [
            'mobile_proof:actual /packages mobile browser proof is stale for the current saved package row',
            'quality_scorecard:packages_mobile: actual /packages mobile browser proof is stale for the current saved package row',
            'quality_scorecard:lp_mobile: actual /packages mobile browser proof is stale for the current saved package row',
          ],
        },
        mobile_browser_proof: {
          status: 'pass',
          checked_at: '2026-06-22T09:00:00.000Z',
          package_updated_at: '2026-06-22T08:59:00.000Z',
          source: 'hwp-mobile-browser-proof',
          screen_hash: 'screen-hash',
          customer_visible_hash: 'visible-hash',
          surfaces: ['packages', 'lp'],
          surface_results: passingSurfaceResults(),
        },
      },
      packageUpdatedAt: '2026-06-22T10:30:00.000Z',
    });

    expect(result.ok).toBe(true);
  });

  it('blocks pass-looking proof when source and hashes are missing', () => {
    const result = evaluateCustomerMobileProof({
      auditReport: {
        mobile_browser_proof: {
          status: 'pass',
          checked_at: '2026-06-22T09:00:00.000Z',
          package_updated_at: '2026-06-22T08:59:00.000Z',
          surfaces: ['packages', 'lp'],
          surface_results: [
            { surface: 'packages', status: 'pass' },
            { surface: 'lp', status: 'pass' },
          ],
        },
      },
      packageUpdatedAt: '2026-06-22T08:59:00.000Z',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('source');
  });

  it('blocks pass-looking proof when a required surface hash is missing', () => {
    const result = evaluateCustomerMobileProof({
      auditReport: {
        mobile_browser_proof: {
          status: 'pass',
          checked_at: '2026-06-22T09:00:00.000Z',
          package_updated_at: '2026-06-22T08:59:00.000Z',
          source: 'hwp-mobile-browser-proof',
          screen_hash: 'screen-hash',
          customer_visible_hash: 'visible-hash',
          surfaces: ['packages', 'lp'],
          surface_results: [
            { surface: 'packages', status: 'pass', screen_hash: 'packages-screen', customer_visible_hash: 'packages-visible' },
            { surface: 'lp', status: 'pass' },
          ],
        },
      },
      packageUpdatedAt: '2026-06-22T08:59:00.000Z',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('lp hashes');
  });

  it('blocks pass-looking proof when CTA sheet checks are missing', () => {
    const result = evaluateCustomerMobileProof({
      auditReport: {
        mobile_browser_proof: {
          status: 'pass',
          checked_at: '2026-06-22T09:00:00.000Z',
          package_updated_at: '2026-06-22T08:59:00.000Z',
          source: 'hwp-mobile-browser-proof',
          screen_hash: 'screen-hash',
          customer_visible_hash: 'visible-hash',
          surfaces: ['packages', 'lp'],
          surface_results: [
            { surface: 'packages', status: 'pass', screen_hash: 'packages-screen', customer_visible_hash: 'packages-visible' },
            { surface: 'lp', status: 'pass', screen_hash: 'lp-screen', customer_visible_hash: 'lp-visible' },
          ],
        },
      },
      packageUpdatedAt: '2026-06-22T08:59:00.000Z',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('CTA checks');
  });

  it('requires expected package revision when approval checks a final revision', () => {
    const result = evaluateCustomerMobileProof({
      auditReport: { mobile_browser_proof: passingProof() },
      packageUpdatedAt: '2026-06-22T08:59:00.000Z',
      packageRevision: 8,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('package revision is missing');
  });

  it('requires expected public snapshot hash on top-level and surface proofs', () => {
    const result = evaluateCustomerMobileProof({
      auditReport: {
        mobile_browser_proof: passingProof({
          package_revision: 8,
        }),
      },
      packageUpdatedAt: '2026-06-22T08:59:00.000Z',
      packageRevision: 8,
      publicSnapshotHash: 'snapshot-hash',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('public snapshot hash is missing');
  });

  it('passes when revision, snapshot hash, and app build id match the expected final artifact', () => {
    const surfaceResults = passingSurfaceResults().map(surface => ({
      ...surface,
      public_snapshot_hash: 'snapshot-hash',
    }));
    const result = evaluateCustomerMobileProof({
      auditReport: {
        mobile_browser_proof: passingProof({
          package_revision: 8,
          public_snapshot_hash: 'snapshot-hash',
          app_build_id: 'build-123',
          surface_results: surfaceResults,
        }),
      },
      packageUpdatedAt: '2026-06-22T08:59:00.000Z',
      packageRevision: 8,
      publicSnapshotHash: 'snapshot-hash',
      appBuildId: 'build-123',
    });

    expect(result.ok).toBe(true);
  });
});
