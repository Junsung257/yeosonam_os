/**
 * @case ERR-unmatched-stale-auto-trigger
 * @summary attraction create/update and daily cron must resweep stale unmatched activity rows.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-unmatched-stale-auto-trigger: shared resweep marks matched rows with auto_resweep evidence', () => {
  const source = read('src/lib/unmatched-resweep.ts');

  assert.match(source, /export async function resweepUnmatchedActivities/);
  assert.match(source, /\.from\('unmatched_activities'\)/);
  assert.match(source, /resolved_at: now/);
  assert.match(source, /resolved_kind: 'auto_resweep'/);
  assert.match(source, /resolved_by: attractionIds \? 'attraction_hook' : 'cron_resweep'/);
});

test('ERR-unmatched-stale-auto-trigger: attraction API and cron both invoke the resweep helper', () => {
  const api = read('src/app/api/attractions/route.ts');
  const cron = read('src/app/api/cron/resweep-unmatched/route.ts');
  const vercel = read('vercel.json');
  const middleware = read('src/middleware.ts');

  assert.match(api, /resweepUnmatchedActivities\(\[data\.id\]\)/);
  assert.match(api, /resweepUnmatchedActivities\(\[id\]\)/);
  assert.match(cron, /resweepUnmatchedActivities\(\)/);
  assert.match(cron, /withCronGuard/);
  assert.match(vercel, /"path": "\/api\/cron\/resweep-unmatched"/);
  assert.match(middleware, /'\/api\/cron\/resweep-unmatched'/);
});
