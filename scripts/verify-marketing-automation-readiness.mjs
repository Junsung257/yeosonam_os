#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const strict = args.has('--strict');

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const baseUrl = argValue('--base', process.env.MARKETING_READINESS_BASE_URL || '').replace(/\/$/, '');
const timeoutMs = Number(argValue('--timeout-ms', process.env.MARKETING_READINESS_TIMEOUT_MS || '10000'));
const providedCookie = argValue('--cookie', process.env.MARKETING_READINESS_COOKIE || '');
const marketingCheckCardNewsId = argValue('--card-news-id', process.env.MARKETING_CHECK_CARD_NEWS_ID || '');
const marketingCheckVariantGroupId = argValue('--variant-group-id', process.env.MARKETING_CHECK_VARIANT_GROUP_ID || '');
const requireDynamicProbes = args.has('--require-dynamic-probes') || process.env.MARKETING_READINESS_REQUIRE_DYNAMIC_PROBES === '1';
const allowMissingAdminCookie = args.has('--allow-missing-admin-cookie') || process.env.MARKETING_READINESS_ALLOW_MISSING_ADMIN_COOKIE === '1';
const DEV_ADMIN_SESSION_PATH = '/api/dev/admin-session';

const checks = [];

function addCheck(name, status, detail = {}) {
  checks.push({ name, status, ...detail });
}

function readText(path) {
  if (!existsSync(path)) {
    addCheck(`file:${path}`, 'fail', { error: 'missing file' });
    return '';
  }
  return readFileSync(path, 'utf8');
}

function requireIncludes(name, path, needles) {
  const text = readText(path);
  if (!text) return;
  const missing = needles.filter((needle) => !text.includes(needle));
  addCheck(name, missing.length ? 'fail' : 'pass', {
    file: path,
    missing,
  });
}

function requireCommandPass(name, command, args = []) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  addCheck(name, result.status === 0 ? 'pass' : 'fail', {
    command: [command, ...args].join(' '),
    error: result.status === 0
      ? ''
      : (result.stderr || result.stdout || result.error?.message || '').trim().slice(0, 1200),
  });
}

