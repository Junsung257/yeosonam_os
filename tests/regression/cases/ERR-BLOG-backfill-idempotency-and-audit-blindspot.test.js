/**
 * @case ERR-BLOG-backfill-idempotency-and-audit-blindspot (2026-06-12)
 * @summary Blog backfill repair must be explicit, idempotent, and paired with
 * render/image audits that avoid false failures on incomplete shells.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-backfill-idempotency-and-audit-blindspot: backfill write mode is explicit and idempotent', () => {
  const source = read('scripts', 'backfill-blog-quality.ts');
  const pkg = JSON.parse(read('package.json'));

  assert.match(source, /const dryRun = !args\.has\(['"]--write['"]\)/);
  assert.match(source, /const debugDiff = args\.has\(['"]--debug-diff['"]\)/);
  assert.match(source, /normalizeMarkdownLinkLabels/);
  assert.match(source, /isSameStoredBlogHtml/);
  assert.match(source, /if \(!changed \|\| dryRun\) continue/);
  assert.match(source, /evaluateBlogPublishQuality/);
  assert.equal(pkg.scripts['backfill:blog-quality'], 'npx tsx scripts/backfill-blog-quality.ts');
  assert.equal(pkg.scripts['backfill:blog-quality:write'], 'npx tsx scripts/backfill-blog-quality.ts --write');
});

test('ERR-BLOG-backfill-idempotency-and-audit-blindspot: audits strip noise and retry incomplete pages', () => {
  const renderAudit = read('scripts', 'audit-blog-render-integrity.mjs');
  const imageAudit = read('scripts', 'audit-blog-image-quality.mjs');

  assert.match(renderAudit, /\$\(['"]script, style, template, noscript['"]\)\.remove\(\)/);
  assert.match(renderAudit, /function shouldRetryArticle/);
  assert.match(renderAudit, /retryReason: ['"]empty_article_shell['"]/);
  assert.match(imageAudit, /async function auditPageWithRetry/);
  assert.match(imageAudit, /retryReason: ['"]no_article_images['"]/);
  assert.match(imageAudit, /probeImageUrl/);
});
