/**
 * @case ERR-PACKAGE-static-prerender-build-timeout (2026-06-18)
 * @summary Package detail prerendering must not block production deploys by
 * default; build-time prerender count is opt-in via environment variable.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-PACKAGE-static-prerender-build-timeout: package static params default to zero', () => {
  const source = read('src', 'app', 'packages', '[id]', 'page.tsx');

  assert.match(source, /PACKAGE_STATIC_PRERENDER_LIMIT \?\? ['"]0['"]/);
  assert.match(source, /if \(STATIC_PACKAGE_PRERENDER_LIMIT <= 0\) return \[\];/);
  assert.match(source, /\.limit\(STATIC_PACKAGE_PRERENDER_LIMIT\)/);
  assert.doesNotMatch(source, /\.limit\(50\);/);
});
