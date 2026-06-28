import { describe, expect, it } from 'vitest';

import { evaluateCustomerMobileProof } from './customer-mobile-proof';

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
          surfaces: ['packages', 'lp'],
          surface_results: [
            { surface: 'packages', status: 'pass' },
            { surface: 'lp', status: 'pass' },
          ],
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
          surfaces: ['packages', 'lp'],
        },
      },
      packageUpdatedAt: '2026-06-22T09:10:00.000Z',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('stale');
  });
});
