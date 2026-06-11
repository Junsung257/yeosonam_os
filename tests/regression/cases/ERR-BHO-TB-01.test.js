/**
 * @case ERR-BHO-TB-01
 * @summary BHO assembler must pass inclusions and activity notes as source verbatim text so W32 can catch drift.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-BHO-TB-01: BHO assembler requires rawText and preserves provided inclusions/activity note', () => {
  const source = read('db/assembler_bho.js');

  assert.match(source, /raw_text verbatim substrings 필수/);
  assert.match(source, /activityNote = '▶ 아일랜드마린 호핑투어/);
  assert.match(source, /if \(!rawText \|\| rawText\.length < 50\)/);
  assert.match(source, /raw_text: rawText/);
  assert.match(source, /inclusions,/);
  assert.match(source, /normal\(activityNote\)/);
});

test('ERR-BHO-TB-01: insert-template W32 checks inclusions against raw_text before approval', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /W32 — ERR-FUK-camellia-overcorrect/);
  assert.match(source, /for \(const inc of \(pkg\.inclusions \|\| \[\]\)\)/);
  assert.match(source, /rawN\.includes\(incN\)/);
  assert.match(source, /verbatim 위반 의심/);
});
