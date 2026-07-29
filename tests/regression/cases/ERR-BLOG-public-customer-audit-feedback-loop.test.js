/**
 * @case ERR-BLOG-public-customer-audit-feedback-loop (2026-07-29)
 * @summary The full public audit must finish in an operating window without
 * double-counting URL-encoded Korean slugs or hiding transient fetch failures.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const source = fs.readFileSync(
  path.join(ROOT, 'scripts', 'audit-blog-public-customer-quality.ts'),
  'utf8',
);

test('ERR-BLOG-public-customer-audit-feedback-loop: audit command stays operator-accessible', () => {
  assert.equal(
    pkg.scripts['audit:blog-public-customer-quality'],
    'npx tsx scripts/audit-blog-public-customer-quality.ts',
  );
});

test('ERR-BLOG-public-customer-audit-feedback-loop: audit is bounded, retryable, and ordered', () => {
  assert.match(source, /--concurrency/);
  assert.match(source, /Math\.min\(12,/);
  assert.match(source, /--retries/);
  assert.match(source, /shouldRetryStatus/);
  assert.match(source, /mapWithConcurrency/);
  assert.match(source, /const results = new Array<R>\(items\.length\)/);
});

test('ERR-BLOG-public-customer-audit-feedback-loop: encoded and decoded slugs share one identity', () => {
  assert.match(source, /const decodedPath = decodeURIComponent\(url\.pathname\)/);
  assert.match(source, /return decodedPath\.replace\(\/\\\/\+\$\/, ''\)/);
});

test('ERR-BLOG-public-customer-audit-feedback-loop: strict mode fails any weak category', () => {
  assert.match(source, /categoryScores\.some\(category => !category\.passed95\)/);
});
