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

test('ERR-BLOG-strict-ops-gates: backfill makes duplicate SEO descriptions unique per article intent', () => {
  const source = read('scripts', 'backfill-blog-quality.ts');

  assert.match(source, /function ensureBatchUniqueSeoDescription/);
  assert.match(source, /const seenSeoDescriptions = new Map<string, number>\(\)/);
  assert.match(source, /descriptionIntentLabel/);
  assert.match(source, /식비와 맛집 예산/);
  assert.match(source, /쇼핑과 기념품 예산/);
  assert.match(source, /ensureBatchUniqueSeoDescription\(ensureStrictSeoDescription/);
});
