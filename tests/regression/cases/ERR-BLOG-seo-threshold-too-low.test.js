/**
 * @case ERR-BLOG-seo-threshold-too-low (2026-06-12)
 * @summary Blog SEO scoring must keep a high publish threshold, not a loose
 * diagnostic pass mark.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-seo-threshold-too-low: scorer uses strict 100-point thresholds', () => {
  const scorer = read('src', 'lib', 'blog-seo-scorer.ts');

  assert.match(scorer, /export const BLOG_SEO_MAX_SCORE = 100/);
  assert.match(scorer, /info:\s*85/);
  assert.match(scorer, /product:\s*80/);
  assert.match(scorer, /score >= minScore && criticalFailures\.length === 0/);
  assert.match(scorer, /title/);
  assert.match(scorer, /meta_description/);
  assert.match(scorer, /structured_data/);
});

test('ERR-BLOG-seo-threshold-too-low: publish quality and audits use the strict scorer', () => {
  const publishQuality = read('src', 'lib', 'blog-publish-quality.ts');
  const pkg = JSON.parse(read('package.json'));

  assert.match(publishQuality, /computeSeoScore\(/);
  assert.match(publishQuality, /passed: blogQualityScore\.isPerfect/);
  assert.equal(pkg.scripts['audit:blog-seo'], 'node scripts/audit-blog-seo-quality.mjs');
});
