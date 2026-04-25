/**
 * @case ERR-audit-severity-flat (2026-04-27)
 * @summary post-audit 가 W12(안내성) 와 W14(환각) 를 동일 'warnings' 로 분류해 자동 승인
 * 차단 → 'info' 단계 신설로 분리.
 *
 * 검증:
 *   1. errors > 0 → blocked
 *   2. W12 만 있음 → info (자동 승인 OK)
 *   3. W14 만 있음 → warnings (force 필요)
 *   4. W12 + W14 혼재 → warnings (info 가 warnings 를 가리지 않음)
 *   5. 둘 다 없음 → clean
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const INFO_RULES = new Set(['W12']);
const isInfoOnly = (warns) => warns.length > 0 && warns.every(w => {
  const m = String(w).match(/\[(W\d+)/);
  return m && INFO_RULES.has(m[1]);
});

function decide(errors, warnings) {
  if ((errors?.length || 0) > 0) return 'blocked';
  if (!warnings || warnings.length === 0) return 'clean';
  return isInfoOnly(warnings) ? 'info' : 'warnings';
}

test('ERR-audit-severity-flat: errors → blocked', () => {
  assert.equal(decide(['[W21 ERR-special-notes-leak] ...'], []), 'blocked');
});

test('ERR-audit-severity-flat: W12 만 있음 → info', () => {
  assert.equal(decide([], ['[W12] 콤마 포함 관광지 activity 1건 자동 분리']), 'info');
});

test('ERR-audit-severity-flat: W14 만 있음 → warnings (info 아님)', () => {
  assert.equal(decide([], ['[W14 ERR-...] notices_parsed 축약 의심']), 'warnings');
});

test('ERR-audit-severity-flat: W12 + W14 혼재 → warnings (info 가 warnings 가리지 않음)', () => {
  const r = decide([], ['[W12] 자동 분리', '[W14 ERR-...] 축약 의심']);
  assert.equal(r, 'warnings');
});

test('ERR-audit-severity-flat: 둘 다 없음 → clean', () => {
  assert.equal(decide([], []), 'clean');
});

test('ERR-audit-severity-flat: errors + warnings → blocked 우선', () => {
  assert.equal(decide(['[W21 ERR-...]'], ['[W14 ERR-...]']), 'blocked');
});
