/**
 * @case ERR-20260418-34
 * @summary new destinations with enough packages must bootstrap assembler stubs with complete CLI arguments.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('ERR-20260418-34: bootstrap cron identifies destinations with three or more packages', () => {
  const source = read('src/app/api/cron/bootstrap-assembler/route.ts');

  assert.match(source, /const MIN_PACKAGES = 3/);
  assert.match(source, /if \(n < MIN_PACKAGES\) continue/);
  assert.match(source, /assemblerFileExists\(slug\)/);
  assert.match(source, /dryRun/);
});

test('ERR-20260418-34: bootstrap spawn passes both slug and dest-code to stub generator', () => {
  const source = read('src/app/api/cron/bootstrap-assembler/route.ts');

  assert.match(source, /const DEST_TO_CODE/);
  assert.match(source, /destCode: DEST_TO_CODE\[dest\] \?\? null/);
  assert.match(source, /if \(!c\.slug \|\| !c\.destCode \|\| isServerless\)/);
  assert.match(source, /`--dest-code=\$\{c\.destCode\}`/);
  assert.match(source, /`--slug=\$\{c\.slug\}`/);
  assert.match(source, /`--min=\$\{MIN_PACKAGES\}`/);
});

test('ERR-20260418-34: generated assembler remains a review stub instead of a final assembler', () => {
  const source = read('db/auto_bootstrap_assembler.js');

  assert.match(source, /assembler_\$\{slug\}\.stub\.js/);
  assert.match(source, /const finalPath = path\.resolve\(__dirname, `assembler_\$\{slug\}\.js`\)/);
  assert.match(source, /fs\.existsSync\(finalPath\)/);
  assert.match(source, /process\.exit\(1\)/);
  assert.match(source, /const BLOCKS = \[/);
});