function requireBundleBudgetRouteFloorSmoke() {
  const distDir = '.tmp/bundle-budget-route-floor-smoke';
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  writeFileSync(
    `${distDir}/app-build-manifest.json`,
    `${JSON.stringify({ pages: { '/page': [] } }, null, 2)}\n`,
  );

  const result = spawnSync(process.execPath, ['scripts/check-bundle-budget.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_DIST_DIR: distDir,
      BUNDLE_BUDGET_MIN_ROUTES: '2',
      NEXT_BUILD_ALLOW_ACTIVE_DEV_SERVER: '1',
      BUNDLE_BUDGET_ALLOW_ACTIVE_DEV_SERVER: '1',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const passed = result.status !== 0
    && output.includes('only 1 non-API route(s) found')
    && output.includes('expected at least 2');
  addCheck('script:bundle-budget-route-floor-smoke', passed ? 'pass' : 'fail', {
    command: `${process.execPath} scripts/check-bundle-budget.mjs`,
    exitCode: result.status,
    error: passed ? '' : output.trim().slice(0, 1200),
  });
}

function requireActiveDevServerBundleBudgetSmoke() {
  const tmpDir = '.tmp/bundle-budget-active-dev-smoke';
  const fakeDevScript = `${tmpDir}/fake-next-dev-server.cjs`;
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(fakeDevScript, 'setTimeout(() => {}, 60000);\n');

  const fakeDev = spawn(process.execPath, [fakeDevScript, process.cwd(), 'next', 'dev'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    windowsHide: true,
  });

  try {
    sleepSync(750);
    const result = spawnSync(process.execPath, ['scripts/check-bundle-budget.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const passed = result.status !== 0
      && output.includes('Refusing to check bundle budget while next dev is active')
      && output.includes('Stop the dev server first');
    addCheck('script:bundle-budget-rejects-active-dev-server-smoke', passed ? 'pass' : 'fail', {
      command: `${process.execPath} scripts/check-bundle-budget.mjs`,
      exitCode: result.status,
      error: passed ? '' : output.trim().slice(0, 1200),
    });
  } finally {
    if (fakeDev.pid) {
      killProcess(fakeDev.pid);
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function sleepSync(ms) {
  spawnSync(process.execPath, [
    '-e',
    `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${Number(ms) || 0})`,
  ], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

function killProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`,
    ], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // best effort
  }
}

function requireActiveDevServerBuildPrecheckSmoke() {
  const tmpDir = '.tmp/build-precheck-smoke';
  const fakeDevScript = `${tmpDir}/fake-next-dev-server.cjs`;
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(fakeDevScript, 'setTimeout(() => {}, 60000);\n');

  const fakeDev = spawn(process.execPath, [fakeDevScript, process.cwd(), 'next', 'dev'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    windowsHide: true,
  });

  try {
    sleepSync(750);
    const result = spawnSync(process.execPath, ['scripts/run-next-build.cjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_BUILD_PRECHECK_ONLY: '1',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const passed = result.status !== 0
      && output.includes('Refusing to run production build while next dev is active')
      && output.includes('Stop the dev server first');
    addCheck('script:build-rejects-active-dev-server-smoke', passed ? 'pass' : 'fail', {
      command: `${process.execPath} scripts/run-next-build.cjs`,
      exitCode: result.status,
      error: passed ? '' : output.trim().slice(0, 1200),
    });
  } finally {
    if (fakeDev.pid) {
      killProcess(fakeDev.pid);
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function requireJsonCron(path) {
  try {
    const vercel = JSON.parse(readText('vercel.json'));
    const paths = new Set((vercel.crons || []).map((cron) => cron.path));
    addCheck(`cron:${path}`, paths.has(path) ? 'pass' : 'fail', {
      file: 'vercel.json',
      missing: paths.has(path) ? [] : [path],
    });
  } catch (err) {
    addCheck(`cron:${path}`, 'fail', { error: err instanceof Error ? err.message : String(err) });
  }
}

function staticChecks() {
  requireIncludes('ui:campaigns-degraded-state', 'src/app/admin/marketing/campaigns/page.tsx', [
    'integrationBlocked',
    'AbortController',
    'content-type',
    'disabled={integrationBlocked}',
    '연동 상태를 먼저 확인하세요',
    '연동 상태를 확인한 뒤 캠페인 목록을 다시 불러오세요.',
  ]);

  requireIncludes('ui:creatives-degraded-state', 'src/app/admin/marketing/creatives/page.tsx', [
    'integrationBlocked',
    'AbortController',
    'content-type',
    'disabled={integrationBlocked}',
    '소재 연동을 확인하세요',
    '연동 상태를 확인한 뒤 소재 목록을 다시 불러오세요',
  ]);

  requireIncludes('api:meta-campaigns-safe-read-write', 'src/app/api/meta/campaigns/route.ts', [
    'degraded: true',
    "reason: 'supabase_unconfigured'",
    'Supabase 연동이 설정되지 않아 빈 캠페인 목록을 표시합니다.',
    'Supabase 연동이 설정되지 않아 캠페인을 생성할 수 없습니다.',
  ]);

  requireIncludes('api:meta-creatives-safe-read-write', 'src/app/api/meta/creatives/route.ts', [
    'degraded: true',
    "access_state: 'supabase_unconfigured'",
    'Supabase 연동이 설정되지 않아 빈 소재 목록을 표시합니다.',
    'Supabase 연동이 설정되지 않아 소재를 저장할 수 없습니다.',
  ]);

  requireIncludes('api:meta-performance-safe-read-write', 'src/app/api/meta/performance/route.ts', [
    'degraded: true',
    "access_state: 'supabase_unconfigured'",
    'Supabase 연동이 설정되지 않아 빈 Meta 성과를 표시합니다.',
    'Supabase 연동이 설정되지 않아 Meta 성과를 저장할 수 없습니다.',
  ]);

  requireIncludes('api:campaign-creatives-safe-read-write', 'src/app/api/campaigns/creatives/route.ts', [
    'degraded: true',
    "access_state: 'supabase_unconfigured'",
    'Supabase 연동이 설정되지 않아 빈 소재 목록을 표시합니다.',
    'Supabase 연동이 설정되지 않아 소재 상태를 변경할 수 없습니다.',
  ]);

  requireIncludes('api:campaign-generation-launch-guards', 'src/app/api/campaigns/generate/route.ts', [
    'isSupabaseConfigured',
    'Supabase 연동이 설정되지 않아 캠페인 소재를 생성할 수 없습니다.',
  ]);
  requireIncludes('api:campaign-launch-guards', 'src/app/api/campaigns/launch/route.ts', [
    'isSupabaseConfigured',
    'Supabase 연동이 설정되지 않아 캠페인 소재를 배포할 수 없습니다.',
  ]);

  requireIncludes('session:refresh-dev-and-marker-guard', 'src/lib/fetch-with-session-refresh.ts', [
    'sb-refresh-token-present',
    'ys-dev-admin',
    'shouldAttemptSessionRefresh',
    'return hasCookie(REFRESH_MARKER_COOKIE)',
  ]);
  requireIncludes('session:refresh-token-first-api', 'src/app/api/auth/refresh/route.ts', [
    "request.cookies.get('sb-refresh-token')",
    'refresh_token missing',
    "res.cookies.delete('sb-refresh-token-present')",
  ]);
  requireIncludes('session:dev-admin-public-route', 'src/middleware.ts', [
    "'/api/dev/admin-session'",
    "request.cookies.get('ys-dev-admin')?.value === '1'",
  ]);

  requireIncludes('component:tracked-kakao-link-context', 'src/components/customer/TrackedKakaoLink.tsx', [
    'ANALYTICS_EVENTS.kakaoClicked',
    'event_source: source',
    'destination',
    'metadata: { ...metadata, source }',
    'trackEngagement',
    "rel = 'noopener noreferrer'",
  ]);
  requireIncludes('lib:tracker-engagement-context-payload', 'src/lib/tracker.ts', [
    'event_source?: string | null',
    'destination?: string | null',
    'metadata?: Record<string, unknown>',
  ]);
  requireIncludes('api:tracking-engagement-context', 'src/app/api/tracking/route.ts', [
    'event_source?: string',
    'destination?: string',
    'metadata?: Record<string, unknown>',
    'normalizeMetadata',
    'nonEmptyString',
    'event_source: eventSource',
    'destination: nonEmptyString(body.destination)',
    'metadata,',
  ]);
  requireIncludes('db:ad-engagement-context-columns', 'src/lib/db/ads.ts', [
    'event_source?: string | null',
    'destination?: string | null',
    'metadata?: Record<string, unknown>',
    'missingExtendedColumn',
  ]);
  requireIncludes('migration:ad-engagement-context', 'supabase/migrations/20260619090000_ad_engagement_context_metadata.sql', [
    'ADD COLUMN IF NOT EXISTS event_source',
    'ADD COLUMN IF NOT EXISTS destination',
    'ADD COLUMN IF NOT EXISTS metadata',
    'idx_ad_engagement_logs_kakao_context',
  ]);

  requireIncludes('api:marketing-dashboard-degraded', 'src/app/api/admin/marketing/dashboard/route.ts', [
    'degraded: true',
    'Supabase 연동이 설정되지 않아 빈 마케팅 대시보드를 표시합니다.',
  ]);
  requireIncludes('api:ad-os-summary-degraded', 'src/app/api/admin/ad-os/summary/route.ts', [
    'degraded: true',
    'supabase_unconfigured',
  ]);
  requireIncludes('api:marketing-system-health-runtime-env', 'src/app/api/admin/marketing/system-health/route.ts', [
    'checkMissingEnvVars',
    'env.runtime_readiness',
    'Runtime integration env',
  ]);
  requireIncludes('api:search-ads-mutation-live-guard', 'src/app/api/admin/search-ads/mutate/route.ts', [
    'mutationGuard',
    'naver_ads_unconfigured',
    'google_ads_unconfigured',
    'invalid_external_keyword_id',
    'blocked: true',
    'getNaverAdsConfigStatus',
    'getGoogleAdsConfigStatus',
    'isNaverAdsMutableKeywordId',
    'isGoogleAdsMutableKeywordId',
  ]);
  requireIncludes('lib:search-ads-mutation-no-mock-success', 'src/lib/search-ads-api.ts', [
    'isGoogleAdsMutableKeywordId',
    'Naver bid update blocked: account is not configured',
    'Naver keyword pause blocked: account is not configured',
    'Naver keyword lock update blocked: account is not configured',
    'Google bid update blocked: account is not configured',
    'Google keyword pause blocked: account is not configured',
  ]);

  requireJsonCron('/api/cron/sync-creative-performance');
  requireJsonCron('/api/cron/meta-optimize');
  requireJsonCron('/api/cron/ad-optimizer');
  requireJsonCron('/api/cron/ad-os-safe-pipelines');
  requireJsonCron('/api/cron/marketing-rules');
  requireJsonCron('/api/cron/marketing-asset-snapshot');

  requireIncludes('cron:creative-performance-auth-and-engine', 'src/app/api/cron/sync-creative-performance/route.ts', [
    'isCronAuthorized',
    'dailySync',
    'meta',
    'naver',
    'google',
  ]);

  requireIncludes('package:scripts-expose-readiness', 'package.json', [
    '"verify:marketing-automation"',
    '"verify:marketing-automation:ci"',
    '"verify:marketing-automation:live"',
    '"verify:marketing-runtime:local"',
    '"verify:marketing-release"',
    '"verify:local-release"',
    '"discover:operational-inputs"',
    '"verify:operational-inputs"',
    '"verify:operational-apply-scripts"',
    '"verify:project-automation-wiring"',
    '"verify:runtime-env-wiring"',
    '"verify:runtime-env-docs"',
    '"verify:runtime-env-code"',
    '"verify:readiness-report-renderer"',
    '"verify:readiness-contracts"',
    '"render:readiness-report"',
    '"open:readiness:local"',
    '"open:readiness:local:runtime"',
    '"open:readiness:local:full"',
    '"audit:blog-search-daily"',
    '"audit:site-indexability"',
  ]);

  requireIncludes('script:bundle-budget-route-floor', 'scripts/check-bundle-budget.mjs', [
    'BUNDLE_BUDGET_MIN_ROUTES',
    'BUNDLE_BUDGET_ALLOW_ACTIVE_DEV_SERVER',
    'MIN_ROUTE_COUNT',
    "if (distDir !== '.next') return []",
    'activeNextDevServerProcesses',
    'assertNoActiveNextDevServer',
    'Refusing to check bundle budget while next dev is active',
    'Get-CimInstance Win32_Process',
    "CommandLine -notlike '*Get-CimInstance Win32_Process*'",
    'npm*run*dev',
    'Start-Process*npm.cmd*run*dev',
    'only ${stats.length} non-API route(s) found',
    'next dev server is rewriting .next',
  ]);
  requireBundleBudgetRouteFloorSmoke();
  requireActiveDevServerBundleBudgetSmoke();
  requireIncludes('script:build-rejects-active-dev-server', 'scripts/run-next-build.cjs', [
    'NEXT_BUILD_ALLOW_ACTIVE_DEV_SERVER',
    'NEXT_BUILD_PRECHECK_ONLY',
    "if (distDirName !== '.next') return []",
    'activeNextDevServerProcesses',
    'assertNoActiveNextDevServer',
    'startActiveNextDevServerMonitor',
    'Refusing to run production build while next dev is active',
    'Refusing to finish production build because next dev became active',
    'Get-CimInstance Win32_Process',
    "CommandLine -notlike '*Get-CimInstance Win32_Process*'",
    'npm*run*dev',
    'Start-Process*npm.cmd*run*dev',
    'Stop the dev server first so it cannot rewrite .next',
  ]);
  requireActiveDevServerBuildPrecheckSmoke();

  requireIncludes('open-readiness:blog-search-quality-gate', 'scripts/open-readiness-check.mjs', [
    'checkBlogSearchQualityReadiness',
    'public:blog-search-quality',
    'checkBlogPublicSurfaceMonitor',
    'public:blog-surface-monitor',
    '/api/ops/blog-system',
    'opsRequestHeaders',
    'OPEN_CHECK_AUTH_COOKIE',
    'ys-dev-admin=1',
    'failedIssues',
    'issueCounts',
    'strictScore',
    'fleetScore',
    'attentionChecksFromReport',
    'limit = 40',
    'attentionCheckCount',
    'isProtectedPreviewRuntimeBlock',
    'live:auth-refresh-no-token(fail)',
    'protected preview requires authenticated runtime probes',
    "missing: ['OPEN_CHECK_PACKAGE_ID']",
    "'OPEN_CHECK_REF_CODE'",
    'surfaceFailures',
    'surfaceWarnings',
    'LOCAL_MODE',
    'SKIP_EXTERNAL',
    'ALLOW_LOCAL_MISSING_DATA',
    'localProbeUnavailable',
    'ECONNREFUSED',
    'ECONNRESET',
    'options.attempts',
    'attempts: attempt',
    'retryDelayMs',
    'await sleep(retryDelayMs)',
    'INCLUDE_MARKETING_RUNTIME',
    'MARKETING_RUNTIME_ISOLATED',
    'MARKETING_RUNTIME_HARD_TIMEOUT_MS',
    'checkMarketingRuntimeLocal',
    'scripts/verify-marketing-automation-readiness.mjs',
    'scripts/verify-marketing-runtime-local.mjs',
    'process.execPath',
    '} else if (!LOCAL_MODE) {',
    '--base=${BASE_URL}',
    'runtime:env-readiness',
    'runtime-env-readiness.json',
    'audit:blog-search-daily',
    'OPEN_CHECK_BLOG_AUDIT_LIMIT',
    'OPEN_CHECK_BLOG_AUDIT_HARD_TIMEOUT_MS',
    'MARKETING_AUTOMATION_TIMEOUT_MS',
    'MARKETING_RUNTIME_HARD_TIMEOUT_MS',
    'REPORT_PATH',
    'writeReport',
    'releaseBlockers',
    'releaseWarnings',
    "source: 'open-readiness'",
    'usingDefaults',
    'warnings',
    '[open-readiness] warnings:',
  ]);

  requireIncludes('ci:marketing-readiness-wired', '.github/workflows/ci.yml', [
    'Marketing automation readiness',
    'npm run verify:marketing-automation:ci',
  ]);
  requireIncludes('ci:pr-quality-gate-wired', '.github/workflows/pr-quality-gate.yml', [
    'Marketing automation readiness',
    'npm run verify:marketing-automation:ci',
  ]);
  requireIncludes('ci:open-readiness-deployment-wired', '.github/workflows/open-readiness.yml', [
    'deployment_status:',
    'npm run verify:marketing-automation:ci',
    'npm run discover:operational-inputs',
    'npm run verify:operational-inputs',
    '--env-file=.tmp/operational-readiness-discovered.env',
    'operational-readiness-discovery.json',
    'operational-readiness-discovered.env',
    '--operational-env-file=.tmp/operational-readiness-discovered.env',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'operational-readiness-inputs.json',
    'operational-readiness-inputs.env.example',
    'operational-readiness-action-plan.md',
    'operational-readiness-apply-inputs.sh',
    'operational-readiness-vercel-env.sh',
    'operational-readiness-apply-inputs.mjs',
    'operational-readiness-vercel-env.mjs',
    'npm run open:readiness -- --json',
    '--include-marketing-runtime',
    'MARKETING_AUTOMATION_TIMEOUT_MS',
    'MARKETING_RUNTIME_HARD_TIMEOUT_MS',
    'OPEN_CHECK_PACKAGE_ID',
    'OPEN_CHECK_REF_CODE',
    'MARKETING_CHECK_CARD_NEWS_ID',
    'MARKETING_CHECK_VARIANT_GROUP_ID',
    'SERPAPI_KEY',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'SLACK_WEBHOOK_URL',
    'CRON_SECRET',
    '--report=.tmp/open-readiness-report.json',
    'render-readiness-report.mjs',
    '--summary-out=.tmp/open-readiness-step-summary.md',
    '--issue-body-out=.tmp/open-readiness-issue-body.md',
    '--meta-out=.tmp/open-readiness-issue-meta.json',
    '--operational-template=.tmp/operational-readiness-inputs.env.example',
    '--operational-plan=.tmp/operational-readiness-action-plan.md',
    '--operational-apply-script=.tmp/operational-readiness-apply-inputs.sh',
    '--operational-vercel-script=.tmp/operational-readiness-vercel-env.sh',
    '--vercel-script-out=.tmp/operational-readiness-vercel-env.sh',
    '--node-apply-script-out=.tmp/operational-readiness-apply-inputs.mjs',
    '--node-vercel-script-out=.tmp/operational-readiness-vercel-env.mjs',
    '--operational-node-apply-script=.tmp/operational-readiness-apply-inputs.mjs',
    '--operational-node-vercel-script=.tmp/operational-readiness-vercel-env.mjs',
    'GITHUB_STEP_SUMMARY',
    'issues: write',
    'actions/github-script@v7',
    'Track open readiness attention items',
    'open-readiness-issue-meta.json',
    'open-readiness-issue-body.md',
    'meta.marker',
    'meta.issueTitle',
    'meta.legacyIssueTitles',
    'legacyTitles.includes(issue.title)',
    'meta.shouldCloseIssue',
    'meta.hasBlockers',
    'meta.hasWarnings',
    'meta.hasAttentionItems',
    'actions/upload-artifact@v4',
    'OPEN_CHECK_BLOG_AUDIT_LIMIT',
    'OPEN_CHECK_BLOG_AUDIT_HARD_TIMEOUT_MS',
  ]);
  requireIncludes('ci:local-release-readiness-wired', '.github/workflows/local-release-readiness.yml', [
    'Local Release Readiness',
    'workflow_dispatch:',
    'schedule:',
    'push:',
    'npm run verify:local-release',
    'npm run discover:operational-inputs',
    'npm run verify:operational-inputs',
    '--env-file=.tmp/operational-readiness-discovered.env',
    '--operational-env-file=.tmp/operational-readiness-discovered.env',
    'operational-readiness-discovery.json',
    'operational-readiness-discovered.env',
    '--operational-env-file=.tmp/operational-readiness-discovered.env',
    'operational-readiness-inputs.json',
    'operational-readiness-inputs.env.example',
    'operational-readiness-action-plan.md',
    'operational-readiness-apply-inputs.sh',
    'operational-readiness-vercel-env.sh',
    'operational-readiness-apply-inputs.mjs',
    'operational-readiness-vercel-env.mjs',
    'strict_open',
    '--report=.tmp/local-release-readiness-report.json',
    'render-readiness-report.mjs',
    '--summary-out=.tmp/local-release-readiness-step-summary.md',
    '--issue-body-out=.tmp/local-release-readiness-issue-body.md',
    '--meta-out=.tmp/local-release-readiness-issue-meta.json',
    '--operational-template=.tmp/local-release-operational-inputs.env.example',
    '--operational-plan=.tmp/local-release-operational-inputs-action-plan.md',
    '--operational-apply-script=.tmp/local-release-operational-inputs-apply.sh',
    '--operational-vercel-script=.tmp/local-release-operational-inputs-vercel-env.sh',
    '--vercel-script-out=.tmp/operational-readiness-vercel-env.sh',
    '--node-apply-script-out=.tmp/operational-readiness-apply-inputs.mjs',
    '--node-vercel-script-out=.tmp/operational-readiness-vercel-env.mjs',
    '--operational-node-apply-script=.tmp/local-release-operational-inputs-apply.mjs',
    '--operational-node-vercel-script=.tmp/local-release-operational-inputs-vercel-env.mjs',
    'GITHUB_STEP_SUMMARY',
    'issues: write',
    'actions/github-script@v7',
    'Track local release readiness attention items',
    'local-release-readiness-issue-meta.json',
    'local-release-readiness-issue-body.md',
    'meta.marker',
    'meta.issueTitle',
    'meta.legacyIssueTitles',
    'legacyTitles.includes(issue.title)',
    'meta.shouldCloseIssue',
    'meta.hasBlockers',
    'meta.hasWarnings',
    'meta.hasAttentionItems',
    '.tmp/local-release-readiness-report.json',
    'local-release-operational-inputs-action-plan.md',
    'local-release-operational-inputs-apply.sh',
    'local-release-operational-inputs-vercel-env.sh',
    'local-release-operational-inputs-apply.mjs',
    'local-release-operational-inputs-vercel-env.mjs',
    'actions/upload-artifact@v4',
    'LOCAL_RELEASE_OPEN_READY_TIMEOUT_MS',
  ]);
  requireIncludes('ci:marketing-release-readiness-wired', '.github/workflows/marketing-release-readiness.yml', [
    'Marketing Release Readiness',
    'workflow_dispatch:',
    'schedule:',
    'push:',
    'strict',
    'skip_runtime',
    'npm run verify:marketing-release',
    '--report=.tmp/marketing-release-readiness-report.json',
    '--skip-runtime',
    'render-readiness-report.mjs',
    '--kind=marketing-release',
    '--summary-out=.tmp/marketing-release-readiness-step-summary.md',
    '--issue-body-out=.tmp/marketing-release-readiness-issue-body.md',
    '--meta-out=.tmp/marketing-release-readiness-issue-meta.json',
    '--operational-template=.tmp/marketing-release-operational-inputs.env.example',
    '--operational-plan=.tmp/marketing-release-operational-inputs-action-plan.md',
    '--operational-apply-script=.tmp/marketing-release-operational-inputs-apply.sh',
    '--operational-vercel-script=.tmp/marketing-release-operational-inputs-vercel-env.sh',
    '--operational-node-apply-script=.tmp/marketing-release-operational-inputs-apply.mjs',
    '--operational-node-vercel-script=.tmp/marketing-release-operational-inputs-vercel-env.mjs',
    '--operational-env-file=.tmp/marketing-release-operational-inputs-discovered.env',
    'GITHUB_STEP_SUMMARY',
    'issues: write',
    'actions/github-script@v7',
    'Track marketing release readiness attention items',
    'marketing-release-readiness-issue-meta.json',
    'marketing-release-readiness-issue-body.md',
    'meta.marker',
    'meta.issueTitle',
    'meta.legacyIssueTitles',
    'legacyTitles.includes(issue.title)',
    'meta.shouldCloseIssue',
    'meta.hasBlockers',
    'meta.hasWarnings',
    'meta.hasAttentionItems',
    '.tmp/marketing-release-readiness-report.json',
    'marketing-release-operational-inputs-discovered.env',
    'marketing-release-operational-inputs-action-plan.md',
    'marketing-release-operational-inputs-apply.sh',
    'marketing-release-operational-inputs-vercel-env.sh',
    'marketing-release-operational-inputs-apply.mjs',
    'marketing-release-operational-inputs-vercel-env.mjs',
    'actions/upload-artifact@v4',
    'MARKETING_RELEASE_RUNTIME_READY_TIMEOUT_MS',
    'MARKETING_RELEASE_RUNTIME_TIMEOUT_MS',
    'MARKETING_AUTOMATION_TIMEOUT_MS',
    'OPEN_CHECK_PACKAGE_ID',
    'OPEN_CHECK_REF_CODE',
    'MARKETING_CHECK_CARD_NEWS_ID',
    'MARKETING_CHECK_VARIANT_GROUP_ID',
    'SERPAPI_KEY',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'SLACK_WEBHOOK_URL',
    'CRON_SECRET',
  ]);
  requireIncludes('script:runtime-env-workflow-wiring', 'scripts/verify-runtime-env-workflow-wiring.mjs', [
    'runtime-env-readiness.json',
    '.github/workflows/open-readiness.yml',
    '.github/workflows/local-release-readiness.yml',
    '.github/workflows/marketing-release-readiness.yml',
    'OPEN_CHECK_PACKAGE_ID',
    'OPEN_CHECK_REF_CODE',
    'MARKETING_CHECK_CARD_NEWS_ID',
    'MARKETING_CHECK_VARIANT_GROUP_ID',
    'hasRuntimeSource',
  ]);
  requireCommandPass('script:runtime-env-workflow-wiring-pass', process.execPath, [
    'scripts/verify-runtime-env-workflow-wiring.mjs',
    '--json',
  ]);
  requireIncludes('script:runtime-env-docs', 'scripts/verify-runtime-env-docs.mjs', [
    'runtime-env-readiness.json',
    'docs/env-variables-reference.md',
    'docs/deploy-checklist.md',
    'critical',
    'warnDefaults',
  ]);
  requireCommandPass('script:runtime-env-docs-pass', process.execPath, [
    'scripts/verify-runtime-env-docs.mjs',
    '--json',
  ]);
  requireIncludes('script:runtime-env-code-wiring', 'scripts/verify-runtime-env-code-wiring.mjs', [
    'runtime-env-readiness.json',
    'secret-registry.ts',
    'critical-secret-registry',
    'source-references',
    'system-health-surface',
  ]);
  requireCommandPass('script:runtime-env-code-wiring-pass', process.execPath, [
    'scripts/verify-runtime-env-code-wiring.mjs',
    '--json',
  ]);
  requireIncludes('script:operational-readiness-inputs', 'scripts/verify-operational-readiness-inputs.mjs', [
    'runtime-env-readiness.json',
    'OPEN_CHECK_PACKAGE_ID',
    'OPEN_CHECK_REF_CODE',
    'MARKETING_CHECK_CARD_NEWS_ID',
    'MARKETING_CHECK_VARIANT_GROUP_ID',
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_PROJECT_REF',
    'VERCEL_TOKEN',
    '--self-test',
    '--template-out',
    'BLOG_QUALITY_SOURCE_READY',
    '--plan-out',
    '--apply-script-out',
    '--vercel-script-out',
    '--node-apply-script-out',
    '--node-vercel-script-out',
    'writeActionPlan',
    'writeApplyScript',
    'writeVercelScript',
    'writeNodeApplyScript',
    'writeNodeVercelScript',
    'runtimeVercelKeysForApply',
    'gh secret set',
    'gh variable set',
    'spawnSync',
    'nodeApplyScriptOut',
    'nodeVercelScriptOut',
    'OPERATIONAL_APPLY_DRY_RUN',
    'OPERATIONAL_INPUTS_ENV_FILE',
    '--env-file',
    'loadEnvFile',
    'parseEnvLine',
    'bashEnvFileLoaderLines',
    'envFilePath',
    'envFileDiagnostics',
    'env-file-quality',
    'unknownKeys',
    'duplicateKeys',
    'emptyKeys',
    'invalidLines',
    'readFileSync',
    'DRY-RUN',
    'vercel env add',
    '--force',
    'VERCEL_ENV_TARGETS',
    'VERCEL_PROJECT_CWD',
    'chmodSync',
    'applyScriptPath',
    'vercelScriptPath',
    'nodeApplyScriptPath',
    'nodeVercelScriptPath',
    'Operational Readiness Action Plan',
    'preferredTarget',
  ]);
  requireCommandPass('script:operational-readiness-inputs-pass', process.execPath, [
    'scripts/verify-operational-readiness-inputs.mjs',
    '--self-test',
    '--json',
    '--template-out=.tmp/operational-readiness-inputs-selftest.env.example',
    '--plan-out=.tmp/operational-readiness-inputs-selftest-action-plan.md',
    '--apply-script-out=.tmp/operational-readiness-inputs-selftest-apply.sh',
    '--vercel-script-out=.tmp/operational-readiness-inputs-selftest-vercel-env.sh',
    '--node-apply-script-out=.tmp/operational-readiness-inputs-selftest-apply.mjs',
    '--node-vercel-script-out=.tmp/operational-readiness-inputs-selftest-vercel-env.mjs',
  ]);
  requireIncludes('script:operational-apply-scripts', 'scripts/verify-operational-apply-scripts.mjs', [
    'verify-operational-readiness-inputs.mjs',
    'OPERATIONAL_APPLY_DRY_RUN',
    '--env-file',
    'filled-inputs.env',
    'writeFilledEnvFile',
    'assertBashEnvFileContract',
    'bash-apply-env-file-contract',
    'operational-inputs-env-file-pass',
    'operational-inputs-env-file-quality-warn',
    'filled-inputs-noisy.env',
    'SERPAPI_KEY_TYPO',
    'env-file audit',
    'DRY-RUN gh secret set SERPAPI_KEY --body <redacted>',
    'DRY-RUN gh variable set OPEN_CHECK_PACKAGE_ID --body <redacted>',
    'DRY-RUN gh variable set MARKETING_CHECK_CARD_NEWS_ID --body <redacted>',
    'DRY-RUN vercel env add SERPAPI_KEY production --value <redacted>',
    'nodeApplyScriptPath',
    'nodeVercelScriptPath',
    'assertExcludes',
  ]);
  requireCommandPass('script:operational-apply-scripts-pass', process.execPath, [
    'scripts/verify-operational-apply-scripts.mjs',
    '--json',
  ]);
  requireIncludes('script:project-automation-wiring', 'scripts/verify-project-automation-wiring.mjs', [
    'package:scripts-reference-existing-scripts',
    'package:scripts-reference-existing-files',
    'workflow:yaml-syntax',
    'workflow:npm-run-references-existing-scripts',
    'workflow:direct-local-command-targets-exist',
    'workflow:inline-generated-script-targets-inventoried',
    'local-script:node-syntax',
    'local-script:typescript-syntax',
    'workflowHelperSmokeTargets',
    'local-script:workflow-helper-smoke',
  ]);
  requireCommandPass('script:project-automation-wiring-pass', process.execPath, [
    'scripts/verify-project-automation-wiring.mjs',
    '--json',
  ]);
  requireIncludes('script:readiness-report-renderer', 'scripts/render-readiness-report.mjs', [
    'releaseBlockers',
    'missingReportFor',
    'Readiness report was not created',
    'renderMissingInputsSection',
    'missingInputRows',
    '## Missing Inputs',
    'releaseWarnings',
    'renderWarningsSection',
    '## Release Warnings',
    'renderOperationalArtifactsSection',
    '## Operational Artifacts',
    'operationalApplyScriptPath',
    'operationalVercelScriptPath',
    'operationalNodeApplyScriptPath',
    'operationalNodeVercelScriptPath',
    '--operational-apply-script',
    '--operational-vercel-script',
    '--operational-node-apply-script',
    '--operational-node-vercel-script',
    'actionPlanPath',
    'templatePath',
    'vercelScriptPath',
    'nodeApplyScriptPath',
    'nodeVercelScriptPath',
    'Vercel env script',
    'Node apply script',
    'Node Vercel env script',
    'preferredLocationForKey',
    'preferredLocationsForKeys',
    'alternatives: ${item.alternatives.join',
    "value.endsWith('_URL')",
    'Preferred Location',
    'GitHub Actions secret',
    'GitHub Actions variable',
    'failedIssues',
    'issueCounts',
    'strictScore',
    'fleetScore',
    'attention checks: ${item.attentionChecks.join',
    'authMode',
    'surfaceFailures',
    'surfaceWarnings',
    'auth: ${item.authMode}',
    'surfaces: ${parts.join',
    'warningCount',
    'hasWarnings',
    'hasAttentionItems',
    'Open Readiness Attention Items',
    'Local Release Readiness Attention Items',
    'Marketing Release Readiness Attention Items',
    'legacyIssueTitles',
    'Open readiness blockers',
    'Local release readiness blockers',
    'Marketing release readiness blockers',
    'issueTitle',
    'readiness-open-blockers',
    'readiness-local-release-blockers',
    'readiness-marketing-release-blockers',
    '--self-test',
    '--summary-out',
    '--issue-body-out',
    '--meta-out',
    'GITHUB_SERVER_URL',
    'GITHUB_REPOSITORY',
    'GITHUB_RUN_ID',
  ]);
  requireIncludes('script:readiness-report-renderer-verifier', 'scripts/verify-readiness-report-renderer.mjs', [
    'render-readiness-report.mjs',
    "['open', 'local-release', 'marketing-release']",
    '--kind=${kind}',
    'missing-report',
    'warning-only',
    'inconsistent-blocker',
    'runMissingReportRenderer',
    'runWarningOnlyRenderer',
    'runInconsistentBlockerRenderer',
    'Warnings:',
    '## Missing Inputs',
    '## Operational Artifacts',
    'Action plan',
    'Apply script',
    'Vercel env script',
    'Node apply script',
    'Node Vercel env script',
    'Preferred Location',
    'GitHub Actions secret',
    'GitHub Actions variable',
    'SERPAPI_KEY',
    '## Release Warnings',
    'AD_FLAG_UP_BID_FACTOR',
    'summaryPath',
    'issuePath',
    'metaPath',
    'hasBlockers',
  ]);
  requireCommandPass('script:readiness-report-renderer-verifier-pass', process.execPath, [
    'scripts/verify-readiness-report-renderer.mjs',
    '--json',
  ]);
  requireIncludes('script:readiness-contracts-suite', 'scripts/verify-readiness-contracts.mjs', [
    'verify-runtime-env-workflow-wiring.mjs',
    'verify-runtime-env-docs.mjs',
    'verify-runtime-env-code-wiring.mjs',
    'verify-readiness-report-renderer.mjs',
    'verify-project-automation-wiring.mjs',
    'verify-operational-readiness-inputs.mjs',
    'verify-operational-apply-scripts.mjs',
    'verify-marketing-release-readiness.mjs',
    'marketing-release-smoke',
    '--skip-marketing-automation',
    "expectedStatus: 'blocked'",
    'checksToRun',
  ]);
  requireCommandPass('script:readiness-contracts-suite-pass', process.execPath, [
    'scripts/verify-readiness-contracts.mjs',
    '--json',
  ]);
  requireCommandPass('script:readiness-report-renderer-pass', process.execPath, [
    'scripts/render-readiness-report.mjs',
    '--self-test',
    '--kind=open',
    '--summary-out=.tmp/readiness-render-selftest-summary.md',
    '--issue-body-out=.tmp/readiness-render-selftest-issue.md',
    '--meta-out=.tmp/readiness-render-selftest-meta.json',
  ]);

  requireIncludes('live:marketing-runtime-contract-wired', 'scripts/verify-marketing-automation-readiness.mjs', [
    'DEV_ADMIN_SESSION_PATH',
    'checkRefreshWithoutToken',
    'checkTrackingEngagementContext',
    'checkApiContract',
    'marketingCheckCardNewsId',
    'marketingCheckVariantGroupId',
    'requireDynamicProbes',
    '--require-dynamic-probes',
    'MARKETING_READINESS_REQUIRE_DYNAMIC_PROBES',
    'allowMissingAdminCookie',
    '--allow-missing-admin-cookie',
    'MARKETING_READINESS_ALLOW_MISSING_ADMIN_COOKIE',
    'dynamicMarketingPagePaths',
    'missingDynamicMarketingProbeInputs',
    'live:dynamic-marketing-page-probes',
    'allowDegraded',
    'MARKETING_READINESS_ALLOW_WRITE_PROBES',
    '/api/tracking',
    'live:tracking-engagement-context',
    '/api/admin/marketing/actions?limit=10',
    '/api/admin/marketing/asset-groups?limit=10',
    '/api/admin/marketing/integration-probes',
    '/api/admin/marketing/snapshots?days=14',
    '/api/admin/marketing/system-health',
    '/api/admin/ad-os/credential-preflight',
    '/api/admin/ad-os/runtime-readiness',
    '/api/admin/ad-os/channel-adapters/health',
    '/api/admin/ad-os/staging-smoke',
    '/admin/marketing/card-news',
    '/admin/marketing/card-news/${encodeURIComponent(marketingCheckCardNewsId)}',
    '/admin/marketing/content-hub/${encodeURIComponent(marketingCheckCardNewsId)}',
    '/admin/marketing/card-news/variants/${encodeURIComponent(marketingCheckVariantGroupId)}',
    '/admin/marketing/command-center',
    '/admin/marketing/social-configs',
    "setCookie: ''",
    "if (!setCookie) return '';",
    'live:unexpected-error',
  ]);
  requireIncludes('script:marketing-runtime-local-start-stop', 'scripts/verify-marketing-runtime-local.mjs', [
    'startNextServer',
    'waitForReady',
    'stopProcessTree',
    'findLast',
    'lastIndexOf',
    'runtimeDistDir',
    'existsSync(`${runtimeDistDir}/BUILD_ID`)',
    'start mode requires a production build',
    'MARKETING_READINESS_ALLOW_MISSING_ADMIN_COOKIE',
    'verify-marketing-automation-readiness.mjs',
    'MARKETING_RUNTIME_PORT',
    '--strict',
  ]);
  requireIncludes('script:marketing-release-readiness', 'scripts/verify-marketing-release-readiness.mjs', [
    'verify-marketing-automation-readiness.mjs',
    'discover-operational-readiness-inputs.mjs',
    'verify-operational-readiness-inputs.mjs',
    'verify-marketing-runtime-local.mjs',
    'type-check',
    'lint',
    'build',
    'check:bundle',
    'MARKETING_RELEASE_SKIP_RUNTIME',
    'MARKETING_RELEASE_SKIP_BUILD',
    'MARKETING_RELEASE_SKIP_MARKETING_AUTOMATION',
    '--skip-marketing-automation',
    '--operational-env-file',
    'marketing-release-operational-inputs-discovered.env',
    'nested status:',
    'releaseBlockers',
    'operational-input-discovery',
    'operational-inputs',
    'marketing-runtime-local',
  ]);
  requireIncludes('script:open-readiness-local-full-start-stop', 'scripts/verify-open-readiness-local.mjs', [
    'startNextServer',
    'waitForReady',
    'stopProcessTree',
    'open-readiness-check.mjs',
    '--include-marketing-runtime',
    '--base=${baseUrl}',
  ]);
  requireIncludes('script:local-next-server-helper', 'scripts/lib/local-next-server.mjs', [
    'startNextServer',
    'stopProcessTree',
    'waitForReady',
    'AbortController',
    'controller.abort',
    'probeTimeoutMs',
    'signal: controller.signal',
    'validatePort',
    'validateMode',
    'NEXT_DIST_DIR',
    "`.next-dev-${port}`",
  ]);
  requireIncludes('script:next-main-app-shim-dist-dir', 'scripts/ensure-next-main-app-js-shim.cjs', [
    "process.env.NEXT_DIST_DIR || '.next'",
    "path.join(process.cwd(), distDir)",
    "path.join(process.cwd(), distDir, 'static', 'chunks')",
  ]);
  requireIncludes('script:local-release-readiness', 'scripts/verify-local-release-readiness.mjs', [
    'type-check',
    'lint',
    'test',
    'readiness-contracts',
    'verify:readiness-contracts',
    "args: ['--', '--json']",
    'summarizeReadinessContracts',
    'operational-inputs',
    'verify:operational-inputs',
    'skipOperationalInputs',
    'operationalInputsTemplatePath',
    'operationalInputsPlanPath',
    'operationalInputsApplyScriptPath',
    'operationalInputsVercelScriptPath',
    'operationalInputsNodeApplyScriptPath',
    'operationalInputsNodeVercelScriptPath',
    'operationalInputsEnvFilePath',
    'LOCAL_RELEASE_OPERATIONAL_INPUTS_ENV_FILE',
    '--operational-env-file',
    'skipOperationalDiscovery',
    'LOCAL_RELEASE_SKIP_OPERATIONAL_DISCOVERY',
    'operationalDiscoveryOutPath',
    'LOCAL_RELEASE_OPERATIONAL_DISCOVERY_OUT',
    '--operational-discovery-out',
    'autoOperationalDiscovery',
    'operational-input-discovery',
    'discover:operational-inputs',
    'summarizeOperationalDiscovery',
    'loadOperationalEnvFile',
    'operationalEnvFileLoad',
    'operationalEnvFile',
    'summarizeOperationalInputs',
    'summarizeOperationalInputBlockers',
    'summarizeOperationalInputWarnings',
    'releaseWarnings',
    'warningPreview',
    'summaryCount',
    '--plan-out=${operationalInputsPlanPath}',
    '--apply-script-out=${operationalInputsApplyScriptPath}',
    '--vercel-script-out=${operationalInputsVercelScriptPath}',
    '--node-apply-script-out=${operationalInputsNodeApplyScriptPath}',
    '--node-vercel-script-out=${operationalInputsNodeVercelScriptPath}',
    '--env-file=${operationalInputsEnvFilePath}',
    'actionPlanPath',
    'applyScriptPath',
    'vercelScriptPath',
    'nodeApplyScriptPath',
    'nodeVercelScriptPath',
    'operationalEnvFilePath',
    '--operational-env-file',
    '[local-release] warnings:',
    'warnings=${releaseWarnings.length}',
    'operationalDiscovery: !autoOperationalDiscovery',
    'verify:marketing-automation:ci',
    'open:readiness:local:full',
    'check:bundle',
    'marketingRuntimeHardTimeoutMs',
    '--marketing-runtime-hard-timeout-ms=${marketingRuntimeHardTimeoutMs}',
    'parseJsonFromOutput',
    'strictOpenReadiness',
    'summarizeOpenReadinessBlockers',
    'releaseBlockers',
    'reportPath',
    'failedIssues',
    'issueCounts',
    'strictScore',
    'fleetScore',
    'attentionChecks',
    'attentionCheckCount',
    'authMode',
    'surfaceFailures',
    'surfaceWarnings',
    'writeReport',
    'outputPath',
    'tailFile',
    'NEXT_BUILD_RECOVERY_WAIT_MS',
  ]);
  requireIncludes('script:operational-input-discovery', 'scripts/discover-operational-readiness-inputs.mjs', [
    '@supabase/supabase-js',
    'travel_packages',
    'affiliates',
    'card_news',
    'OPEN_CHECK_PACKAGE_ID',
    'OPEN_CHECK_REF_CODE',
    'MARKETING_CHECK_CARD_NEWS_ID',
    'MARKETING_CHECK_VARIANT_GROUP_ID',
    'operational-readiness-discovered.env',
    '--env-file',
    '--out',
    'OPERATIONAL_DISCOVERY_TIMEOUT_MS',
    'fetchWithTimeout',
    'isPlaceholder',
    'quoteEnv',
  ]);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      ...options,
      headers: {
        Accept: 'application/json,text/html;q=0.9,*/*;q=0.5',
        ...(options.headers || {}),
      },
    });
    const body = await res.text();
    return {
      ok: true,
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      setCookie: res.headers.get('set-cookie') || '',
      location: res.headers.get('location') || '',
      body,
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      contentType: '',
      setCookie: '',
      location: '',
      body: '',
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function cookieHeaderFromSetCookie(setCookie) {
  if (!setCookie) return '';
  return setCookie
    .split(/,(?=[^;,]+=)/)
    .map((cookie) => cookie.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

function parseJsonBody(res) {
  if (!res.body) return null;
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

function isLoginHtml(res) {
  if (!res.contentType.includes('text/html')) return false;
  return /login|sign in|로그인|관리자/i.test(res.body);
}

function isDegradedPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return Boolean(
    payload.degraded === true ||
      payload.access_state === 'supabase_unconfigured' ||
      payload.reason === 'supabase_unconfigured' ||
      payload.reason === 'summary_degraded',
  );
}

function missingTopLevelKeys(payload, keys) {
  if (!payload || typeof payload !== 'object') return keys;
  return keys.filter((key) => !(key in payload));
}

function statusAllowed(endpoint, status, payload) {
  if ((endpoint.allowedStatuses || [200]).includes(status)) return true;
  return Boolean(endpoint.allowDegraded && [200, 503].includes(status) && isDegradedPayload(payload));
}

const LIVE_API_ENDPOINTS = [
  { path: '/api/meta/campaigns', keys: ['campaigns'], allowDegraded: true },
  { path: '/api/meta/creatives', keys: ['creatives', 'grouped'], allowDegraded: true },
  { path: '/api/meta/performance', keys: ['campaigns', 'snapshots'], allowDegraded: true },
  { path: '/api/campaigns/creatives?limit=10', keys: ['creatives'], allowDegraded: true },
  { path: '/api/campaigns/performance?type=patterns', keys: ['patterns'], allowDegraded: true },
  { path: '/api/admin/marketing/actions?limit=10', keys: ['actions'], allowDegraded: true },
  { path: '/api/admin/marketing/asset-groups?limit=10', keys: ['ok', 'groups', 'actions'], allowDegraded: true },
  { path: '/api/admin/marketing/dashboard', keys: ['data'], allowDegraded: true },
  { path: '/api/admin/marketing/integration-probes', keys: ['ok', 'probes'] },
  { path: '/api/admin/marketing/snapshots?days=14', keys: ['trend'], allowDegraded: true },
  { path: '/api/admin/marketing/system-health', keys: ['ok', 'score', 'checks'] },
  {
    path: '/api/admin/ad-os/summary',
    keys: ['ok', 'kpis', 'launch_action_queue'],
    allowDegraded: true,
    allowedStatuses: [200, 503],
  },
  { path: '/api/admin/ad-os/credential-preflight', keys: ['ok', 'readiness', 'summary'] },
  { path: '/api/admin/ad-os/runtime-readiness', keys: ['ok'], allowedStatuses: [200, 503] },
  { path: '/api/admin/ad-os/channel-adapters/health', keys: ['ok'], allowedStatuses: [200, 503] },
  { path: '/api/admin/ad-os/staging-smoke', keys: ['ok', 'smoke', 'safety'] },
];

const LIVE_PAGE_PATHS = [
  '/admin/marketing',
  '/admin/marketing/auto-publish',
  '/admin/marketing/blog-export',
  '/admin/marketing/brand-kits',
  '/admin/marketing/campaigns',
  '/admin/marketing/card-news',
  '/admin/marketing/card-news/campaign/new',
  '/admin/marketing/card-news/new',
  '/admin/marketing/card-news/new-html',
  '/admin/marketing/card-news/variants/new',
  '/admin/marketing/command-center',
  '/admin/marketing/creatives',
  '/admin/marketing/published',
  '/admin/marketing/social-configs',
  '/admin/marketing/system-health',
  '/admin/ad-os',
];

function dynamicMarketingPagePaths() {
  const paths = [];
  if (marketingCheckCardNewsId) {
    paths.push(
      `/admin/marketing/card-news/${encodeURIComponent(marketingCheckCardNewsId)}`,
      `/admin/marketing/card-news/${encodeURIComponent(marketingCheckCardNewsId)}/v2`,
      `/admin/marketing/content-hub/${encodeURIComponent(marketingCheckCardNewsId)}`,
    );
  }
  if (marketingCheckVariantGroupId) {
    paths.push(`/admin/marketing/card-news/variants/${encodeURIComponent(marketingCheckVariantGroupId)}`);
  }
  return paths;
}

function missingDynamicMarketingProbeInputs() {
  const missing = [];
  if (!marketingCheckCardNewsId) missing.push('MARKETING_CHECK_CARD_NEWS_ID');
  if (!marketingCheckVariantGroupId) missing.push('MARKETING_CHECK_VARIANT_GROUP_ID');
  return missing;
}

async function checkRefreshWithoutToken() {
  const res = await fetchWithTimeout(`${baseUrl}/api/auth/refresh`, { method: 'POST' });
  const payload = parseJsonBody(res);
  const ok =
    res.status === 401 &&
    res.contentType.includes('application/json') &&
    payload &&
    payload.error === 'refresh_token missing';
  addCheck('live:auth-refresh-no-token', ok ? 'pass' : 'fail', {
    statusCode: res.status,
    contentType: res.contentType,
    ms: res.ms,
    error: ok ? '' : (res.error || res.body.slice(0, 300)),
  });
}

function shouldRunWriteProbe() {
  if (process.env.MARKETING_READINESS_ALLOW_WRITE_PROBES === '1') return true;
  try {
    const url = new URL(baseUrl);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function checkTrackingEngagementContext() {
  if (!shouldRunWriteProbe()) {
    addCheck('live:tracking-engagement-context', 'pass', {
      notes: 'write probe skipped for non-local target; set MARKETING_READINESS_ALLOW_WRITE_PROBES=1 to force it',
    });
    return;
  }

  const res = await fetchWithTimeout(`${baseUrl}/api/tracking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'engagement',
      session_id: `marketing-readiness-${Date.now()}`,
      event_type: 'kakao_clicked',
      event_source: 'marketing_readiness_probe',
      destination: 'Da Nang',
      page_url: '/__marketing-readiness__',
      metadata: {
        source: 'marketing_readiness_probe',
        placement: 'runtime_contract',
      },
    }),
  });
  const payload = parseJsonBody(res);
  const ok =
    res.status === 202 &&
    res.contentType.includes('application/json') &&
    payload &&
    payload.ok === true &&
    !payload.error;
  addCheck('live:tracking-engagement-context', ok ? 'pass' : 'fail', {
    statusCode: res.status,
    contentType: res.contentType,
    ms: res.ms,
    mock: Boolean(payload?.mock),
    error: ok ? '' : (res.error || res.body.slice(0, 300)),
  });
}

async function checkApiContract(endpoint, headers) {
  const res = await fetchWithTimeout(`${baseUrl}${endpoint.path}`, { headers });
  const payload = parseJsonBody(res);
  const missingKeys = missingTopLevelKeys(payload, endpoint.keys);
  const allowed = statusAllowed(endpoint, res.status, payload);
  const ok =
    allowed &&
    res.contentType.includes('application/json') &&
    payload &&
    typeof payload === 'object' &&
    missingKeys.length === 0;

  addCheck(`live:api:${endpoint.path}`, ok ? 'pass' : 'fail', {
    statusCode: res.status,
    contentType: res.contentType,
    ms: res.ms,
    degraded: isDegradedPayload(payload),
    missingKeys,
    error: ok ? '' : isLoginHtml(res) ? 'received login HTML instead of JSON' : (res.error || res.body.slice(0, 300)),
  });
}

async function liveChecks() {
  if (!baseUrl) return;

  await checkRefreshWithoutToken();
  await checkTrackingEngagementContext();
  const livePagePaths = [...LIVE_PAGE_PATHS, ...dynamicMarketingPagePaths()];
  const dynamicProbeMissing = missingDynamicMarketingProbeInputs();
  if (dynamicProbeMissing.length > 0) {
    addCheck('live:dynamic-marketing-page-probes', requireDynamicProbes ? 'blocked' : 'pass', {
      missing: dynamicProbeMissing,
      notes: requireDynamicProbes
        ? 'provide MARKETING_CHECK_CARD_NEWS_ID and MARKETING_CHECK_VARIANT_GROUP_ID to verify dynamic marketing pages'
        : 'dynamic marketing page probes skipped because sample IDs were not provided',
    });
  }

  let cookie = providedCookie;
  if (!cookie) {
    const login = await fetchWithTimeout(`${baseUrl}${DEV_ADMIN_SESSION_PATH}`);
    const issuedCookie = cookieHeaderFromSetCookie(login.setCookie);
    const loginOk = login.status === 200 && /ys-dev-admin=/.test(login.setCookie);
    cookie = loginOk ? issuedCookie : '';
    addCheck('live:dev-admin-cookie', loginOk || allowMissingAdminCookie ? 'pass' : 'blocked', {
      statusCode: login.status,
      ms: login.ms,
      path: DEV_ADMIN_SESSION_PATH,
      notes: loginOk
        ? 'dev admin cookie issued'
        : allowMissingAdminCookie
          ? 'dev admin cookie unavailable; protected probes will be skipped for this runtime mode'
          : 'provide --cookie for non-local or production targets',
    });
  }

  if (!cookie) {
    const missingCookieStatus = allowMissingAdminCookie ? 'pass' : 'blocked';
    const missingCookieNotes = allowMissingAdminCookie
      ? 'admin cookie unavailable; protected marketing route probe skipped for this runtime mode'
      : 'admin cookie unavailable; pass --cookie to verify protected marketing API routes';
    for (const endpoint of LIVE_API_ENDPOINTS) {
      addCheck(`live:api:${endpoint.path}`, missingCookieStatus, {
        notes: missingCookieNotes,
      });
    }
    for (const pagePath of livePagePaths) {
      addCheck(`live:page:${pagePath}`, missingCookieStatus, {
        notes: allowMissingAdminCookie
          ? 'admin cookie unavailable; protected marketing page probe skipped for this runtime mode'
          : 'admin cookie unavailable; pass --cookie to verify protected marketing pages',
      });
    }
    return;
  }

  const headers = { Cookie: cookie };

  for (const endpoint of LIVE_API_ENDPOINTS) {
    await checkApiContract(endpoint, headers);
  }

  for (const pagePath of livePagePaths) {
    const res = await fetchWithTimeout(`${baseUrl}${pagePath}`, { headers });
    const ok =
      res.status === 200 &&
      res.contentType.includes('text/html') &&
      !/Application error|Internal Server Error|Unhandled Runtime Error/.test(res.body) &&
      !isLoginHtml(res);
    addCheck(`live:page:${pagePath}`, ok ? 'pass' : 'fail', {
      statusCode: res.status,
      contentType: res.contentType,
      ms: res.ms,
      error: ok ? '' : (res.error || res.body.slice(0, 300)),
    });
  }
}

async function main() {
  staticChecks();
  try {
    await liveChecks();
  } catch (err) {
    addCheck('live:unexpected-error', 'fail', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const failed = checks.filter((check) => check.status === 'fail');
  const blocked = checks.filter((check) => check.status === 'blocked');
  const passed = checks.filter((check) => check.status === 'pass');
  const summary = {
    status: failed.length ? 'fail' : strict && blocked.length ? 'blocked' : 'pass',
    passed: passed.length,
    blocked: blocked.length,
    failed: failed.length,
    checks,
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const check of checks) {
      const suffix = check.error
        ? ` - ${check.error}`
        : check.missing?.length
          ? ` - missing: ${check.missing.join(', ')}`
          : check.notes
            ? ` - ${check.notes}`
            : '';
      console.log(`${check.status.toUpperCase().padEnd(7)} ${check.name}${suffix}`);
    }
    console.log(`\n[marketing-automation-readiness] ${summary.status}: ${passed.length} passed, ${blocked.length} blocked, ${failed.length} failed`);
  }

  if (failed.length) process.exit(1);
  if (strict && blocked.length) process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
