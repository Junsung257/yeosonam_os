/**
 * @case ERR-BLOG-publish-quality-bypass (2026-08-13)
 * @summary Publication requires evidence-bearing quality gates plus the V3
 * evaluator; diagnostic scores alone must never authorize publication.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-publish-quality-bypass: shared evaluator records gate evidence', () => {
  const source = read('src', 'lib', 'blog-publish-quality.ts');

  assert.match(source, /await runQualityGates\(/);
  assert.match(source, /computeSeoScore\(/);
  assert.match(source, /computeReadability\(/);
  assert.match(source, /evaluateBlogPublicCustomerQuality\(/);
  assert.match(source, /publishContractIssues\.length === 0/);
  assert.match(source, /publicCustomerGatePassed/);
  assert.match(source, /updateData\.quality_gate =/);
  assert.match(source, /updateData\.seo_score = report\.seoScore/);
  assert.match(source, /updateData\.readability_score = report\.readability\.score/);
});

test('ERR-BLOG-publish-quality-bypass: preparation is syntax-only and cannot invent content', () => {
  const source = read('src', 'lib', 'blog-publish-quality.ts');
  const safeRepair = read('src', 'lib', 'blog-safe-publish-repair-v3.ts');

  assert.match(source, /repairBlogPublishFormattingV3/);
  assert.doesNotMatch(source, /repairBlogEditorialQuality/);
  assert.doesNotMatch(source, /repairBlogStructureQuality/);
  assert.doesNotMatch(source, /repairKeywordDensityToTarget/);
  assert.match(safeRepair, /may not add facts/);
  assert.match(safeRepair, /removed_unsafe_html/);
  assert.match(safeRepair, /normalized_line_endings/);
  assert.doesNotMatch(safeRepair, /buildStandardBlogCtaMarkdown|repairKeywordDensityToTarget|appendPublishReadinessSupport/);
});

test('ERR-BLOG-publish-quality-bypass: deterministic fallback is an explicit blocker', () => {
  const source = read('src', 'lib', 'blog-publish-quality.ts');

  assert.match(source, /deterministic_info_fallback_not_publishable/);
  assert.match(source, /deterministic_info_fallback/);
  assert.match(source, /deterministic_fast_fallback/);
});

test('ERR-BLOG-publish-quality-bypass: publisher combines all V3 decisions before publish', () => {
  const source = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');

  assert.match(source, /const qualityEvaluationV3 = evaluateBlogQualityV3\(/);
  assert.match(source, /allGatesPassed: publishQuality\.passed/);
  assert.match(source, /&& qa\.passed/);
  assert.match(source, /&& claimValidation\.passed/);
  assert.match(source, /&& contentBriefV3\.passed/);
  assert.match(source, /&& qualityEvaluationV3\.passed/);
  assert.match(source, /&& demandScoreV3\.eligible/);
  assert.match(source, /const publishAllowed = autopublishDecision\.publish && !contentRequiresHumanReview/);
});
