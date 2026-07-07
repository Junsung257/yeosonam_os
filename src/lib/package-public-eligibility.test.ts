import { describe, expect, it } from 'vitest';
import {
  collectBrokenAttractionIds,
  getPackagePublicEligibilityBlockers,
  hasOptionalTourDisplayPollution,
  isCustomerPubliclyOpenable,
} from './package-public-eligibility';

const passingContract = {
  customer_open_contract: {
    ok: true,
    status: 'pass',
    stale_or_missing_proof: false,
    mobile_browser_proof: { ok: true },
  },
};

describe('package public eligibility', () => {
  it('fails closed when customer_open_contract is missing, even for active clean packages', () => {
    const blockers = getPackagePublicEligibilityBlockers({
      status: 'active',
      audit_status: 'clean',
      audit_report: {},
    });

    expect(blockers.map((b) => b.code)).toContain('customer_open_contract_missing');
    expect(isCustomerPubliclyOpenable({ status: 'active', audit_status: 'clean', audit_report: {} })).toBe(false);
  });

  it('allows only customer-visible packages with a passing contract and clean public fields', () => {
    expect(
      isCustomerPubliclyOpenable({
        status: 'active',
        audit_status: 'clean',
        audit_report: passingContract,
        optional_tours: [],
        itinerary_data: [{ day: 1, attraction_ids: ['123e4567-e89b-12d3-a456-426614174000'] }],
      }),
    ).toBe(true);
  });

  it('blocks optional tour pollution from no-option and table fragments', () => {
    expect(hasOptionalTourDisplayPollution(['\ub178\uc635\uc158'])).toBe(true);
    expect(hasOptionalTourDisplayPollution([{ name: '\ud3ec \ud568 \ub0b4 \uc5ed' }])).toBe(true);
    expect(hasOptionalTourDisplayPollution([{ name: '\uc0c1\ud488\uac00', price: '599' }])).toBe(true);

    const blockers = getPackagePublicEligibilityBlockers({
      status: 'active',
      audit_report: passingContract,
      optional_tours: [{ name: '\ub178\uc635\uc158' }],
    });
    expect(blockers.map((b) => b.code)).toContain('optional_tour_display_pollution');
  });

  it('blocks malformed attraction ids instead of letting audit fail open', () => {
    const brokenIds = collectBrokenAttractionIds({
      days: [
        {
          title: 'day 1',
          attraction_ids: ['fcf2-4df5-bad-id', '123e4567-e89b-12d3-a456-426614174000'],
        },
      ],
    });

    expect(brokenIds).toEqual(['fcf2-4df5-bad-id']);
    expect(
      getPackagePublicEligibilityBlockers({
        status: 'active',
        audit_report: passingContract,
        itinerary_data: { attraction_ids: ['fcf2-4df5-bad-id'] },
      }).map((b) => b.code),
    ).toContain('broken_attraction_id');
  });

  it('blocks stale or failed mobile proof in the stored contract', () => {
    const blockers = getPackagePublicEligibilityBlockers({
      status: 'active',
      audit_report: {
        customer_open_contract: {
          ok: true,
          status: 'pass',
          stale_or_missing_proof: true,
          mobile_browser_proof: { ok: false, reason: 'proof is older than package revision' },
        },
      },
    });

    expect(blockers.map((b) => b.code)).toContain('stale_or_missing_mobile_proof');
    expect(isCustomerPubliclyOpenable({ status: 'active', audit_report: passingContract })).toBe(true);
  });
});
