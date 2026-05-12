import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGETS = ['src', 'scripts', 'db'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const KEY_PATTERN = /process\.env\.([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|KEY)[A-Z0-9_]*)/g;

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name.startsWith('.git')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(path.extname(e.name))) out.push(full);
  }
  return out;
}

const keyMap = new Map();

for (const target of TARGETS) {
  const abs = path.join(ROOT, target);
  if (!fs.existsSync(abs)) continue;
  const files = walk(abs);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(KEY_PATTERN)) {
      const key = m[1];
      if (!keyMap.has(key)) keyMap.set(key, new Set());
      keyMap.get(key).add(path.relative(ROOT, file).replace(/\\/g, '/'));
    }
  }
}

const rows = [...keyMap.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, files]) => `- ${key}\n  - ${[...files].sort().join('\n  - ')}`)
  .join('\n');

console.log('# API Key Usage Audit\n');
console.log(rows || '(검색 결과 없음)');

