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

const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(baseUrl);

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
  const started = Date.now();
  const res = await fetch(`${baseUrl}${endpoint.path}`, {
    redirect: 'manual',
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
}

const cookie = await localDevCookie();

if (isLocal) {
  for (const endpoint of endpoints) {
    await fetch(`${baseUrl}${endpoint.path}`, {
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }).catch(() => null);
  }
}

const results = [];

for (const endpoint of endpoints) {
  try {
    results.push(await checkOne(endpoint, cookie));
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

if (failed.length > 0) {
  console.error(`\n[admin-dashboard-contract] ${failed.length}/${results.length} checks failed.`);
  process.exit(1);
}

console.log(`\n[admin-dashboard-contract] ${results.length}/${results.length} checks passed.`);
