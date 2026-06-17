import runtimeEnvReadiness from '@/config/runtime-env-readiness.json';

const CRITICAL_ENV = runtimeEnvReadiness.critical as readonly string[];
const WARN_ENV = runtimeEnvReadiness.warnDefaults as readonly string[];

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
