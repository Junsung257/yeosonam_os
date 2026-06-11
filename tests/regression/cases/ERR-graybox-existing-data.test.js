/**
 * @case ERR-graybox-existing-data
 * @summary existing-package audit must expose legacy graybox risks and safe fix modes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-graybox-existing-data: audit_existing_packages keeps the seven legacy-risk checks', () => {
  const source = read('db/audit_existing_packages.js');

  for (const code of [
    'SPLIT-NOTES',
    'CUSTOMER-LEAK',
    'FIXED-COMMISSION-MISSING',
    'SHOPPING-NOT-SPECIFIED',
    'AUDIT-STATUS-NULL',
    'NOTICES-EMPTY',
    'NUMBER-COMMA-RESIDUE',
  ]) {
    assert.match(source, new RegExp(code));
  }
  assert.match(source, /--json/);
  assert.match(source, /--fix-split-notes/);
});
