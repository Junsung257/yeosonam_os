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

test('ERR-BLOG-destination-static-prerender-build-timeout: destinations never query DB during static param generation', () => {
  const source = read('src', 'app', 'blog', 'destination', '[dest]', 'page.tsx');

  assert.doesNotMatch(source, /generateStaticParams/);
  assert.match(source, /export const dynamicParams = true/);
  assert.match(source, /loadPublicBlogCatalogPage/);
  assert.doesNotMatch(source, /\.not\('destination', 'is', null\)\s*\.limit\(2000\)/);
});
