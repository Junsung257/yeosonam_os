import { describe, expect, it } from 'vitest';

import { buildV5ItineraryItems, buildV5PriceRules } from './typed-projections';

const payload = {
  sections: [{
    v3: {
      ledger: {
        variants: [{
          variant_key: 'base',
          price_calendar: [{ date: '2026-09-01', amount: 599000, currency: 'KRW' }],
          options: [{ raw_name: '야경 크루즈', price_amount: 50000, currency: 'KRW' }],
          days: [{
            day: 1,
            events: [
              { type: 'flight', time: '10:00', raw_text: 'KE123 출발', evidence: { line_start: 1 } },
              { type: 'attraction', raw_text: '오사카성', canonical_id: 'attr-1' },
            ],
          }],
        }],
      },
    },
  }],
};

describe('V5 typed projections', () => {
  it('projects dated base and optional prices without inventing missing values', () => {
    const rules = buildV5PriceRules({ revisionId: 'revision', canonicalPayload: payload });
    expect(rules).toHaveLength(3);
    expect(rules[0]).toMatchObject({ componentType: 'base', scope: 'specific_departure', specificDate: '2026-09-01', amount: 599000 });
    expect(rules[1]).toMatchObject({ componentType: 'child', scope: 'specific_departure', specificDate: '2026-09-01', amount: 599000 });
    expect(rules[1]?.evidenceRef).toMatchObject({ derived_policy: 'same_as_adult_policy' });
    expect(rules[2]).toMatchObject({ componentType: 'optional_tour', scope: 'always', inclusion: 'optional', amount: 50000 });
  });

  it('keeps itinerary order and typed event categories source-bound', () => {
    const items = buildV5ItineraryItems({ revisionId: 'revision', canonicalPayload: payload });
    expect(items.map(item => item.itemType)).toEqual(['flight', 'attraction']);
    expect(items.map(item => item.sequenceNo)).toEqual([0, 1]);
    expect(items[1]).toMatchObject({ dayIndex: 1, title: '오사카성', canonicalId: 'attr-1' });
    expect(items.every(item => /^[0-9a-f]{64}$/.test(item.itemHash))).toBe(true);
  });

  it('projects explicit range and single-weekday pricing without guessing a year', () => {
    const rules = buildV5PriceRules({
      revisionId: 'revision',
      canonicalPayload: {
        sections: [{
          v3: {
            ledger: {
              variants: [{
                variant_key: 'seasonal',
                price_calendar: [
                  {
                    label: '성수기',
                    date_range: { start: '2026-08-01', end: '2026-08-31' },
                    amount: 799000,
                    currency: 'KRW',
                  },
                  { label: '매주 목요일', weekday: 4, amount: 829000, currency: 'KRW' },
                ],
              }],
            },
          },
        }],
      },
    });

    expect(rules.filter(rule => rule.componentType === 'base')).toMatchObject([
      { scope: 'date_range', effectiveStart: '2026-08-01', effectiveEnd: '2026-08-31' },
      { scope: 'weekday', weekday: 4 },
    ]);
    expect(rules.filter(rule => rule.componentType === 'child')).toHaveLength(2);
  });

  it('projects occupancy-specific child prices as separate source-bound components', () => {
    const rules = buildV5PriceRules({
      revisionId: 'revision',
      canonicalPayload: {
        sections: [{
          v3: {
            ledger: {
              variants: [{
                variant_key: 'airtel',
                price_calendar: [{
                  date: '2026-09-01',
                  label: '성인',
                  amount: 1339000,
                  currency: 'KRW',
                  evidence: { quote: '성인 1,339,000원' },
                  passenger_prices: [
                    {
                      passenger_type: 'child',
                      occupancy_type: 'without_bed',
                      label: '아동 노베드',
                      amount: 979000,
                      currency: 'KRW',
                      evidence: { quote: '아동 노베드 979,000원' },
                    },
                    {
                      passenger_type: 'child',
                      occupancy_type: 'with_bed',
                      label: '아동 엑베적용',
                      amount: 1059000,
                      currency: 'KRW',
                      evidence: { quote: '아동 엑베적용 1,059,000원' },
                    },
                  ],
                }],
              }],
            },
          },
        }],
      },
    });

    expect(rules).toHaveLength(3);
    expect(rules[0]).toMatchObject({ componentType: 'base', amount: 1339000 });
    expect(rules.slice(1)).toMatchObject([
      { componentType: 'child', amount: 979000, evidenceRef: { occupancy_type: 'without_bed', derived_policy: 'source' } },
      { componentType: 'child', amount: 1059000, evidenceRef: { occupancy_type: 'with_bed', derived_policy: 'source' } },
    ]);
  });
});
