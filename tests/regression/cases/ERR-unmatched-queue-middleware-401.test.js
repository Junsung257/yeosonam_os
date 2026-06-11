/**
 * @case ERR-unmatched-queue-middleware-401
 * @summary public package rendering must not self-call protected unmatched admin APIs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-unmatched-queue-middleware-401: middleware exposes only POST /api/unmatched publicly', () => {
  const source = read('src/middleware.ts');

  assert.match(source, /if \(pathname === '\/api\/unmatched'\)/);
  assert.match(source, /return request\.method === 'POST'/);
});

test('ERR-unmatched-queue-middleware-401: package page uses Supabase read client and beacon instead of server self-fetch', () => {
  const source = read('src/app/packages/[id]/page.tsx');

  assert.match(source, /getSupabaseAdmin\(\) \?\? getSupabase\(\)/);
  assert.match(source, /ENABLE_UNMATCHED_QUEUE_ON_VIEW/);
  assert.match(source, /<UnmatchedActivitiesBeacon items=\{unmatchedItems\} \/>/);
  assert.equal(source.includes("fetch('/api/unmatched"), false);
  assert.equal(source.includes('fetch("/api/unmatched'), false);
});
