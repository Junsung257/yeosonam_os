/**
 * @case ERR-pexels-korean-search
 * @summary attraction photo search must prefer English aliases for Pexels queries.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-pexels-korean-search: photo API accepts attractionId and picks English aliases', () => {
  const source = read('src/app/api/attractions/photos/route.ts');

  assert.match(source, /ERR-pexels-korean-search/);
  assert.match(source, /function pickEnglishAlias\(aliases: unknown\): string \| null/);
  assert.match(source, /ascii\.length \/ a\.length > 0\.8/);
  assert.match(source, /const \{ keyword: keywordRaw, attractionId/);
  assert.match(source, /const eng = pickEnglishAlias\(attr\.aliases\)/);
  assert.match(source, /searchKeyword = eng \|\|/);
});

test('ERR-pexels-korean-search: admin attraction UI passes attractionId for generated photos', () => {
  const source = read('src/app/admin/attractions/page.tsx');

  assert.match(source, /ERR-pexels-korean-search/);
  assert.match(source, /attractionId/);
  assert.match(source, /aliases/);
});
