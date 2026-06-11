/**
 * @case ERR-W-FINAL-2026-04-21
 * @summary W-final hardening must keep Rule Zero, self-audit, CRC, API
 * validation, drift checks, and parser-version tracking wired in.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-W-FINAL-2026-04-21: insert template enforces Rule Zero and stores parser lineage', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /W-final F3/);
  assert.match(source, /const PARSER_VERSION =/);
  assert.match(source, /function computeRawHash\(text\)/);
  assert.match(source, /raw_text.*length < 50/);
  assert.match(source, /raw_text_hash/);
  assert.match(source, /actual !== pkg\.raw_text_hash/);
  assert.match(source, /parser_version: pkg\.parser_version \|\| PARSER_VERSION/);
});

test('ERR-W-FINAL-2026-04-21: insert template gates agent self-audit before insert', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /agent_audit_report/);
  assert.match(source, /overall_verdict === 'blocked'/);
  assert.match(source, /unsupported_critical/);
  assert.match(source, /unsupported_high/);
  assert.match(source, /STRICT_AUDIT/);
  assert.match(source, /AGENT_AUDIT_BLOCKED/);
});

test('ERR-W-FINAL-2026-04-21: packages API keeps default-on validation hard block', () => {
  const source = read('src/app/api/packages/route.ts');

  assert.match(source, /W-final F4/);
  assert.match(source, /const STRICT_OFF = process\.env\.STRICT_VALIDATION === 'false'/);
  assert.match(source, /raw_text\.length < 50/);
  assert.match(source, /ApiErrors\.badRequest\('\[RuleZero\]/);
  assert.match(source, /validatePackageLoose\(normalized\)/);
  assert.match(source, /Zod .*hard-block/);
});

test('ERR-W-FINAL-2026-04-21: CRC and API drift gates remain discoverable', () => {
  const renderContract = read('src/lib/render-contract.ts');
  const packageJson = JSON.parse(read('package.json'));

  assert.match(renderContract, /Canonical Render Contract/);
  assert.match(renderContract, /export function renderPackage/);
  assert.match(renderContract, /parseFlightActivity/);
  assert.match(renderContract, /formatFlightLabel/);
  assert.equal(packageJson.scripts['audit:api-drift:ci'], 'node db/audit_api_field_drift.js --strict');
});
