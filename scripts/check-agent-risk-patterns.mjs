#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, relative } from 'node:path';

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const checkAll = args.has('--all');
const reportOnly = args.has('--report-only');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const rules = [
  {
    id: 'no-new-as-any',
    pattern: /\bas\s+any\b|:\s*any\b|any\s*\[/,
    message: 'new any/as any weakens type safety; define a type, guard, or unknown-to-specific cast',
  },
  {
    id: 'no-api-direct-json-response',
    pattern: /\b(?:NextResponse|Response)\.json\s*\(/,
    message: 'API routes should use apiResponse unless streaming or explicitly exempted',
    appliesTo(file) {
      return file.startsWith('src/app/api/') && file.endsWith('/route.ts');
    },
  },
  {
    id: 'no-direct-llm-client',
    pattern: /\bnew\s+(?:OpenAI|Anthropic|GoogleGenerativeAI)\s*\(/,
    message: 'direct LLM clients must stay behind approved gateway/specialist modules',
  },
  {
    id: 'no-service-role-bearer',
    pattern: /Authorization.*Bearer.*SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY.*Authorization.*Bearer/,
    message: 'service-role keys must not be sent or documented as HTTP bearer tokens',
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

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function normalize(path) {
  return path.replace(/\\/g, '/');
}

function isSourceFile(file) {
  return SOURCE_EXTENSIONS.has(extname(file));
}

function allTrackedSourceFiles() {
  return git(['ls-files', 'src'])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((file) => file && isSourceFile(file));
}

function changedFiles() {
  const files = new Set();
  for (const command of [
    ['diff', '--name-only', '--diff-filter=ACMRTUXB'],
    ['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB'],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    for (const file of git(command).split(/\r?\n/)) {
      const trimmed = file.trim();
      if (trimmed && isSourceFile(trimmed)) files.add(trimmed);
    }
  }
  return [...files].sort();
}

function addedLinesFromDiff(diffText) {
  const linesByFile = new Map();
  let currentFile = null;

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      currentFile = normalize(line.slice('+++ b/'.length));
      if (!linesByFile.has(currentFile)) linesByFile.set(currentFile, []);
      continue;
    }
    if (line.startsWith('+++ /dev/null')) {
      currentFile = null;
      continue;
    }
    if (!currentFile || !line.startsWith('+') || line.startsWith('+++')) continue;
    linesByFile.get(currentFile).push(line.slice(1));
  }

  return linesByFile;
}

function candidateLines() {
  if (checkAll) {
    const map = new Map();
    for (const file of allTrackedSourceFiles()) {
      if (!existsSync(file)) continue;
      map.set(file, readFileSync(file, 'utf8').split(/\r?\n/));
    }
    return map;
  }

  const map = addedLinesFromDiff([
    git(['diff', '--unified=0', '--diff-filter=ACMRTUXB']),
    git(['diff', '--cached', '--unified=0', '--diff-filter=ACMRTUXB']),
  ].join('\n'));

  for (const file of changedFiles()) {
    if (git(['ls-files', '--others', '--exclude-standard', '--', file]).trim() !== file) continue;
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    map.set(file, readFileSync(file, 'utf8').split(/\r?\n/));
  }

  return map;
}

const offenders = [];

for (const [file, lines] of candidateLines()) {
  const rel = normalize(relative(ROOT, file) || file);
  const normalizedFile = normalize(file);
  const target = normalizedFile.startsWith('src/') ? normalizedFile : rel;
  if (!isSourceFile(target)) continue;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(target)) continue;
  if (allowFiles.has(target)) continue;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    for (const rule of rules) {
      if (rule.appliesTo && !rule.appliesTo(target)) continue;
      if (!rule.pattern.test(line)) continue;
      offenders.push({
        file: target,
        line: checkAll ? index + 1 : 'added',
        rule: rule.id,
        message: rule.message,
      });
    }
  });
}

if (offenders.length > 0) {
  console.error('Agent risk pattern check found issues:');
  for (const offender of offenders.slice(0, 50)) {
    console.error(`- ${offender.file}:${offender.line} [${offender.rule}] ${offender.message}`);
  }
  if (offenders.length > 50) console.error(`- ...and ${offenders.length - 50} more`);
  process.exit(reportOnly ? 0 : 1);
}

console.log('Agent risk pattern check passed.');
