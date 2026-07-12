import { describe, expect, it } from 'vitest';
import {
  classifyMobileProofRefreshCandidate,
  parseMobileProofRefreshStatusFilter,
  selectMobileProofRefreshCandidates,
  summarizeMobileProofRefreshCandidates,
} from './mobile-proof-refresh-candidates';

const passProof = (updatedAt = '2026-07-01T00:00:00.000Z') => ({
  mobile_browser_proof: {
    status: 'pass',
    checked_at: '2026-07-01T00:01:00.000Z',
    package_updated_at: updatedAt,
    source: 'hwp-mobile-browser-proof',
    screen_hash: 'screen',
    customer_visible_hash: 'visible',
    surfaces: ['packages', 'lp'],
    surface_results: [
      {
        surface: 'packages',
        status: 'pass',
        screen_hash: 'p-screen',
        customer_visible_hash: 'p-visible',
        checks: [
          { name: 'packages_reservation_cta_visible', ok: true },
          { name: 'packages_reservation_sheet_opens', ok: true },
          { name: 'packages_reservation_sheet_has_product_context', ok: true },
        ],
      },
      {
        surface: 'lp',
        status: 'pass',
        screen_hash: 'l-screen',
        customer_visible_hash: 'l-visible',
        checks: [
          { name: 'lp_lead_cta_visible', ok: true },
          { name: 'lp_lead_sheet_opens', ok: true },
          { name: 'lp_lead_sheet_has_customer_copy', ok: true },
        ],
      },
    ],
  },
});

describe('mobile proof refresh candidates', () => {
  it('skips packages whose stored proof is current and complete', () => {
    expect(classifyMobileProofRefreshCandidate({
      id: 'pkg-ok',
      updated_at: '2026-07-01T00:00:00.000Z',
      audit_report: passProof(),
    })).toBeNull();
  });

  it('classifies stale, missing, and hashless proof work for batch reproof', () => {
    const candidates = selectMobileProofRefreshCandidates([
      { id: 'missing', internal_code: 'PUS-MISSING', updated_at: '2026-07-01T00:00:00.000Z', audit_report: {} },
      { id: 'stale', internal_code: 'PUS-STALE', updated_at: '2026-07-02T00:00:00.000Z', audit_report: passProof('2026-07-01T00:00:00.000Z') },
      {
        id: 'hashless',
        internal_code: 'PUS-HASH',
        updated_at: '2026-07-01T00:00:00.000Z',
        audit_report: { mobile_browser_proof: { ...passProof().mobile_browser_proof, screen_hash: null } },
      },
    ]);

    expect(candidates.map(candidate => candidate.reason)).toEqual(['missing', 'hash_missing', 'stale']);
    expect(summarizeMobileProofRefreshCandidates(candidates).byReason).toMatchObject({
      missing: 1,
      hash_missing: 1,
      stale: 1,
    });
  });

  it('filters by requested reason before enforcing limit', () => {
    const candidates = selectMobileProofRefreshCandidates([
      { id: 'missing', updated_at: '2026-07-01T00:00:00.000Z', audit_report: {} },
      { id: 'stale', updated_at: '2026-07-02T00:00:00.000Z', audit_report: passProof('2026-07-01T00:00:00.000Z') },
    ], { reasons: ['stale'], limit: 1 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.id).toBe('stale');
  });

  it('parses explicit status filters without changing the safe default', () => {
    expect(parseMobileProofRefreshStatusFilter(null, ['active', 'approved'])).toEqual(['active', 'approved']);
    expect(parseMobileProofRefreshStatusFilter('pending_review,active,pending_review', ['active'])).toEqual([
      'pending_review',
      'active',
    ]);
  });

  it('classifies hash-only proof as CTA reproof work', () => {
    const candidate = classifyMobileProofRefreshCandidate({
      id: 'hash-only',
      updated_at: '2026-07-01T00:00:00.000Z',
      audit_report: {
        mobile_browser_proof: {
          status: 'pass',
          checked_at: '2026-07-01T00:01:00.000Z',
          package_updated_at: '2026-07-01T00:00:00.000Z',
          source: 'hwp-mobile-browser-proof',
          screen_hash: 'screen',
          customer_visible_hash: 'visible',
          surfaces: ['packages', 'lp'],
          surface_results: [
            { surface: 'packages', status: 'pass', screen_hash: 'p-screen', customer_visible_hash: 'p-visible' },
            { surface: 'lp', status: 'pass', screen_hash: 'l-screen', customer_visible_hash: 'l-visible' },
          ],
        },
      },
    });

    expect(candidate?.reason).toBe('cta_missing');
  });

  it('classifies legacy proof without revision metadata as reproof work when the row has a stored revision', () => {
    const candidate = classifyMobileProofRefreshCandidate({
      id: 'legacy-proof',
      status: 'active',
      package_revision: 7,
      updated_at: '2026-07-01T00:00:00.000Z',
      audit_report: passProof(),
    });

    expect(candidate?.reason).toBe('hash_missing');
    expect(candidate?.detail).toContain('package revision is missing');
  });
});
