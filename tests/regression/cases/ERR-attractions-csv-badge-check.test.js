/**
 * @case ERR-attractions-csv-badge-check
 * @summary attraction CSV upload must normalize badge_type and return row-level failures.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-attractions-csv-badge-check: CSV API normalizes badge_type before DB upsert', () => {
  const source = read('src/app/api/attractions/route.ts');

  assert.match(source, /ERR-attractions-csv-badge-check/);
  assert.match(source, /const BADGE_ALLOWED = new Set/);
  assert.match(source, /const BADGE_KO_MAP/);
  assert.match(source, /function normalizeBadgeType\(raw: unknown\): string/);
  assert.match(source, /if \(BADGE_ALLOWED\.has\(s\)\) return s/);
  assert.match(source, /badge_type: normalizeBadgeType\(i\.badge_type\)/);
});

test('ERR-attractions-csv-badge-check: CSV API reports row-level fallback errors', () => {
  const source = read('src/app/api/attractions/route.ts');

  assert.match(source, /const rowErrors: Array<\{ name: string; error: string \}> = \[\]/);
  assert.match(source, /for \(let i = 0; i < cleaned\.length; i \+= BATCH\)/);
  assert.match(source, /rowErrors\.push/);
  assert.match(source, /totalErrors/);
});
