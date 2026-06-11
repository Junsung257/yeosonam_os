/**
 * @summary products review API exposes raw review fields and must stay admin-only.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('admin products review route is protected by withAdminGuard', () => {
  const source = read('src/app/api/products/review/route.ts');

  assert.match(source, /from ['"]@\/lib\/admin-guard['"]/);
  assert.match(source, /raw_extracted_text/);
  assert.match(source, /internal_memo/);
  assert.match(source, /export const GET = withAdminGuard\(getHandler\)/);
  assert.match(source, /export const POST = withAdminGuard\(postHandler\)/);
  assert.doesNotMatch(source, /export async function GET/);
  assert.doesNotMatch(source, /export async function POST/);
});
