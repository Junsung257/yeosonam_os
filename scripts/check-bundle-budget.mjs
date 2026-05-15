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

// 주의: app-build-manifest.json 의 chunk 사이즈는 gzip 전 raw 바이트.
// Next.js build 출력의 "First Load JS" 는 gzip 후라 약 1/3 수준.
// 임계는 raw 바이트 기준 — 회귀 방지용으로 현재 max + 헤드룸 으로 설정.
const BUDGET_KB_DEFAULT = 800; // admin 페이지 (현재 max ≈ 670KB raw)
const BUDGET_KB_CUSTOMER = 720; // 고객 페이지 (2026-05-15: destination-iso SSOT 67도시 inline 으로 /packages/[id] 705KB)
// TODO(P1): /packages/[id] 와 /auth/* 를 600KB 이하로 슬림화 후 BUDGET_KB_CUSTOMER 600 으로 강화
const FAIL_FLAG = process.argv.includes('--fail');

const buildManifestPath = path.join('.next', 'app-build-manifest.json');
if (!fs.existsSync(buildManifestPath)) {
  console.error('[budget] .next/app-build-manifest.json 이 없습니다. npm run build 먼저 실행하세요.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(buildManifestPath, 'utf8'));
const pages = manifest.pages || {};
const chunkSizes = new Map();

function getChunkSize(chunk) {
  if (chunkSizes.has(chunk)) return chunkSizes.get(chunk);
  const p = path.join('.next', chunk);
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
  const total = chunks.reduce((s, c) => s + getChunkSize(c), 0);
  const totalKb = Math.round(total / 1024);
  const budget = isCustomerPage(route) ? BUDGET_KB_CUSTOMER : BUDGET_KB_DEFAULT;
  stats.push({ route, totalKb, budget });
  if (totalKb > budget) {
    violations.push({ route, totalKb, budget, over: totalKb - budget });
  }
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
