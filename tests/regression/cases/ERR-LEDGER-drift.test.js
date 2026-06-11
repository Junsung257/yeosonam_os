/**
 * @case ERR-LEDGER-drift
 * @summary ledger/bookings drift must be detected by a scheduled reconciliation path with operator alerts.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-LEDGER-drift: cron calls reconcile_ledger and reports non-zero drift with alerts', () => {
  const source = read('src/app/api/cron/ledger-reconcile/route.ts');
  const vercel = read('vercel.json');
  const middleware = read('src/middleware.ts');

  assert.match(source, /supabaseAdmin\.rpc\('reconcile_ledger'\)/);
  assert.match(source, /driftCount === 0/);
  assert.match(source, /totalAbsDrift/);
  assert.match(source, /dispatchPushAsync/);
  assert.match(source, /sendSlackAlert/);
  assert.match(source, /kind: 'ledger_drift'/);
  assert.match(vercel, /"path": "\/api\/cron\/ledger-reconcile"/);
  assert.match(middleware, /'\/api\/cron\/ledger-reconcile'/);
});
