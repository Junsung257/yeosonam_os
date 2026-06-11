/**
 * @case ERR-BLOG-render-markdown-skip (2026-06-07)
 * @summary Stored blog bodies may mix markdown with safe inline HTML such as
 * figcaption; markdown signals must still be parsed and audited.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const renderer = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'blog-renderer.ts'), 'utf8');
const rendererTest = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'blog-renderer.test.ts'), 'utf8');

test('ERR-BLOG-render-markdown-skip: renderer parses markdown even around figcaption HTML', () => {
  assert.match(renderer, /await import\(['"]marked['"]\)/);
  assert.match(renderer, /marked\.parse\(mdAccented,\s*\{\s*gfm:\s*true\s*\}\)/);
  assert.ok(
    renderer.includes("out = out.replace(/(<\\/figcaption>)[ \\t]+/gi, '$1\\n\\n');"),
    'figcaption must be split back into block markdown flow',
  );
});

test('ERR-BLOG-render-markdown-skip: render integrity detects skipped markdown artifacts', () => {
  assert.match(renderer, /literal_markdown_image/);
  assert.match(renderer, /literal_markdown_heading/);
  assert.match(renderer, /literal_markdown_link/);
  assert.match(renderer, /missing_rendered_images/);
});

test('ERR-BLOG-render-markdown-skip: unit tests keep mixed markdown and figcaption behavior covered', () => {
  assert.match(rendererTest, /safe inline figcaption HTML/);
  assert.match(rendererTest, /reports literal markdown artifacts/);
  assert.match(rendererTest, /keeps markdown lists and links renderable after inline figcaption HTML/);
});
