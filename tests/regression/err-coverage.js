#!/usr/bin/env node
/**
 * @file tests/regression/err-coverage.js
 * @description error registry docs ↔ tests/regression/cases/ 커버리지 리포트 (P3 #4)
 *
 * 목적:
 *   - db/error-registry.md 및 docs/errors/*.md 의 모든 ERR 항목을 추출
 *   - tests/regression/cases/ 의 회귀 fixture 와 매칭
 *   - "어느 ERR 가 회귀 보호 받고 있는지" / "어느 ERR 가 다음 변환 후보인지" 가시화
 *
 * 사용:
 *   node tests/regression/err-coverage.js              # 한 화면 리포트
 *   node tests/regression/err-coverage.js --uncovered  # 미커버 ERR 만 (다음 후보)
 *   node tests/regression/err-coverage.js --json       # 머신 가독 JSON
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ERR_REGISTRY_FILES = [
  path.join(ROOT, 'db', 'error-registry.md'),
  path.join(ROOT, 'docs', 'errors', 'product-registration.md'),
  path.join(ROOT, 'docs', 'errors', 'blog.md'),
  path.join(ROOT, 'docs', 'errors', 'affiliate.md'),
  path.join(ROOT, 'docs', 'errors', 'settlement.md'),
  path.join(ROOT, 'docs', 'errors', 'ai-ops.md'),
  path.join(ROOT, 'docs', 'errors', 'common.md'),
];
const CASES_DIR = path.join(ROOT, 'tests', 'regression', 'cases');

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    uncovered: args.includes('--uncovered'),
    json: args.includes('--json'),
  };
}

function normalizeCode(code) {
  return code.split('@')[0].replace(/[):：,.;]+$/, '');
}

function pushErr(out, seen, code, category, body, source) {
  if (!code || code === 'ERR-YYYYMMDD-NN') return;
  const fullCode = code.replace(/[):：,.;]+$/, '');
  const normalized = normalizeCode(fullCode);
  if (seen.has(normalized)) return;
  seen.add(normalized);
  out.push({
    code: normalized,
    fullCode,
    date: fullCode.includes('@') ? fullCode.split('@')[1] : null,
    category: category ? category.trim() : '',
    body: body.slice(0, 120) + (body.length > 120 ? '...' : ''),
    source,
  });
}

// ERR 항목 파싱: heading 또는 "- [ ] **ERR-XXX@YYYY-MM-DD** (카테고리): ..."
function parseRegistryFile(file) {
  const out = [];
  const seen = new Set();
  const text = fs.readFileSync(file, 'utf-8');
  const lines = text.split(/\r?\n/);
  const headingRe = /^#{2,3}\s+(ERR-[A-Za-z0-9_-]+(?:@[\d-]+)?)(?:[:：]\s*)?(.*)$/;
  const checklistRe = /^-\s*\[\s*[ x]?\s*\]\s*\*\*(ERR-[A-Za-z0-9_-]+(?:@[\d-]+)?)\*\*\s*(?:\(([^)]+)\))?\s*[:：]?\s*(.*)$/;
  for (const line of lines) {
    const heading = line.match(headingRe);
    if (heading) {
      pushErr(out, seen, heading[1], '', heading[2] || '', path.relative(ROOT, file));
      continue;
    }
    const checklist = line.match(checklistRe);
    if (checklist) {
      pushErr(out, seen, checklist[1], checklist[2] || '', checklist[3] || '', path.relative(ROOT, file));
    }
  }
  return out;
}

function parseRegistry() {
  const all = [];
  const seen = new Set();
  for (const file of ERR_REGISTRY_FILES) {
    if (!fs.existsSync(file)) continue;
    for (const err of parseRegistryFile(file)) {
      if (seen.has(err.code)) continue;
      seen.add(err.code);
      all.push(err);
    }
  }
  return all;
}

// fixture 파일에서 @case 헤더 추출
function parseFixtures(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js'));
  const out = [];
  for (const f of files) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf-8');
    const m = txt.match(/@case\s+([A-Z][A-Za-z0-9_-]+(?:@[\d-]+)?)/);
    const tests = (txt.match(/^test\(/gm) || []).length;
    out.push({
      file: f,
      caseCode: m ? m[1].split('@')[0] : f.replace(/\.test\.js$/, ''),
      tests,
    });
  }
  return out;
}

function categorize(category) {
  const c = (category || '').toLowerCase();
  if (c.includes('ux')) return 'UX';
  if (c.includes('구조')) return '구조적';
  if (c.includes('데이터') || c.includes('파싱')) return '데이터/파싱';
  if (c.includes('렌더') || c.includes('crc')) return '렌더';
  return '기타';
}

function isFixtureCandidate(err) {
  // UX, 구조적, 데이터/파싱 카테고리는 fixture 변환 적합도 높음
  // (AI 환각·축약 같은 ai 카테고리는 fixture 화 어려움)
  const cat = categorize(err.category);
  if (cat === 'UX' || cat === '구조적' || cat === '데이터/파싱') return true;
  return false;
}

function main() {
  const args = parseArgs();
  const errs = parseRegistry();
  const fixtures = parseFixtures(CASES_DIR);
  const fixtureCodes = new Set(fixtures.map(f => f.caseCode));

  const covered = errs.filter(e => fixtureCodes.has(e.code));
  const uncovered = errs.filter(e => !fixtureCodes.has(e.code));
  const candidates = uncovered.filter(isFixtureCandidate);

  if (args.json) {
    console.log(JSON.stringify({
      summary: {
        total_errs: errs.length,
        total_fixtures: fixtures.length,
        covered: covered.length,
        uncovered: uncovered.length,
        candidates_for_next: candidates.length,
        coverage_pct: errs.length > 0 ? Math.round((covered.length / errs.length) * 100) : 0,
      },
      covered: covered.map(e => ({ code: e.code, category: e.category })),
      uncovered: uncovered.map(e => ({ code: e.code, category: e.category, body: e.body })),
      candidates,
    }, null, 2));
    return;
  }

  if (args.uncovered) {
    console.log(`다음 회귀 fixture 변환 후보 (${candidates.length}건):\n`);
    for (const e of candidates.slice(0, 30)) {
      console.log(`  ❑ ${e.code}`);
      console.log(`    [${e.category}] ${e.body}\n`);
    }
    if (candidates.length > 30) console.log(`  ... 외 ${candidates.length - 30}건\n`);
    return;
  }

  // 한 화면 리포트
  console.log('═'.repeat(72));
  console.log(' Regression Fixture Coverage — docs/errors ↔ tests/regression/cases/');
  console.log('═'.repeat(72));
  console.log(`📋 ERR 항목 총합:      ${errs.length}개`);
  console.log(`✅ 회귀 fixture 보유: ${fixtures.length}개 파일 / ${fixtures.reduce((a, f) => a + f.tests, 0)}개 테스트`);
  console.log(`🟢 커버 ERR:          ${covered.length}건`);
  console.log(`🟡 미커버 ERR:        ${uncovered.length}건`);
  console.log(`🎯 변환 후보(미커버 중 적합):  ${candidates.length}건`);
  console.log(`📊 커버리지:          ${errs.length > 0 ? Math.round((covered.length / errs.length) * 100) : 0}%`);
  console.log();

  if (covered.length > 0) {
    console.log('🟢 회귀 보호 중인 ERR:');
    for (const e of covered) console.log(`   ✓ ${e.code}  [${e.category}]`);
    console.log();
  }

  if (candidates.length > 0) {
    console.log('🎯 다음 fixture 후보 (UX·구조적·데이터):');
    for (const e of candidates.slice(0, 10)) {
      console.log(`   ❑ ${e.code}  [${e.category}]`);
    }
    if (candidates.length > 10) console.log(`   ... +${candidates.length - 10} more`);
    console.log();
  }

  console.log('명령어:');
  console.log('   • 미커버 후보 상세: node tests/regression/err-coverage.js --uncovered');
  console.log('   • JSON 출력: node tests/regression/err-coverage.js --json');
  console.log('   • 회귀 실행: npm run test:regression');
}

main();
