/**
 * @case ERR-BLOG-autopublish-contract-bypass (2026-06-15)
 * @summary Live blog autopublishing must not bypass the documented
 * pre-publish repair, quality, SEO, readability, and indexing contract.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

function indexOfOrFail(source, needle, label) {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `${label} missing: ${needle}`);
  return index;
}

test('ERR-BLOG-autopublish-contract-bypass: contract document records evidence and blocking rules', () => {
  const source = read('docs', 'blog-autopublish-contract.md');

  assert.match(source, /Google sitemap guidance/);
  assert.match(source, /Google sitemap ping deprecation/);
  assert.match(source, /Google URL Inspection API/);
  assert.match(source, /IndexNow protocol documentation/);
  assert.match(source, /Vercel Cron duration guidance/);
  assert.match(source, /No path may write `status='published'` unless/);
  assert.match(source, /repairBlogStructureQuality\(\)/);
  assert.match(source, /Publishing and indexing must be treated as separate responsibilities/);
});

test('ERR-BLOG-autopublish-contract-bypass: live publisher runs structure repair before first quality gate', () => {
  const source = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');
  const processStart = indexOfOrFail(source, 'async function processQueueItem', 'processQueueItem');
  const processSource = source.slice(processStart);

  const editorialRepair = indexOfOrFail(processSource, 'repairBlogEditorialQuality({', 'editorial repair');
  const structureRepair = indexOfOrFail(processSource, 'repairBlogStructureQuality({', 'structure repair');
  const firstGate = indexOfOrFail(processSource, 'let qa = await runGeneratedQualityGates', 'first quality gate');

  assert.ok(editorialRepair < structureRepair, 'structure repair should run after editorial repair');
  assert.ok(structureRepair < firstGate, 'structure repair must run before the first quality gate');
});

test('ERR-BLOG-autopublish-contract-bypass: shared prepare helper repairs before evaluating publish quality', () => {
  const source = read('src', 'lib', 'blog-publish-quality.ts');
  const prepareStart = indexOfOrFail(source, 'export async function prepareBlogForPublish', 'prepareBlogForPublish');
  const prepareSource = source.slice(prepareStart);

  const editorialRepair = indexOfOrFail(prepareSource, 'repairBlogEditorialQuality({', 'prepare editorial repair');
  const structureRepair = indexOfOrFail(prepareSource, 'repairBlogStructureQuality({', 'prepare structure repair');
  const evaluator = indexOfOrFail(prepareSource, 'const report = await evaluateBlogPublishQuality({', 'prepare evaluator');

  assert.ok(editorialRepair < structureRepair, 'prepare helper should run editorial repair before structure repair');
  assert.ok(structureRepair < evaluator, 'prepare helper must repair structure before evaluating quality');
});

test('ERR-BLOG-autopublish-contract-bypass: direct publish paths use prepare helper', () => {
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
    assert.match(source, /prepareBlogForPublish/, `${label} must use the shared prepare helper`);
  }
});

test('ERR-BLOG-autopublish-contract-bypass: repair rounds rerun structure repair after mutations', () => {
  const source = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');
  const repairStart = indexOfOrFail(source, 'async function repairFailedQualityGates', 'repairFailedQualityGates');
  const repairEnd = indexOfOrFail(source.slice(repairStart), 'async function getActiveBlogStyleGuide', 'repair end');
  const repairSource = source.slice(repairStart, repairStart + repairEnd);

  const mutationBlock = indexOfOrFail(repairSource, 'if (changed) {', 'changed block');
  const structureRepair = indexOfOrFail(repairSource.slice(mutationBlock), 'repairBlogStructureQuality({', 'post-mutation structure repair');
  const nextGate = indexOfOrFail(repairSource.slice(mutationBlock), 'qa = await runGeneratedQualityGates', 'next gate');

  assert.ok(structureRepair < nextGate, 'post-mutation structure repair must happen before rechecking gates');
});

test('ERR-BLOG-autopublish-contract-bypass: final readability is calculated after SEO blocking', () => {
  const source = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');
  const processStart = indexOfOrFail(source, 'async function processQueueItem', 'processQueueItem');
  const processSource = source.slice(processStart);

  const seoBlock = indexOfOrFail(processSource, "status: 'seo_score_failed'", 'SEO failure block');
  const readability = indexOfOrFail(processSource, 'const readability = computeReadability(generated.blog_html)', 'final readability');
  const payload = indexOfOrFail(processSource, 'const rowPayload', 'row payload');

  assert.ok(seoBlock < readability, 'readability must be calculated after SEO repair/blocking');
  assert.ok(readability < payload, 'readability must be calculated before persisted payload');
});

test('ERR-BLOG-autopublish-contract-bypass: indexing happens only after published results exist', () => {
  const source = read('src', 'app', 'api', 'cron', 'blog-publisher', 'route.ts');
  const worker = read('src', 'lib', 'blog-indexing-worker.ts');

  const publishedSlugs = indexOfOrFail(source, 'const publishedSlugs = results', 'published slugs');
  const enqueueIndexing = indexOfOrFail(source, 'enqueueBlogIndexingJob({', 'indexing enqueue');
  const notifyIndexing = indexOfOrFail(worker, 'notifyIndexing(job.url, baseUrl', 'worker indexing call');
  const indexingReports = indexOfOrFail(worker, 'persistBlogIndexingReport(job, report)', 'indexing report persistence');
  const inlineWorkerDrain = indexOfOrFail(source, 'processDueBlogIndexingJobs({', 'inline worker drain');

  assert.equal(source.includes('notifyIndexing('), false, 'publisher must not call external indexing inline');
  assert.ok(publishedSlugs < enqueueIndexing, 'indexing enqueue must use only successfully published slugs');
  assert.ok(enqueueIndexing < inlineWorkerDrain, 'publisher must drain due indexing jobs after enqueueing');
  assert.ok(notifyIndexing < indexingReports, 'worker must persist reports after provider requests');
});

test('ERR-BLOG-autopublish-contract-bypass: direct publish paths enqueue durable indexing jobs', () => {
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
    assert.match(source, /enqueueBlogIndexingJob/, `${label} must enqueue indexing`);
  }
});

test('ERR-BLOG-autopublish-contract-bypass: durable indexing outbox is scheduled and migrated', () => {
  const migration = read('supabase', 'migrations', '20260615150000_blog_indexing_jobs.sql');
  const vercel = read('vercel.json');
  const parsed = JSON.parse(vercel);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.blog_indexing_jobs/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FOR ALL TO service_role/);
  assert.equal(parsed.crons.length <= 100, true, 'vercel.json must stay within Vercel cron limit');
  assert.match(vercel, /\/api\/cron\/blog-publisher/);
  assert.match(vercel, /\/api\/cron\/auto-publish-loop/);
});
