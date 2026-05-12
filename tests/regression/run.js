#!/usr/bin/env node
/**
 * @file tests/regression/run.js
 * @description error-registry 회귀 테스트 일괄 실행기.
 * cases/ 디렉터리의 모든 .test.js 를 node --test 로 실행 후 summary 리포트.
 *
 * 사용:
 *   npm run test:regression
 *   node tests/regression/run.js [--filter ERR-some-code]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CASES_DIR = path.join(__dirname, 'cases');

function listCases(filter) {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs.readdirSync(CASES_DIR)
    .filter(f => f.endsWith('.test.js'))
    .filter(f => !filter || f.includes(filter))
    .map(f => path.join(CASES_DIR, f));
}

function main() {
  const filterIdx = process.argv.indexOf('--filter');
  const filter = filterIdx >= 0 ? process.argv[filterIdx + 1] : null;
  const cases = listCases(filter);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  🧪 Error Registry 회귀 테스트`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`총 ${cases.length}건${filter ? ` (필터: ${filter})` : ''}\n`);

  if (cases.length === 0) {
    console.log('ℹ️  케이스 없음. tests/regression/cases/<ERR-CODE>.test.js 에 추가하세요.');
    return;
  }

  // node --test 는 인자 여러 개 받으면 한꺼번에 실행하고 통합 summary 제공.
  const r = spawnSync('node', ['--test', '--test-reporter=spec', ...cases], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..', '..'),
  });
  process.exit(r.status ?? 0);
}

main();
