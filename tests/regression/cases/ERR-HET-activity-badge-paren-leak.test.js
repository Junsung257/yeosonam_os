/**
 * @case ERR-HET-activity-badge-paren-leak
 * @summary A4 special-badge detection must ignore keyword matches inside parentheses.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-HET-activity-badge-paren-leak: activity badge core strips parenthetical text before keyword matching', () => {
  const source = read('src/components/admin/YeosonamA4Template.tsx');

  assert.match(source, /ERR-HET-activity-badge-paren-leak/);
  assert.match(source, /const core = activity \? activity\.replace\(\/\\s\*\\\(\[\^\)\]\*\\\)\\s\*\/g, ' '\)\.trim\(\) : ''/);
  assert.match(source, /if \(core &&/);
  assert.match(source, /return \{ bg: 'bg-cyan-50'/);
});
