import { describe, expect, it } from 'vitest';
import {
  classifyOptionalTourForPublicEligibility,
  collectBrokenAttractionIds,
  getUpcomingPublicDepartureDates,
  getPackagePublicEligibilityBlockers,
  hasOptionalTourDisplayPollution,
  hasUpcomingPublicDepartureDate,
  isCustomerPubliclyOpenable,
  sanitizeBrokenAttractionIdsForPublicEligibility,
  sanitizeOptionalToursForPublicEligibility,
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
  it('shares a KST-safe public departure-date rule across customer surfaces', () => {
    const today = '2026-08-29';

    expect(hasUpcomingPublicDepartureDate({ price_dates: [] }, today)).toBe(true);
    expect(hasUpcomingPublicDepartureDate({}, today)).toBe(true);
    expect(hasUpcomingPublicDepartureDate({ price_dates: null }, today)).toBe(true);
    expect(hasUpcomingPublicDepartureDate({ price_dates: '2026-08-30' }, today)).toBe(false);
    expect(hasUpcomingPublicDepartureDate({ price_dates: { date: '2026-08-30' } }, today)).toBe(false);
    expect(hasUpcomingPublicDepartureDate({ price_dates: [{ date: '2026-08-29' }] }, today)).toBe(true);
    expect(hasUpcomingPublicDepartureDate({ price_dates: [{ date: '2026-08-30' }] }, today)).toBe(true);
    expect(hasUpcomingPublicDepartureDate({ price_dates: [{ date: '2026-08-28' }] }, today)).toBe(false);
    expect(hasUpcomingPublicDepartureDate({ price_dates: [{ date: '2026-02-30' }] }, today)).toBe(false);
    expect(hasUpcomingPublicDepartureDate({ price_dates: [{ date: 'not-a-date' }] }, today)).toBe(false);

    expect(getUpcomingPublicDepartureDates([
      { date: '2026-08-28' },
      { date: '2026-08-29', price: 100 },
      { date: '2026-09-01', price: 200 },
      { date: '2026-02-30' },
    ], today)).toEqual([
      { date: '2026-08-29', price: 100 },
      { date: '2026-09-01', price: 200 },
    ]);
  });

  it('fails closed when customer_open_contract is missing, even for active clean packages', () => {
    const blockers = getPackagePublicEligibilityBlockers({
      status: 'active',
      audit_status: 'clean',
      audit_report: {},
    });

    expect(blockers.map((b) => b.code)).toContain('customer_open_contract_missing');
    expect(isCustomerPubliclyOpenable({ status: 'active', audit_status: 'clean', audit_report: {} })).toBe(false);
  });

  it('blocks expired or malformed departure-date arrays in the canonical public gate', () => {
    const blockers = getPackagePublicEligibilityBlockers({
      status: 'active',
      audit_status: 'clean',
      audit_report: passingContract,
      price_dates: [{ date: '2026-08-28' }],
    });

    expect(blockers.map((blocker) => blocker.code)).toContain('all_departure_dates_expired');
    expect(isCustomerPubliclyOpenable({
      status: 'active',
      audit_status: 'clean',
      audit_report: passingContract,
      price_dates: [{ date: '2026-08-28' }],
    })).toBe(false);
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

  it('accepts the ready_not_opened autopilot nested customer_open_contract shape', () => {
    expect(
      isCustomerPubliclyOpenable({
        status: 'active',
        audit_status: 'warnings',
        audit_report: {
          upload_to_open_autopilot: passingContract,
        },
        optional_tours: [],
        itinerary_data: { days: [] },
      }),
    ).toBe(true);
  });

  it('blocks optional tour pollution from no-option and table fragments', () => {
    expect(hasOptionalTourDisplayPollution(['\ub178\uc635\uc158'])).toBe(true);
    expect(hasOptionalTourDisplayPollution([{ name: '\ud3ec \ud568 \ub0b4 \uc5ed' }])).toBe(true);
    expect(hasOptionalTourDisplayPollution([{ name: '\uc0c1\ud488\uac00', price: '599' }])).toBe(true);
    expect(hasOptionalTourDisplayPollution([{ name: '\uc624\uc804\uc790\uc720' }])).toBe(true);

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

  it('classifies optional-tour fragments so repair jobs can quarantine them with reasons', () => {
    expect(classifyOptionalTourForPublicEligibility({ name: '\ub178\uc635\uc158' }).classification)
      .toBe('no_option_evidence');
    expect(classifyOptionalTourForPublicEligibility({ name: '\uc0c1\ud488\uac00', price: '599' }).classification)
      .toBe('price_table_fragment');
    expect(classifyOptionalTourForPublicEligibility({ name: '\ucc28\ub7c9' }).classification)
      .toBe('inclusion_fragment');
    expect(classifyOptionalTourForPublicEligibility({ name: '\uc120\ud0dd\uad00\uad11 \ud638\ud551\ud22c\uc5b4', price: '$80/\uc778' }).classification)
      .toBe('valid_paid_option');
    expect(classifyOptionalTourForPublicEligibility({ name: '\ucd94\ucc9c \uc635\uc158 : \ud06c\ub8e8\uc988 60$' }).classification)
      .toBe('valid_paid_option');
    expect(classifyOptionalTourForPublicEligibility({ name: '\u25b3 \ud63c\ub62c\uc12c \ucf00\uc774\ube14\uce74 &\uc6cc\ud130\ud30c\ud06c', price: '$60/\uc778' }).classification)
      .toBe('valid_paid_option');
  });

  it('sanitizes optional tours by keeping paid options and quarantining no-option/table noise', () => {
    const repair = sanitizeOptionalToursForPublicEligibility([
      { name: '\ub178\uc635\uc158' },
      { name: '\ud3ec \ud568 \ub0b4 \uc5ed' },
      { name: '\uc624\uc804\uc790\uc720' },
      { name: '\uc120\ud0dd\uad00\uad11 \ud638\ud551\ud22c\uc5b4', price: '$80/\uc778' },
    ]);

    expect(repair.repaired).toBe(true);
    expect(repair.status).toBe('paid_options');
    expect(repair.optionalTours).toEqual([
      { name: '\uc120\ud0dd\uad00\uad11 \ud638\ud551\ud22c\uc5b4', price: '$80/\uc778' },
    ]);
    expect(repair.removed.map((finding) => finding.classification)).toEqual([
      'no_option_evidence',
      'inclusion_fragment',
      'unknown_fragment',
    ]);
  });

  it('marks no-option evidence as a product condition rather than a renderable optional tour', () => {
    const repair = sanitizeOptionalToursForPublicEligibility([{ name: '\uc120\ud0dd\uad00\uad11: \ub178\uc635\uc158' }]);

    expect(repair.status).toBe('none_explicit');
    expect(repair.optionalTours).toEqual([]);
    expect(repair.removed[0]?.classification).toBe('no_option_evidence');
  });

  it('removes malformed or orphan attraction ids while preserving valid ids', () => {
    const valid = '123e4567-e89b-12d3-a456-426614174000';
    const orphan = '123e4567-e89b-12d3-a456-426614174999';
    const repair = sanitizeBrokenAttractionIdsForPublicEligibility(
      {
        days: [
          {
            schedule: [
              { attraction_ids: ['fcf2-4df5-bad-id', valid, orphan] },
            ],
          },
        ],
      },
      new Set([valid]),
    );

    expect(repair.repaired).toBe(true);
    expect(repair.itineraryData).toEqual({
      days: [
        {
          schedule: [
            { attraction_ids: [valid] },
          ],
        },
      ],
    });
    expect(repair.removed.map((item) => item.reason)).toEqual([
      'malformed_uuid',
      'unknown_attraction_id',
    ]);
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

  it('does not keep a proof-only customer contract blocker after fresh proof passes', () => {
    const auditReport = {
      customer_open_contract: {
        ok: false,
        status: 'blocked',
        blockers: ['public_eligibility_repair:requires_mobile_reproof'],
        stale_or_missing_proof: true,
        mobile_browser_proof: {
          ok: false,
          reason: 'public eligibility repair changed package data; refresh mobile proof and customer open contract',
        },
      },
      mobile_browser_proof: {
        status: 'pass',
        checked_at: '2026-07-08T09:30:00.000Z',
        package_updated_at: '2026-07-08T09:00:00.000Z',
        source: 'hwp-mobile-browser-proof',
        screen_hash: 'screen-hash',
        customer_visible_hash: 'visible-hash',
        surfaces: ['packages', 'lp'],
        surface_results: [
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
        ],
      },
    };

    const blockers = getPackagePublicEligibilityBlockers({
      status: 'active',
      audit_status: 'clean',
      audit_report: auditReport,
      updated_at: '2026-07-08T09:00:00.000Z',
      optional_tours: [],
      itinerary_data: { days: [] },
    }).map((b) => b.code);

    expect(blockers).not.toContain('customer_open_contract_blocked');
    expect(blockers).not.toContain('stale_or_missing_mobile_proof');
  });

  it('fails closed when stored mobile readiness contradicts a passing customer contract', () => {
    const blockers = getPackagePublicEligibilityBlockers({
      status: 'active',
      audit_status: 'clean',
      audit_report: {
        ...passingContract,
        readiness: {
          status: 'fail',
          failures: ['attraction_unlinked_registered', 'entity_attraction_unresolved'],
        },
        trust_score: {
          publishable: false,
          blockers: ['attraction.unlinked_registered', 'entity.attraction_unresolved'],
        },
      },
      optional_tours: [],
      itinerary_data: { days: [] },
    }).map((b) => b.code);

    expect(blockers).toContain('mobile_readiness_failed');
    expect(blockers).toContain('attraction_unlinked_registered');
    expect(blockers).toContain('entity_review_unresolved');
    expect(blockers).toContain('trust_score_blocked');
  });

  it('uses the latest persisted mobile landing readiness snapshot before stale legacy audit fields', () => {
    const blockers = getPackagePublicEligibilityBlockers({
      status: 'active',
      audit_status: 'clean',
      audit_report: {
        ...passingContract,
        quality_status: 'blocked',
        readiness: {
          status: 'fail',
          failures: ['entity_attraction_unresolved'],
        },
        trust_score: {
          publishable: false,
          blockers: ['entity.attraction_unresolved'],
        },
        mobile_landing_readiness: {
          source: 'audit-product-mobile-landing-readiness',
          checked_at: '2026-07-08T00:00:00.000Z',
          status: 'pass',
          failures: [],
          warnings: [],
          trust_score: {
            publishable: true,
            blockers: [],
          },
        },
      },
      optional_tours: [],
      itinerary_data: { days: [] },
    }).map((b) => b.code);

    expect(blockers).not.toContain('mobile_readiness_failed');
    expect(blockers).not.toContain('entity_review_unresolved');
    expect(blockers).not.toContain('trust_score_blocked');
  });
});
