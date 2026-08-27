import { describe, expect, it } from 'vitest';
import {
  normalizeFitnessScores,
  normalizeMonthlyNormals,
  normalizeSeasonalSignals,
} from './destination-climate-display';

describe('destination climate display boundary', () => {
  it('drops malformed monthly normal rows without throwing', () => {
    expect(normalizeMonthlyNormals([
      { month: 8, temp_max: 31, temp_min: 24, temp_mean: 28, rain_days: 8, rain_mm: 140, humidity: 75 },
      { month: 13, temp_max: 31, temp_min: 24, temp_mean: 28, rain_days: 8, rain_mm: 140, humidity: 75 },
      { month: 8, temp_max: 'bad', temp_min: 24, temp_mean: 28, rain_days: 8, rain_mm: 140, humidity: 75 },
    ])).toEqual([
      { month: 8, temp_max: 31, temp_min: 24, temp_mean: 28, rain_days: 8, rain_mm: 140, humidity: 75 },
    ]);
  });

  it('drops malformed score and signal rows while preserving valid values', () => {
    expect(normalizeFitnessScores([
      { month: 8, score: 62, label: '준비 권장', key_concern: '우기 대비', metrics: { temp: 80, rain: 55, humidity: 76, crowd: 62 } },
      { month: 8, score: 62, metrics: null },
    ])).toHaveLength(1);

    expect(normalizeSeasonalSignals([
      { month: 8, naver_idx: 1, naver_ratio: 50, wiki_idx: 1, wiki_views: 10, seasonality_index: 1, agreement: 0.5, popularity_score: 50, label: '평균 수준', badge: null },
      { month: 8, popularity_score: 'bad' },
    ])).toHaveLength(1);
  });

  it('treats non-arrays as empty series', () => {
    expect(normalizeMonthlyNormals(null)).toEqual([]);
    expect(normalizeFitnessScores({})).toEqual([]);
    expect(normalizeSeasonalSignals('')).toEqual([]);
  });
});
