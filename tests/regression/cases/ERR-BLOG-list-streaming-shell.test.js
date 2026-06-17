/**
 * @case ERR-BLOG-list-streaming-shell (2026-06-18)
 * @summary Blog list pages must return crawler-auditable HTML instead of
 * leaving tools on a Suspense loading shell stream.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-list-streaming-shell: /blog list renders BlogData without Suspense fallback shell', () => {
  const source = read('src', 'app', 'blog', 'page.tsx');

  assert.doesNotMatch(source, /from ['"]react['"]/);
  assert.doesNotMatch(source, /<Suspense\b/);
  assert.doesNotMatch(source, /fallback=\{<Loading \/>}/);
  assert.match(source, /export const dynamic = ['"]force-dynamic['"]/);
  assert.match(source, /return <BlogData searchParams=\{searchParams\} \/>;/);
});
