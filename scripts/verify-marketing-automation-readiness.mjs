#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

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
const commandTimeoutMs = Number(
  argValue('--command-timeout-ms', process.env.MARKETING_READINESS_COMMAND_TIMEOUT_MS || '300000'),
);
const commandTimeoutKillGraceMs = Number(
  argValue('--command-timeout-kill-grace-ms', process.env.MARKETING_READINESS_COMMAND_TIMEOUT_KILL_GRACE_MS || '5000'),
);
const providedCookie = argValue('--cookie', process.env.MARKETING_READINESS_COOKIE || '');
const marketingCheckCardNewsId = argValue('--card-news-id', process.env.MARKETING_CHECK_CARD_NEWS_ID || '');
const marketingCheckVariantGroupId = argValue('--variant-group-id', process.env.MARKETING_CHECK_VARIANT_GROUP_ID || '');
const requireDynamicProbes = args.has('--require-dynamic-probes') || process.env.MARKETING_READINESS_REQUIRE_DYNAMIC_PROBES === '1';
const allowMissingAdminCookie = args.has('--allow-missing-admin-cookie') || process.env.MARKETING_READINESS_ALLOW_MISSING_ADMIN_COOKIE === '1';
const skipContractSelfChecks =
  args.has('--skip-contract-self-checks') || process.env.MARKETING_READINESS_SKIP_CONTRACT_SELF_CHECKS === '1';
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

function requireExcludes(name, path, needles) {
  const text = readText(path);
  if (!text) return;
  const present = needles.filter((needle) => text.includes(needle));
  addCheck(name, present.length ? 'fail' : 'pass', {
    file: path,
    present,
  });
}

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function listFiles(root, predicate = () => true) {
  const files = [];
  if (!existsSync(root)) return files;

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const target = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(target);
      } else if (entry.isFile() && predicate(target, entry)) {
        files.push(normalizeSlashes(target));
      }
    }
  }

  walk(root);
  return files.sort();
}

function appPageRouteFromFile(file) {
  return `/${normalizeSlashes(file)
    .replace(/^src\/app\//, '')
    .replace(/\/page\.tsx$/, '')}`;
}

function apiRouteFileForPath(apiPath) {
  const cleanPath = String(apiPath || '').split('?')[0].replace(/\/+$/, '');
  return cleanPath ? `src/app${cleanPath}/route.ts` : '';
}

