import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const PATTERN = /process\.env\.[A-Z0-9_]*(KEY|SECRET|TOKEN)/g;
const ALLOW = new Set([
  'src/lib/secret-registry.ts',
  'src/lib/ai-provider-policy.ts',
  'src/lib/supabase.ts',
]);

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name.startsWith('.git')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(e.name))) out.push(full);
  }
  return out;
}

function getChangedFiles() {
  try {
    const out = execSync('git diff --name-only --cached --diff-filter=ACMRTUXB', {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((rel) => path.join(ROOT, rel));
  } catch {
    return [];
  }
}

const checkAll = process.argv.includes('--all');
const candidateFiles = checkAll ? walk(SRC) : getChangedFiles().filter((f) => f.startsWith(SRC));
if (candidateFiles.length === 0 && !checkAll) {
  console.log('SKIP: 비교할 변경 파일이 없습니다. (--all 로 전체 검사 가능)');
  process.exit(0);
}

const offenders = [];
for (const file of candidateFiles) {
  if (!fs.existsSync(file)) continue;
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (ALLOW.has(rel)) continue;
  const text = fs.readFileSync(file, 'utf8')
    // 주석 내부 문자열로 인한 오탐 방지
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  if (PATTERN.test(text)) offenders.push(rel);
}

if (offenders.length > 0) {
  console.error('직접 process.env 키 접근 금지 위반 파일:');
  for (const f of offenders) console.error(`- ${f}`);
  process.exit(1);
}

console.log('OK: 직접 process.env 키 접근 위반 없음');

