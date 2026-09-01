export const FORECAST_LAB_VERSION = 'forecast-lab-v1' as const;

export type ForecastMetric = 'inquiries' | 'bookings';
export type ForecastMethod =
  | 'seasonal_naive_7'
  | 'seasonal_naive_28'
  | 'moving_average_7'
  | 'moving_average_28'
  | 'exponential_smoothing';

export type DailyDemandAggregateV1 = {
  date: string;
  inquiries: number;
  bookings: number;
};

export type ForecastMetricsV1 = {
  wape: number | null;
  mae: number;
  smape: number;
  actualTotal: number;
  absoluteErrorTotal: number;
};

export type ForecastMethodResultV1 = {
  method: ForecastMethod;
  metrics: ForecastMetricsV1;
  cutoffs: number;
  points: number;
};

export type ForecastLabResultV1 =
  | {
      version: typeof FORECAST_LAB_VERSION;
      status: 'data_insufficient';
      reason: string;
      observedDays: number;
      minimumDays: 180;
      requiredCutoffs: 8;
      advisoryOnly: true;
      downstreamMutationsAllowed: false;
    }
  | {
      version: typeof FORECAST_LAB_VERSION;
      status: 'ready';
      metric: ForecastMetric;
      observedDays: number;
      cutoffCount: 8;
      horizonDays: number;
      methods: ForecastMethodResultV1[];
      bestNaiveMethod: 'seasonal_naive_7' | 'seasonal_naive_28';
      advisoryOnly: true;
      downstreamMutationsAllowed: false;
      referenceTable: 'demand_forecast_v2';
    };

export type ForecastCandidateDecisionV1 = {
  status: 'candidate' | 'rejected' | 'data_insufficient' | 'license_blocked';
  modelName: string;
  improvementPercent: number | null;
  reasons: string[];
  advisoryOnly: true;
  productionMutationAllowed: false;
};

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const METHODS: ForecastMethod[] = [
  'seasonal_naive_7',
  'seasonal_naive_28',
  'moving_average_7',
  'moving_average_28',
  'exponential_smoothing',
];

