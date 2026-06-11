/**
 * @case ERR-BLOG-mobile-heading-flex-overflow
 * @summary Blog h2 headings must keep generated text in normal wrapping flow; unwrapped flex headings caused mobile overflow.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readCss() {
  return fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');
}

function cssBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `${selector} block must exist`);
  return match[1];
}

test('ERR-BLOG-mobile-heading-flex-overflow: .prose-blog h2 is block flow, not flex', () => {
  const block = cssBlock(readCss(), '.prose-blog h2');

  assert.match(block, /display:\s*block\s*;/);
  assert.doesNotMatch(block, /display:\s*(inline-)?flex\s*;/);
});

test('ERR-BLOG-mobile-heading-flex-overflow: h2 numbering stays in pseudo-element, not flex child layout', () => {
  const css = readCss();
  const h2Block = cssBlock(css, '.prose-blog h2');
  const beforeBlock = cssBlock(css, '.prose-blog h2::before');

  assert.doesNotMatch(h2Block, /align-items|justify-content|gap:/);
  assert.match(beforeBlock, /content:\s*counter\(h2-counter,\s*decimal-leading-zero\)/);
  assert.match(beforeBlock, /display:\s*inline-flex\s*;/);
});
