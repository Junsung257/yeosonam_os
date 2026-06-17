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

const LIVE_API_ENDPOINTS = [
  '/api/meta/campaigns',
  '/api/meta/creatives',
  '/api/meta/performance',
  '/api/campaigns/creatives?limit=10',
  '/api/admin/marketing/dashboard',
  '/api/admin/ad-os/summary',
];

const LIVE_PAGE_PATHS = [
  '/admin/marketing/campaigns',
  '/admin/marketing/creatives',
  '/admin/marketing/system-health',
  '/admin/ad-os',
];

async function liveChecks() {
  if (!baseUrl) return;

  let cookie = providedCookie;
  if (!cookie) {
    const login = await fetchWithTimeout(`${baseUrl}/api/debug/dev-admin-login`);
    cookie = cookieHeaderFromSetCookie(login.setCookie);
    const loginOk = login.status === 200 && /ys-dev-admin=/.test(login.setCookie);
    addCheck('live:dev-admin-cookie', loginOk ? 'pass' : 'blocked', {
      statusCode: login.status,
      ms: login.ms,
      notes: loginOk ? 'dev admin cookie issued' : 'provide --cookie for non-local or production targets',
    });
  }

  if (!cookie) {
    for (const endpoint of LIVE_API_ENDPOINTS) {
      addCheck(`live:api:${endpoint}`, 'blocked', {
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

  const headers = cookie ? { Cookie: cookie } : {};

  for (const endpoint of LIVE_API_ENDPOINTS) {
    const res = await fetchWithTimeout(`${baseUrl}${endpoint}`, { headers });
    let parsed = null;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      /* checked below */
    }
    const jsonOk = res.status === 200 && res.contentType.includes('application/json') && parsed && typeof parsed === 'object';
    const authHtml = res.contentType.includes('text/html') && /로그인|여행사 관리 시스템/.test(res.body);
    addCheck(`live:api:${endpoint}`, jsonOk ? 'pass' : 'fail', {
      statusCode: res.status,
      contentType: res.contentType,
      ms: res.ms,
      degraded: Boolean(parsed?.degraded || parsed?.access_state === 'supabase_unconfigured' || parsed?.reason === 'supabase_unconfigured'),
      error: jsonOk ? '' : authHtml ? 'received login HTML instead of JSON' : (res.error || res.body.slice(0, 300)),
    });
  }

  for (const pagePath of LIVE_PAGE_PATHS) {
    const res = await fetchWithTimeout(`${baseUrl}${pagePath}`, { headers });
    const ok =
      res.status === 200 &&
      res.contentType.includes('text/html') &&
      !/Application error|Internal Server Error|Unhandled Runtime Error/.test(res.body) &&
      !/여행사 관리 시스템/.test(res.body);
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
