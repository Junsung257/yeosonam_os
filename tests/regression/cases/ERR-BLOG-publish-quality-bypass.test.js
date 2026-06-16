/**
 * @case ERR-BLOG-publish-quality-bypass (2026-06-12)
 * @summary Blog publish paths must not mark posts published without quality,
 * SEO, and readability evidence.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-publish-quality-bypass: shared evaluator is strict and complete', () => {
  const source = read('src', 'lib', 'blog-publish-quality.ts');

  assert.match(source, /await runQualityGates\(/);
  assert.match(source, /computeSeoScore\(/);
  assert.match(source, /computeReadability\(/);
  assert.match(source, /calculateBlogQualityScore\(/);
  assert.match(source, /passed: blogQualityScore\.isPerfect/);
  assert.match(source, /updateData\.quality_gate = report\.qualityGate/);
  assert.match(source, /updateData\.seo_score = report\.seoScore/);
  assert.match(source, /updateData\.readability_score = report\.readability\.score/);
});

test('ERR-BLOG-publish-quality-bypass: direct publish APIs call evaluator and persist evidence', () => {
  const publishFiles = [
    ['src', 'app', 'api', 'blog', 'route.ts'],
    ['src', 'app', 'api', 'content-hub', 'publish', 'route.ts'],
    ['src', 'app', 'api', 'content-queue', 'route.ts'],
    ['src', 'app', 'api', 'blog', 'mrt-hotel-ranking', 'route.ts'],
    ['src', 'app', 'api', 'cron', 'blog-regenerate-zero-click', 'route.ts'],
    ['src', 'lib', 'social-publishing', 'distribution-publisher.ts'],
  ];

  for (const parts of publishFiles) {
    const source = read(...parts);
    const label = parts.join('/');
    assert.match(source, /evaluateBlogPublishQuality|prepareBlogForPublish/, `${label} must prepare or evaluate publish quality`);
    assert.ok(
      /quality_gate/.test(source) || /applyBlogPublishQualityToUpdate/.test(source),
      `${label} must persist quality gate evidence`,
    );
    assert.ok(
      /seo_score/.test(source) || /applyBlogPublishQualityToUpdate/.test(source),
      `${label} must persist SEO evidence`,
    );
  }
});

test('ERR-BLOG-publish-quality-bypass: cron publisher gates generated posts before publish', () => {
  const source = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');

  assert.match(source, /await runQualityGates\(/);
  assert.match(source, /computeSeoScore\(/);
  assert.match(source, /seo_score_failed/);
  assert.match(source, /quality_gate: qa/);
  assert.match(source, /seo_score: seoScore/);
  assert.match(source, /readability_score: readability\.score/);
});
