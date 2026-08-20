import { describe, expect, it } from 'vitest';

import { buildProductRegistrationV6DomainProjection, classifyLodgingState } from './domain-projections';

describe('V6 domain projections', () => {
  it('projects dated departures, source flights, lodging and core golf rounds without inventing facts', () => {
    const result = buildProductRegistrationV6DomainProjection({
      packageId: 'package-1',
      canonicalPayload: {
        sections: [{
          v3: { ledger: { variants: [{
            variant_key: 'v1',
            price_calendar: [{ date: '2026-10-01', amount: 999000, evidence: { node: 'p1' } }],
            flight_segments: [{ leg: 'outbound', code: 'BX321', dep_airport: 'PUS', arr_airport: 'DAD', dep_time: '19:00', arr_time: '22:00', evidence: { node: 'f1' } }],
            days: [{
              day: 1,
              hotel: { raw_text: '다낭 시내 4성급 또는 동급', evidence: { node: 'h1' } },
              events: [{ type: 'activity', time: '08:00', raw_text: '몽고메리 링크스 CC 18홀', evidence: { node: 'g1' } }],
            }],
          }] } },
        }],
      },
    });
    expect(result.departures).toHaveLength(1);
    expect(result.transportSegments[0]).toMatchObject({
      carrier_code: 'BX',
      service_number: 'BX321',
      departure_place_code: 'PUS',
      arrival_place_code: 'DAD',
      departure_local_time: '19:00',
      fact_state: 'source_confirmed',
    });
    expect(result.lodgingStays[0]).toMatchObject({ lodging_state: 'equivalent' });
    expect(result.golfRounds[0]).toMatchObject({ holes: 18, tee_time: '08:00' });
  });

  it('does not turn optional golf text into a core round', () => {
    const result = buildProductRegistrationV6DomainProjection({
      packageId: 'package-1',
      canonicalPayload: { sections: [{ v3: { ledger: { variants: [{ days: [{ day: 1, events: [{ type: 'option', raw_text: '선택 골프 18홀 추가 비용' }] }] }] } } }] },
    });
    expect(result.golfRounds).toHaveLength(0);
  });

  it('deduplicates repeated departure dates while retaining all evidence anchors', () => {
    const result = buildProductRegistrationV6DomainProjection({
      packageId: 'package-1',
      canonicalPayload: {
        sections: [{
          v3: { ledger: { variants: [{
            variant_key: 'v1',
            price_calendar: [
              { date: '2026-10-01', amount: 599000, evidence: { node: 'p1' } },
              { date: '2026-10-01', amount: 599000, evidence: { node: 'p2' } },
            ],
          }] } },
        }],
      },
    });

    expect(result.departures).toHaveLength(1);
    expect(result.departures[0]?.evidence).toEqual([{ node: 'p1' }, { node: 'p2' }]);
  });

  it('keeps exact-date special pricing separate from booking availability', () => {
    const result = buildProductRegistrationV6DomainProjection({
      packageId: 'package-1',
      canonicalPayload: {
        sections: [{ v3: { ledger: { variants: [{
          variant_key: 'golf-v1',
          price_calendar: [
            { date: '2026-10-30', amount: 869000, label: '별도문의', source_labels: ['제외일자'] },
            { date: '2026-10-31', amount: '85,9000', label: '별도문의' },
          ],
        }] } } }],
      },
    });

    expect(result.departures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        departure_date: '2026-10-30',
        adult_selling_price: 869000,
        pricing_state: 'PRICED',
        booking_state: 'MANUAL_CONFIRMATION_REQUIRED',
        price_rule_type: 'EXACT_DATE_OVERRIDE',
        sale_state: 'request',
      }),
      expect.objectContaining({
        departure_date: '2026-10-31',
        adult_selling_price: null,
        raw_amount: '85,9000',
        pricing_state: 'CONFLICTING',
        booking_state: 'MANUAL_CONFIRMATION_REQUIRED',
      }),
    ]));
  });

  it('treats supplier placeholders as unconfirmed lodging', () => {
    expect(classifyLodgingState('해당숙소')).toBe('to_be_confirmed');
    expect(classifyLodgingState('호텔 미정')).toBe('to_be_confirmed');
    expect(classifyLodgingState('다낭 4성급 또는 동급')).toBe('equivalent');
    expect(classifyLodgingState('헤난 알로나 비치 리조트')).toBe('confirmed');
  });
});
