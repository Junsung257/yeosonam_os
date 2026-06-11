/**
 * @case ERR-process-violation-auto-approve
 * @summary clean registrations must run the mandatory auto-approval step.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-process-violation-auto-approve: insert template invokes approve_package after audit', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /ERR-process-violation-auto-approve/);
  assert.match(source, /const approveScript = path\.join\(__dirname, '\.\.', 'approve_package\.js'\)/);
  assert.match(source, /!process\.env\.SKIP_AUTO_APPROVE/);
  assert.match(source, /spawnSync\('node', \[approveScript, \.\.\.insertedIds\]/);
});
