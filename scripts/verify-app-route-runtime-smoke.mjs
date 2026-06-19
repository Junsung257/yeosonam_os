#!/usr/bin/env node

import { existsSync } from 'node:fs';
import {
  startNextServer,
  stopProcessTree,
  validateMode,
  validatePort,
  waitForReady,
} from './lib/local-next-server.mjs';

const rawArgs = process.argv.slice(2);

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = rawArgs.findLast((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = rawArgs.lastIndexOf(name);
  return index >= 0 ? rawArgs[index + 1] ?? fallback : fallback;
}

function hasFlag(name) {
  return rawArgs.includes(name);
}

const jsonOutput = hasFlag('--json');
const selfTest = hasFlag('--self-test');
const port = Number(argValue('--port', process.env.APP_ROUTE_RUNTIME_PORT || '3052'));
const mode = argValue('--mode', process.env.APP_ROUTE_RUNTIME_MODE || 'dev');
const explicitBase = argValue('--base', process.env.APP_ROUTE_RUNTIME_BASE_URL || '').replace(/\/$/, '');
const baseUrl = explicitBase || `http://127.0.0.1:${port}`;
const shouldStartServer = !explicitBase && !selfTest;
const timeoutMs = Number(argValue('--timeout-ms', process.env.APP_ROUTE_RUNTIME_TIMEOUT_MS || '30000'));
const readyTimeoutMs = Number(argValue('--ready-timeout-ms', process.env.APP_ROUTE_RUNTIME_READY_TIMEOUT_MS || '120000'));
const keepServer = hasFlag('--keep-server');
const probeAttempts = Math.max(1, Number(argValue('--attempts', process.env.APP_ROUTE_RUNTIME_ATTEMPTS || '2')));
const probeRetryDelayMs = Math.max(0, Number(argValue('--retry-delay-ms', process.env.APP_ROUTE_RUNTIME_RETRY_DELAY_MS || '1000')));
const allowMissingDevAdmin =
  hasFlag('--allow-missing-dev-admin') || process.env.APP_ROUTE_RUNTIME_ALLOW_MISSING_DEV_ADMIN === '1';
const runtimeDistDir = process.env.NEXT_DIST_DIR || '.next';

validatePort(port, 'app-route-runtime');
validateMode(mode, 'app-route-runtime');

const pageProbes = [
  { id: 'public:disclaimer', path: '/disclaimer', statuses: [200], auth: false },
  { id: 'redirect:lp-index', path: '/lp', statuses: [200, 307, 308], auth: true },
  { id: 'redirect:admin-products', path: '/admin/products', statuses: [200, 307, 308], auth: true },
  { id: 'redirect:search-ads-keywords', path: '/admin/search-ads/keywords', statuses: [200, 307, 308], auth: true },
  { id: 'redirect:search-ads-reports', path: '/admin/search-ads/reports', statuses: [200, 307, 308], auth: true },
  { id: 'redirect:mypage-notifications', path: '/mypage/notifications', statuses: [200, 307, 308], auth: true },
  { id: 'redirect:mypage-settings', path: '/mypage/settings', statuses: [200, 307, 308], auth: true },
  { id: 'redirect:voucher-detail', path: '/voucher/runtime-smoke', statuses: [200, 307, 308], auth: true },
  { id: 'redirect:admin-faq', path: '/admin/faq', statuses: [200, 307, 308], auth: true },
];

const apiProbes = [
  {
    id: 'api:admin-packages-alias',
    path: '/api/admin/packages?limit=1',
    method: 'GET',
    statuses: [200],
    auth: true,
    expectJson: true,
  },
  {
    id: 'api:tracking-engagement',
    path: '/api/tracking',
    method: 'POST',
    statuses: [200, 202],
    auth: false,
    expectJson: true,
    body: {
      type: 'engagement',
      session_id: 'runtime-smoke',
      event_type: 'package_card_clicked',
      page_url: '/packages',
      package_id: 'runtime-smoke',
    },
  },
];

function reportAndExit(report) {
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const check of report.checks) {
      const suffix = check.statusCode ? ` status=${check.statusCode}` : check.reason ? ` ${check.reason}` : '';
      console.log(`${check.status.toUpperCase()} ${check.id}${suffix}`);
    }
    console.log(`[app-route-runtime] ${report.status}: ${report.passed} passed, ${report.blocked} blocked, ${report.failed} failed`);
  }
  process.exitCode = report.failed > 0 ? 1 : 0;
}

function setCookieHeader(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie().join(', ');
  }
  return headers.get('set-cookie') || '';
}

function cookiePairsFromSetCookie(raw) {
  return String(raw || '')
    .match(/(?:^|, )([^=;,]+=[^;,]+)/g)
    ?.map((value) => value.replace(/^, /, ''))
    .filter((value) => /^(ys_session_id|ys-dev-admin)=/.test(value))
    .join('; ') || '';
}

