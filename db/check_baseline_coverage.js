#!/usr/bin/env node
/**
 * @file db/check_baseline_coverage.js
 * @description visual baseline 커버리지 audit. fixtures.json 항목 중 baseline 파일이
 * 누락된 product 를 식별하고 일괄 생성 명령을 안내.
 *
 * P2 #1 (2026-04-27): 등록 시 dev 서버가 켜져있지 않아 자동 baseline 생성이 거의 항상
 * skip 되는 패턴 보강. 사장님이 가끔 "npm run baseline:catchup" 한 번 돌리면 모든 신규
 * 상품의 baseline 이 한 번에 생성됨.
 *
 * 사용:
 *   node db/check_baseline_coverage.js          # listing only
 *   node db/check_baseline_coverage.js --catchup # dev 서버 ON 상태에서 누락 baseline 일괄 생성
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'tests', 'visual', 'fixtures.json');
const BASELINES_DIR = path.join(ROOT, 'tests', 'visual', 'baselines');
const SNAPSHOTS_DIR = path.join(ROOT, 'tests', 'visual', 'packages.spec.ts-snapshots');

function loadFixtures() {
  try { return JSON.parse(fs.readFileSync(FIXTURES, 'utf8')); }
  catch { return []; }
}

function listFiles(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function checkProductCoverage(product) {
  const baselineFiles = listFiles(BASELINES_DIR);
  const snapshotFiles = listFiles(SNAPSHOTS_DIR);
  const hasTextHash = baselineFiles.some(f => f === `${product}-text.hash`);
  const hasMobileSnapshot = snapshotFiles.some(f => f.startsWith(`${product}-mobile-`));
  return { product, hasTextHash, hasMobileSnapshot, complete: hasTextHash && hasMobileSnapshot };
}

async function devServerAlive() {
  return new Promise(resolve => {
    const http = require('http');
    const req = http.get('http://localhost:3000', { timeout: 2000 }, res => {
      resolve(res.statusCode !== undefined);
      req.destroy();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  const catchup = process.argv.includes('--catchup');
  const fixtures = loadFixtures();
  if (fixtures.length === 0) {
    console.log('ℹ️  tests/visual/fixtures.json 비어 있음. baseline 자동 추가는 신규 등록 시 일어남.');
    return;
  }

  const results = fixtures.map(f => ({ ...f, ...checkProductCoverage(f.product) }));
  const missing = results.filter(r => !r.complete);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  📸 Visual Baseline 커버리지 audit`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  console.log(`총 ${results.length}건 | 완전 ${results.length - missing.length} | 누락 ${missing.length}\n`);

  if (missing.length === 0) {
    console.log('✅ 모든 fixture 의 baseline 이 생성되어 있습니다. 다음 코드 변경 시 자동 회귀 검증 작동.');
    return;
  }

  console.log(`⚠️  baseline 누락 (${missing.length}건):`);
  missing.forEach(m => {
    const flags = [
      m.hasTextHash ? '✓text' : '✗text',
      m.hasMobileSnapshot ? '✓png' : '✗png',
    ].join('/');
    console.log(`  - ${m.product.padEnd(24)} [${flags}]  ${m.title}`);
  });

  if (!catchup) {
    console.log(`\n💡 일괄 생성하려면:`);
    console.log(`   1) 다른 터미널에서 'npm run dev' 로 dev 서버 기동`);
    console.log(`   2) node db/check_baseline_coverage.js --catchup`);
    console.log(`\n   또는 개별 상품 ID 로:`);
    console.log(`   node db/generate_visual_baseline.js <id1> <id2> ...`);
    return;
  }

  // catchup 모드: dev 서버 확인 후 누락 건 일괄 생성
  const alive = await devServerAlive();
  if (!alive) {
    console.log(`\n❌ dev 서버(localhost:3000) 응답 없음. 'npm run dev' 후 재실행 필요.`);
    process.exit(1);
  }

  const ids = missing.map(m => m.id).filter(Boolean);
  if (ids.length === 0) {
    console.log(`\n⚠️  fixtures 에 id 가 없는 항목만 있음. fixtures.json 수동 보강 필요.`);
    process.exit(1);
  }

  const { spawnSync } = require('child_process');
  const visualScript = path.join(__dirname, 'generate_visual_baseline.js');
  console.log(`\n▶ 누락 ${ids.length}건 baseline 일괄 생성 중...`);
  const r = spawnSync('node', [visualScript, ...ids], { stdio: 'inherit', cwd: ROOT });
  process.exit(r.status ?? 0);
}

main().catch(err => {
  console.error('💥', err.message);
  process.exit(1);
});
