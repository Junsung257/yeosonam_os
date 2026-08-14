/**
 * @case ERR-BLOG-publisher-quality-self-repair (2026-08-13)
 * @summary A failed quality gate must produce a draft/review handoff, not
 * deterministic paragraphs, links, FAQs, keywords, or claims.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-publisher-quality-self-repair: publisher only invokes the safe formatting repair', () => {
  const publisher = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');

  assert.match(publisher, /repairBlogPublishFormattingV3/);
  assert.doesNotMatch(publisher, /appendPublishReadinessSupport/);
  assert.doesNotMatch(publisher, /ensurePublisherInternalLinks/);
  assert.doesNotMatch(publisher, /buildStandardBlogCtaMarkdown/);
  assert.doesNotMatch(publisher, /repairKeywordDensityToTarget/);
  assert.doesNotMatch(publisher, /repairBlogEditorialQuality/);
  assert.doesNotMatch(publisher, /repairBlogStructureQuality/);
});

test('ERR-BLOG-publisher-quality-self-repair: failed policy decisions stay private', () => {
  const publisher = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');

  assert.match(publisher, /const requiresHumanReview = contentRequiresHumanReview \|\| !autopublishDecision\.publish/);
  assert.match(publisher, /status: publishAllowed \? 'published' : 'draft'/);
  assert.match(publisher, /review_status: publishAllowed \? contentReviewStatus : 'pending_review'/);
  assert.match(publisher, /status: 'pending_review'/);
});

test('ERR-BLOG-publisher-quality-self-repair: safe repair is limited to syntax and unsafe markup', () => {
  const source = read('src', 'lib', 'blog-safe-publish-repair-v3.ts');

  assert.match(source, /normalized_line_endings/);
  assert.match(source, /removed_unsafe_html/);
  assert.match(source, /removed_unsafe_markdown_links/);
  assert.match(source, /normalized_trailing_whitespace/);
  assert.match(source, /normalized_blank_lines/);
  assert.doesNotMatch(source, /buildStandardBlogCtaMarkdown|repairKeywordDensityToTarget|appendPublishReadinessSupport/);
});
