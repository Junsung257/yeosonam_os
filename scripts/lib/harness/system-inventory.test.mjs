import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

test('system inventory excludes ignored build artifacts', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'yeosonam-inventory-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: temporaryRoot });
    write(join(temporaryRoot, '.gitignore'), 'src/app/ignored/\n');
    write(join(temporaryRoot, 'src/app/tracked/route.ts'), 'export const GET = () => null;\n');
    write(join(temporaryRoot, 'src/app/ignored/route.js'), 'generated\n');
    mkdirSync(join(temporaryRoot, 'scripts'), { recursive: true });
    copyFileSync(
      join(repositoryRoot, 'scripts/generate-system-inventory.mjs'),
      join(temporaryRoot, 'scripts/generate-system-inventory.mjs'),
    );

    execFileSync(process.execPath, ['scripts/generate-system-inventory.mjs'], {
      cwd: temporaryRoot,
      stdio: 'pipe',
    });
    const inventory = JSON.parse(
      readFileSync(join(temporaryRoot, 'docs/generated/system-inventory.json'), 'utf8'),
    );

    assert.deepEqual(inventory.routes, ['src/app/tracked/route.ts']);
  } finally {
    const expectedPrefix = resolve(tmpdir(), 'yeosonam-inventory-');
    assert.ok(resolve(temporaryRoot).startsWith(expectedPrefix));
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
