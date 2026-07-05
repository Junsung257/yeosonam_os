/**
 * @case ERR-BLOG-publisher-quota-fill (2026-07-05)
 * @summary The publisher must keep pulling and repairing candidates until the
 * daily quota is met. Candidate-level failures should not mark the publisher
 * as failed when another candidate fills the quota.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-BLOG-publisher-quota-fill: publisher has a deep default candidate pool', () => {
  const source = read('src/app/api/cron/blog-publisher/route.ts');

  assert.match(source, /BLOG_PUBLISHER_CLAIM_POOL_MULTIPLIER',\s*4,\s*1,\s*5/);
  assert.match(source, /BLOG_PUBLISHER_MAX_CANDIDATE_POOL',\s*12,\s*MAX_BATCH,\s*20/);
  assert.match(source, /BLOG_PUBLISHER_MAX_EXTRA_CLAIM_ROUNDS',\s*4,\s*0,\s*4/);
});

test('ERR-BLOG-publisher-quota-fill: candidate failures are separated from run errors when quota is met', () => {
  const source = read('src/app/api/cron/blog-publisher/route.ts');

  assert.match(source, /const candidateFailures:\s*string\[]\s*=\s*\[]/);
  assert.match(source, /candidateFailures\.push\(`\$\{r\.id\} \(\$\{r\.topic\}\): \$\{r\.reason \?\? r\.status\}`\)/);
  assert.doesNotMatch(source, /errors\.push\(`\$\{r\.id\} \(\$\{r\.topic\}\): \$\{r\.reason \?\? r\.status\}`\)/);
  assert.match(source, /const underfilledQuota = publishedCount < remainingToday/);
  assert.match(source, /publisher_under_published_with_remaining_quota/);
  assert.match(source, /candidate_failures:\s*candidateFailures/);
  assert.match(source, /quota_fulfillment:\s*\{/);
});
