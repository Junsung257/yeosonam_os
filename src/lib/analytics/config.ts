export interface PublicAnalyticsConfig {
  enabled: boolean;
  debug: boolean;
  gtmContainerId: string | null;
  ga4MeasurementId: string | null;
  googleAdsId: string | null;
  clarityProjectId: string | null;
  siteUrl: string;
  attributionTtlDays: number;
}

const GTM_RE = /^GTM-[A-Z0-9]+$/;
const GA4_RE = /^G-[A-Z0-9]+$/;
const ADS_RE = /^AW-\d+$/;
const CLARITY_RE = /^[a-z0-9]+$/i;

function enabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function valid(value: string | undefined, pattern: RegExp): string | null {
  const normalized = value?.trim();
  return normalized && pattern.test(normalized) ? normalized : null;
}

function ttlDays(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 365 ? parsed : 90;
}

export function getPublicAnalyticsConfig(): PublicAnalyticsConfig {
  return {
    enabled: enabled(process.env.NEXT_PUBLIC_ANALYTICS_ENABLED),
    debug: enabled(process.env.NEXT_PUBLIC_ANALYTICS_DEBUG),
    gtmContainerId: valid(process.env.NEXT_PUBLIC_GTM_CONTAINER_ID, GTM_RE),
    ga4MeasurementId: valid(
      process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID ?? process.env.NEXT_PUBLIC_GA4_ID,
      GA4_RE,
    ),
    googleAdsId: valid(process.env.NEXT_PUBLIC_GOOGLE_ADS_ID, ADS_RE),
    clarityProjectId: valid(process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID, CLARITY_RE),
    siteUrl:
      process.env.NEXT_PUBLIC_SITE_URL?.trim()
      || process.env.NEXT_PUBLIC_BASE_URL?.trim()
      || 'https://www.yeosonam.com',
    attributionTtlDays: ttlDays(process.env.NEXT_PUBLIC_ATTRIBUTION_TTL_DAYS),
  };
}

export function isProductionAnalyticsRuntime(
  config: PublicAnalyticsConfig,
  runtime: {
    nodeEnv?: string;
    vercelEnv?: string;
    hostname?: string;
  } = {},
): boolean {
  if (!config.enabled || !config.gtmContainerId) return false;
  if (config.debug && runtime.nodeEnv !== 'production') return true;
  if (runtime.nodeEnv !== 'production' || runtime.vercelEnv !== 'production') return false;
  if (!runtime.hostname) return true;
  try {
    return runtime.hostname === new URL(config.siteUrl).hostname;
  } catch {
    return false;
  }
}

export const analyticsIdValidators = {
  gtm: (value: string) => GTM_RE.test(value),
  ga4: (value: string) => GA4_RE.test(value),
  googleAds: (value: string) => ADS_RE.test(value),
};
