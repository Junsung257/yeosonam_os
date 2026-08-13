/**
 * @case ERR-BLOG-empty-angle-tabs (2026-06-18)
 * @summary Blog angle filter chips must not advertise empty categories.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-empty-angle-tabs: list renders only angle chips that have published posts', () => {
  const source = read('src', 'app', 'blog', 'BlogData.tsx');
  const catalog = read('src', 'lib', 'blog-public-catalog.ts');

  assert.match(source, /angleCounts: Record<string, number>/);
  assert.match(source, /loadPublicBlogCatalogPage/);
  assert.match(catalog, /blog_public_catalog_facets/);
  assert.match(catalog, /facet_type === 'angle'/);
  assert.match(source, /const visibleAngleChips = BLOG_PUBLIC_ANGLES\.filter/);
  assert.match(source, /angleCounts\[candidate\.key\]/);
  assert.match(source, /visibleAngleChips\.map/);
  assert.doesNotMatch(source, /BLOG_PUBLIC_ANGLES\.map\(/);
});
