/**
 * @case ERR-BLOG-visual-blindspot (2026-06-08)
 * @summary DOM/URL audits are not enough; the visual audit must inspect actual
 * desktop/mobile viewports for markdown artifacts, strikethrough, overflow,
 * broken images, and card image gaps.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const source = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-blog-visual-system.mjs'), 'utf8');

test('ERR-BLOG-visual-blindspot: package exposes the visual audit command', () => {
  assert.equal(pkg.scripts['audit:blog-visual'], 'node scripts/audit-blog-visual-system.mjs');
});

test('ERR-BLOG-visual-blindspot: audit checks desktop and mobile viewports', () => {
  assert.match(source, /VIEWPORTS/);
  assert.match(source, /name:\s*['"]desktop['"]/);
  assert.match(source, /name:\s*['"]mobile['"]/);
  assert.match(source, /page\.setViewportSize/);
});

test('ERR-BLOG-visual-blindspot: audit detects visual-only failure classes', () => {
  assert.match(source, /markdown_strike/);
  assert.match(source, /visible_strikethrough_or_deletion/);
  assert.match(source, /table_overflow/);
  assert.match(source, /page_horizontal_overflow/);
  assert.match(source, /visible_broken_or_tiny_images/);
  assert.match(source, /blog_card_missing_image/);
  assert.match(source, /if \(strict && summary\.failed > 0\) process\.exitCode = 1/);
});

