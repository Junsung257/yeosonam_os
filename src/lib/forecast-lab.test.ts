import { describe, expect, it } from 'vitest';
import {
  buildDemandForecastV2ShadowRows,
  evaluateForecastCandidate,
  isForecastSegmentEligible,
  runForecastLab,
  type DailyDemandAggregateV1,
} from './forecast-lab';

function dailySeries(days: number, start = '2026-01-01'): DailyDemandAggregateV1[] {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, index) => ({
    date: new Date(startMs + index * 86_400_000).toISOString().slice(0, 10),
    inquiries: 10 + (index % 7),
    bookings: 3 + (index % 7),
  }));
}

describe('forecast lab', () => {
  it('is deterministic across 180 PII-free daily points and 8 cutoffs', () => {
    const rows = dailySeries(180);
    const first = runForecastLab(rows, 'bookings');
    const second = runForecastLab(rows, 'bookings');
    expect(first).toEqual(second);
    expect(first).toMatchObject({ status: 'ready', cutoffCount: 8, referenceTable: 'demand_forecast_v2', downstreamMutationsAllowed: false });
  });

  it('returns data_insufficient instead of a fabricated forecast', () => {
    expect(runForecastLab(dailySeries(179), 'inquiries')).toMatchObject({ status: 'data_insufficient', reason: 'MINIMUM_180_DAILY_POINTS_REQUIRED' });
  });

  it('rejects extra fields that could carry PII', () => {
    const rows = dailySeries(180) as Array<DailyDemandAggregateV1 & { customerPhone?: string }>;
    rows[0].customerPhone = '010-0000-0000';
    expect(runForecastLab(rows, 'bookings')).toMatchObject({ status: 'data_insufficient', reason: 'PII_OR_UNSUPPORTED_FIELD_PRESENT' });
  });

  it('requires values on 60 distinct dates for a segment', () => {
    expect(isForecastSegmentEligible(dailySeries(59), 'bookings')).toBe(false);
    expect(isForecastSegmentEligible(dailySeries(60), 'bookings')).toBe(true);
  });

  it('requires 10 percent WAPE improvement without important-segment regression', () => {
    expect(evaluateForecastCandidate({
      modelName: 'candidate-v1', bestNaiveWape: 20, candidateWape: 17,
      importantSegments: [{ id: 'japan', bestNaiveWape: 22, candidateWape: 21, eligibleDays: 60 }],
    })).toMatchObject({ status: 'candidate', improvementPercent: 15, productionMutationAllowed: false });
    expect(evaluateForecastCandidate({
      modelName: 'candidate-v1', bestNaiveWape: 20, candidateWape: 17,
      importantSegments: [{ id: 'japan', bestNaiveWape: 22, candidateWape: 23, eligibleDays: 60 }],
    }).reasons).toContain('IMPORTANT_SEGMENT_WORSENED:japan');
  });

  it('blocks TimesFM-3 by license even when metrics look good', () => {
    expect(evaluateForecastCandidate({
      modelName: 'timesfm-3.0', bestNaiveWape: 20, candidateWape: 10, importantSegments: [], licenseStatus: 'license_blocked',
    })).toMatchObject({ status: 'license_blocked', reasons: ['MODEL_LICENSE_BLOCKED'] });
  });

  it('builds advisory shadow rows with no confidence or charter decision', () => {
    const rows = buildDemandForecastV2ShadowRows({
      rows: dailySeries(180), metric: 'bookings', method: 'seasonal_naive_7', destination: 'Japan', generatedAt: '2026-09-02T00:00:00.000Z',
    });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(14);
    expect((rows as Array<Record<string, unknown>>)[0]).toMatchObject({
      confidence_lower: null, confidence_upper: null, charter_recommendation: 'unknown',
      metadata: { shadow: true, decision_role: 'advisory_only', downstream_mutations_allowed: false },
    });
  });
});
