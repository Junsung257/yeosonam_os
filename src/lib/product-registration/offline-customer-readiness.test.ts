import { describe, expect, it } from 'vitest';

import {
  ACTIVE_ATTRACTION_CATALOG_UNAVAILABLE,
  evaluateOfflineCustomerReadiness,
} from './offline-customer-readiness';

describe('evaluateOfflineCustomerReadiness', () => {
  it('does not claim customer readiness when the attraction catalog was not verified', () => {
    const result = evaluateOfflineCustomerReadiness({
      publishable: true,
      blockers: [],
      warnings: [],
      activeAttractionCatalogVerified: false,
    });

    expect(result.ready).toBe(false);
    expect(result.reviewWarnings).toContain(ACTIVE_ATTRACTION_CATALOG_UNAVAILABLE);
  });

  it.each([
    'v3:needs_review',
    'v3:gate:v1.flight:air package has flight evidence',
    'mobile_media:attraction.unmatched_major:천문산',
    'entity_attraction_unmatched',
  ])('keeps customer-facing review warning "%s" blocking', warning => {
    const result = evaluateOfflineCustomerReadiness({
      publishable: true,
      blockers: [],
      warnings: [warning],
      activeAttractionCatalogVerified: true,
    });

    expect(result.ready).toBe(false);
    expect(result.reviewWarnings).toContain(warning);
  });

  it('allows non-customer parser warnings after the active catalog is verified', () => {
    const result = evaluateOfflineCustomerReadiness({
      publishable: true,
      blockers: [],
      warnings: ['summary:auto_generated'],
      activeAttractionCatalogVerified: true,
    });

    expect(result).toEqual({ ready: true, reviewWarnings: [] });
  });

  it('still blocks an otherwise clean product when registration is not publishable', () => {
    const result = evaluateOfflineCustomerReadiness({
      publishable: false,
      blockers: [],
      warnings: [],
      activeAttractionCatalogVerified: true,
    });

    expect(result.ready).toBe(false);
  });
});
