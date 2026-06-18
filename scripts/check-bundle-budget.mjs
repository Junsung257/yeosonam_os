#!/usr/bin/env node
/**
 * @file check-bundle-budget.mjs
 * @description Next.js build 후 First Load JS 가 페이지별 임계를 넘었는지 검사.
 *
 * 사용:
 *   npm run build && node scripts/check-bundle-budget.mjs
 *
 * CI:
 *   npm run build && node scripts/check-bundle-budget.mjs --fail
 *
 * 임계는 page-loads.json 우선, 없으면 BUDGET_KB_DEFAULT.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// 주의: app-build-manifest.json 의 chunk 사이즈는 gzip 전 raw 바이트.
// Next.js build 출력의 "First Load JS" 는 gzip 후라 약 1/3 수준.
// 임계는 raw 바이트 기준 — 회귀 방지용으로 현재 max + 헤드룸 으로 설정.
const BUDGET_KB_DEFAULT = 800; // admin 페이지 (현재 max ≈ 670KB raw)
const BUDGET_KB_CUSTOMER = 720; // 고객 페이지 (2026-05-15: destination-iso SSOT 67도시 inline 으로 /packages/[id] 705KB)
// TODO(P1): /packages/[id] 와 /auth/* 를 600KB 이하로 슬림화 후 BUDGET_KB_CUSTOMER 600 으로 강화
const ROUTE_BUDGET_OVERRIDES = new Map([
  // Current operational pages with intentionally larger payloads. Keep explicit
  // so future growth is still visible instead of relaxing every route.
  ['/admin/search-ads/page', 1150],
  ['/packages/[id]/page', 850],
]);
const FAIL_FLAG = process.argv.includes('--fail');
const MIN_ROUTE_COUNT = Number(process.env.BUNDLE_BUDGET_MIN_ROUTES || 100);

const distDir = process.env.NEXT_DIST_DIR || '.next';
const root = process.cwd();
const buildManifestPath = path.join(distDir, 'app-build-manifest.json');

function activeNextDevServerProcesses() {
  if (
    process.env.NEXT_BUILD_ALLOW_ACTIVE_DEV_SERVER === '1'
    || process.env.BUNDLE_BUDGET_ALLOW_ACTIVE_DEV_SERVER === '1'
  ) {
    return [];
  }

  if (process.platform === 'win32') {
    const escapedRoot = root.replace(/'/g, "''");
    const script = [
      'Get-CimInstance Win32_Process',
      `Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -like '*${escapedRoot}*' -and $_.CommandLine -notlike '*Get-CimInstance Win32_Process*' -and ($_.CommandLine -like '*npm*run*dev*' -or $_.CommandLine -like '*Start-Process*npm.cmd*run*dev*' -or $_.CommandLine -like '*next* dev*' -or $_.CommandLine -like '*next/dist/bin/next*dev*' -or $_.CommandLine -like '*next\\\\dist\\\\bin\\\\next*dev*' -or $_.CommandLine -like '*next\\\\dist\\\\server\\\\lib\\\\start-server.js*' -or $_.CommandLine -like '*start-server.js*') }`,
      'Select-Object -First 5 -ExpandProperty ProcessId',
    ].join(' | ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  }

  const result = spawnSync('ps', ['-eo', 'pid=,args='], {
    encoding: 'utf8',
  });
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(root) && (/\bnpm\b.*\brun\b.*\bdev\b/.test(line) || /\bnext\b.*\bdev\b/.test(line) || line.includes('start-server.js')))
    .map((line) => Number(line.split(/\s+/, 1)[0]))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
    .slice(0, 5);
}

function assertNoActiveNextDevServer() {
  const pids = activeNextDevServerProcesses();
  if (pids.length === 0) return;
  console.error(
    `[budget] Refusing to check bundle budget while next dev is active in this workspace (pid${pids.length > 1 ? 's' : ''} ${pids.join(', ')}). `
    + 'Stop the dev server first so it cannot rewrite .next during bundle verification.',
  );
  process.exit(1);
}

assertNoActiveNextDevServer();
if (!fs.existsSync(buildManifestPath)) {
  console.error('[budget] .next/app-build-manifest.json 이 없습니다. npm run build 먼저 실행하세요.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(buildManifestPath, 'utf8'));
const pages = manifest.pages || {};
const chunkSizes = new Map();

function getChunkSize(chunk) {
  if (chunkSizes.has(chunk)) return chunkSizes.get(chunk);
  const p = path.join(distDir, chunk);
  let size = 0;
  try { size = fs.statSync(p).size; } catch { size = 0; }
  chunkSizes.set(chunk, size);
  return size;
}

function isCustomerPage(route) {
  if (route.startsWith('/api/')) return false;
  if (route.startsWith('/admin') || route.startsWith('/m/admin')) return false;
  return true;
}

const violations = [];
const stats = [];

for (const [route, chunks] of Object.entries(pages)) {
  if (route.startsWith('/_')) continue;
  if (route.startsWith('/api/')) continue;
  const total = chunks.reduce((s, c) => s + getChunkSize(c), 0);
  const totalKb = Math.round(total / 1024);
  const budget = ROUTE_BUDGET_OVERRIDES.get(route) ?? (isCustomerPage(route) ? BUDGET_KB_CUSTOMER : BUDGET_KB_DEFAULT);
  stats.push({ route, totalKb, budget });
  if (totalKb > budget) {
    violations.push({ route, totalKb, budget, over: totalKb - budget });
  }
}

if (Number.isFinite(MIN_ROUTE_COUNT) && stats.length < MIN_ROUTE_COUNT) {
  console.error(
    `[budget] only ${stats.length} non-API route(s) found in app-build-manifest.json; `
    + `expected at least ${MIN_ROUTE_COUNT}. Re-run npm run build and make sure no next dev server is rewriting .next.`,
  );
  process.exit(1);
}

stats.sort((a, b) => b.totalKb - a.totalKb);
console.log('Top 15 routes by First Load JS:');
console.log('  KB   | budget | route');
console.log('  -----|--------|------');
stats.slice(0, 15).forEach((s) => {
  const mark = s.totalKb > s.budget ? ' ⚠️ ' : '   ';
  console.log(`  ${String(s.totalKb).padStart(4)} |  ${String(s.budget).padStart(4)} |${mark}${s.route}`);
});

if (violations.length === 0) {
  console.log(`\n✅ All ${stats.length} routes under budget (customer ${BUDGET_KB_CUSTOMER}KB / admin ${BUDGET_KB_DEFAULT}KB).`);
  process.exit(0);
}

console.log(`\n⚠️  ${violations.length} route(s) over budget:`);
violations.forEach((v) => {
  console.log(`  ${v.route}: ${v.totalKb}KB (budget ${v.budget}KB, +${v.over}KB)`);
});

if (FAIL_FLAG) {
  console.error('\n[budget] --fail 모드 — exit 1');
  process.exit(1);
}
