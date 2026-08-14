/**
 * @case ERR-BLOG-prompt-highlight-regression (2026-08-13)
 * @summary The informational writer must never emit legacy highlight syntax.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-prompt-highlight-regression: writer contract bans highlights and requires valid tables', () => {
  const prompt = read('src', 'lib', 'blog-informational-writer-prompt.ts');
  const guide = read('src', 'prompts', 'blog', 'informational-writer-guide.ts');

  assert.match(prompt, /Do not use ==highlight==, <mark>/);
  assert.match(guide, /decorative highlight syntax/);
  assert.match(guide, /valid GitHub Flavored Markdown tables/);
  assert.doesNotMatch(guide, /use ==highlight==/i);
});
