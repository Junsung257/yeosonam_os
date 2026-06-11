/**
 * @summary sensitive API routes that touch raw/contact fields must stay guarded.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('sensitive API guard audit exists and covers raw/contact fields', () => {
  const source = read('scripts/audit-sensitive-api-guards.mjs');

  assert.match(source, /raw_text/);
  assert.match(source, /raw_payload/);
  assert.match(source, /customer_phone/);
  assert.match(source, /withAdminGuard/);
  assert.match(source, /requireCronBearer/);
});

test('band import save route is admin-only before service-client writes', () => {
  const source = read('src/app/api/band-import/save/route.ts');

  assert.match(source, /from ['"]@\/lib\/admin-guard['"]/);
  assert.match(source, /supabaseAdmin/);
  assert.match(source, /rawText/);
  assert.match(source, /export const POST = withAdminGuard\(postHandler\)/);
  assert.doesNotMatch(source, /export async function POST/);
});

test('package approval route is admin-only before publish state changes', () => {
  const source = read('src/app/api/packages/[id]/approve/route.ts');

  assert.match(source, /from ['"]@\/lib\/admin-guard['"]/);
  assert.match(source, /status:\s*'active'/);
  assert.match(source, /indexPackage\(id\)/);
  assert.match(source, /export const PATCH = withAdminGuard\(patchHandler\)/);
  assert.doesNotMatch(source, /export async function PATCH/);
});
