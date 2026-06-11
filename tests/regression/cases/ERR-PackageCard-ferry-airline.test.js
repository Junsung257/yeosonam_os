/**
 * @case ERR-PackageCard-ferry-airline (2026-04-29)
 * @summary Ferry package cards must show the ferry company name, not the generic
 * parenthesized transport type such as "선박".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'render-contract.ts'), 'utf8');

function getAirlineNameMirror(flightCode) {
  if (!flightCode) return null;
  const map = {
    카멜리아: '카멜리아',
    부관훼리: '부관훼리',
    뉴카멜리아: '뉴카멜리아',
  };
  const code = String(flightCode).split(/[\s|(]/)[0].replace(/\d+$/, '').toUpperCase().trim();
  if (map[code]) return map[code];
  const parenMatch = String(flightCode).match(/\(([^)]+)\)/);
  return parenMatch ? parenMatch[1] : code;
}

test('ERR-PackageCard-ferry-airline: render contract keeps explicit ferry company mappings', () => {
  assert.match(source, /['"]카멜리아['"]\s*:\s*['"]카멜리아['"]/);
  assert.match(source, /['"]부관훼리['"]\s*:\s*['"]부관훼리['"]/);
  assert.match(source, /['"]뉴카멜리아['"]\s*:\s*['"]뉴카멜리아['"]/);
});

test('ERR-PackageCard-ferry-airline: company match is checked before parenthesis fallback', () => {
  const fnStart = source.indexOf('export function getAirlineName');
  const fnSource = source.slice(fnStart, source.indexOf('function airportToDepCity'));
  const directMap = fnSource.indexOf('if (AIRLINE_MAP[code]) return AIRLINE_MAP[code];');
  const parenFallback = fnSource.indexOf('parenMatch');

  assert.ok(fnStart > 0, 'getAirlineName function must exist');
  assert.ok(directMap > 0, 'direct AIRLINE_MAP lookup must exist');
  assert.ok(parenFallback > directMap, 'parenthesis fallback must remain after ferry/company lookup');
});

test('ERR-PackageCard-ferry-airline: mirror behavior preserves ferry company names', () => {
  assert.equal(getAirlineNameMirror('카멜리아 (선박)'), '카멜리아');
  assert.equal(getAirlineNameMirror('뉴카멜리아 페리'), '뉴카멜리아');
  assert.equal(getAirlineNameMirror('부관훼리'), '부관훼리');
});
