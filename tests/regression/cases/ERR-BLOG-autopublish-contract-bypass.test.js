/**
 * @case ERR-BLOG-autopublish-contract-bypass (2026-08-13)
 * @summary V3 publishing fails closed, never creates content during repair,
 * and runs public side effects only after a public snapshot refresh succeeds.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-autopublish-contract-bypass: V3 contract records fail-closed publishing rules', () => {
  const contract = read('docs', 'blog-autopublish-contract.md');
  const runbook = read('docs', 'runbooks', 'blog-publishing-v3.md');

  assert.match(contract, /누락\/잘못된 `BLOG_AUTOPUBLISH_MODE`는 `draft_only`/);
  assert.match(contract, /coverage gap만으로 발행하지 않으며/);
  assert.match(contract, /deterministic fallback과 content-creating repair는 공개 불가/);
  assert.match(runbook, /BLOG_REQUIRE_DEMAND_SIGNAL/);
  assert.match(runbook, /reviewed_only/);
});

test('ERR-BLOG-autopublish-contract-bypass: policy defaults to draft and blocks missing demand', () => {
  const policy = read('src', 'lib', 'blog-autopublish-policy-v3.ts');

  assert.match(policy, /BLOG_AUTOPUBLISH_MODES = \['draft_only', 'reviewed_only', 'live'\]/);
  assert.match(policy, /: 'draft_only';/);
  assert.match(policy, /verified_demand_signal_missing/);
  assert.match(policy, /deterministic_fallback_not_publishable/);
  assert.match(policy, /daily_publish_cap_reached/);
  assert.match(policy, /weather_share_cap_exceeded/);
  assert.match(policy, /archetype_saturation_cap_reached/);
  assert.match(policy, /human_approval_required/);
});

test('ERR-BLOG-autopublish-contract-bypass: publisher uses V3 gates and syntax-only repair', () => {
  const publisher = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');

  assert.match(publisher, /evaluateBlogQualityV3/);
  assert.match(publisher, /evaluateBlogAutopublishDecisionV3/);
  assert.match(publisher, /repairBlogPublishFormattingV3/);
  assert.match(publisher, /status: publishAllowed \? 'published' : 'draft'/);
  assert.match(publisher, /review_status: publishAllowed \? contentReviewStatus : 'pending_review'/);
  assert.doesNotMatch(publisher, /repairBlogEditorialQuality/);
  assert.doesNotMatch(publisher, /repairBlogStructureQuality/);
  assert.doesNotMatch(publisher, /repairKeywordDensityToTarget/);
  assert.doesNotMatch(publisher, /appendPublishReadinessSupport/);
});

test('ERR-BLOG-autopublish-contract-bypass: public effects require a successful snapshot refresh', () => {
  const publisher = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');
  const publicRequest = publisher.indexOf('const publicPublicationRequested');
  const snapshotRefresh = publisher.indexOf('publicSnapshotRefresh.status === \'succeeded\'');
  const indexing = publisher.indexOf('for (const r of publicSideEffectsEnabled ? results : [])');
  const revalidation = publisher.indexOf('if (publicSideEffectsEnabled) revalidatePublicBlogCache()');

  assert.ok(publicRequest > 0);
  assert.ok(snapshotRefresh > publicRequest);
  assert.ok(indexing > snapshotRefresh);
  assert.ok(revalidation > snapshotRefresh);
});

test('ERR-BLOG-autopublish-contract-bypass: draft-only generators reject public writes', () => {
  const hotelRanking = read('src', 'app', 'api', 'blog', 'mrt-hotel-ranking', 'route.ts');

  assert.match(hotelRanking, /if \(body\.publish === true\)/);
  assert.match(hotelRanking, /status: 'draft'/);
  assert.match(hotelRanking, /published_at: null/);
  assert.doesNotMatch(hotelRanking, /enqueueBlogIndexingJob/);
});

test('ERR-BLOG-autopublish-contract-bypass: durable indexing worker remains independently scheduled', () => {
  const migration = read('supabase', 'migrations', '20260615150000_blog_indexing_jobs.sql');
  const workflow = read('.github', 'workflows', 'blog-external-cron.yml');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.blog_indexing_jobs/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(workflow, /blog-indexing-worker/);
});
