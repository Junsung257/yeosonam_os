/**
 * @case ERR-20260418-33
 * @summary product registration must not bypass the managed attraction workflow with ad-hoc seed scripts.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-33: auto bootstrap explicitly refuses automatic LLM or photo seeding', () => {
  const source = read('db/auto_bootstrap_assembler.js');

  assert.match(source, /자동 LLM 호출 X \/ 사진 자동 수집 X/);
  assert.match(source, /admin\/attractions/);
  assert.match(source, /stub/);
});

test('ERR-20260418-33: upload runner reports zero auto-seeded attraction records', () => {
  const source = read('src/lib/product-registration/upload-product-runner.ts');

  assert.match(source, /const attractionSeededCount = 0/);
  assert.match(source, /const attractionReflectedCount = 0/);
  assert.match(source, /attractionMatchedCount/);
  assert.match(source, /attractionUnmatchedCount/);
});

test('ERR-20260418-33: no destination-specific ad-hoc seed script is present for KWL', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'db/seed_kwl_attractions.js')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'db/seed_kul_attractions.js')), false);
});
