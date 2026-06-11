/**
 * @case ERR-unmatched-stale-after-alias
 * @summary manual alias additions must not leave older unmatched activity rows stale forever.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-unmatched-stale-after-alias: archived manual sweep remains dry-run capable and updates resolved evidence only', () => {
  const source = read('db/_archive/resweep_unmatched_activities.js');

  assert.match(source, /ERR-unmatched-stale-after-alias/);
  assert.match(source, /const DRY_RUN = process\.env\.DRY_RUN === '1'/);
  assert.match(source, /\.is\('resolved_at', null\)/);
  assert.match(source, /resolved_kind: 'auto_resweep'/);
  assert.match(source, /resolved_by: 'resweep_script'/);
  assert.match(source, /DRY_RUN 모드/);
});

test('ERR-unmatched-stale-after-alias: current API path resweeps after link_alias', () => {
  const source = read('src/app/api/unmatched/route.ts');

  assert.match(source, /action: 'link_alias'/);
  assert.match(source, /await resweepUnmatchedActivities\(\[attractionId\]\)/);
});
