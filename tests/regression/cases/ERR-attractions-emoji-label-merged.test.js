/**
 * @case ERR-attractions-emoji-label-merged
 * @summary attraction CSV upload must split emoji glyphs from label text.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-attractions-emoji-label-merged: API sanitizes composite emoji labels before upsert', () => {
  const source = read('src/app/api/attractions/route.ts');

  assert.match(source, /ERR-attractions-emoji-label-merged/);
  assert.match(source, /function sanitizeEmoji\(raw: unknown\): string \| null/);
  assert.match(source, /const idx = s\.search\(\/\\s\/\)/);
  assert.match(source, /return s\.slice\(0, idx\)/);
  assert.match(source, /emoji: sanitizeEmoji\(i\.emoji\)/);
});
