/**
 * @case ERR-BLOG-strict-ops-gates (2026-07-01)
 * @summary Blog ops gates must not hide SEO warnings or daily publish misses.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-strict-ops-gates: strict SEO audit fails on warning-only duplicate metadata', () => {
  const source = read('scripts', 'audit-blog-seo-quality.mjs');

  assert.match(source, /const strictMode = hasFlag\('--strict'\)/);
  assert.match(source, /const strictWarnings = strictMode \|\| hasFlag\('--strict-warnings'\)/);
  assert.match(source, /duplicate_meta_description/);
  assert.match(source, /row\.failed \|\| \(strictWarnings && row\.warnings\?\.length\)/);
});

test('ERR-BLOG-strict-ops-gates: product consult posts do not inherit info guide length warnings', () => {
  const source = read('scripts', 'audit-blog-seo-quality.mjs');

  assert.match(source, /function isProductConsultBlog\(row\)/);
  assert.match(source, /row\.hasProductJsonLd/);
  assert.match(source, /PRODUCT_BLOG_TITLE_SIGNALS/);
  assert.match(source, /below_product_blog_ideal_length/);
  assert.match(source, /weak_product_decision_help/);
  assert.match(source, /else if \(row\.articleTextLength < 2500\)/);
});

test('ERR-BLOG-strict-ops-gates: public SEO checks fail localhost links', () => {
  const auditSource = read('scripts', 'audit-blog-seo-quality.mjs');
  const scorerSource = read('src', 'lib', 'blog-seo-scorer.ts');

  assert.match(auditSource, /NON_PUBLIC_LINK_HOSTS/);
  assert.match(auditSource, /non_public_link/);
  assert.match(scorerSource, /public_link_integrity/);
  assert.match(scorerSource, /NON_PUBLIC_LINK_HOSTS/);
});

test('ERR-BLOG-strict-ops-gates: daily strict search audit forwards SEO warning strictness', () => {
  const source = read('scripts', 'blog-search-quality-daily.mjs');

  assert.match(source, /script: 'audit:blog-seo'/);
  assert.match(source, /strict \? \['--strict-warnings'\] : \[\]/);
});

test('ERR-BLOG-strict-ops-gates: autopublish diagnosis exposes SLA miss as a bucket', () => {
  const source = read('scripts', 'diagnose-blog-autopublish.ts');

  assert.match(source, /\| 'daily_publish_sla_miss'/);
  assert.match(source, /const selectedDayUnderTarget = selectedDayPublished < dailyTarget/);
  assert.match(source, /code: 'daily_publish_sla_miss'/);
  assert.match(source, /under_target: selectedDayUnderTarget/);
});

test('ERR-BLOG-strict-ops-gates: recovered publisher timeouts do not stay as active high buckets', () => {
  const source = read('scripts', 'diagnose-blog-autopublish.ts');

  assert.match(source, /function isRecoveredPublisherRun/);
  assert.match(source, /const timeoutRecovered = timeoutRuns\.length > 0/);
  assert.match(source, /publishPreflight\.status === 'pass'/);
  assert.match(source, /currentDayPublisherHealth\.status === 'healthy'/);
  assert.match(source, /startedAtMs\(row\) > latestTimeoutStartedAt && isRecoveredPublisherRun\(row\)/);
  assert.match(source, /if \(timeoutRuns\.length > 0 && !timeoutRecovered\)/);
});

test('ERR-BLOG-strict-ops-gates: blog detail cache handles DB unavailable before Next logs revalidation errors', () => {
  const source = read('src', 'app', 'blog', '[slug]', 'page.tsx');

  assert.match(source, /const getCachedPostFast = unstable_cache/);
  assert.match(source, /try \{\s*return await getPostFastUncached\(slug\);/);
  assert.match(source, /if \(isBlogDatabaseUnavailableError\(error\)\)/);
  assert.match(source, /return getFallbackBlogPost\(safeDecodeSlug\(slug\)\) as unknown as BlogPost \| null/);
});

test('ERR-BLOG-strict-ops-gates: backfill makes duplicate SEO descriptions unique per article intent', () => {
  const source = read('scripts', 'backfill-blog-quality.ts');

  assert.match(source, /function ensureBatchUniqueSeoDescription/);
  assert.match(source, /const seenSeoDescriptions = new Map<string, number>\(\)/);
  assert.match(source, /descriptionIntentLabel/);
  assert.match(source, /식비와 맛집 예산/);
  assert.match(source, /쇼핑과 기념품 예산/);
  assert.match(source, /ensureBatchUniqueSeoDescription\(ensureStrictSeoDescription/);
});

test('ERR-BLOG-strict-ops-gates: backfill cannot re-save generic info labels as destinations', () => {
  const source = read('scripts', 'backfill-blog-quality.ts');

  assert.match(source, /INVALID_BACKFILL_DESTINATION_KEYWORDS/);
  assert.match(source, /'대학생'/);
  assert.match(source, /'여름'/);
  assert.match(source, /'해외여행'/);
  assert.match(source, /hasInvalidBackfillDestinationKeyword/);
  assert.match(source, /genericInfoWithoutDestination/);
  assert.match(source, /destination: normalizedDestinationForWrite \?\? null/);
  assert.match(source, /function splitStableTailSections/);
  assert.match(source, /함께\\s\*확인할\\s\*세부\\s\*키워드/);
});
