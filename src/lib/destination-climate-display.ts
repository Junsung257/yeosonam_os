import type { FitnessScore, MonthlyNormal } from '@/lib/travel-fitness-score';
import type { SeasonalSignal } from '@/lib/seasonal-signals';

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function monthNumber(value: unknown): number | null {
  const month = finiteNumber(value);
  return month !== null && Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/**
 * Public destination pages receive JSONB produced by several historical seeds.
 * Keep malformed rows out of the render tree; a missing series is handled by
 * the page-level deterministic climate fallback.
 */
export function normalizeMonthlyNormals(value: unknown): MonthlyNormal[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const row = recordOf(item);
    if (!row) return [];

    const month = monthNumber(row.month);
    const tempMax = finiteNumber(row.temp_max);
    const tempMin = finiteNumber(row.temp_min);
    const tempMean = finiteNumber(row.temp_mean);
    const rainDays = finiteNumber(row.rain_days);
    const rainMm = finiteNumber(row.rain_mm);
    const humidity = finiteNumber(row.humidity);
    const sunshineHours = finiteNumber(row.sunshine_hours);
    if (month === null || tempMax === null || tempMin === null || tempMean === null
      || rainDays === null || rainMm === null || humidity === null) {
      return [];
    }

    return [{
      month,
      temp_max: tempMax,
      temp_min: tempMin,
      temp_mean: tempMean,
      rain_days: rainDays,
      rain_mm: rainMm,
      humidity,
      ...(sunshineHours === null ? {} : { sunshine_hours: sunshineHours }),
    }];
  });
}

export function normalizeFitnessScores(value: unknown): FitnessScore[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const row = recordOf(item);
    if (!row) return [];

    const month = monthNumber(row.month);
    const score = finiteNumber(row.score);
    const metrics = recordOf(row.metrics);
    if (month === null || score === null || !metrics) return [];

    const temp = finiteNumber(metrics.temp);
    const rain = finiteNumber(metrics.rain);
    const humidity = finiteNumber(metrics.humidity);
    const crowd = finiteNumber(metrics.crowd);
    if (temp === null || rain === null || humidity === null || crowd === null) return [];

    return [{
      month,
      score: Math.max(0, Math.min(100, score)),
      label: stringOr(row.label, '데이터 확인'),
      key_concern: typeof row.key_concern === 'string' && row.key_concern.trim() ? row.key_concern.trim() : null,
      metrics: { temp, rain, humidity, crowd },
    }];
  });
}

export function normalizeSeasonalSignals(value: unknown): SeasonalSignal[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const row = recordOf(item);
    if (!row) return [];

    const month = monthNumber(row.month);
    const naverIdx = finiteNumber(row.naver_idx);
    const naverRatio = finiteNumber(row.naver_ratio);
    const wikiIdx = finiteNumber(row.wiki_idx);
    const wikiViews = finiteNumber(row.wiki_views);
    const seasonalityIndex = finiteNumber(row.seasonality_index);
    const agreement = finiteNumber(row.agreement);
    const popularityScore = finiteNumber(row.popularity_score);
    if (month === null || naverIdx === null || naverRatio === null || wikiIdx === null
      || wikiViews === null || seasonalityIndex === null || agreement === null || popularityScore === null) {
      return [];
    }

    return [{
      month,
      naver_idx: naverIdx,
      naver_ratio: naverRatio,
      wiki_idx: wikiIdx,
      wiki_views: Math.max(0, Math.round(wikiViews)),
      seasonality_index: seasonalityIndex,
      agreement: Math.max(0, Math.min(1, agreement)),
      popularity_score: Math.max(0, Math.min(100, popularityScore)),
      label: stringOr(row.label, '평균 수준'),
      badge: typeof row.badge === 'string' && row.badge.trim() ? row.badge.trim() : null,
    }];
  });
}
