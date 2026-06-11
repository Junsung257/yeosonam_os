/**
 * @case ERR-FUK-render-audit-falsepos
 * @summary render audit must skip incomplete ISR output instead of creating false positive failures.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-FUK-render-audit-falsepos: short/incomplete render output is logged as skipped', () => {
  const source = read('db/post_register_audit.js');

  assert.match(source, /renderedText\.length > 500/);
  assert.match(source, /r\.render\.length < 5000/);
  assert.match(source, /렌더 검증 SKIP/);
  assert.match(source, /production ISR 빌드 미완료/);
  assert.match(source, /데이터 자체는 정상/);
});
