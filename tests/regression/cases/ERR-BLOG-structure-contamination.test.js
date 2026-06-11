/**
 * @case ERR-BLOG-structure-contamination (2026-06-12)
 * @summary Blog structure artifacts must be checked inside the publish gate.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-structure-contamination: publish gate includes structure integrity', () => {
  const gate = read('src', 'lib', 'blog-quality-gate.ts');

  assert.match(gate, /import \{ inspectBlogStructure \} from ['"]\.\/blog-structure-audit['"]/);
  assert.match(gate, /export async function checkStructureIntegrity/);
  assert.match(gate, /inspectBlogStructure\(\{/);
  assert.match(gate, /gate: ['"]structure_integrity['"]/);
  assert.match(gate, /gates\.push\(await checkStructureIntegrity\(input\)\)/);
});

test('ERR-BLOG-structure-contamination: structure audit has fixture coverage for artifact classes', () => {
  const audit = read('src', 'lib', 'blog-structure-audit.ts');
  const unit = read('src', 'lib', 'blog-structure-audit.test.ts');

  assert.match(audit, /export function inspectBlogStructure/);
  assert.match(audit, /rawMarkdown/);
  assert.match(audit, /renderedHtml/);
  assert.match(unit, /inspectBlogStructure/);
  assert.match(unit, /rawMarkdown/);
  assert.match(unit, /renderedHtml/);
});
