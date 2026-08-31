import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRECT_CALL_PATTERNS = [
  /api\.deepseek\.com/u,
  /generativelanguage\.googleapis\.com/u,
  /api\.anthropic\.com/u,
  /api\.openai\.com/u,
  /\.generateContent\s*\(/u,
  /chat\.completions\.create\s*\(/u,
  /responses\.create\s*\(/u,
];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function normalize(file) {
  return relative(ROOT, file).replaceAll('\\', '/');
}

export function auditLlmTelemetryCoverage() {
  const baselinePath = join(ROOT, 'config', 'llm-telemetry-baseline.json');
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const allowedUntraced = new Set(baseline.untracedDirectCallFiles ?? []);
  const directFiles = walk(join(ROOT, 'src'))
    .filter((file) => /\.(?:ts|tsx)$/u.test(file) && !file.endsWith('.d.ts') && !/\.test\.[^.]+$/u.test(file))
    .filter((file) => DIRECT_CALL_PATTERNS.some((pattern) => pattern.test(readFileSync(file, 'utf8'))));

  const entries = directFiles.map((file) => {
    const source = readFileSync(file, 'utf8');
    const path = normalize(file);
    return {
      file: path,
      traced: source.includes('traceLlmCall('),
      grandfathered: allowedUntraced.has(path),
    };
  }).sort((left, right) => left.file.localeCompare(right.file));

  const newUntraced = entries.filter((entry) => !entry.traced && !entry.grandfathered);
  const currentUntraced = new Set(entries.filter((entry) => !entry.traced).map((entry) => entry.file));
  const staleBaseline = [...allowedUntraced].filter((file) => !currentUntraced.has(file) || !existsSync(join(ROOT, file)));

  return {
    ok: newUntraced.length === 0,
    generatedAt: new Date().toISOString(),
    summary: {
      directCallFiles: entries.length,
      tracedFiles: entries.filter((entry) => entry.traced).length,
      grandfatheredUntracedFiles: entries.filter((entry) => !entry.traced && entry.grandfathered).length,
      newUntracedFiles: newUntraced.length,
      staleBaselineFiles: staleBaseline.length,
    },
    newUntraced: newUntraced.map((entry) => entry.file),
    staleBaseline,
    entries,
  };
}

function printHuman(report) {
  console.log(`LLM telemetry coverage audit: ${report.ok ? 'PASS' : 'FAIL'}`);
  console.log(`Direct callers: ${report.summary.directCallFiles}`);
  console.log(`Traced: ${report.summary.tracedFiles}`);
  console.log(`Grandfathered untraced: ${report.summary.grandfatheredUntracedFiles}`);
  for (const file of report.newUntraced) console.error(`ERROR new_untraced_direct_llm_call:${file}`);
  for (const file of report.staleBaseline) console.warn(`WARN stale_llm_telemetry_baseline:${file}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const report = auditLlmTelemetryCoverage();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (process.argv.includes('--strict') && !report.ok) process.exitCode = 1;
}
