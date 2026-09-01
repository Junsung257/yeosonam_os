import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, '.agents', 'skills');
const target = resolve(root, '.claude', 'skills');
const check = process.argv.includes('--check');

function assertSafeTarget() {
  const expected = resolve(root, '.claude', 'skills');
  if (target !== expected || !target.startsWith(`${root}${sep}`)) {
    throw new Error('Refusing to operate outside the repository Claude skill mirror.');
  }
}

function files(dir) {
  if (!existsSync(dir)) return [];
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...files(full));
    else if (entry.isFile()) result.push(relative(dir === source ? source : target, full).replaceAll('\\', '/'));
  }
  return result.sort();
}

function snapshot(dir) {
  const map = new Map();
  const base = dir;
  function walk(current) {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) map.set(relative(base, full).replaceAll('\\', '/'), readFileSync(full));
    }
  }
  walk(dir);
  return map;
}

function differences() {
  const left = snapshot(source);
  const right = snapshot(target);
  const names = [...new Set([...left.keys(), ...right.keys()])].sort();
  return names.filter((name) => !left.has(name) || !right.has(name) || !left.get(name).equals(right.get(name)));
}

if (!existsSync(source) || !statSync(source).isDirectory()) {
  throw new Error('Canonical skill directory .agents/skills is missing.');
}

assertSafeTarget();

if (check) {
  const diff = differences();
  if (diff.length) {
    console.error(`Agent skill mirror differs in ${diff.length} file(s):`);
    for (const name of diff.slice(0, 30)) console.error(`- ${name}`);
    process.exit(1);
  }
  console.log(`Agent skill sync passed (${files(source).length} files).`);
} else {
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  console.log(`Synced ${files(source).length} canonical skill files to .claude/skills.`);
}
