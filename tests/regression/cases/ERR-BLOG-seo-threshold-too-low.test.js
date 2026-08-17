/**
 * @case ERR-BLOG-seo-threshold-too-low (2026-08-13)
 * @summary SEO scoring is diagnostic; publication also requires evidence-rich
 * V3 quality dimensions and hard-blocker checks.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-seo-threshold-too-low: SEO scorer remains a strict supporting gate', () => {
  const scorer = read('src', 'lib', 'blog-seo-scorer.ts');

  assert.match(scorer, /export const BLOG_SEO_MAX_SCORE = 100/);
  assert.match(scorer, /info:\s*95/);
  assert.match(scorer, /product:\s*95/);
  assert.match(scorer, /criticalFailures\.length === 0/);
  assert.match(scorer, /title/);
  assert.match(scorer, /meta_description/);
  assert.match(scorer, /structured_data/);
});

test('ERR-BLOG-seo-threshold-too-low: V3 evaluator stores dimensions, evidence, and failures', () => {
  const evaluator = read('src', 'lib', 'blog-quality-evaluator-v3.ts');

  for (const dimension of [
    'intent_completion',
    'factual_support_coverage',
    'unsupported_number_count',
    'destination_specificity',
    'information_gain',
    'title_uniqueness',
    'opening_uniqueness',
    'structure_uniqueness',
    'Korean_language_integrity',
    'image_relevance',
    'image_uniqueness',
    'source_quality',
    'author_review_truthfulness',
    'internal_link_relevance',
    'user_actionability',
  ]) {
    assert.match(evaluator, new RegExp(dimension));
  }
  assert.match(evaluator, /evidence: string\[\]/);
  assert.match(evaluator, /failures: string\[\]/);
  assert.match(evaluator, /hardBlockers/);
  assert.match(evaluator, /failureReasons/);
});

test('ERR-BLOG-seo-threshold-too-low: publisher cannot publish on SEO score alone', () => {
  const publisher = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');

  assert.match(publisher, /evaluateBlogQualityV3/);
  assert.match(publisher, /claimValidation\.passed/);
  assert.match(publisher, /contentBriefV3\.passed/);
  assert.match(publisher, /corpusDiversity\.error === null/);
  assert.match(publisher, /qualityEvaluationV3\.passed/);
  assert.match(publisher, /demandScoreV3\.eligible/);
});
