import runtimeEnvReadiness from '@/config/runtime-env-readiness.json';

const CRITICAL_ENV = runtimeEnvReadiness.critical as readonly string[];
const OPTIONAL_ENV = runtimeEnvReadiness.optionalIntegrations as readonly string[];
const WARN_ENV = runtimeEnvReadiness.warnDefaults as readonly string[];

let hasLoggedEnvCheck = false;

export function checkMissingEnvVars(options: { log?: boolean } = {}): { missing: string[]; warnings: string[] } {
  if (typeof process === 'undefined') return { missing: [], warnings: [] };

  const missing = CRITICAL_ENV.filter((key) => !process.env[key]);
  const warnings = [...OPTIONAL_ENV, ...WARN_ENV].filter((key) => !process.env[key]);
  const shouldLog = options.log !== false && !hasLoggedEnvCheck;

  if (shouldLog && missing.length > 0) {
    console.info(
      [
        `[env-check] Missing ${missing.length} important environment variable(s).`,
        ...missing.map((key) => `- ${key}`),
        'Search, Naver API, or cron integrations may be skipped.',
      ].join('\n'),
    );
  }

  if (shouldLog && warnings.length > 0) {
    console.info(
      [
        `[env-check] ${warnings.length} optional/default environment variable(s) are not configured.`,
        ...warnings.map((key) => `- ${key}`),
      ].join('\n'),
    );
  }

  if (shouldLog) hasLoggedEnvCheck = true;

  return { missing, warnings };
}
