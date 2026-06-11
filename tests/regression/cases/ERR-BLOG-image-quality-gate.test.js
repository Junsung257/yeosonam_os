/**
 * @case ERR-BLOG-image-quality-gate (2026-06-12)
 * @summary Blog image quality checks must run both at publish time and in the
 * browser audit.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('ERR-BLOG-image-quality-gate: publish gate includes image quality', () => {
  const gate = read('src', 'lib', 'blog-quality-gate.ts');

  assert.match(gate, /import \{ inspectBlogImageQuality \} from ['"]\.\/blog-image-quality['"]/);
  assert.match(gate, /export function checkImageQuality/);
  assert.match(gate, /gate: ['"]image_quality['"]/);
  assert.match(gate, /gates\.push\(checkImageQuality\(input\)\)/);
});

test('ERR-BLOG-image-quality-gate: browser image audit probes reachability and visible image state', () => {
  const pkg = JSON.parse(read('package.json'));
  const audit = read('scripts', 'audit-blog-image-quality.mjs');

  assert.equal(pkg.scripts['audit:blog-images'], 'node scripts/audit-blog-image-quality.mjs');
  assert.match(audit, /async function probeImageUrl/);
  assert.match(audit, /method: ['"]HEAD['"]/);
  assert.match(audit, /method: ['"]GET['"]/);
  assert.match(audit, /Range: ['"]bytes=0-0['"]/);
  assert.match(audit, /waitForSelector\(['"]article img['"]/);
  assert.match(audit, /naturalWidth/);
  assert.match(audit, /missingAlt/);
  assert.match(audit, /duplicate_within_post/);
});
