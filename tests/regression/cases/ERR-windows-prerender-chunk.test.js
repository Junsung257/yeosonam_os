/**
 * @case ERR-windows-prerender-chunk
 * @summary Windows/Next prerender workarounds must keep client logic out of route entrypoints.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-windows-prerender-chunk: login keeps dynamic guard in layout and client hooks in LoginForm', () => {
  const layout = read('src/app/login/layout.tsx');
  const page = read('src/app/login/page.tsx');
  const form = read('src/app/login/LoginForm.tsx');

  assert.match(layout, /ERR-windows-prerender-chunk/);
  assert.match(layout, /export const dynamic = 'force-dynamic'/);
  assert.match(page, /import LoginForm from '\.\/LoginForm'/);
  assert.match(page, /return <LoginForm \/>/);
  assert.match(form, /'use client'/);
  assert.match(form, /useRouter/);
  assert.match(form, /useSearchParams/);
});

test('ERR-windows-prerender-chunk: homepage route config is statically declared for current Next runtime', () => {
  const home = read('src/app/page.tsx');

  assert.match(home, /export const revalidate = 300/);
  assert.match(home, /export const dynamic = 'force-static'/);
});
