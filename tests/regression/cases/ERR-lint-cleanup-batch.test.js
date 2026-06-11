/**
 * @case ERR-lint-cleanup-batch
 * @summary lint cleanup policy must keep real bug rules active while noisy rules are explicitly configured.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-lint-cleanup-batch: lint script runs with zero warnings and explicit rule configuration', () => {
  const pkg = read('package.json');
  const eslint = read('.eslintrc.json');

  assert.match(pkg, /"lint": "eslint src --ext \.js,\.jsx,\.ts,\.tsx --max-warnings=0"/);
  assert.match(eslint, /"plugin:@typescript-eslint\/recommended"/);
  assert.match(eslint, /"react\/no-unescaped-entities": "off"/);
  assert.match(eslint, /"@next\/next\/no-img-element": "off"/);
  assert.match(eslint, /AdminLayout/);
});
