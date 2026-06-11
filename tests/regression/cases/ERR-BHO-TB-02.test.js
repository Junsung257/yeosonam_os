/**
 * @case ERR-BHO-TB-02
 * @summary assembler scripts must access insert-template helpers through the inserter instance.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-BHO-TB-02: BHO assembler destructures helpers from inserter.helpers, not module exports', () => {
  const source = read('db/assembler_bho.js');

  assert.match(source, /function _helpers\(inserter\)/);
  assert.match(source, /return inserter\.helpers/);
  assert.match(source, /const \{ flight, normal \} = _helpers\(inserter\)/);
  assert.match(source, /const \{ normal \} = _helpers\(inserter\)/);
  assert.equal(source.includes("require('./templates/insert-template').helpers"), false);
});
