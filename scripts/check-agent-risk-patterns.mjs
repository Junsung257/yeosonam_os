#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = new Set(process.argv.slice(2));
const checkAll = args.has('--all') || args.has('--write-baseline');
const reportOnly = args.has('--report-only');
const writeBaseline = args.has('--write-baseline');
const baselinePath = resolve(root, 'config/agent-risk-baseline.json');
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const rules = [
  { id: 'no-new-as-any', severity: 'P2', pattern: /\bas\s+any\b|:\s*any\b|any\s*\[/, message: 'Define a type, guard, or unknown-to-specific cast.' },
  {
    id: 'no-api-direct-json-response', severity: 'P2', pattern: /\b(?:NextResponse|Response)\.json\s*\(/,
    message: 'API routes should use apiResponse unless streaming or explicitly exempted.',
    appliesTo: (file) => file.startsWith('src/app/api/') && file.endsWith('/route.ts'),
  },
  { id: 'no-direct-llm-client', severity: 'P2', pattern: /\bnew\s+(?:OpenAI|Anthropic|GoogleGenerativeAI)\s*\(/, message: 'Keep direct LLM clients behind approved gateway or specialist modules.' },
  {
    id: 'no-service-role-bearer', severity: 'P0',
    pattern: /Authorization.*Bearer.*SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY.*Authorization.*Bearer/,
    message: 'Service-role keys must never be sent or documented as HTTP bearer tokens.',
  },
];

const allowFiles = new Set([
  'scripts/check-agent-risk-patterns.mjs',
  'src/lib/llm-gateway.ts',
  'src/lib/secret-registry.ts',
  'src/lib/ai-provider-policy.ts',
  'src/lib/normalize-with-llm.ts',
  'src/lib/gemini-agent-loop-v2.ts',
  'src/lib/blog-ai-caller.ts',
]);

function git(values) {
  try { return execFileSync('git', values, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return ''; }
}

const normalize = (path) => path.replaceAll('\\', '/');
const isSource = (path) => sourceExtensions.has(extname(path));

function allFiles() {
  return git(['ls-files', 'src']).split(/\r?\n/).map((line) => line.trim()).filter((path) => path && isSource(path));
}

function changedFiles() {
  const files = new Set();
  for (const command of [
    ['diff', '--name-only', '--diff-filter=ACMRTUXB'],
    ['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB'],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    for (const path of git(command).split(/\r?\n/).map((line) => line.trim())) if (path && isSource(path)) files.add(path);
  }
  return [...files].sort();
}

function addedLines(diff) {
  const map = new Map();
  let file = null;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      file = normalize(line.slice(6));
      if (!map.has(file)) map.set(file, []);
    } else if (line.startsWith('+++ /dev/null')) file = null;
    else if (file && line.startsWith('+') && !line.startsWith('+++')) map.get(file).push(line.slice(1));
  }
  return map;
}

function candidates() {
  if (checkAll) return new Map(allFiles().filter(existsSync).map((path) => [path, readFileSync(resolve(root, path), 'utf8').split(/\r?\n/)]));
  const map = addedLines(`${git(['diff', '--unified=0', '--diff-filter=ACMRTUXB'])}\n${git(['diff', '--cached', '--unified=0', '--diff-filter=ACMRTUXB'])}`);
  for (const path of changedFiles()) {
    if (git(['ls-files', '--others', '--exclude-standard', '--', path]).trim() !== path) continue;
    const full = resolve(root, path);
    if (existsSync(full) && statSync(full).isFile()) map.set(path, readFileSync(full, 'utf8').split(/\r?\n/));
  }
  return map;
}

const offenders = [];
for (const [path, lines] of candidates()) {
  const file = normalize(path);
  if (!isSource(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) || allowFiles.has(file)) continue;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      if ((!rule.appliesTo || rule.appliesTo(file)) && rule.pattern.test(line)) {
        const contentHash = createHash('sha256').update(trimmed.replace(/\s+/g, ' ')).digest('hex').slice(0, 12);
        offenders.push({ file, line: checkAll ? index + 1 : 'added', rule: rule.id, severity: rule.severity, message: rule.message, key: `${rule.id}|${file}|${contentHash}` });
      }
    }
  });
}

const counts = new Map();
for (const item of offenders) counts.set(item.key, (counts.get(item.key) || 0) + 1);
const high = offenders.filter((item) => ['P0', 'P1'].includes(item.severity));

if (writeBaseline) {
  if (high.length) {
    console.error(`Refusing to baseline ${high.length} P0/P1 finding(s).`);
    process.exit(1);
  }
  const baseline = {
    schemaVersion: 1,
    snapshotCommit: git(['rev-parse', 'HEAD']).trim(),
    generatedAt: new Date().toISOString(),
    counts: Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Wrote risk baseline with ${offenders.length} P2 finding(s) across ${counts.size} signatures.`);
  process.exit(0);
}

let failures = [...high];
let existingDebt = 0;
if (checkAll) {
  let baseline = { counts: {} };
  if (existsSync(baselinePath)) baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  for (const [key, count] of counts) {
    const allowed = Number(baseline.counts?.[key] || 0);
    existingDebt += Math.min(count, allowed);
    if (count > allowed) failures.push(...offenders.filter((item) => item.key === key).slice(allowed));
  }
} else {
  failures = offenders;
}

if (failures.length) {
  console.error(`Agent risk ratchet found ${failures.length} new or unbaselinable issue(s):`);
  for (const item of failures.slice(0, 50)) console.error(`- ${item.file}:${item.line} [${item.severity} ${item.rule}] ${item.message}`);
  if (failures.length > 50) console.error(`- ...and ${failures.length - 50} more`);
  process.exit(reportOnly ? 0 : 1);
}

console.log(`Agent risk ratchet passed; existing P2 debt=${existingDebt}, new violations=0.`);
