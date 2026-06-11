/**
 * @case ERR-BLOG-gsc-property-split-audit (2026-06-08)
 * @summary Search Console may contain several properties, but automation must
 * audit and use one canonical www origin.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const source = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-blog-gsc-domain.mjs'), 'utf8');

test('ERR-BLOG-gsc-property-split-audit: package exposes the GSC/domain audit command', () => {
  assert.equal(pkg.scripts['audit:blog-gsc-domain'], 'node scripts/audit-blog-gsc-domain.mjs');
});

test('ERR-BLOG-gsc-property-split-audit: canonical origin defaults to www', () => {
  assert.match(source, /preferredOrigin[\s\S]+https:\/\/www\.yeosonam\.com/);
  assert.match(source, /ORIGIN_VARIANTS[\s\S]+http:\/\/yeosonam\.com/);
  assert.match(source, /ORIGIN_VARIANTS[\s\S]+http:\/\/www\.yeosonam\.com/);
  assert.match(source, /ORIGIN_VARIANTS[\s\S]+https:\/\/yeosonam\.com/);
  assert.match(source, /ORIGIN_VARIANTS[\s\S]+https:\/\/www\.yeosonam\.com/);
});

test('ERR-BLOG-gsc-property-split-audit: audit checks redirects, canonical, og:url, sitemap, and env hints', () => {
  assert.match(source, /auditRedirects/);
  assert.match(source, /link\[rel="canonical"\]/);
  assert.match(source, /meta\[property="og:url"\]/);
  assert.match(source, /sitemap\.xml/);
  assert.match(source, /GSC_SITE_URL/);
  assert.match(source, /if \(strict && issues\.length > 0\) process\.exitCode = 1/);
});

