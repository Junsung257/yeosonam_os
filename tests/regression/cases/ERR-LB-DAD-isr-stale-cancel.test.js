/**
 * @case ERR-LB-DAD-isr-stale-cancel
 * @summary package updates must invalidate all customer-facing package surfaces.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-LB-DAD-isr-stale-cancel: shared revalidate helper covers PC, mobile, and landing routes', () => {
  const source = read('src/lib/revalidate-helper.ts');

  assert.match(source, /export async function revalidatePackagePaths/);
  assert.match(source, /buildPackageSurfacePaths/);
  assert.match(source, /`\/packages\/\$\{packageId\}`/);
  assert.match(source, /`\/m\/packages\/\$\{packageId\}`/);
  assert.match(source, /`\/lp\/\$\{packageId\}`/);
  assert.match(source, /`\/lp\/\$\{shortCode\}`/);
  assert.match(source, /REVALIDATE_SECRET/);
});

test('ERR-LB-DAD-isr-stale-cancel: approval route also invalidates package list and landing-page surfaces', () => {
  const source = read('src/app/api/packages/[id]/approve/route.ts');

  assert.match(source, /revalidatePath\('\/packages'\)/);
  assert.match(source, /revalidatePath\(`\/packages\/\$\{id\}`\)/);
  assert.match(source, /revalidateLandingPagesForPackage/);
});
