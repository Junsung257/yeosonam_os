#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs';

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
    '"verify:local-release"',
    '"open:readiness:local"',
    '"open:readiness:local:runtime"',
    '"open:readiness:local:full"',
    '"audit:blog-search-daily"',
    '"audit:site-indexability"',
  ]);

  requireIncludes('open-readiness:blog-search-quality-gate', 'scripts/open-readiness-check.mjs', [
    'checkBlogSearchQualityReadiness',
    'public:blog-search-quality',
    'LOCAL_MODE',
    'SKIP_EXTERNAL',
    'ALLOW_LOCAL_MISSING_DATA',
    'INCLUDE_MARKETING_RUNTIME',
    'MARKETING_RUNTIME_ISOLATED',
    'checkMarketingRuntimeLocal',
    '--base=${BASE_URL}',
    'runtime:env-readiness',
    'runtime-env-readiness.json',
    'audit:blog-search-daily',
    'OPEN_CHECK_BLOG_AUDIT_LIMIT',
    'OPEN_CHECK_BLOG_AUDIT_HARD_TIMEOUT_MS',
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
    'npm run open:readiness -- --json',
    'OPEN_CHECK_BLOG_AUDIT_LIMIT',
    'OPEN_CHECK_BLOG_AUDIT_HARD_TIMEOUT_MS',
  ]);
  requireIncludes('ci:local-release-readiness-wired', '.github/workflows/local-release-readiness.yml', [
    'Local Release Readiness',
    'workflow_dispatch:',
    'schedule:',
    'push:',
    'npm run verify:local-release',
    'strict_open',
    '--report=.tmp/local-release-readiness-report.json',
    'GITHUB_STEP_SUMMARY',
    '.tmp/local-release-readiness-report.json',
    'actions/upload-artifact@v4',
    'LOCAL_RELEASE_OPEN_READY_TIMEOUT_MS',
  ]);

  requireIncludes('live:marketing-runtime-contract-wired', 'scripts/verify-marketing-automation-readiness.mjs', [
    'DEV_ADMIN_SESSION_PATH',
    'checkRefreshWithoutToken',
    'checkApiContract',
    'allowDegraded',
    '/api/admin/marketing/system-health',
  ]);
  requireIncludes('script:marketing-runtime-local-start-stop', 'scripts/verify-marketing-runtime-local.mjs', [
    'startNextServer',
    'waitForReady',
    'stopProcessTree',
    'verify-marketing-automation-readiness.mjs',
    'MARKETING_RUNTIME_PORT',
    '--strict',
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
    'validatePort',
    'validateMode',
  ]);
  requireIncludes('script:local-release-readiness', 'scripts/verify-local-release-readiness.mjs', [
    'type-check',
    'lint',
    'test',
    'verify:marketing-automation:ci',
    'open:readiness:local:full',
    'check:bundle',
    'parseJsonFromOutput',
    'strictOpenReadiness',
    'reportPath',
    'writeReport',
    'outputPath',
    'tailFile',
    'NEXT_BUILD_RECOVERY_WAIT_MS',
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
      body: '',
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function cookieHeaderFromSetCookie(setCookie) {
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
  { path: '/api/admin/marketing/dashboard', keys: ['data'], allowDegraded: true },
  { path: '/api/admin/marketing/system-health', keys: ['ok', 'score', 'checks'] },
  {
    path: '/api/admin/ad-os/summary',
    keys: ['ok', 'kpis', 'launch_action_queue'],
    allowDegraded: true,
    allowedStatuses: [200, 503],
  },
];

const LIVE_PAGE_PATHS = [
  '/admin/marketing/campaigns',
  '/admin/marketing/creatives',
  '/admin/marketing/system-health',
  '/admin/ad-os',
];

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

  let cookie = providedCookie;
  if (!cookie) {
    const login = await fetchWithTimeout(`${baseUrl}${DEV_ADMIN_SESSION_PATH}`);
    const issuedCookie = cookieHeaderFromSetCookie(login.setCookie);
    const loginOk = login.status === 200 && /ys-dev-admin=/.test(login.setCookie);
    cookie = loginOk ? issuedCookie : '';
    addCheck('live:dev-admin-cookie', loginOk ? 'pass' : 'blocked', {
      statusCode: login.status,
      ms: login.ms,
      path: DEV_ADMIN_SESSION_PATH,
      notes: loginOk ? 'dev admin cookie issued' : 'provide --cookie for non-local or production targets',
    });
  }

  if (!cookie) {
    for (const endpoint of LIVE_API_ENDPOINTS) {
      addCheck(`live:api:${endpoint.path}`, 'blocked', {
        notes: 'admin cookie unavailable; pass --cookie to verify protected marketing API routes',
      });
    }
    for (const pagePath of LIVE_PAGE_PATHS) {
      addCheck(`live:page:${pagePath}`, 'blocked', {
        notes: 'admin cookie unavailable; pass --cookie to verify protected marketing pages',
      });
    }
    return;
  }

  const headers = { Cookie: cookie };

  for (const endpoint of LIVE_API_ENDPOINTS) {
    await checkApiContract(endpoint, headers);
  }

  for (const pagePath of LIVE_PAGE_PATHS) {
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
  await liveChecks();

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
