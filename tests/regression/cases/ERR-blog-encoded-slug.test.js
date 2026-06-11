/**
 * @case ERR-blog-encoded-slug (2026-06-12)
 * @summary Encoded Korean blog slugs must decode safely without breaking
 * already-decoded or malformed slugs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-blog-encoded-slug: safe decoder protects route and OG image lookup', () => {
  const decoder = read('src', 'lib', 'decode-slug.ts');
  const page = read('src', 'app', 'blog', '[slug]', 'page.tsx');
  const og = read('src', 'app', 'blog', '[slug]', 'opengraph-image.tsx');

  assert.match(decoder, /export function safeDecodeSlug/);
  assert.match(decoder, /decodeURIComponent/);
  assert.match(decoder, /catch/);
  assert.match(page, /safeDecodeSlug\(slug\)/);
  assert.match(og, /safeDecodeSlug\(params\.slug\)/);
});

test('ERR-blog-encoded-slug: decoder unit tests cover encoded and malformed inputs', () => {
  const unit = read('tests', 'unit', 'lib', 'decode-slug.spec.ts');

  assert.match(unit, /encoded Korean slug/);
  assert.match(unit, /already-decoded Korean slug/);
  assert.match(unit, /malformed percent sequences/);
  assert.match(unit, /safeDecodeSlug/);
});
