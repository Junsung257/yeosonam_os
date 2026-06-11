/**
 * @case ERR-FUK-clause-duplication
 * @summary special cancellation terms must suppress duplicated standard cancellation clauses on customer surfaces.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-FUK-clause-duplication: post-register audit detects standard clause leakage for special terms', () => {
  const source = read('db/post_register_audit.js');

  assert.match(source, /function checkClauseDuplication\(pkg, renderedText\)/);
  assert.match(source, /pkg\.notices_parsed/);
  assert.match(source, /STANDARD_MARKERS/);
  assert.match(source, /30일 전까지 취소/);
  assert.match(source, /계약금 전액 환불/);
  assert.match(source, /checkClauseDuplication\(pkg, renderedText\)/);
});

test('ERR-FUK-clause-duplication: standard terms filter removes RESERVATION when special cancel policy exists', () => {
  const source = read('src/lib/standard-terms.ts');
  const client = read('src/lib/standard-terms-client.ts');

  assert.match(source, /shouldSuppressStandardCancelTable\(filtered\)/);
  assert.match(source, /filtered\.filter\(n => n\.type !== 'RESERVATION'\)/);
  assert.match(client, /export function shouldSuppressStandardCancelTable/);
  assert.match(client, /AUTO_TICKETING/);
  assert.match(client, /hasProductSpecialCancelPolicy/);
});
