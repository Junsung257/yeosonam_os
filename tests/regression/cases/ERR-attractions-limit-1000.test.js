/**
 * @case ERR-attractions-limit-1000
 * @summary /api/attractions must not trust a single PostgREST response when the table can exceed the 1000-row default cap.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRoute() {
  return fs.readFileSync(path.join(process.cwd(), 'src/app/api/attractions/route.ts'), 'utf8');
}

test('ERR-attractions-limit-1000: default attraction list uses an exact count before range fetch', () => {
  const source = readRoute();

  assert.match(
    source,
    /select\('id',\s*\{\s*count:\s*'exact',\s*head:\s*true\s*\}\)/,
    'route must ask PostgREST for an exact count before paged fetch',
  );
});

test('ERR-attractions-limit-1000: default attraction list uses range instead of relying on limit(5000)', () => {
  const source = readRoute();
  const defaultBranch = source.slice(source.indexOf('const PAGE = 1000'));

  assert.match(defaultBranch, /\.range\(0,\s*Math\.min\(total,\s*5000\)\s*-\s*1\)/);
  assert.doesNotMatch(defaultBranch, /\.limit\(5000\)/, 'limit(5000) can still be capped by PostgREST max-rows');
});
