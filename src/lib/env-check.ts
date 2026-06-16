const CRITICAL_ENV = [
  'SERPAPI_KEY',
  'BAND_RSS_URL',
  'TWITTER_BEARER_TOKEN',
  'NAVER_CLIENT_ID',
  'NAVER_CLIENT_SECRET',
  'NAVER_CAFE_ID',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'SLACK_WEBHOOK_URL',
  'CRON_SECRET',
] as const;

const WARN_ENV = [
  'AD_FLAG_UP_BID_FACTOR',
  'AD_OFFPEAK_BID_FACTOR',
  'AD_MIN_BID_KRW',
] as const;

let hasLoggedEnvCheck = false;

export function checkMissingEnvVars(options: { log?: boolean } = {}): { missing: string[]; warnings: string[] } {
  if (typeof process === 'undefined') return { missing: [], warnings: [] };

  const missing = CRITICAL_ENV.filter((key) => !process.env[key]);
  const warnings = WARN_ENV.filter((key) => !process.env[key]);
  const shouldLog = options.log !== false && !hasLoggedEnvCheck;

  if (shouldLog && missing.length > 0) {
    console.warn(
      [
        `[env-check] Missing ${missing.length} important environment variable(s).`,
        ...missing.map((key) => `- ${key}`),
        'Some marketing, search, social, or cron integrations may be skipped.',
      ].join('\n'),
    );
  }

  if (shouldLog && warnings.length > 0) {
    console.warn(
      [
        `[env-check] ${warnings.length} environment variable(s) are using defaults.`,
        ...warnings.map((key) => `- ${key}`),
      ].join('\n'),
    );
  }

  if (shouldLog) hasLoggedEnvCheck = true;

  return { missing, warnings };
}
