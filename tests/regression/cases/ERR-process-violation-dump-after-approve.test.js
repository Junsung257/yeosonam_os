/**
 * @case ERR-process-violation-dump-after-approve
 * @summary successful approval must immediately dump active sales fields for operator review.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-process-violation-dump-after-approve: approve script dumps only promoted package ids unless explicitly skipped', () => {
  const source = read('db/approve_package.js');

  assert.match(source, /ERR-process-violation-dump-after-approve/);
  assert.match(source, /const promoted = \[\]/);
  assert.match(source, /promoted\.push\(id\)/);
  assert.match(source, /promoted\.length > 0 && !process\.env\.SKIP_DUMP_RESULT/);
  assert.match(source, /dump_package_result\.js/);
  assert.match(source, /spawnSync\('node', \[dumpScript, \.\.\.promoted\], \{ stdio: 'inherit' \}\)/);
});
