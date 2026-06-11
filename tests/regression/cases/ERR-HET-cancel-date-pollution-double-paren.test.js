/**
 * @case ERR-HET-cancel-date-pollution-double-paren
 * @summary cancellation date enrichment must merge into existing parentheses.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-HET-cancel-date-pollution-double-paren: standard terms merge date into existing bracket text', () => {
  const source = read('src/lib/standard-terms.ts');

  assert.match(source, /ERR-HET-cancel-date-pollution-double-paren/);
  assert.match(source, /const withRangeDates = n\.text\.replace/);
  assert.match(source, /const enriched = withRangeDates\.replace/);
  assert.match(source, /if \(bracket\) \{/);
  assert.match(source, /return `\$\{daysStr\}.*\$\{inner\}, \$\{ymd\}/);
});

test('ERR-HET-cancel-date-pollution-double-paren: unit test covers existing-bracket merge', () => {
  const testSource = read('src/lib/standard-terms.test.ts');

  assert.match(testSource, /ERR-HET-cancel-date-pollution-double-paren/);
  assert.match(testSource, /기존 괄호/);
});
