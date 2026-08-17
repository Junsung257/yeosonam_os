/**
 * @case ERR-BLOG-strict-ops-gates (2026-08-13)
 * @summary Operational checks use V3 caps, preserve concrete warning evidence,
 * and distinguish a database outage from missing public content.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-strict-ops-gates: strict SEO audit fails warning-only duplicate metadata', () => {
  const source = read('scripts', 'audit-blog-seo-quality.mjs');

  assert.match(source, /const strictMode = hasFlag\('--strict'\)/);
  assert.match(source, /const strictWarnings = strictMode \|\| hasFlag\('--strict-warnings'\)/);
  assert.match(source, /duplicate_meta_description/);
  assert.match(source, /strictWarnings && row\.warnings\?\.length/);
});

test('ERR-BLOG-strict-ops-gates: public SEO checks fail non-public links', () => {
  const audit = read('scripts', 'audit-blog-seo-quality.mjs');
  const scorer = read('src', 'lib', 'blog-seo-scorer.ts');

  assert.match(audit, /NON_PUBLIC_LINK_HOSTS/);
  assert.match(audit, /non_public_link/);
  assert.match(scorer, /public_link_integrity/);
  assert.match(scorer, /NON_PUBLIC_LINK_HOSTS/);
});

test('ERR-BLOG-strict-ops-gates: daily audit keeps bounded but realistic runtime', () => {
  const source = read('scripts', 'blog-search-quality-daily.mjs');

  assert.match(source, /strict \? \['--strict-warnings'\] : \[\]/);
  assert.match(source, /DEFAULT_HARD_TIMEOUT_MS\s*=\s*180_000/);
  assert.match(source, /BLOG_AUDIT_HARD_TIMEOUT_MS/);
});

test('ERR-BLOG-strict-ops-gates: revenue audit enforces the V3 publish cap', () => {
  const source = read('scripts', 'audit-blog-revenue-funnel.mjs');

  assert.match(source, /daily_publish_target_is_v3_capped/);
  assert.ok(source.includes('/DEFAULT_POSTS_PER_DAY\\s*=\\s*1/'));
  assert.match(source, /readBlogAutopublishPolicyV3/);
  assert.ok(source.includes('/BLOG_AUTOPUBLISH_POLICY_V3\\.dailyPublishCap/'));
  assert.match(source, /publisher_respects_cumulative_slot_quota/);
  assert.match(source, /daily_summary_alerts_when_under_configured_target/);
});

test('ERR-BLOG-strict-ops-gates: daily summary uses the capped configured target', () => {
  const source = read('src', 'app', 'api', 'cron', 'blog-daily-summary', 'route.ts');

  assert.match(source, /normalizeDailyPostTarget/);
  assert.match(source, /if \(summary\.under_daily_target\)/);
  assert.doesNotMatch(source, /MIN_DAILY_SUMMARY_ALERT_POSTS/);
});

test('ERR-BLOG-strict-ops-gates: diagnosis exposes SLA and demand repository failures', () => {
  const source = read('scripts', 'diagnose-blog-autopublish.ts');

  assert.match(source, /\| 'daily_publish_sla_miss'/);
  assert.match(source, /code: 'daily_publish_sla_miss'/);
  assert.match(source, /demand_repository_missing/);
  assert.match(source, /readBlogAutopublishPolicyV3\(\)\.dailyPublishCap/);
  assert.match(source, /classifyBlogAutopublishDiagnosisBuckets/);
});

test('ERR-BLOG-strict-ops-gates: detail cache stores a typed outage envelope', () => {
  const source = read('src', 'app', 'blog', '[slug]', 'page.tsx');

  assert.match(source, /const getCachedPostFast = unstable_cache/);
  assert.match(source, /async function loadBlogPostCacheEnvelope/);
  assert.match(source, /if \(isBlogDatabaseUnavailableError\(error\)\)/);
  assert.match(source, /return \{ state: 'unavailable', post: null \}/);
  assert.match(source, /blog-detail-v6-outage-envelope/);
});

test('ERR-BLOG-strict-ops-gates: legacy content backfill is dry-run-only and rejects generic destinations', () => {
  const source = read('scripts', 'backfill-blog-quality.ts');

  assert.match(source, /Legacy blog quality backfill is permanently dry-run-only/);
  assert.match(source, /const dryRun = true/);
  assert.match(source, /INVALID_BACKFILL_DESTINATION_KEYWORDS/);
  assert.match(source, /'대학생'/);
  assert.match(source, /'여름'/);
  assert.match(source, /'해외여행'/);
  assert.match(source, /hasInvalidBackfillDestinationKeyword/);
  assert.match(source, /genericInfoWithoutDestination/);
  assert.match(source, /destinationChanged \? \{ destination: normalizedDestinationForWrite \?\? null \} : \{\}/);
});
