import { getSecret } from '@/lib/secret-registry';

export const DEFAULT_GSC_URL_INSPECTION_MAX_PER_RUN = 25;
export const DEFAULT_GSC_URL_INSPECTION_MAX_PER_10M = 100;
export const DEFAULT_GSC_URL_INSPECTION_MAX_PER_DAY = 1500;
export const DEFAULT_GSC_URL_INSPECTION_RETRY_AFTER_MINUTES = 15;

export type UrlInspectionQuotaReason =
  | 'allowed'
  | 'per_10m_exhausted'
  | 'daily_exhausted'
  | 'no_candidates';

export interface UrlInspectionQuotaInput {
  requestedLimit: number;
  last10mCount: number;
  last24hCount: number;
  maxPerRun?: number;
  maxPer10m?: number;
  maxPerDay?: number;
  retryAfterMinutes?: number;
}

export interface UrlInspectionQuotaState {
  allowed: boolean;
  effectiveLimit: number;
  reason: UrlInspectionQuotaReason;
  requestedLimit: number;
  last10mCount: number;
  last24hCount: number;
  maxPerRun: number;
  maxPer10m: number;
  maxPerDay: number;
  remaining10m: number;
  remaining24h: number;
  retryAfterMinutes: number;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readUrlInspectionQuotaConfig() {
  return {
    maxPerRun: positiveInt(
      getSecret('GSC_URL_INSPECTION_MAX_PER_RUN'),
      DEFAULT_GSC_URL_INSPECTION_MAX_PER_RUN,
    ),
    maxPer10m: positiveInt(
      getSecret('GSC_URL_INSPECTION_MAX_PER_10M'),
      DEFAULT_GSC_URL_INSPECTION_MAX_PER_10M,
    ),
    maxPerDay: positiveInt(
      getSecret('GSC_URL_INSPECTION_MAX_PER_DAY'),
      DEFAULT_GSC_URL_INSPECTION_MAX_PER_DAY,
    ),
    retryAfterMinutes: positiveInt(
      getSecret('GSC_URL_INSPECTION_RETRY_AFTER_MINUTES'),
      DEFAULT_GSC_URL_INSPECTION_RETRY_AFTER_MINUTES,
    ),
  };
}

export function buildUrlInspectionQuotaState(input: UrlInspectionQuotaInput): UrlInspectionQuotaState {
  const maxPerRun = positiveInt(input.maxPerRun, DEFAULT_GSC_URL_INSPECTION_MAX_PER_RUN);
  const maxPer10m = positiveInt(input.maxPer10m, DEFAULT_GSC_URL_INSPECTION_MAX_PER_10M);
  const maxPerDay = positiveInt(input.maxPerDay, DEFAULT_GSC_URL_INSPECTION_MAX_PER_DAY);
  const retryAfterMinutes = positiveInt(
    input.retryAfterMinutes,
    DEFAULT_GSC_URL_INSPECTION_RETRY_AFTER_MINUTES,
  );
  const requestedLimit = Math.max(0, Math.floor(input.requestedLimit || 0));
  const last10mCount = Math.max(0, Math.floor(input.last10mCount || 0));
  const last24hCount = Math.max(0, Math.floor(input.last24hCount || 0));
  const remaining10m = Math.max(0, maxPer10m - last10mCount);
  const remaining24h = Math.max(0, maxPerDay - last24hCount);
  const effectiveLimit = Math.max(
    0,
    Math.min(requestedLimit, maxPerRun, remaining10m, remaining24h),
  );

  let reason: UrlInspectionQuotaReason = 'allowed';
  if (requestedLimit === 0) reason = 'no_candidates';
  else if (remaining24h <= 0) reason = 'daily_exhausted';
  else if (remaining10m <= 0) reason = 'per_10m_exhausted';

  return {
    allowed: reason === 'allowed' && effectiveLimit > 0,
    effectiveLimit,
    reason,
    requestedLimit,
    last10mCount,
    last24hCount,
    maxPerRun,
    maxPer10m,
    maxPerDay,
    remaining10m,
    remaining24h,
    retryAfterMinutes,
  };
}

export function isUrlInspectionQuotaError(message: string | null | undefined): boolean {
  const value = String(message || '').toLowerCase();
  if (!value) return false;
  return /\b429\b/.test(value)
    || value.includes('quota')
    || value.includes('rate limit')
    || value.includes('ratelimit')
    || value.includes('resource_exhausted')
    || value.includes('too many requests');
}