async function fetchWithTimeout(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${path}`, {
      redirect: 'manual',
      signal: controller.signal,
      ...options,
      headers: {
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function retryableMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

function shouldRetryError(err) {
  return /aborted|fetch failed|terminated|ECONNRESET|ECONNREFUSED|UND_ERR/i.test(retryableMessage(err));
}

async function sleep(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchProbe(path, options = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= probeAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(path, options);
      return { response, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt >= probeAttempts || !shouldRetryError(err)) break;
      await sleep(probeRetryDelayMs);
    }
  }
  throw lastErr;
}

async function devAdminCookie() {
  try {
    const { response: res } = await fetchProbe('/api/dev/admin-session');
    const cookie = cookiePairsFromSetCookie(setCookieHeader(res.headers));
    return {
      status: res.status,
      cookie,
      ok: res.status === 200 && cookie.includes('ys-dev-admin=1'),
    };
  } catch (err) {
    return {
      status: 0,
      cookie: '',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runProbe(probe, cookie) {
  if (probe.auth && !cookie) {
    return {
      id: probe.id,
      path: probe.path,
      status: allowMissingDevAdmin ? 'pass' : 'blocked',
      reason: allowMissingDevAdmin ? 'auth probe skipped without dev-admin cookie' : 'missing dev-admin cookie',
    };
  }

  try {
    const headers = {
      ...(probe.auth && cookie ? { cookie } : {}),
      ...(probe.body ? { 'content-type': 'application/json' } : {}),
    };
    const { response: res, attempts } = await fetchProbe(probe.path, {
      method: probe.method || 'GET',
      headers,
      body: probe.body ? JSON.stringify(probe.body) : undefined,
    });
    const contentType = res.headers.get('content-type') || '';
    const statusOk = probe.statuses.includes(res.status);
    const jsonOk = !probe.expectJson || contentType.includes('application/json');
    return {
      id: probe.id,
      path: probe.path,
      status: statusOk && jsonOk ? 'pass' : 'fail',
      statusCode: res.status,
      location: res.headers.get('location') || undefined,
      contentType,
      attempts,
      reason: statusOk ? (jsonOk ? undefined : 'expected json response') : `unexpected status ${res.status}`,
    };
  } catch (err) {
    return {
      id: probe.id,
      path: probe.path,
      status: 'fail',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

if (selfTest) {
  reportAndExit({
    status: 'pass',
    passed: 1,
    blocked: 0,
    failed: 0,
    checks: [{
      id: 'self-test:probe-manifest',
      status: 'pass',
      pages: pageProbes.length,
      apis: apiProbes.length,
    }],
  });
  process.exit(process.exitCode ?? 0);
} else if (shouldStartServer && mode === 'start' && !existsSync(`${runtimeDistDir}/BUILD_ID`)) {
  console.error(`[app-route-runtime] start mode requires a production build in ${runtimeDistDir}. Run npm run build first.`);
  process.exit(1);
}

let server = null;

try {
  if (shouldStartServer) {
    server = startNextServer({
      port,
      mode,
      label: 'app-route-runtime',
      logPrefix: 'app-route-runtime',
    });
    console.error(`[app-route-runtime] starting ${mode} server on ${baseUrl}`);
    console.error(`[app-route-runtime] logs: ${server.outLog}`);
    await waitForReady({ baseUrl, readyTimeoutMs });
  } else {
    console.error(`[app-route-runtime] using existing server at ${baseUrl}`);
  }

  const login = await devAdminCookie();
  const checks = [{
    id: 'auth:dev-admin-cookie',
    status: login.ok || allowMissingDevAdmin ? 'pass' : 'blocked',
    statusCode: login.status || undefined,
    reason: login.ok ? undefined : login.error || 'dev-admin cookie was not issued',
  }];

  for (const probe of [...pageProbes, ...apiProbes]) {
    checks.push(await runProbe(probe, login.ok ? login.cookie : ''));
  }

  const failed = checks.filter((check) => check.status === 'fail').length;
  const blocked = checks.filter((check) => check.status === 'blocked').length;
  const passed = checks.filter((check) => check.status === 'pass').length;
  reportAndExit({
    status: failed > 0 ? 'fail' : blocked > 0 ? 'blocked' : 'pass',
    baseUrl,
    passed,
    blocked,
    failed,
    checks,
  });
} catch (err) {
  reportAndExit({
    status: 'fail',
    baseUrl,
    passed: 0,
    blocked: 0,
    failed: 1,
    checks: [{
      id: 'runtime',
      status: 'fail',
      reason: err instanceof Error ? err.message : String(err),
    }],
  });
} finally {
  if (server) stopProcessTree(server, { keepServer });
}
