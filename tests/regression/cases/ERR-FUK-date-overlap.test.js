/**
 * @case ERR-FUK-date-overlap
 * @summary post-register audit must flag surcharge periods that overlap excluded departure dates.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-FUK-date-overlap: audit checks excluded_dates against surcharge ranges', () => {
  const source = read('db/post_register_audit.js');

  assert.match(source, /function checkDateOverlap\(pkg\)/);
  assert.match(source, /pkg\.excluded_dates/);
  assert.match(source, /pkg\.surcharges/);
  assert.match(source, /const exSet = new Set/);
  assert.match(source, /exSet\.has\(iso\)/);
  assert.match(source, /E3: surcharge/);
  assert.match(source, /result\.warnings\.push\(\.\.\.checkDateOverlap\(pkg\)\)/);
});
