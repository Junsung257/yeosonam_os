/**
 * @case ERR-BAEKDU-cross-region-attraction-card (2026-06-10)
 * @summary Attraction cards must not be created from cross-region stored IDs
 * or short substring matches. Matching needs destination scope and Hangul term
 * boundaries before customer card render.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-BAEKDU-cross-region-attraction-card: matcher builds a destination-scoped attraction index', () => {
  const source = read('src/lib/attraction-matcher.ts');

  assert.match(source, /export function buildAttractionIndex/);
  assert.match(source, /destTrim\.includes\(a\.region\)/);
  assert.match(source, /a\.region\.includes\(destTrim\)/);
  assert.match(source, /a\.country && destTrim\.includes\(a\.country\)/);
  assert.match(source, /NON_ATTRACTION_CATEGORIES/);
  assert.match(source, /const NON_ATTRACTION_CATEGORIES = new Set\(\['accommodation', 'mrt_product'\]\)/);
});

test('ERR-BAEKDU-cross-region-attraction-card: short Hangul substring matches require boundaries', () => {
  const source = read('src/lib/attraction-matcher.ts');

  assert.match(source, /function isHangulSyllable/);
  assert.match(source, /function hasTermBoundary/);
  assert.match(source, /if \(compactTerm\.length <= 2\) return hasTermBoundary\(text, term\)/);
  assert.match(source, /if \(nameNoSpace\.length >= 3 && actLowerNoSpace\.includes\(nameNoSpace\)\) return a/);
  assert.match(source, /aliasNoSpace\.length >= 3 && actLowerNoSpace\.includes\(aliasNoSpace\)/);
});

test('ERR-BAEKDU-cross-region-attraction-card: audits use the same destination scope before matching candidates', () => {
  const auditSource = read('scripts/audit-attraction-keyword-matching.ts');

  assert.match(auditSource, /function inDestinationScope/);
  assert.match(auditSource, /filter\(attraction => inDestinationScope\(attraction, destination\)\)/);
  assert.match(auditSource, /scopedAttractionsFor\(pkg\.destination \?\? undefined\)/);
  assert.match(auditSource, /scopedTermsFor\(pkg\.destination \?\? undefined\)/);
  assert.match(auditSource, /extractAttractionCandidates\(item\.activity \?\? '', item\.note \?\? null\)/);
});
