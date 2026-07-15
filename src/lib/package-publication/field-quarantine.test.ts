import { describe, expect, it } from 'vitest';

import { applyDeterministicFieldQuarantine, detectPackageFieldPollution, quarantineIdempotencyKey } from './field-quarantine';

describe('package field quarantine detector', () => {
  it('quarantines no-option as a condition rather than a paid optional tour', () => {
    const findings = detectPackageFieldPollution({ optional_tours: ['노옵션'] });
    expect(findings).toMatchObject([{ reasonCode: 'condition_badge_in_optional_tours' }]);
  });

  it('keeps an explicit paid optional tour candidate', () => {
    const findings = detectPackageFieldPollution({
      optional_tours: [{ name: '전신 마사지', price: 50, currency: 'USD' }],
    });
    expect(findings).toEqual([]);
  });

  it('quarantines price, inclusion, and notice fragments inside itinerary schedules', () => {
    const findings = detectPackageFieldPollution({
      itinerary_data: {
        days: [{ schedule: ['599,000원/인', '포함내역 차량 가이드', '취소 규정 수수료 안내'] }],
      },
    });
    expect(findings.map(item => item.reasonCode)).toEqual([
      'price_fragment_in_itinerary',
      'inclusion_fragment_in_itinerary',
      'notice_fragment_in_itinerary',
    ]);
  });

  it('builds a stable idempotency key for repeated repair jobs', () => {
    const [finding] = detectPackageFieldPollution({ optional_tours: ['노옵션'] });
    expect(quarantineIdempotencyKey('package-1', finding)).toBe(
      quarantineIdempotencyKey('package-1', finding),
    );
  });

  it('removes only detected fragments and preserves valid itinerary activities', () => {
    const result = applyDeterministicFieldQuarantine({
      optional_tours: ['노옵션', { name: '전신 마사지', price: 50, currency: 'USD' }],
      itinerary_data: { days: [{ schedule: ['백두산 천지 관광', '599,000원/인'] }] },
    });
    expect(result.repairedPackage.optional_tours).toEqual([{ name: '전신 마사지', price: 50, currency: 'USD' }]);
    expect((result.repairedPackage.itinerary_data as { days: Array<{ schedule: unknown[] }> }).days[0].schedule)
      .toEqual(['백두산 천지 관광']);
  });
});
