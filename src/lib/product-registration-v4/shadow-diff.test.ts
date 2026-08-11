import { describe, expect, it } from 'vitest';

import { buildV3V5CriticalDiff } from './shadow-diff';

const base = {
  sections: [{
    v3: {
      ledger: {
        variants: [{
          price_calendar: [{ date: '2026-09-01', amount: 599000 }],
          flight_segments: [{ code: 'KE123', dep_time: '10:00' }],
          minimum_departure: { value: 2 },
          standard_notices: [{ type: 'PAYMENT', value: '예약금' }],
          days: [{ day: 1 }],
          inclusions: ['항공'],
          exclusions: ['현지비용'],
          options: [],
        }],
      },
    },
  }],
};

describe('V3/V5 shadow diff', () => {
  it('reports no mismatch when critical facts are structurally identical', () => {
    const report = buildV3V5CriticalDiff({ legacyPayload: base, canonicalPayload: base });
    expect(report.criticalMismatch).toBe(false);
    expect(report.highMismatch).toBe(false);
    expect(report.mismatchedCriticalFieldCount).toBe(0);
  });

  it('blocks a changed price while distinguishing editorial additions', () => {
    const canonical = structuredClone(base);
    canonical.sections[0].v3.ledger.variants[0].price_calendar[0].amount = 699000;
    const report = buildV3V5CriticalDiff({ legacyPayload: base, canonicalPayload: canonical });
    expect(report.criticalMismatch).toBe(true);
    expect(report.diffs.find(diff => diff.fieldPath.endsWith('price_calendar'))?.kind).toBe('changed');
    expect(report.diffs.find(diff => diff.fieldPath.endsWith('flight_segments'))?.kind).toBe('match');
  });

  it('fails closed when a canonical critical field disappears', () => {
    const canonical = structuredClone(base);
    delete (canonical.sections[0].v3.ledger.variants[0] as { flight_segments?: unknown }).flight_segments;
    const report = buildV3V5CriticalDiff({ legacyPayload: base, canonicalPayload: canonical });
    expect(report.criticalMismatch).toBe(true);
    expect(report.diffs.find(diff => diff.fieldPath.endsWith('flight_segments'))?.kind).toBe('missing');
  });
});
