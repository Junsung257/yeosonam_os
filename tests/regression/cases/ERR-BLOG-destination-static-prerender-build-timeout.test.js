/**
 * @case ERR-BLOG-destination-static-prerender-build-timeout (2026-06-18)
 * @summary Blog destination landing pages must not block production deploys by
 * default; build-time prerender count is opt-in via environment variable.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-destination-static-prerender-build-timeout: blog destination static params default to zero', () => {
  const source = read('src', 'app', 'blog', 'destination', '[dest]', 'page.tsx');

  assert.match(source, /BLOG_DESTINATION_STATIC_PRERENDER_LIMIT \?\? ['"]0['"]/);
  assert.match(source, /if \(BLOG_DESTINATION_STATIC_PRERENDER_LIMIT <= 0\) return \[\];/);
  assert.match(source, /\.limit\(BLOG_DESTINATION_STATIC_PRERENDER_LIMIT\)/);
  assert.match(source, /\[\.\.\.destinations\]\.slice\(0, BLOG_DESTINATION_STATIC_PRERENDER_LIMIT\)/);
  assert.doesNotMatch(source, /\.not\('destination', 'is', null\)\s*\.limit\(2000\);/);
});
