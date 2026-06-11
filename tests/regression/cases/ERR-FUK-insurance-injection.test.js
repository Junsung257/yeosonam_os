/**
 * @case ERR-FUK-insurance-injection
 * @summary inclusion amounts such as travel-insurance coverage must not be invented.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-FUK-insurance-injection: retry prompt forbids unsupported source values', () => {
  const source = read('src/lib/llm-validate-retry.ts');

  assert.match(source, /ERR-FUK-insurance-injection/);
  assert.match(source, /criticOnSuccess/);
  assert.match(source, /Self-Refine/);
  assert.match(source, /Zod/);
  assert.match(source, /지어내지 말 것/);
});

test('ERR-FUK-insurance-injection: post-register audit checks inclusion amount tokens against raw text', () => {
  const source = read('db/post_register_audit.js');

  assert.match(source, /function checkInclusionInjection\(pkg\)/);
  assert.match(source, /Array\.isArray\(pkg\.inclusions\)/);
  assert.match(source, /rawNorm\.includes\(normalizeText\(token\)\)/);
  assert.match(source, /issues\.push\(`E1:/);
});
