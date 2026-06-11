/**
 * @case ERR-HET-render-over-split
 * @summary schedule splitting must not promote descriptive parenthetical lists into fake attractions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-HET-render-over-split: insert-template splitScheduleItems skips descriptive parenthetical CSVs', () => {
  const source = read('db/templates/insert-template.js');

  assert.match(source, /ERR-HET-render-over-split/);
  assert.match(source, /const parenMatch = body\.match\(\/\\\(\(\[\^\)\]\*\)\\\)\/\)/);
  assert.match(source, /const hasDescriptive = DESCRIPTIVE_KW\.test\(innerCSV\)/);
  assert.match(source, /if \(!suffix \|\| hasDescriptive\) \{/);
  assert.match(source, /result\.push\(item\)/);
});
