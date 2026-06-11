/**
 * @case ERR-BLOG-render-integrity-audit (2026-06-12)
 * @summary Render integrity audit must catch visible markdown artifacts and
 * retry incomplete article shells before failing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-render-integrity-audit: package scripts expose render audit modes', () => {
  const pkg = JSON.parse(read('package.json'));

  assert.equal(pkg.scripts['audit:blog-render'], 'node scripts/audit-blog-render-integrity.mjs');
  assert.equal(pkg.scripts['audit:blog-render:browser'], 'node scripts/audit-blog-render-integrity.mjs --browser-fallback');
});

test('ERR-BLOG-render-integrity-audit: audit strips non-content nodes and detects markdown residue', () => {
  const source = read('scripts', 'audit-blog-render-integrity.mjs');

  assert.match(source, /\$\(['"]script, style, template, noscript['"]\)\.remove\(\)/);
  assert.match(source, /markdownImages/);
  assert.match(source, /markdownHeadings/);
  assert.match(source, /markdownLinks/);
  assert.match(source, /markdownTables/);
  assert.match(source, /markdownBold/);
  assert.match(source, /artifactTotal > 0/);
});

test('ERR-BLOG-render-integrity-audit: audit retries empty shells and can verify in browser', () => {
  const source = read('scripts', 'audit-blog-render-integrity.mjs');

  assert.match(source, /function shouldRetryArticle/);
  assert.match(source, /row\.imgCount === 0 && row\.h2Count === 0/);
  assert.match(source, /retryReason: ['"]empty_article_shell['"]/);
  assert.match(source, /browserFallback/);
  assert.match(source, /checkedBy: ['"]browser['"]/);
});
