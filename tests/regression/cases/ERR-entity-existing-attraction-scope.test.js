/**
 * @case ERR-entity-existing-attraction-scope (2026-07-09)
 * @summary Existing approved attractions should be auto-linked only when the
 * candidate name and destination/country scope both support the match. Real
 * attraction names with parenthetical aliases, such as 나라코엔(나라사슴공원),
 * must not be rejected as product-like marketing names.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-entity-existing-attraction-scope: existing-match audit uses Korean destination aliases for country scope', () => {
  const source = read('scripts/auto-audit-entity-review-candidates.ts');

  assert.match(source, /KOREAN_DESTINATION_TO_ISO/);
  assert.match(source, /COUNTRY_SCOPE_ALIASES/);
  assert.match(source, /countryAliasSupported/);
  assert.match(source, /SHORT_CONTAINED_ATTRACTION_TERMS/);
  assert.match(source, /TW: \['기륭', '타이완'\]/);
  assert.match(source, /JP: \['규슈', '유후인', '쿠로가와'\]/);
  assert.match(source, /CN: \['백두산', '연변', '길림', '두만강'\]/);
});

test('ERR-entity-existing-attraction-scope: parenthetical real attraction names are not treated as product names', () => {
  const source = read('scripts/auto-audit-entity-review-candidates.ts');
  const regexLine = source.split('\n').find(line => line.includes('PRODUCT_LIKE_ATTRACTION_NAME_RE')) ?? '';

  assert.match(regexLine, /투어/);
  assert.match(regexLine, /패키지/);
  assert.match(regexLine, /\\\[[^/]+\\\]/);
  assert.doesNotMatch(regexLine, /\[()\[\\\]\]/);
});

test('ERR-entity-existing-attraction-scope: generic attraction labels stay review-only', () => {
  const source = read('scripts/auto-audit-entity-review-candidates.ts');

  assert.match(source, /'야시장'/);
  assert.match(source, /'시장'/);
});
