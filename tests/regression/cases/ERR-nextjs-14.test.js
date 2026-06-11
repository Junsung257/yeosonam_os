/**
 * @case ERR-nextjs-14
 * @summary project must not regress to the old Next 14 Windows chunk-race assumptions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-nextjs-14: package is on current Next major and keeps cache-clean build helpers', () => {
  const pkg = read('package.json');
  const parsed = JSON.parse(pkg);

  assert.match(parsed.dependencies.next, /^15\./);
  assert.match(pkg, /"clean:next":/);
  assert.match(pkg, /"build": "cross-env NODE_OPTIONS=--max_old_space_size=6144 next build"/);
  assert.match(pkg, /"postbuild": "node scripts\/ensure-next-main-app-js-shim\.cjs"/);
});
