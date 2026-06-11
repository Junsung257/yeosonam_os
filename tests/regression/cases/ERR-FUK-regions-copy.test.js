/**
 * @case ERR-FUK-regions-copy
 * @summary day regions must be mapped from each product source block, not copied across variants.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-FUK-regions-copy: normalized intake schema describes per-source day regions', () => {
  const source = read('src/lib/intake-normalizer.ts');

  assert.match(source, /regions: z\.array\(z\.string\(\)\)/);
  assert.match(source, /ERR-FUK-regions-copy/);
});

test('ERR-FUK-regions-copy: post-register audit flags suspicious copied or unsupported regions', () => {
  const source = read('db/post_register_audit.js');

  assert.match(source, /function checkRegionsVsRawText\(pkg\)/);
  assert.match(source, /itinerary_data\?\.days/);
  assert.match(source, /rawNorm\.includes\(regNorm\)/);
  assert.match(source, /const fingerprints = days\.map/);
  assert.match(source, /new Set\(fingerprints\)/);
});
