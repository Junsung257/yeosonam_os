/**
 * @case ERR-W11-warning-misclass
 * @summary W11 informational comma warnings must be tagged and classified as info, not blocking warnings.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-W11-warning-misclass: insert-template prefixes W11 and post-audit classifies it as info', () => {
  const template = read('db/templates/insert-template.js');
  const audit = read('db/post_register_audit.js');
  const dump = read('db/dump_package_result.js');
  const approve = read('db/approve_package.js');

  assert.match(template, /warnings\.push\(`\[W11\] 콤마 포함 ▶ activity/);
  assert.match(audit, /const INFO_RULES = new Set\(\['W11', 'W12'\]\)/);
  assert.match(audit, /isInfoOnly\(warnList\) \? 'info' : 'warnings'/);
  assert.match(audit, /INFO \(안내성 경고만/);
  assert.match(dump, /n\.text \|\| n\.title \|\| '\(empty\)'/);
  assert.match(approve, /info 는 자동 승인/);
});
