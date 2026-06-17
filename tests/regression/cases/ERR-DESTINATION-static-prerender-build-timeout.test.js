/**
 * @case ERR-DESTINATION-static-prerender-build-timeout (2026-06-18)
 * @summary Destination prerendering must not block production deploys by
 * default; build-time prerender count is opt-in via environment variable.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-DESTINATION-static-prerender-build-timeout: destination static params default to zero', () => {
  const source = read('src', 'app', 'destinations', '[city]', 'page.tsx');

  assert.match(source, /DESTINATION_STATIC_PRERENDER_LIMIT \?\? ['"]0['"]/);
  assert.match(source, /if \(DESTINATION_STATIC_PRERENDER_LIMIT <= 0\) return \[\];/);
  assert.match(source, /\.limit\(DESTINATION_STATIC_PRERENDER_LIMIT\)/);
  assert.match(source, /unique\.slice\(0, DESTINATION_STATIC_PRERENDER_LIMIT\)/);
  assert.doesNotMatch(source, /unique\.slice\(0, 50\)/);
});
