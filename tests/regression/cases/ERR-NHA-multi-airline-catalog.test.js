/**
 * @case ERR-NHA-multi-airline-catalog
 * @summary multi-airline catalog ambiguity must be stopped before arbitrary registration choices.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-NHA-multi-airline-catalog: registration docs preserve Step 1.5 consistency checks', () => {
  const plan = read('docs/registration-improvement-plan.md');
  const changelog = read('docs/register-changelog.md');

  assert.match(plan, /Step 1\.5 카탈로그 모순 검증/);
  assert.match(changelog, /신규 랜드사는 사장님 입력대로 즉시 추가/);
  assert.match(changelog, /W투어/);
  assert.match(changelog, /유류할증료\(N월\) 표기 = 발권기한 조건부 포함/);
});

test('ERR-NHA-multi-airline-catalog: archived W투어 registration records the chosen airline and Step 1.5 decisions', () => {
  const source = read('db/_archive/insert_nha_wt_selectum_3n5d.js');

  assert.match(source, /Step 1\.5 정형화 적용/);
  assert.match(source, /landOperator: 'W투어'/);
  assert.match(source, /BX-에어부산 BX781\/BX782/);
  assert.match(source, /Step 1\.5-E 호텔 등급 정형화 룰 적용/);
  assert.match(source, /Step 1\.5-D/);
});
