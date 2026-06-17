/**
 * @case ERR-BLOG-empty-angle-tabs (2026-06-18)
 * @summary Blog angle filter chips must not advertise empty categories.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-empty-angle-tabs: list renders only angle chips that have published posts', () => {
  const source = read('src', 'app', 'blog', 'BlogData.tsx');

  assert.match(source, /angleCounts: Record<string, number>/);
  assert.match(source, /\.select\('angle_type'\)/);
  assert.match(source, /if \(filter\.destination\) angleQuery = angleQuery\.eq\('destination', filter\.destination\);/);
  assert.match(source, /const visibleAngleChips = ANGLE_CHIPS\.filter/);
  assert.match(source, /angleCounts\[c\.v\]/);
  assert.match(source, /visibleAngleChips\.map/);
  assert.doesNotMatch(source, /ANGLE_CHIPS\.map\(c =>/);
});