function dateMillis(date: string): number {
  if (!DATE_RE.test(date)) return Number.NaN;
  const value = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value : Number.NaN;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function forecast(method: ForecastMethod, history: number[], horizon: number): number[] {
  if (method.startsWith('seasonal_naive_')) {
    const period = method === 'seasonal_naive_7' ? 7 : 28;
    return Array.from({ length: horizon }, (_, index) => history[history.length - period + (index % period)] ?? 0);
  }
  if (method.startsWith('moving_average_')) {
    const window = method === 'moving_average_7' ? 7 : 28;
    const value = mean(history.slice(-window));
    return Array.from({ length: horizon }, () => value);
  }
  let level = history[0] ?? 0;
  const alpha = 0.3;
  for (let index = 1; index < history.length; index += 1) level = alpha * history[index] + (1 - alpha) * level;
  return Array.from({ length: horizon }, () => level);
}

export function computeForecastMetrics(actual: number[], predicted: number[]): ForecastMetricsV1 {
  if (actual.length === 0 || actual.length !== predicted.length) throw new Error('FORECAST_METRIC_LENGTH_INVALID');
  let absoluteErrorTotal = 0;
  let actualTotal = 0;
  let smapeTotal = 0;
  for (let index = 0; index < actual.length; index += 1) {
    const observed = actual[index];
    const estimate = predicted[index];
    absoluteErrorTotal += Math.abs(observed - estimate);
    actualTotal += Math.abs(observed);
    const denominator = Math.abs(observed) + Math.abs(estimate);
    smapeTotal += denominator === 0 ? 0 : (2 * Math.abs(observed - estimate)) / denominator;
  }
  return {
    wape: actualTotal === 0 ? null : round((absoluteErrorTotal / actualTotal) * 100),
    mae: round(absoluteErrorTotal / actual.length),
    smape: round((smapeTotal / actual.length) * 100),
    actualTotal: round(actualTotal),
    absoluteErrorTotal: round(absoluteErrorTotal),
  };
}

function validateSeries(rows: DailyDemandAggregateV1[]): string | null {
  const allowedKeys = new Set(['date', 'inquiries', 'bookings']);
  for (const row of rows) {
    if (Object.keys(row).some((key) => !allowedKeys.has(key))) return 'PII_OR_UNSUPPORTED_FIELD_PRESENT';
    if (!Number.isFinite(dateMillis(row.date))) return 'DATE_INVALID';
    if (![row.inquiries, row.bookings].every((value) => Number.isFinite(value) && value >= 0)) return 'VALUE_INVALID';
  }
  const dates = rows.map((row) => row.date);
  if (new Set(dates).size !== dates.length) return 'DUPLICATE_DATE';
  for (let index = 1; index < dates.length; index += 1) {
    if (dateMillis(dates[index]) - dateMillis(dates[index - 1]) !== DAY_MS) return 'DAILY_SERIES_NOT_CONTIGUOUS';
  }
  return null;
}

export function runForecastLab(
  inputRows: DailyDemandAggregateV1[],
  metric: ForecastMetric,
  options?: { horizonDays?: number },
): ForecastLabResultV1 {
  const rows = [...inputRows].sort((left, right) => left.date.localeCompare(right.date));
  const invalidReason = validateSeries(rows);
  if (invalidReason || rows.length < 180) {
    return {
      version: FORECAST_LAB_VERSION,
      status: 'data_insufficient',
      reason: invalidReason ?? 'MINIMUM_180_DAILY_POINTS_REQUIRED',
      observedDays: rows.length,
      minimumDays: 180,
      requiredCutoffs: 8,
      advisoryOnly: true,
      downstreamMutationsAllowed: false,
    };
  }

  const horizonDays = options?.horizonDays ?? 14;
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 28) throw new Error('FORECAST_HORIZON_INVALID');
  const values = rows.map((row) => row[metric]);
  const cutoffs = Array.from({ length: 8 }, (_, index) => rows.length - horizonDays - (7 * index)).reverse();
  if (cutoffs[0] < 28) {
    return {
      version: FORECAST_LAB_VERSION,
      status: 'data_insufficient',
      reason: 'EIGHT_ROLLING_CUTOFFS_UNAVAILABLE',
      observedDays: rows.length,
      minimumDays: 180,
      requiredCutoffs: 8,
      advisoryOnly: true,
      downstreamMutationsAllowed: false,
    };
  }

  const methods = METHODS.map((method) => {
    const actual: number[] = [];
    const predicted: number[] = [];
    for (const cutoff of cutoffs) {
      const expected = values.slice(cutoff, cutoff + horizonDays);
      const estimates = forecast(method, values.slice(0, cutoff), horizonDays);
      actual.push(...expected);
      predicted.push(...estimates);
    }
    return { method, metrics: computeForecastMetrics(actual, predicted), cutoffs: 8, points: actual.length };
  });
  const naive = methods
    .filter((result): result is ForecastMethodResultV1 & { method: 'seasonal_naive_7' | 'seasonal_naive_28' } => result.method.startsWith('seasonal_naive'))
    .filter((result) => result.metrics.wape !== null)
    .sort((left, right) => (left.metrics.wape ?? Number.POSITIVE_INFINITY) - (right.metrics.wape ?? Number.POSITIVE_INFINITY));
  if (!naive.length) {
    return {
      version: FORECAST_LAB_VERSION,
      status: 'data_insufficient',
      reason: 'WAPE_UNDEFINED_ZERO_ACTUALS',
      observedDays: rows.length,
      minimumDays: 180,
      requiredCutoffs: 8,
      advisoryOnly: true,
      downstreamMutationsAllowed: false,
    };
  }
  return {
    version: FORECAST_LAB_VERSION,
    status: 'ready',
    metric,
    observedDays: rows.length,
    cutoffCount: 8,
    horizonDays,
    methods,
    bestNaiveMethod: naive[0].method,
    advisoryOnly: true,
    downstreamMutationsAllowed: false,
    referenceTable: 'demand_forecast_v2',
  };
}

