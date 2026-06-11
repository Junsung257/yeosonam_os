/**
 * @case ERR-BLOG-seo-audit-missing (2026-06-12)
 * @summary Published blog SEO must have a browser-backed audit, not only
 * generation-time scoring.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-seo-audit-missing: package script exposes SEO quality audit', () => {
  const pkg = JSON.parse(read('package.json'));

  assert.equal(pkg.scripts['audit:blog-seo'], 'node scripts/audit-blog-seo-quality.mjs');
});

test('ERR-BLOG-seo-audit-missing: browser audit checks page metadata, structure, and schema', () => {
  const source = read('scripts', 'audit-blog-seo-quality.mjs');

  assert.match(source, /chromium/);
  assert.match(source, /canonical/);
  assert.match(source, /description/);
  assert.match(source, /og:title/);
  assert.match(source, /og:image/);
  assert.match(source, /twitter:card/);
  assert.match(source, /h1Count/);
  assert.match(source, /h2Count/);
  assert.match(source, /BlogPosting/);
  assert.match(source, /BreadcrumbList/);
  assert.match(source, /duplicate_title/);
});
