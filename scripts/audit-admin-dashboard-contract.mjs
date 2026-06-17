#!/usr/bin/env node

/**
 * Smoke-check the /admin dashboard data contract.
 *
 * Usage:
 *   node scripts/audit-admin-dashboard-contract.mjs
 *   BASE_URL=https://www.yeosonam.com node scripts/audit-admin-dashboard-contract.mjs
 *
 * Local dev automatically enables the non-production ys-dev-admin bypass.
 */

const args = process.argv.slice(2);
function argValue(name, fallback = '') {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}
function hasFlag(name) {
  return args.includes(name);
}

const baseUrl = (argValue('--base', process.env.BASE_URL || 'http://localhost:3000') || '').replace(/\/$/, '');
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl);
const strict = hasFlag('--strict');
const providedCookie = argValue('--cookie', process.env.ADMIN_AUDIT_COOKIE || '');
const timeoutMs = Math.max(1000, Number(argValue('--timeout-ms', process.env.ADMIN_DASHBOARD_AUDIT_TIMEOUT_MS || '10000')) || 10000);
const outputJson = hasFlag('--json');
const requestedHardTimeoutMs = Number(argValue('--hard-timeout-ms', process.env.ADMIN_DASHBOARD_AUDIT_HARD_TIMEOUT_MS || '0')) || 0;
const hardTimeoutMs = requestedHardTimeoutMs > 0
  ? Math.max(timeoutMs + 1000, requestedHardTimeoutMs)
  : Math.min(120000, timeoutMs * 10 + 15000);

const hardTimer = setTimeout(() => {
  console.error(`[admin-dashboard-contract] hard timeout after ${hardTimeoutMs}ms`);
  process.exit(124);
}, hardTimeoutMs);
hardTimer.unref?.();

const endpoints = [
  {
    path: '/api/dashboard',
    keys: ['stats'],
    budgetMs: 2500,
  },
  {
    path: '/api/dashboard/chart?months=6',
    keys: ['data'],
    budgetMs: 2500,
  },
  {
    path: '/api/dashboard/revenue-recognition?months=6',
    keys: ['recognized', 'newBookings', 'pace', 'cancellation_90d'],
    budgetMs: 2500,
  },
  {
    path: '/api/dashboard/operations?mode=dashboard',
    keys: ['aiUsage', 'settlement', 'takeRates', 'repeat', 'dataQuality'],
    budgetMs: 2500,
  },
  {
    path: '/api/capital?summary=1',
    keys: ['entries', 'total'],
    budgetMs: 2500,
  },
  {
    path: '/api/bank-transactions?match_status=unmatched&summary=1',
    keys: ['count', 'transactions'],
    budgetMs: 2500,
  },
  {
    path: '/api/agent-actions?status=pending&limit=6&count=none&fields=compact',
    keys: ['actions', 'total', 'page', 'limit'],
    budgetMs: 2500,
  },
  {
    path: '/api/admin/ai-credits?live_balance=0',
    keys: ['credits', 'updated_at'],
    budgetMs: 3500,
  },
];

async function localDevCookie() {
  if (!isLocal) return '';
  try {
    const res = await fetch(`${baseUrl}/api/debug/dev-admin-login?mode=on`, { redirect: 'manual' });
    return res.headers.get('set-cookie')?.split(';')[0] || '';
  } catch {
    return '';
  }
}

async function checkOne(endpoint, cookie) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}${endpoint.path}`, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    const ms = Date.now() - started;
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // keep null
    }

    const missingKeys = json
      ? endpoint.keys.filter((key) => !(key in json))
      : endpoint.keys;

    return {
      path: endpoint.path,
      status: res.status,
      ok: res.ok,
      ms,
      budgetMs: endpoint.budgetMs,
      overBudget: ms > endpoint.budgetMs,
      missingKeys,
      json: Boolean(json),
      sample: json ? JSON.stringify(json).slice(0, 220) : text.slice(0, 220),
    };
  } finally {
    clearTimeout(timer);
  }
}

const cookie = await localDevCookie();
const authCookie = providedCookie || cookie;

if (!authCookie) {
  const authHelp = isLocal
    ? 'auth-required: pass --cookie or ADMIN_AUDIT_COOKIE, or run a dev server with the dev admin bypass enabled'
    : 'auth-required: pass --cookie or ADMIN_AUDIT_COOKIE to verify production admin API JSON contracts';
  const blockedResults = endpoints.map((endpoint) => ({
    path: endpoint.path,
    status: null,
    ok: false,
    ms: null,
    budgetMs: endpoint.budgetMs,
    overBudget: false,
    missingKeys: endpoint.keys,
    json: false,
    blocked: true,
    sample: authHelp,
  }));
  const blockedPayload = {
    summary: {
      baseUrl,
      total: blockedResults.length,
      passed: 0,
      failed: 0,
      blocked: blockedResults.length,
      score: 0,
      timeoutMs,
      devCookieIssued: false,
      status: 'blocked',
    },
    results: blockedResults,
  };

  if (outputJson) {
    console.log(JSON.stringify(blockedPayload, null, 2));
  } else {
    for (const endpoint of endpoints) {
      console.log(`BLOCKED  ${endpoint.path}  ${authHelp}`);
    }
    console.log(`\n[admin-dashboard-contract] blocked: admin APIs require an authenticated cookie.`);
  }
  process.exit(strict ? 2 : 0);
}

if (isLocal) {
  for (const endpoint of endpoints) {
    await fetch(`${baseUrl}${endpoint.path}`, {
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        ...(authCookie ? { Cookie: authCookie } : {}),
      },
    }).catch(() => null);
  }
}

const results = [];

for (const endpoint of endpoints) {
  try {
    results.push(await checkOne(endpoint, authCookie));
  } catch (err) {
    results.push({
      path: endpoint.path,
      status: null,
      ok: false,
      ms: null,
      budgetMs: endpoint.budgetMs,
      overBudget: true,
      missingKeys: endpoint.keys,
      json: false,
      sample: err instanceof Error ? err.message : String(err),
    });
  }
}

if (cookie) {
  await fetch(`${baseUrl}/api/debug/dev-admin-login?mode=off`, { headers: { Cookie: cookie } }).catch(() => {});
}

const failed = results.filter((r) => !r.ok || !r.json || r.missingKeys.length > 0 || r.overBudget);
const payload = {
  summary: {
    baseUrl,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    score: results.length === 0 ? 0 : Math.round(((results.length - failed.length) / results.length) * 100),
    timeoutMs,
    devCookieIssued: Boolean(cookie),
  },
  results,
};

if (outputJson) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  for (const r of results) {
    const mark = failed.includes(r) ? 'FAIL' : 'PASS';
    const bits = [
      `${mark}`,
      r.path,
      `status=${r.status}`,
      `ms=${r.ms}`,
      `budget=${r.budgetMs}`,
    ];
    if (r.missingKeys.length > 0) bits.push(`missing=${r.missingKeys.join(',')}`);
    if (r.overBudget) bits.push('over-budget');
    console.log(bits.join('  '));
  }
}

if (failed.length > 0) {
  if (!outputJson) console.error(`\n[admin-dashboard-contract] ${failed.length}/${results.length} checks failed.`);
  process.exit(1);
}

if (!outputJson) console.log(`\n[admin-dashboard-contract] ${results.length}/${results.length} checks passed.`);
