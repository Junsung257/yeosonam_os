/**
 * @case ERR-FUK-camellia-overcorrect
 * @summary FUK Camellia learnings must keep descriptive comma protection and verbatim gates in place.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-FUK-camellia-overcorrect: splitScheduleItems protects descriptive comma phrases', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /ERR-FUK-camellia-overcorrect/);
  assert.match(source, /const DESCRIPTIVE_KW/);
  assert.match(source, /후쿠오카 타워 관광/);
  assert.match(source, /DESCRIPTIVE_KW\.test\(body\) \|\| HAS_VERB_ENDING_BEFORE_COMMA\.test\(body\)/);
  assert.match(source, /W32 — ERR-FUK-camellia-overcorrect/);
});

test('ERR-FUK-camellia-overcorrect: archived fixed registrations carry explicit parser evidence', () => {
  const source = read('db/_archive/insert_tourbi_fuk_camellia_jeongtong_20260428.js');

  assert.match(source, /camellia-fix/);
  assert.match(source, /schedule = verbatim/);
  assert.match(source, /\(카멜리아\)" 같은 단어 추가 금지/);
  assert.match(source, /regions 는 지역 컬럼만/);
});
