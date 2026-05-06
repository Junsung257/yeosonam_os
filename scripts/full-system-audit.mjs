import fs from 'node:fs/promises';

const BASE = 'http://localhost:3000';
const TIMEOUT_MS = 20000;
const CONCURRENCY = 4;

const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/products',
  '/destinations',
  '/things-to-do',
  '/blog',
  '/concierge',
  '/group',
  '/group-inquiry',
  '/free-travel',
  '/packages',
  '/partner',
  '/partner-apply',
  '/passport-assist',
  '/auth/reset-password',
  '/auth/callback',
  '/legal/partner-attribution',
];

function p95(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx];
}

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

async function timedFetch(path, headers = undefined) {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(`${BASE}${path}`, headers ? { headers } : {});
    const text = await res.text();
    return {
      path,
      status: res.status,
      timeMs: Date.now() - started,
      location: res.headers.get('location') || '',
      hasNotFound: text.includes('This page could not be found'),
      hasApplicationError:
        text.includes('Application error') ||
        text.includes('Cannot find module') ||
        text.includes('Hydration failed'),
    };
  } catch (error) {
    return {
      path,
      status: 'ERR',
      timeMs: Date.now() - started,
      location: String(error?.message || error),
      hasNotFound: false,
      hasApplicationError: true,
    };
  }
}

async function mapWithConcurrency(items, worker, concurrency = CONCURRENCY) {
  const out = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return out;
}

function extractLinksByPrefix(html, prefix, max = 10) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`href=["'](${escaped}[^"']+)["']`, 'g');
  const set = new Set();
  let m;
  while ((m = re.exec(html)) !== null && set.size < max) set.add(m[1]);
  return [...set];
}

async function main() {
  const routesRaw = await fs.readFile('tmp-static-routes.json', 'utf8');
  const staticRoutes = JSON.parse(routesRaw);
  const adminRoutes = staticRoutes.filter((r) => r.startsWith('/admin') || r.startsWith('/m/admin'));

  // dev bypass cookie
  const loginRes = await fetchWithTimeout(`${BASE}/api/debug/dev-admin-login`);
  const setCookie = loginRes.headers.get('set-cookie') || '';
  const bypassCookie = setCookie.split(';')[0];
  const bypassHeaders = bypassCookie ? { cookie: bypassCookie } : undefined;

  // 1) Frontend static routes (no auth)
  const staticNoAuth = await mapWithConcurrency(staticRoutes, (path) => timedFetch(path));

  // 2) Admin routes with bypass cookie
  const adminBypass = await mapWithConcurrency(adminRoutes, (path) => timedFetch(path, bypassHeaders));

  // 3) Dynamic samples
  let packageIds = [];
  try {
    const pkgRes = await fetchWithTimeout(`${BASE}/api/packages`);
    const pkgData = await pkgRes.json();
    const list = pkgData?.data || pkgData || [];
    packageIds = list.map((x) => x?.id).filter(Boolean).slice(0, 12);
  } catch {
    packageIds = [];
  }
  const dynamicPackageRoutes = packageIds.map((id) => `/packages/${id}`);

  const ttdHtml = await fetchWithTimeout(`${BASE}/things-to-do`).then((r) => r.text()).catch(() => '');
  const dynamicTtdRoutes = extractLinksByPrefix(ttdHtml, '/things-to-do/', 12);

  const destHtml = await fetchWithTimeout(`${BASE}/destinations`).then((r) => r.text()).catch(() => '');
  const dynamicDestinationRoutes = extractLinksByPrefix(destHtml, '/destinations/', 12);

  const dynamicRoutes = [...new Set([...dynamicPackageRoutes, ...dynamicTtdRoutes, ...dynamicDestinationRoutes])];
  const dynamicChecks = await mapWithConcurrency(dynamicRoutes, (path) => timedFetch(path, bypassHeaders));

  // 4) Public speed pass (warm)
  const publicChecks = await mapWithConcurrency(PUBLIC_ROUTES, (path) => timedFetch(path));

  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      staticRoutes: staticRoutes.length,
      adminRoutes: adminRoutes.length,
      dynamicSampleRoutes: dynamicRoutes.length,
      publicRoutes: PUBLIC_ROUTES.length,
    },
    staticNoAuth,
    adminBypass,
    dynamicChecks,
    publicChecks,
  };

  await fs.writeFile('tmp-full-system-audit.json', JSON.stringify(report, null, 2), 'utf8');

  const staticErrors = staticNoAuth.filter(
    (x) => x.status === 'ERR' || (typeof x.status === 'number' && x.status >= 500),
  );
  const adminErrors = adminBypass.filter((x) => x.status !== 200);
  const dynamicErrors = dynamicChecks.filter(
    (x) => x.status === 'ERR' || (typeof x.status === 'number' && x.status >= 500),
  );
  const public200 = publicChecks.filter((x) => x.status === 200);
  const publicTimes = public200.map((x) => x.timeMs);
  const slowPublic = [...public200].sort((a, b) => b.timeMs - a.timeMs).slice(0, 10);

  console.log('=== Full System Audit ===');
  console.log('static errors:', staticErrors.length);
  console.log('admin non-200 with bypass:', adminErrors.length);
  console.log('dynamic sample errors:', dynamicErrors.length);
  console.log(
    'public speed:',
    `avg=${Math.round(publicTimes.reduce((s, v) => s + v, 0) / Math.max(publicTimes.length, 1))}ms`,
    `p95=${p95(publicTimes)}ms`,
    `max=${publicTimes.length ? Math.max(...publicTimes) : 0}ms`,
  );
  for (const s of slowPublic) {
    console.log('SLOW', `${s.timeMs}ms`, s.path, s.status);
  }
  for (const e of [...staticErrors, ...dynamicErrors].slice(0, 20)) {
    console.log('ERROR', e.path, e.status, e.location);
  }
  for (const e of adminErrors.slice(0, 20)) {
    console.log('ADMIN_NON_200', e.path, e.status, e.location);
  }
}

await main();
