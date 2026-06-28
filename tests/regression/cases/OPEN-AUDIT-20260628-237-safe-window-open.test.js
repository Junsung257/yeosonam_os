/**
 * @case OPEN-AUDIT-20260628-237
 * @summary New-window openings must use noopener/noreferrer or the shared
 * safeOpenNewWindow helper.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function listSourceFiles(dir) {
  const abs = path.join(ROOT, dir);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(rel);
    return /\.(tsx?|jsx?)$/.test(entry.name) ? [rel] : [];
  });
}

test('OPEN-AUDIT-20260628-237: no direct _blank window.open call omits noopener/noreferrer', () => {
  const unsafe = [];
  for (const file of listSourceFiles('src')) {
    const source = read(file);
    source.split(/\r?\n/).forEach((line, index) => {
      if (!line.includes('window.open')) return;
      if (line.trim().startsWith('//')) return;
      if (file === path.join('src', 'lib', 'safe-window-open.ts')) return;
      if (!/window\.open\([^)]*['_"]_blank['_"]/.test(line)) return;
      if (/noopener/.test(line) && /noreferrer/.test(line)) return;
      unsafe.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }

  assert.deepEqual(unsafe, []);
});

test('OPEN-AUDIT-20260628-237: safeOpenNewWindow always applies opener protections', () => {
  const source = read(path.join('src', 'lib', 'safe-window-open.ts'));

  assert.match(source, /parts\.add\('noopener'\)/);
  assert.match(source, /parts\.add\('noreferrer'\)/);
  assert.match(source, /opened\.opener = null/);
});
