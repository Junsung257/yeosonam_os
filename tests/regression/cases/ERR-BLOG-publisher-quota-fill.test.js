/**
 * @case ERR-BLOG-publisher-quota-fill (2026-08-13)
 * @summary Candidate depth may improve reliability, but V3 daily, demand,
 * weather, and archetype caps always take precedence over quota filling.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-publisher-quota-fill: V3 conservative limits are the default', () => {
  const policy = read('src', 'lib', 'blog-autopublish-policy-v3.ts');

  assert.match(policy, /BLOG_DAILY_PUBLISH_CAP, 1, 0, 20/);
  assert.match(policy, /BLOG_MAX_WEATHER_SHARE_30D, 0\.2, 0, 1/);
  assert.match(policy, /BLOG_MAX_SAME_ARCHETYPE_IN_LAST_10, 2, 0, 10/);
  assert.match(policy, /BLOG_REQUIRE_DEMAND_SIGNAL, true/);
});

test('ERR-BLOG-publisher-quota-fill: publisher clamps legacy targets to the V3 cap', () => {
  const source = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');

  assert.match(source, /const targetPostsToday = Math\.min\(/);
  assert.match(source, /BLOG_AUTOPUBLISH_POLICY_V3\.dailyPublishCap/);
  assert.match(source, /normalizeDailyPostTarget/);
  assert.match(source, /const remainingDueNow = slotQuota\.remainingDueNow/);
});

test('ERR-BLOG-publisher-quota-fill: missing demand stops work before generation', () => {
  const source = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');
  const preflight = source.indexOf('const demandPreflight = await loadQueueDemandEvidenceV3(item)');
  const blocked = source.indexOf('verified_demand_signal_missing_before_generation');
  const generation = source.indexOf('await generatePublisherBlogText(', preflight);

  assert.ok(preflight > 0);
  assert.ok(blocked > preflight);
  assert.ok(generation > blocked);
  assert.match(source, /demand_signal_repository_unavailable_before_generation/);
});

test('ERR-BLOG-publisher-quota-fill: candidate failures stay observable without bypassing gates', () => {
  const source = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');

  assert.match(source, /const candidateFailures:\s*string\[\]\s*=\s*\[\]/);
  assert.match(source, /candidateFailures\.push\(`/);
  assert.match(source, /const underfilledQuota = publishedCount < remainingDueNow/);
  assert.match(source, /candidate_failures:\s*candidateFailures/);
  assert.match(source, /quota_fulfillment:\s*\{/);
});
