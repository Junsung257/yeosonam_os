/**
 * @case ERR-20260418-03
 * @summary A4/mobile rendering must use structured surcharge objects with
 * start/end/amount/currency/unit instead of reparsing bare exclude strings.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-03: package schemas keep structured surcharge fields', () => {
  const packageSchema = read('src/lib/package-schema.ts');
  const intakeNormalizer = read('src/lib/intake-normalizer.ts');

  for (const source of [packageSchema, intakeNormalizer]) {
    assert.match(source, /SurchargeSchema/);
    assert.match(source, /start:/);
    assert.match(source, /end:/);
    assert.match(source, /amount:/);
    assert.match(source, /currency:/);
    assert.match(source, /unit:/);
    assert.match(source, /ERR-20260418-03/);
  }
});

test('ERR-20260418-03: render contract models surcharge objects explicitly', () => {
  const source = read('src/lib/render-contract.ts');

  assert.match(source, /export interface SurchargeObject/);
  assert.match(source, /start\?: string/);
  assert.match(source, /end\?: string/);
  assert.match(source, /amount\?: number/);
  assert.match(source, /currency\?: string/);
  assert.match(source, /unit\?: string/);
  assert.match(source, /SURCHARGE_RE/);
  assert.match(source, /isBareSurcharge/);
});

test('ERR-20260418-03: W15 guards catch raw date ranges with missing surcharge objects', () => {
  const businessRules = read('src/lib/validators/package-rules.ts');
  const insertTemplate = read('db/templates/insert-template.js');

  for (const source of [businessRules, insertTemplate]) {
    assert.match(source, /W15/);
    assert.match(source, /ERR-20260418-03/);
    assert.match(source, /match\(\/\\d\+\\\/\\d\+\\s\*\[~-\]\\s\*\\d\+\/g\)/);
    assert.match(source, /surchargeCount < Math\.ceil\(/);
  }
});