function collectAdOsUiApiReferences() {
  const refs = new Set();
  const files = listFiles('src/app/admin/ad-os', (file) => /\.(?:ts|tsx)$/.test(file));
  const apiLiteral = /['"`](\/api\/admin\/ad-os\/[A-Za-z0-9/_-]+(?:\?[^'"`$]*)?)['"`]/g;

  for (const file of files) {
    const source = readText(file);
    for (const match of source.matchAll(apiLiteral)) {
      const apiPath = String(match[1] || '').split('?')[0].replace(/\/+$/, '');
      if (apiPath) refs.add(apiPath);
    }
  }

  return [...refs].sort();
}

function requireMarketingSurfaceCoverage() {
  const marketingPageFiles = listFiles(
    'src/app/admin/marketing',
    (file, entry) => entry.name === 'page.tsx',
  );
  const actualStaticMarketingPages = marketingPageFiles
    .map(appPageRouteFromFile)
    .filter((route) => !route.includes('['))
    .sort();
  const expectedStaticMarketingPages = LIVE_PAGE_PATHS
    .filter((route) => route.startsWith('/admin/marketing'))
    .sort();
  const expectedStatic = new Set(expectedStaticMarketingPages);
  const actualStatic = new Set(actualStaticMarketingPages);
  const missingStaticCoverage = actualStaticMarketingPages.filter((route) => !expectedStatic.has(route));
  const staleStaticCoverage = expectedStaticMarketingPages.filter((route) => !actualStatic.has(route));

  addCheck(
    'surface:admin-marketing-static-pages-covered',
    missingStaticCoverage.length || staleStaticCoverage.length ? 'fail' : 'pass',
    {
      actualCount: actualStaticMarketingPages.length,
      expectedCount: expectedStaticMarketingPages.length,
      missing: missingStaticCoverage,
      stale: staleStaticCoverage,
    },
  );

  const actualDynamicMarketingPages = marketingPageFiles
    .map(appPageRouteFromFile)
    .filter((route) => route.includes('['))
    .sort();
  const expectedDynamicMarketingPages = [
    '/admin/marketing/card-news/[id]',
    '/admin/marketing/card-news/[id]/v2',
    '/admin/marketing/card-news/variants/[group_id]',
    '/admin/marketing/content-hub/[cardNewsId]',
  ].sort();
  const expectedDynamic = new Set(expectedDynamicMarketingPages);
  const actualDynamic = new Set(actualDynamicMarketingPages);
  const missingDynamicCoverage = actualDynamicMarketingPages.filter((route) => !expectedDynamic.has(route));
  const staleDynamicCoverage = expectedDynamicMarketingPages.filter((route) => !actualDynamic.has(route));

  addCheck(
    'surface:admin-marketing-dynamic-pages-covered',
    missingDynamicCoverage.length || staleDynamicCoverage.length ? 'fail' : 'pass',
    {
      actualCount: actualDynamicMarketingPages.length,
      expectedCount: expectedDynamicMarketingPages.length,
      missing: missingDynamicCoverage,
      stale: staleDynamicCoverage,
    },
  );

  const missingAdOsRouteFiles = collectAdOsUiApiReferences()
    .map((path) => ({ path, routeFile: apiRouteFileForPath(path) }))
    .filter((item) => !item.routeFile || !existsSync(item.routeFile));

  addCheck(
    'surface:ad-os-ui-api-routes-exist',
    missingAdOsRouteFiles.length ? 'fail' : 'pass',
    {
      checked: collectAdOsUiApiReferences().length,
      missing: missingAdOsRouteFiles,
    },
  );
}

function appendCapped(current, chunk, limit = 2 * 1024 * 1024) {
  const next = current + chunk.toString('utf8');
  return next.length > limit ? next.slice(next.length - limit) : next;
}

function runCommandWithTimeout(command, args = []) {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    let stdout = '';
    let stderr = '';
    let spawnError;
    let timedOut = false;
    let settled = false;
    let forceCloseTimer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (forceCloseTimer) clearTimeout(forceCloseTimer);
      resolve({
        ...result,
        stdout,
        stderr,
        timedOut,
        durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000),
      });
    };

    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    const timer = Number.isFinite(commandTimeoutMs) && commandTimeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        killProcess(child.pid);
        forceCloseTimer = setTimeout(() => {
          finish({
            status: null,
            signal: 'SIGTERM',
            error: new Error(`command timed out after ${commandTimeoutMs}ms`),
          });
        }, commandTimeoutKillGraceMs);
      }, commandTimeoutMs)
      : null;

    child.stdout?.on('data', (chunk) => {
      stdout = appendCapped(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = appendCapped(stderr, chunk);
    });
    child.on('error', (err) => {
      spawnError = err;
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      finish({
        status: code,
        signal,
        error: timedOut ? new Error(`command timed out after ${commandTimeoutMs}ms`) : spawnError,
      });
    });
  });
}

function parseJsonPayload(output) {
  const text = String(output || '').trim().replace(/^\uFEFF/, '');
  if (!text) return null;
  const starts = [...new Set([0, text.indexOf('{'), text.lastIndexOf('\n{') + 1])]
    .filter((index) => index >= 0 && index < text.length);
  for (const start of starts) {
    try {
      return JSON.parse(text.slice(start));
    } catch {
      // Try the next plausible JSON boundary.
    }
  }
  return null;
}

function formatCommandFailureOutput(result, limit = 12000) {
  const output = `${result.stderr || ''}\n${result.stdout || ''}`.trim();
  const parsed = parseJsonPayload(output);
  if (parsed && Array.isArray(parsed.checks)) {
    const failedChecks = parsed.checks
      .filter((check) => check.status === 'fail' || check.status === 'blocked')
      .map((check) => ({
        id: check.id || check.name,
        status: check.status,
        error: check.error,
        exitCode: check.exitCode,
        timedOut: check.timedOut,
        missing: check.missing,
        missingRequiredCheckFields: check.missingRequiredCheckFields,
        presentForbiddenFiles: check.presentForbiddenFiles,
        lingeringTypeCheckProcesses: check.lingeringTypeCheckProcesses,
      }));
    return JSON.stringify({
      status: parsed.status,
      passed: parsed.passed,
      blocked: parsed.blocked,
      failed: parsed.failed,
      failedChecks,
    }, null, 2).slice(0, limit);
  }
  return (output || result.error?.message || '').slice(0, limit);
}

async function requireCommandPass(name, command, args = []) {
  const result = await runCommandWithTimeout(command, args);
  addCheck(name, result.status === 0 ? 'pass' : 'fail', {
    command: [command, ...args].join(' '),
    exitCode: result.status,
    timedOut: result.timedOut,
    timeoutMs: commandTimeoutMs,
    durationMs: result.durationMs,
    error: result.status === 0
      ? ''
      : formatCommandFailureOutput(result),
  });
}

async function requireCommandFail(name, command, args = [], outputNeedles = []) {
  const result = await runCommandWithTimeout(command, args);
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const missing = outputNeedles.filter((needle) => !output.includes(needle));
  addCheck(name, result.status !== 0 && missing.length === 0 ? 'pass' : 'fail', {
    command: [command, ...args].join(' '),
    exitCode: result.status,
    timedOut: result.timedOut,
    timeoutMs: commandTimeoutMs,
    durationMs: result.durationMs,
    missing,
    output: output.trim().slice(0, 1200),
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
      env: {
        ...process.env,
        NEXT_DIST_DIR: '.next',
      },
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
        NEXT_DIST_DIR: '.next',
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

async function staticChecks() {
  requireMarketingSurfaceCoverage();

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
  requireIncludes('lib:slack-alert-resolver', 'src/lib/slack-alert.ts', [
    'resolveSlackAlertWebhookUrl',
    'SLACK_ALERT_WEBHOOK_URL',
    'SLACK_ALERTS_WEBHOOK',
    'SLACK_ALERTS_WEBHOOK_URL',
    'SLACK_CWV_WEBHOOK_URL',
    'SLACK_WEBHOOK_URL',
  ]);
  requireIncludes('lib:slack-alert-resolver-consumers', 'src/lib/admin-alerts.ts', [
    'resolveSlackAlertWebhookUrl',
  ]);
  requireIncludes('lib:seo-monitor-slack-resolver', 'src/lib/seo-monitor.ts', [
    'resolveSlackAlertWebhookUrl',
  ]);
  requireIncludes('lib:web-vitals-slack-resolver', 'src/lib/web-vitals-collector.ts', [
    'resolveSlackAlertWebhookUrl',
  ]);
  requireIncludes('lib:ad-controller-slack-resolver', 'src/lib/ad-controller.ts', [
    'resolveSlackAlertWebhookUrl',
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
  requireIncludes('api:ad-os-runtime-readiness-degraded', 'src/app/api/admin/ad-os/runtime-readiness/route.ts', [
    'buildSupabaseUnconfiguredResponse',
    'supabase_unconfigured',
    'degraded: true',
    'buildRuntimeReadinessChecks',
  ]);
  requireIncludes('api:ad-os-channel-health-degraded', 'src/app/api/admin/ad-os/channel-adapters/health/route.ts', [
    'supabase_unconfigured',
    'degraded: true',
    'capabilities: []',
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
    '"verify:marketing-runtime:vercel"',
    '"verify:marketing-release"',
    '"verify:local-release"',
    '"verify:all"',
    '"verify:all:strict"',
    'scripts/verify-all-readiness.mjs',
    '--report=.tmp/full-readiness-report.json',
    '"lint:a11y:ci"',
    '"discover:operational-inputs"',
    '"discover:operational-inputs:vercel"',
    '"ensure:operational-variant-group"',
    '"generate:full-operational-inputs"',
    '"bootstrap:ci-management-secrets"',
    '--inspect-management-auth',
    '--inspect-supabase-system-secrets',
    'full-project-operational-inputs.env.example',
    '"verify:operational-inputs"',
    '"verify:operational-apply-scripts"',
    '"sync:vercel-env:github"',
    'scripts/bootstrap-ci-management-secrets.mjs',
    'scripts/verify-marketing-runtime-from-vercel.mjs',
    '"verify:project-automation-wiring"',
    '"verify:app-route-runtime"',
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

  requireIncludes('gitignore:ephemeral-next-dev-dist', '.gitignore', [
    '/.next-dev-*/',
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
  requireIncludes('script:performance-bundle-dist-dir', 'scripts/check-bundle.js', [
    "process.env.NEXT_DIST_DIR || '.next'",
    "path.join(distDir, 'static', 'chunks')",
    "path.join(distDir, 'static', 'css')",
    'bundle-result.json',
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
    'MARKETING_RUNTIME_COMMAND_TIMEOUT_MS',
    '--marketing-runtime-command-timeout-ms',
    '--command-timeout-ms=${MARKETING_RUNTIME_COMMAND_TIMEOUT_MS}',
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
    'Readiness automation contracts',
    'npm run verify:readiness-contracts -- --json',
    'Unit tests',
    'npm run test -- --run',
    'Bundle budget',
    'npm run check:bundle:ci',
    'a11y lint',
    'npm run lint:a11y:ci',
    'Next build output size',
    'du -sh .next/',
  ]);
  requireExcludes('ci:no-stale-next-build-output-path', '.github/workflows/ci.yml', [
    'du -sh build/',
  ]);
  requireIncludes('ci:bundle-monitor-next-output-wired', '.github/workflows/bundle-monitor.yml', [
    'pull_request:',
    'npm run build',
    'npm run check:bundle:ci',
    'du -sh .next/',
    'du -sb .next/',
    'Bundle Size Report',
  ]);
  requireExcludes('ci:bundle-monitor-no-stale-next-output-path', '.github/workflows/bundle-monitor.yml', [
    'du -sh build/',
    'du -sb build/',
  ]);
  requireIncludes('ci:pr-quality-gate-wired', '.github/workflows/pr-quality-gate.yml', [
    'Marketing automation readiness',
    'npm run verify:marketing-automation:ci',
    'Readiness automation contracts',
    'npm run verify:readiness-contracts -- --json',
    'a11y lint',
    'npm run lint:a11y:ci',
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
    'Treat blocked local release checks as failures',
    'args+=(--strict)',
    'github.event_name }}" == "schedule"',
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
    'LOCAL_RELEASE_COMMAND_TIMEOUT_MS',
    'LOCAL_RELEASE_COMMAND_TIMEOUT_KILL_GRACE_MS',
    '--command-timeout-ms="${LOCAL_RELEASE_COMMAND_TIMEOUT_MS}"',
    '--command-timeout-kill-grace-ms="${LOCAL_RELEASE_COMMAND_TIMEOUT_KILL_GRACE_MS}"',
  ]);
  requireIncludes('ci:marketing-release-readiness-wired', '.github/workflows/marketing-release-readiness.yml', [
    'Marketing Release Readiness',
    'workflow_dispatch:',
    'schedule:',
    'push:',
    'strict',
    'skip_runtime',
    'args+=(--strict)',
    'github.event_name }}" == "schedule"',
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
    'MARKETING_RELEASE_COMMAND_TIMEOUT_MS',
    'MARKETING_RELEASE_COMMAND_TIMEOUT_KILL_GRACE_MS',
    '--command-timeout-ms="${MARKETING_RELEASE_COMMAND_TIMEOUT_MS}"',
    '--command-timeout-kill-grace-ms="${MARKETING_RELEASE_COMMAND_TIMEOUT_KILL_GRACE_MS}"',
    'OPEN_CHECK_PACKAGE_ID',
    'OPEN_CHECK_REF_CODE',
    'MARKETING_CHECK_CARD_NEWS_ID',
    'MARKETING_CHECK_VARIANT_GROUP_ID',
    'SERPAPI_KEY',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'SLACK_WEBHOOK_URL',
    'CRON_SECRET',
  ]);
  requireIncludes('ci:full-project-readiness-wired', '.github/workflows/full-readiness.yml', [
    'Full Project Readiness',
    'workflow_dispatch:',
    'schedule:',
    'strict',
    'quick_mode',
    'args+=(--strict)',
    'github.event_name }}" == "schedule"',
    'skip_local_release',
    'skip_marketing_release',
    'npm run verify:all',
    '--report=.tmp/full-readiness-report.json',
    '--skip-build',
    '--skip-open-readiness',
    '--skip-app-route-runtime',
    '--skip-runtime',
    '--skip-local-release',
    '--skip-marketing-release',
    'full-readiness-report.json',
    'full-readiness-summary.json',
    'full-project-operational-inputs*',
    'local-release-operational-inputs*',
    'marketing-release-operational-inputs*',
    'render-readiness-report.mjs',
    '--kind=full-project',
    'full-readiness-step-summary.md',
    'full-readiness-issue-body.md',
    'full-readiness-issue-meta.json',
    'Track full project readiness attention items',
    'issues: write',
    'meta.shouldCloseIssue',
    'meta.hasAttentionItems',
    'github.rest.issues.create',
    'github.rest.issues.update',
    'GITHUB_STEP_SUMMARY',
    'actions/upload-artifact@v4',
    'full-project-readiness-${{ github.run_id }}',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'LOCAL_RELEASE_OPEN_READY_TIMEOUT_MS',
    'LOCAL_RELEASE_APP_ROUTE_RUNTIME_READY_TIMEOUT_MS',
    'MARKETING_RELEASE_RUNTIME_READY_TIMEOUT_MS',
    'MARKETING_RELEASE_RUNTIME_TIMEOUT_MS',
    'VERIFY_ALL_STAGE_TIMEOUT_MS',
    'VERIFY_ALL_COMMAND_TIMEOUT_MS',
    'VERIFY_ALL_COMMAND_TIMEOUT_KILL_GRACE_MS',
    '--stage-timeout-ms="${VERIFY_ALL_STAGE_TIMEOUT_MS}"',
    '--command-timeout-ms="${VERIFY_ALL_COMMAND_TIMEOUT_MS}"',
    '--command-timeout-kill-grace-ms="${VERIFY_ALL_COMMAND_TIMEOUT_KILL_GRACE_MS}"',
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
    '.github/workflows/full-readiness.yml',
    'OPEN_CHECK_PACKAGE_ID',
    'OPEN_CHECK_REF_CODE',
    'MARKETING_CHECK_CARD_NEWS_ID',
    'MARKETING_CHECK_VARIANT_GROUP_ID',
    'hasRuntimeSource',
  ]);
  await requireCommandPass('script:runtime-env-workflow-wiring-pass', process.execPath, [
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
  await requireCommandPass('script:runtime-env-docs-pass', process.execPath, [
    'scripts/verify-runtime-env-docs.mjs',
    '--json',
  ]);
  requireIncludes('script:runtime-env-code-wiring', 'scripts/verify-runtime-env-code-wiring.mjs', [
    'runtime-env-readiness.json',
    'secret-registry.ts',
    'channelOptional',
    'aliases',
    'critical-secret-registry',
    'optional-secret-registry',
    'source-references',
    'system-health-surface',
  ]);
  await requireCommandPass('script:runtime-env-code-wiring-pass', process.execPath, [
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
    '--inspect-github',
    '--inspect-management-auth',
    '--inspect-supabase-system-secrets',
    'system_secrets',
    '--format',
    'sensitiveKeys',
    'Sensitive values are runtime-available on Vercel but not readable for local CLI sync',
    '--management-auth-inspect-timeout-ms',
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
    'OPERATIONAL_APPLY_COMMAND_TIMEOUT_MS',
    'timeout: commandTimeoutMs',
    'Command timed out after',
    'process.exit(124)',
    'nodeApplyScriptOut',
    'nodeVercelScriptOut',
    'OPERATIONAL_APPLY_DRY_RUN',
    'OPERATIONAL_INPUTS_ENV_FILE',
    'OPERATIONAL_INPUTS_INSPECT_GITHUB',
    'OPERATIONAL_INPUTS_INSPECT_MANAGEMENT_AUTH',
    'OPERATIONAL_INPUTS_MANAGEMENT_AUTH_INSPECT_TIMEOUT_MS',
    'githubActionsInventory',
    'localManagementAuthInventory',
    'availableInGitHubActions',
    'availableByInference',
    'local-vercel-cli-auth',
    'local-supabase-cli-auth',
    'gh secret list --json name',
    'gh variable list --json name',
    "runNpx(['vercel', 'whoami']",
    "runNpx(['supabase', 'projects', 'list', '--output', 'json']",
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
  await requireCommandPass('script:operational-readiness-inputs-pass', process.execPath, [
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
    'assertNodeCommandTimeoutContract',
    'node-apply-command-timeout-contract',
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
    'OPERATIONAL_APPLY_VERIFY_COMMAND_TIMEOUT_MS',
    '--command-timeout-ms',
    'unknown operational apply scripts argument',
    'command timed out after',
    'timedOut',
    'timeoutMs',
    'commandTimeoutMs',
    'nodeApplyScriptPath',
    'nodeVercelScriptPath',
    'assertExcludes',
  ]);
  await requireCommandFail('script:operational-apply-scripts-rejects-unknown-args', process.execPath, [
    'scripts/verify-operational-apply-scripts.mjs',
    '--json',
    '--bad-option',
  ], [
    'unknown operational apply scripts argument: --bad-option',
  ]);
  await requireCommandFail('script:operational-apply-scripts-rejects-invalid-timeout', process.execPath, [
    'scripts/verify-operational-apply-scripts.mjs',
    '--json',
    '--command-timeout-ms=0',
  ], [
    '--command-timeout-ms must be a positive number of milliseconds.',
  ]);
  await requireCommandPass('script:operational-apply-scripts-pass', process.execPath, [
    'scripts/verify-operational-apply-scripts.mjs',
    '--json',
  ]);
  requireIncludes('script:sync-vercel-env-to-github-actions', 'scripts/sync-vercel-env-to-github-actions.mjs', [
    '--env-file',
    '--discovered-env-file',
    '--apply',
    'gh',
    'secret',
    'variable',
    'SUPABASE_PROJECT_REF',
    'supabaseProjectRef',
    'THREADS_ACCESS_TOKEN',
    'THREADS_USER_ID',
    'empty',
    'skipped',
    'Dry-run',
  ]);
  requireIncludes('script:bootstrap-ci-management-secrets', 'scripts/bootstrap-ci-management-secrets.mjs', [
    'VERCEL_TOKEN',
    'SUPABASE_ACCESS_TOKEN',
    'local-vercel-cli-auth',
    'local-supabase-cli-auth',
    'gh',
    'secret',
    'set',
    'stdin',
    '--apply',
    'Secret values are never printed',
    'readWindowsSupabaseCliToken',
    'com.vercel.cli',
    'auth.json',
  ]);
  requireIncludes('script:discover-operational-inputs-from-vercel', 'scripts/discover-operational-inputs-from-vercel.mjs', [
    'vercel',
    'env',
    'pull',
    '--environment',
    'discover-operational-readiness-inputs.mjs',
    '--env-file',
    '--out',
    '--pull-timeout-ms',
    'OPERATIONAL_DISCOVERY_VERCEL_ENV',
    'OPERATIONAL_DISCOVERY_VERCEL_PULL_TIMEOUT_MS',
    'rmSync',
  ]);
  requireIncludes('script:ensure-operational-variant-group', 'scripts/ensure-operational-variant-group.mjs', [
    '--from-vercel',
    '--apply',
    'MARKETING_CHECK_VARIANT_GROUP_ID',
    'card_news',
    'variant_group_id',
    '[READINESS] Variant smoke baseline',
    '[READINESS] Variant smoke value angle',
    'DRAFT',
    'operational_readiness',
    'Could not pull Vercel environment variables',
    'rmSync',
  ]);
  requireIncludes('script:project-automation-wiring', 'scripts/verify-project-automation-wiring.mjs', [
    'package:scripts-reference-existing-scripts',
    'package:scripts-reference-existing-files',
    'workflow:yaml-syntax',
    'workflow:npm-run-references-existing-scripts',
    'workflow:direct-local-command-targets-exist',
    'workflow:inline-generated-script-targets-inventoried',
    'workflow:next-output-assumptions-current',
    'checkWorkflowNextOutputAssumptions',
    'workflow:tee-steps-use-pipefail',
    'checkWorkflowTeeStepsUsePipefail',
    'workflow:external-actions-pinned',
    'checkWorkflowExternalActionsPinned',
    'workflow:next-build-env-complete',
    'checkWorkflowNextBuildEnv',
    'workflow:next-dev-env-complete',
    'checkWorkflowNextDevEnv',
    'workflow:referenced-events-have-triggers',
    'checkWorkflowReferencedEventTriggers',
    'workflow:scheduled-readiness-runs-strict',
    'checkScheduledReadinessWorkflowsStrict',
    'workflow:github-script-write-guards',
    'checkWorkflowGithubScriptWriteGuards',
    'workflow:github-script-syntax',
    'checkWorkflowGithubScriptSyntax',
    'workflow:inline-node-script-syntax',
    'checkWorkflowInlineNodeScriptSyntax',
    'PROJECT_AUTOMATION_LOCAL_SCRIPT_SYNTAX_TIMEOUT_MS',
    'PROJECT_AUTOMATION_WORKFLOW_SMOKE_TIMEOUT_MS',
    '--local-script-syntax-timeout-ms',
    '--workflow-smoke-timeout-ms',
    'unknown project automation wiring argument',
    'node syntax check timed out after',
    'workflow helper smoke timed out after',
    'timedOut',
    'localScriptSyntaxTimeoutMs',
    'workflowSmokeTimeoutMs',
    'inlineNodeScripts',
    'local-script:node-syntax',
    'local-script:typescript-syntax',
    'workflowHelperSmokeTargets',
    'local-script:workflow-helper-smoke',
    'automation:critical-command-timeouts',
    'checkCriticalAutomationTimeoutContracts',
    'VERCEL_ENV_PULL_TIMEOUT_MS',
    'VERCEL_ENV_COMMAND_TIMEOUT_MS',
    'PRODUCT_REGISTRATION_LEARNING_VERIFY_COMMAND_TIMEOUT_MS',
    'PRODUCT_MOBILE_QUALITY_COMMAND_TIMEOUT_MS',
    'JARVIS_READINESS_COMMAND_TIMEOUT_MS',
    'OPEN_READINESS_LOCAL_COMMAND_TIMEOUT_MS',
    'MARKETING_RUNTIME_COMMAND_TIMEOUT_MS',
    'OPERATIONAL_APPLY_COMMAND_TIMEOUT_MS',
    'app-route:literal-internal-references',
    'collectAppRouteReferences',
    'checkAppRouteReferences',
    'appRouteFromConventionFile',
    'routePattern',
  ]);
  await requireCommandFail('script:project-automation-wiring-rejects-unknown-args', process.execPath, [
    'scripts/verify-project-automation-wiring.mjs',
    '--json',
    '--bad-option',
  ], [
    'unknown project automation wiring argument: --bad-option',
  ]);
  await requireCommandFail('script:project-automation-wiring-rejects-invalid-timeout', process.execPath, [
    'scripts/verify-project-automation-wiring.mjs',
    '--json',
    '--local-script-syntax-timeout-ms=0',
  ], [
    '--local-script-syntax-timeout-ms must be a positive number of milliseconds.',
  ]);
  await requireCommandPass('script:project-automation-wiring-pass', process.execPath, [
    'scripts/verify-project-automation-wiring.mjs',
    '--json',
  ]);
  requireIncludes('script:all-readiness-suite', 'scripts/verify-all-readiness.mjs', [
    'scripts/verify-readiness-contracts.mjs',
    'scripts/verify-local-release-readiness.mjs',
    'scripts/verify-marketing-release-readiness.mjs',
    'let value = fallback',
    'selected no stages',
    '--stage-timeout-ms',
    '--command-timeout-ms',
    '--command-timeout-kill-grace-ms',
    'VERIFY_ALL_STAGE_TIMEOUT_MS',
    'VERIFY_ALL_COMMAND_TIMEOUT_MS',
    'VERIFY_ALL_COMMAND_TIMEOUT_KILL_GRACE_MS',
    'VERIFY_ALL_OPERATIONAL_TEMPLATE',
    'full-project-operational-inputs.env.example',
    'generateFullOperationalInputBundle',
    'scripts/verify-operational-readiness-inputs.mjs',
    'operationalBundle',
    'artifacts',
    'stage timed out after',
    'cleanupTimedOutStageProcesses',
    'taskkill.exe',
    'commandTimeoutMs',
    'commandTimeoutKillGraceMs',
    'valuePassthrough',
    'timedOut',
    'validateArgs',
    'unknown verify:all argument',
    'attentionItemsFromReport',
    'firstArtifactPath',
    'operationalArtifactFieldsFromReport',
    'uniqueOperationalArtifactRows',
    'printConsoleGuidance',
    'Attention items:',
    'Operational artifacts:',
    'templatePath',
    'actionPlanPath',
    'nodeApplyScriptPath',
    'nodeVercelScriptPath',
    'releaseBlockers',
    'releaseWarnings',
    'attentionCount',
    '--self-test',
    '--skip-build',
    '--skip-type-check',
    '--skip-lint',
    '--skip-a11y',
    '--skip-sensitive-api-guards',
    '--skip-dependency-circular',
    '--skip-open-readiness',
    '--skip-app-route-runtime',
    '--skip-runtime',
    '--skip-local-release',
    '--skip-marketing-release',
    '--skip-readiness-contracts',
    '--skip-marketing-automation',
    '--strict',
    'VERIFY_ALL_STRICT',
    'local-release',
    'marketing-release',
  ]);
  await requireCommandPass('script:all-readiness-suite-self-test-pass', process.execPath, [
    'scripts/verify-all-readiness.mjs',
    '--self-test',
    '--json',
  ]);
  await requireCommandFail('script:all-readiness-suite-rejects-unknown-args', process.execPath, [
    'scripts/verify-all-readiness.mjs',
    '--self-test',
    '--json',
    '--bad-option',
  ], [
    'unknown verify:all argument: --bad-option',
    '"status": "fail"',
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
    'warningCountOf',
    'Open Readiness Attention Items',
    'Local Release Readiness Attention Items',
    'Marketing Release Readiness Attention Items',
    'Full Project Readiness Attention Items',
    'readiness-full-project-blockers',
    'report?.attention',
    'Project Attention Blockers',
    'legacyIssueTitles',
    'Open readiness blockers',
    'Local release readiness blockers',
    'Marketing release readiness blockers',
    'Full project readiness blockers',
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
    "['open', 'local-release', 'marketing-release', 'full-project']",
    'isFullProjectKind',
    'Full Project Readiness Attention Items',
    'Project Attention Blockers',
    'Warnings: 1',
    '.tmp/local-release-operational-inputs-action-plan.md',
    '--kind=${kind}',
    'missing-report',
    'warning-only',
    'inconsistent-blocker',
    'READINESS_REPORT_RENDERER_TIMEOUT_MS',
    '--timeout-ms',
    'unknown readiness report renderer argument',
    'renderer command timed out after',
    'timedOut',
    'timeoutMs',
    'durationMs',
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
  await requireCommandFail('script:readiness-report-renderer-verifier-rejects-unknown-args', process.execPath, [
    'scripts/verify-readiness-report-renderer.mjs',
    '--json',
    '--bad-option',
  ], [
    'unknown readiness report renderer argument: --bad-option',
  ]);
  await requireCommandFail('script:readiness-report-renderer-verifier-rejects-invalid-timeout', process.execPath, [
    'scripts/verify-readiness-report-renderer.mjs',
    '--json',
    '--timeout-ms=0',
  ], [
    '--timeout-ms must be a positive number of milliseconds.',
  ]);
  await requireCommandPass('script:readiness-report-renderer-verifier-pass', process.execPath, [
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
    'verify-app-route-runtime-smoke.mjs',
    'app-route-runtime-self-test',
    'verify-marketing-release-readiness.mjs',
    'marketing-release-smoke',
    'marketing-release-strict-blocked-exit',
    'local-release-strict-blocked-exit',
    'local-release-command-timeout-rejected',
    'marketing-release-command-timeout-rejected',
    'operationalEnvKeys',
    'clearOperationalEnv',
    'envForCheck',
    'env: envForCheck(check)',
    'OPERATIONAL_INPUTS_ENV_FILE',
    'all-readiness-strict-blocked-exit',
    'all-readiness-attention-smoke',
    'all-readiness-console-guidance-smoke',
    'all-readiness-report-arg-last-wins',
    'all-readiness-empty-stage-rejected',
    'all-readiness-stage-timeout-rejected',
    'all-readiness-command-timeout-passthrough',
    'allowedExitCodes: [0]',
    'allowedExitCodes: [1]',
    'requiredFiles',
    'forbiddenFiles',
    'allowFailedCount',
    'forbidLingeringTypeCheckProcesses',
    'lingeringTypeCheckProcesses',
    'minAttentionCount',
    'requiredAttentionMissing',
    'requiredCheckFields',
    'stdoutOnly',
    'expectedStdoutIncludes',
    'attentionCount',
    'missingRequiredCheckFields',
    'missingExpectedStdout',
    '--skip-marketing-automation',
    '--skip-readiness-contracts',
    "expectedStatus: 'blocked'",
    "expectedStatus: 'warn'",
    'checksToRun',
    '--check-timeout-ms',
    'READINESS_CONTRACT_CHECK_TIMEOUT_MS',
    'contract check timed out after',
    'checkTimeoutMs',
  ]);
  if (skipContractSelfChecks) {
    addCheck('script:readiness-contracts-suite-pass', 'pass', {
      skipped: true,
      notes: 'skipped because readiness contracts are verified by the parent release gate',
    });
    addCheck('script:readiness-report-renderer-pass', 'pass', {
      skipped: true,
      notes: 'skipped because readiness report rendering is verified by the parent release gate',
    });
  } else {
    await requireCommandPass('script:readiness-contracts-suite-pass', process.execPath, [
      'scripts/verify-readiness-contracts.mjs',
      '--json',
    ]);
    await requireCommandPass('script:readiness-report-renderer-pass', process.execPath, [
      'scripts/render-readiness-report.mjs',
      '--self-test',
      '--kind=open',
      '--summary-out=.tmp/readiness-render-selftest-summary.md',
      '--issue-body-out=.tmp/readiness-render-selftest-issue.md',
      '--meta-out=.tmp/readiness-render-selftest-meta.json',
    ]);
  }

  requireIncludes('live:marketing-runtime-contract-wired', 'scripts/verify-marketing-automation-readiness.mjs', [
    'DEV_ADMIN_SESSION_PATH',
    'MARKETING_READINESS_COMMAND_TIMEOUT_MS',
    'MARKETING_READINESS_COMMAND_TIMEOUT_KILL_GRACE_MS',
    'runCommandWithTimeout',
    'formatCommandFailureOutput',
    'parseJsonPayload',
    'failedChecks',
    'command timed out after',
    'appendCapped',
    'skipContractSelfChecks',
    'MARKETING_READINESS_SKIP_CONTRACT_SELF_CHECKS',
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
    'MARKETING_RUNTIME_COMMAND_TIMEOUT_MS',
    'MARKETING_READINESS_SKIP_CONTRACT_SELF_CHECKS',
    '--skip-contract-self-checks',
    '--command-timeout-ms',
    'marketing readiness command timed out after',
    'ETIMEDOUT',
    '--strict',
  ]);
  requireIncludes('script:marketing-runtime-vercel-env-start-stop', 'scripts/verify-marketing-runtime-from-vercel.mjs', [
    'vercel',
    'env',
    'pull',
    '--environment',
    'discover-operational-readiness-inputs.mjs',
    '--env-file',
    'MARKETING_READINESS_REQUIRE_DYNAMIC_PROBES',
    'MARKETING_READINESS_SKIP_CONTRACT_SELF_CHECKS',
    '--skip-contract-self-checks',
    'verify-marketing-runtime-local.mjs',
    '--mode=dev',
    '--command-timeout-ms',
    'rmSync',
    'Could not pull Vercel environment variables',
  ]);
  requireIncludes('script:app-route-runtime-smoke', 'scripts/verify-app-route-runtime-smoke.mjs', [
    'startNextServer',
    'waitForReady',
    'stopProcessTree',
    'api:admin-packages-alias',
    'api:tracking-engagement',
    'auth:dev-admin-cookie',
    '--self-test',
    'ys-dev-admin',
    'APP_ROUTE_RUNTIME_ALLOW_MISSING_DEV_ADMIN',
    'APP_ROUTE_RUNTIME_ATTEMPTS',
    'package_card_clicked',
  ]);
  await requireCommandPass('script:app-route-runtime-smoke-self-test-pass', process.execPath, [
    'scripts/verify-app-route-runtime-smoke.mjs',
    '--self-test',
    '--json',
  ]);
  requireIncludes('script:marketing-release-readiness', 'scripts/verify-marketing-release-readiness.mjs', [
    'verify-readiness-contracts.mjs',
    'verify-marketing-automation-readiness.mjs',
    'discover-operational-readiness-inputs.mjs',
    'verify-operational-readiness-inputs.mjs',
    'verify-marketing-runtime-from-vercel.mjs',
    'type-check',
    'lint',
    'build',
    'check:bundle',
    'MARKETING_RELEASE_SKIP_RUNTIME',
    'MARKETING_RELEASE_SKIP_BUILD',
    'MARKETING_RELEASE_SKIP_READINESS_CONTRACTS',
    '--skip-contract-self-checks',
    'MARKETING_RELEASE_SKIP_MARKETING_AUTOMATION',
    'MARKETING_RELEASE_COMMAND_TIMEOUT_MS',
    'MARKETING_RELEASE_COMMAND_TIMEOUT_KILL_GRACE_MS',
    '--command-timeout-ms',
    '--command-timeout-kill-grace-ms',
    'command timed out after',
    'killProcessTree',
    'cleanupLingeringScriptProcesses',
    'sleepSync(750)',
    'spawnWithTimeout',
    'npmCliPath',
    'npm-cli.js',
    'Get-CimInstance Win32_Process',
    'ParentProcessId',
    'Stop-Process',
    'taskkill.exe',
    "detached: process.platform !== 'win32'",
    'timedOut',
    'commandTimeoutMs',
    'commandTimeoutKillGraceMs',
    'MARKETING_RELEASE_BUILD_DIST_DIR',
    '.next-marketing-release',
    'NEXT_DIST_DIR',
    'buildDistDir',
    '--keep-build-dist',
    'MARKETING_RELEASE_KEEP_BUILD_DIST',
    'cleanupBuildDistDir',
    'buildDistCleanup',
    '--skip-readiness-contracts',
    '--skip-marketing-automation',
    '--operational-env-file',
    'marketing-release-operational-inputs-discovered.env',
    'nested status:',
    'releaseBlockers',
    'readiness-contracts',
    'operational-input-discovery',
    'operational-inputs',
    'marketing-runtime-vercel',
  ]);
  requireIncludes('script:open-readiness-local-full-start-stop', 'scripts/verify-open-readiness-local.mjs', [
    'startNextServer',
    'waitForReady',
    'stopProcessTree',
    'open-readiness-check.mjs',
    '--include-marketing-runtime',
    '--base=${baseUrl}',
    'OPEN_READINESS_LOCAL_COMMAND_TIMEOUT_MS',
    '--command-timeout-ms',
    'open readiness command timed out after',
    'ETIMEDOUT',
  ]);
  requireIncludes('script:local-next-server-helper', 'scripts/lib/local-next-server.mjs', [
    'startNextServer',
    'stopProcessTree',
    'cleanupDevDistDir',
    'rmSync(target, { recursive: true, force: true })',
    "firstSegment.startsWith('.next-dev-')",
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
    'LOCAL_RELEASE_STRICT',
    'LOCAL_RELEASE_SKIP_TYPE_CHECK',
    'LOCAL_RELEASE_SKIP_LINT',
    'LOCAL_RELEASE_SKIP_A11Y',
    'LOCAL_RELEASE_SKIP_SENSITIVE_API_GUARDS',
    'LOCAL_RELEASE_SKIP_DEPENDENCY_CIRCULAR',
    'LOCAL_RELEASE_SKIP_READINESS_CONTRACTS',
    'LOCAL_RELEASE_SKIP_MARKETING_AUTOMATION',
    'LOCAL_RELEASE_COMMAND_TIMEOUT_MS',
    'LOCAL_RELEASE_COMMAND_TIMEOUT_KILL_GRACE_MS',
    'open-readiness-local-full',
    '`--command-timeout-ms=${commandTimeoutMs}`',
    '`--marketing-runtime-command-timeout-ms=${commandTimeoutMs}`',
    '`--marketing-runtime-hard-timeout-ms=${',
    '--command-timeout-ms',
    '--command-timeout-kill-grace-ms',
    'command timed out after',
    'killProcessTree',
    'cleanupLingeringScriptProcesses',
    'sleepSync(750)',
    'spawnWithTimeout',
    'npmCliPath',
    'npm-cli.js',
    'Get-CimInstance Win32_Process',
    'ParentProcessId',
    'Stop-Process',
    'taskkill.exe',
    "detached: process.platform !== 'win32'",
    'timedOut',
    'commandTimeoutMs',
    'commandTimeoutKillGraceMs',
    'const strict',
    'strict && blocked > 0 ? 2 : 0',
    '--skip-type-check',
    '--skip-lint',
    '--skip-a11y',
    '--skip-sensitive-api-guards',
    '--skip-dependency-circular',
    '--skip-readiness-contracts',
    '--skip-marketing-automation',
    'lint:a11y',
    'audit:sensitive-api-guards',
    'check:deps:circular',
    'summarizeA11yReport',
    'a11y-report',
    'sensitive-api-guards',
    'dependency-circular',
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
    'LOCAL_RELEASE_BUILD_DIST_DIR',
    '.next-local-release',
    'NEXT_DIST_DIR',
    'buildDistDir',
    '--keep-build-dist',
    'LOCAL_RELEASE_KEEP_BUILD_DIST',
    'cleanupBuildDistDir',
    'buildDistCleanup',
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
    'verify:app-route-runtime',
    'skipAppRouteRuntime',
    'LOCAL_RELEASE_SKIP_APP_ROUTE_RUNTIME',
    'LOCAL_RELEASE_APP_ROUTE_RUNTIME_PORT',
    'LOCAL_RELEASE_APP_ROUTE_RUNTIME_MODE',
    'LOCAL_RELEASE_APP_ROUTE_RUNTIME_TIMEOUT_MS',
    'LOCAL_RELEASE_APP_ROUTE_RUNTIME_READY_TIMEOUT_MS',
    'LOCAL_RELEASE_APP_ROUTE_RUNTIME_ATTEMPTS',
    '--skip-app-route-runtime',
    '--app-route-runtime-port',
    '--app-route-runtime-mode',
    '--app-route-runtime-timeout-ms',
    '--app-route-runtime-ready-timeout-ms',
    '--app-route-runtime-attempts',
    'summarizeAppRouteRuntime',
    'open:readiness:local:full',
    'check:bundle',
    'marketingRuntimeHardTimeoutMs',
    '`--marketing-runtime-hard-timeout-ms=${',
    '`--marketing-runtime-command-timeout-ms=${commandTimeoutMs}`',
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
  await staticChecks();
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