export function isForecastSegmentEligible(rows: DailyDemandAggregateV1[], metric: ForecastMetric): boolean {
  return new Set(rows.filter((row) => Number.isFinite(row[metric])).map((row) => row.date)).size >= 60;
}

export function evaluateForecastCandidate(input: {
  modelName: string;
  bestNaiveWape: number | null;
  candidateWape: number | null;
  importantSegments: Array<{ id: string; bestNaiveWape: number | null; candidateWape: number | null; eligibleDays: number }>;
  licenseStatus?: 'allowed' | 'license_blocked';
}): ForecastCandidateDecisionV1 {
  if (input.licenseStatus === 'license_blocked') {
    return { status: 'license_blocked', modelName: input.modelName, improvementPercent: null, reasons: ['MODEL_LICENSE_BLOCKED'], advisoryOnly: true, productionMutationAllowed: false };
  }
  if (input.bestNaiveWape === null || input.candidateWape === null || input.bestNaiveWape <= 0) {
    return { status: 'data_insufficient', modelName: input.modelName, improvementPercent: null, reasons: ['OVERALL_WAPE_UNAVAILABLE'], advisoryOnly: true, productionMutationAllowed: false };
  }
  const improvementPercent = round(((input.bestNaiveWape - input.candidateWape) / input.bestNaiveWape) * 100);
  const reasons: string[] = [];
  if (improvementPercent < 10) reasons.push('WAPE_IMPROVEMENT_BELOW_10_PERCENT');
  for (const segment of input.importantSegments) {
    if (segment.eligibleDays < 60) continue;
    if (segment.bestNaiveWape === null || segment.candidateWape === null) reasons.push(`SEGMENT_WAPE_UNAVAILABLE:${segment.id}`);
    else if (segment.candidateWape > segment.bestNaiveWape) reasons.push(`IMPORTANT_SEGMENT_WORSENED:${segment.id}`);
  }
  return {
    status: reasons.length ? 'rejected' : 'candidate',
    modelName: input.modelName,
    improvementPercent,
    reasons,
    advisoryOnly: true,
    productionMutationAllowed: false,
  };
}

export function buildDemandForecastV2ShadowRows(input: {
  rows: DailyDemandAggregateV1[];
  metric: ForecastMetric;
  method: ForecastMethod;
  destination: string;
  generatedAt: string;
  horizonDays?: number;
}) {
  const horizonDays = input.horizonDays ?? 14;
  const sorted = [...input.rows].sort((left, right) => left.date.localeCompare(right.date));
  const validation = runForecastLab(sorted, input.metric, { horizonDays });
  if (validation.status !== 'ready') return validation;
  const values = sorted.map((row) => row[input.metric]);
  const estimates = forecast(input.method, values, horizonDays);
  const lastDate = dateMillis(sorted[sorted.length - 1].date);
  return estimates.map((estimate, index) => ({
    generated_at: input.generatedAt,
    model_name: input.method,
    model_version: FORECAST_LAB_VERSION,
    destination: input.destination,
    forecast_date: new Date(lastDate + DAY_MS * (index + 1)).toISOString().slice(0, 10),
    horizon_days: index + 1,
    expected_bookings: input.metric === 'bookings' ? round(estimate, 2) : null,
    expected_revenue_krw: null,
    confidence_lower: null,
    confidence_upper: null,
    feature_snapshot: { metric: input.metric, observed_days: sorted.length, pii_free_daily_aggregate: true },
    charter_recommendation: 'unknown',
    charter_breakeven_seats: null,
    metadata: { shadow: true, decision_role: 'advisory_only', downstream_mutations_allowed: false },
  }));
}
