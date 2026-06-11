/**
 * @case ERR-process-violation
 * @summary register flow must keep mandatory post-registration audit before publishing paths.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-process-violation: insert template still runs Step 7 post-register audit', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /ERR-process-violation/);
  assert.match(source, /insertedIds\.length > 0 && !process\.env\.SKIP_POST_AUDIT/);
  assert.match(source, /const auditScript = path\.join\(__dirname, '\.\.', 'post_register_audit\.js'\)/);
  assert.match(source, /spawnSync\('node', \[auditScript, \.\.\.insertedIds\]/);
  assert.match(source, /const dumpScript = path\.join\(__dirname, '\.\.', 'dump_package_result\.js'\)/);
});
