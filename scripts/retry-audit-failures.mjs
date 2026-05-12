import fs from 'node:fs/promises';

const BASE = 'http://localhost:3000';
const TIMEOUT_MS = 90000;

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

async function timed(path, headers) {
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(`${BASE}${path}`, headers ? { headers } : {});
    await res.text();
    return { path, status: res.status, timeMs: Date.now() - started, location: res.headers.get('location') || '' };
  } catch (error) {
    return { path, status: 'ERR', timeMs: Date.now() - started, location: String(error?.message || error) };
  }
}

const raw = await fs.readFile('tmp-full-system-audit.json', 'utf8');
const report = JSON.parse(raw);

const failedPaths = new Set();
for (const row of report.dynamicChecks || []) {
  if (row.status === 'ERR' || (typeof row.status === 'number' && row.status >= 500)) failedPaths.add(row.path);
}
for (const row of report.adminBypass || []) {
  if (row.status === 'ERR' || row.status !== 200) failedPaths.add(row.path);
}

const login = await fetchWithTimeout(`${BASE}/api/debug/dev-admin-login`);
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const headers = cookie ? { cookie } : undefined;

const out = [];
for (const path of failedPaths) {
  const isAdmin = path.startsWith('/admin') || path.startsWith('/m/admin');
  out.push(await timed(path, isAdmin ? headers : undefined));
  console.log('checked', path);
}

await fs.writeFile('tmp-retry-audit-failures.json', JSON.stringify(out, null, 2), 'utf8');

const stillBad = out.filter((r) => r.status === 'ERR' || (typeof r.status === 'number' && r.status >= 500));
const adminStillNot200 = out.filter(
  (r) => (r.path.startsWith('/admin') || r.path.startsWith('/m/admin')) && r.status !== 200,
);
console.log('retried', out.length, 'stillBad', stillBad.length, 'adminStillNot200', adminStillNot200.length);
for (const r of stillBad.slice(0, 20)) {
  console.log('STILL_BAD', r.path, r.status, r.location);
}
for (const r of adminStillNot200.slice(0, 20)) {
  console.log('ADMIN_NOT_200', r.path, r.status, r.location);
}
