/**
 * @case ERR-regression-coverage-batch2
 * @summary regression runner must execute every fixture file so batch coverage additions stay visible.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-regression-coverage-batch2: runner discovers all .test.js cases and supports targeted filters', () => {
  const source = read('tests/regression/run.js');
  const pkg = read('package.json');

  assert.match(source, /const CASES_DIR = path\.join\(__dirname, 'cases'\)/);
  assert.match(source, /\.filter\(\(file\) => file\.endsWith\('\.test\.js'\)\)/);
  assert.match(source, /process\.argv\.indexOf\('--filter'\)/);
  assert.match(source, /spawnSync\('node', \['--test', '--test-reporter=spec', \.\.\.cases\]/);
  assert.match(pkg, /"test:regression": "node tests\/regression\/run\.js"/);
});
