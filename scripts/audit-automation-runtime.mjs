import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_MARKERS = [
  'withCronGuard',
  'requireCronBearer',
  'verifyCronRequest',
  'isCronAuthorized',
  'isCronOrVercelAuthorized',
  'authorizeCronRequest',
];

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function routeFileForPath(routePath) {
  return join(ROOT, 'src', 'app', ...routePath.split('/').filter(Boolean), 'route.ts');
}

function parseInngestFunctions() {
  const directory = join(ROOT, 'src', 'inngest', 'functions');
  return walk(directory)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => {
      const source = readFileSync(file, 'utf8');
      const id = source.match(/\bid:\s*['"]([^'"]+)['"]/u)?.[1] ?? relative(ROOT, file);
      const cronTriggers = [...source.matchAll(/\bcron:\s*['"]([^'"]+)['"]/gu)].map((match) => match[1]);
      const eventTriggers = [...source.matchAll(/\bevent:\s*['"]([^'"]+)['"]/gu)].map((match) => match[1]);
      return {
        id,
        file: relative(ROOT, file).replaceAll('\\', '/'),
        cronTriggers,
        eventTriggers,
        failClosed: /\bisInngest(?:ScheduleExecution|Billing)Enabled\s*\(\s*\)/u.test(source),
      };
    });
}

export function auditAutomationRuntime() {
  const vercelConfig = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const crons = Array.isArray(vercelConfig.crons) ? vercelConfig.crons : [];
  const issues = [];
  const warnings = [];
  const seenPaths = new Set();

  const vercelCrons = crons.map((cron) => {
    const file = routeFileForPath(cron.path);
    const exists = existsSync(file);
    const source = exists ? readFileSync(file, 'utf8') : '';
    const authMarker = AUTH_MARKERS.find((marker) => source.includes(marker)) ?? null;

    if (seenPaths.has(cron.path)) issues.push(`duplicate_vercel_cron_path:${cron.path}`);
    seenPaths.add(cron.path);
    if (!exists) issues.push(`missing_vercel_cron_route:${cron.path}`);
    if (exists && !authMarker) issues.push(`missing_cron_auth_guard:${cron.path}`);

    return {
      path: cron.path,
      schedule: cron.schedule,
      file: relative(ROOT, file).replaceAll('\\', '/'),
      exists,
      authMarker,
    };
  });

  const inngestFunctions = parseInngestFunctions();
  const dailyMarketing = inngestFunctions.find((fn) => fn.id === 'daily-marketing-orchestrator');
  if (seenPaths.has('/api/cron/daily-marketing') && dailyMarketing) {
    if (!dailyMarketing.failClosed) {
      issues.push('duplicate_owner_not_gated:daily-marketing');
    } else {
      warnings.push('daily-marketing remains Vercel-owned until INNGEST_SCHEDULES_ENABLED cutover');
    }
  }

  const billingFunctions = inngestFunctions.filter((fn) => fn.id.includes('billing'));
  if (billingFunctions.some((fn) => !fn.failClosed)) {
    issues.push('inngest_billing_not_fail_closed');
  }

  const allCronRoutes = walk(join(ROOT, 'src', 'app', 'api', 'cron'))
    .filter((file) => file.endsWith('route.ts'));
  const configuredCronFiles = new Set(vercelCrons.map((cron) => resolve(ROOT, cron.file)));
  const unconfiguredRouteCount = allCronRoutes.filter((file) => !configuredCronFiles.has(resolve(file))).length;

  if (vercelCrons.length >= 80) {
    warnings.push(`high_vercel_cron_count:${vercelCrons.length}`);
  }

  return {
    ok: issues.length === 0,
    generatedAt: new Date().toISOString(),
    summary: {
      vercelCronCount: vercelCrons.length,
      inngestFunctionCount: inngestFunctions.length,
      unconfiguredCronRouteCount: unconfiguredRouteCount,
      issueCount: issues.length,
      warningCount: warnings.length,
    },
    issues,
    warnings,
    vercelCrons,
    inngestFunctions,
  };
}

function printHuman(report) {
  console.log(`Automation runtime audit: ${report.ok ? 'PASS' : 'FAIL'}`);
  console.log(`Vercel crons: ${report.summary.vercelCronCount}`);
  console.log(`Inngest functions: ${report.summary.inngestFunctionCount}`);
  console.log(`Unconfigured cron routes: ${report.summary.unconfiguredCronRouteCount}`);
  for (const warning of report.warnings) console.warn(`WARN ${warning}`);
  for (const issue of report.issues) console.error(`ERROR ${issue}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const report = auditAutomationRuntime();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (process.argv.includes('--strict') && !report.ok) process.exitCode = 1;
}
