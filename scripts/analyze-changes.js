#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

function git(args, fallback = '') {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return fallback;
  }
}

function baseRef() {
  const candidates = [
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : '',
    'origin/main',
    'HEAD~1',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (git(['rev-parse', '--verify', candidate])) return candidate;
  }
  return '';
}

function changedCodeFiles(base) {
  const args = base ? ['diff', '--name-only', `${base}...HEAD`] : ['diff', '--name-only', 'HEAD'];
  return git(args)
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter((file) => /\.(ts|tsx|js|jsx)$/i.test(file));
}

function codeDiffs(base) {
  const range = base ? `${base}...HEAD` : 'HEAD';
  const output = git([
    'diff', '--no-ext-diff', '--unified=0', range, '--', '*.ts', '*.tsx', '*.js', '*.jsx',
  ]);
  const diffs = new Map();
  let currentFile = null;
  let currentLines = [];

  function flush() {
    if (currentFile) diffs.set(currentFile, currentLines.join('\n'));
  }

  for (const line of output.split(/\r?\n/)) {
    const header = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (header) {
      flush();
      currentFile = header[2];
      currentLines = [line];
      continue;
    }
    if (currentFile) currentLines.push(line);
  }
  flush();
  return diffs;
}

const base = baseRef();
const files = changedCodeFiles(base);
const diffs = codeDiffs(base);
const analysis = {
  baseRef: base || null,
  filesChanged: files.length,
  files: {},
  patterns: {
    complexityIncrease: [],
    potentialBugs: [],
    performanceIssues: [],
    securityConcerns: [],
    testingGaps: [],
  },
};

for (const file of files) {
  const diff = diffs.get(file.replace(/\\/g, '/')) || '';
  const addedLines = diff.split(/\r?\n/).filter((line) => line.startsWith('+') && !line.startsWith('+++'));
  const removedLines = diff.split(/\r?\n/).filter((line) => line.startsWith('-') && !line.startsWith('---'));
  const stats = {
    file,
    additions: addedLines.length,
    deletions: removedLines.length,
    isNewFile: /new file mode/.test(diff),
    isTest: /\.(spec|test)\.(ts|tsx|js|jsx)$/i.test(file) || /(^|\/)tests?\//i.test(file),
    isComponent: /\.tsx$/i.test(file),
    isLib: /(^|\/)(lib|utils)\//i.test(file),
  };

  const addedText = addedLines.join('\n');
  if (stats.additions > 500) analysis.patterns.complexityIncrease.push(file);
  if (/\bany\b/.test(addedText) && stats.isComponent) analysis.patterns.potentialBugs.push(file);
  if (/JSON\.parse\(|setTimeout\(|fetch\(/.test(addedText)) analysis.patterns.potentialBugs.push(file);
  if (/for\s*\(|while\s*\(|\.map\([^)]*=>[\s\S]*\.map\(/.test(addedText)) {
    analysis.patterns.performanceIssues.push(file);
  }
  if (/(api[_-]?key|secret|password|token)/i.test(addedText)) {
    analysis.patterns.securityConcerns.push(file);
  }
  if (stats.isNewFile && !stats.isTest) analysis.patterns.testingGaps.push(file);

  analysis.files[file] = stats;
}

const totals = Object.values(analysis.files).reduce(
  (sum, file) => ({
    additions: sum.additions + file.additions,
    deletions: sum.deletions + file.deletions,
  }),
  { additions: 0, deletions: 0 },
);

console.log('Code change analysis');
console.log(`Base ref: ${analysis.baseRef || 'working tree'}`);
console.log(`Files changed: ${analysis.filesChanged}`);
console.log(`Total additions: ${totals.additions}`);
console.log(`Total deletions: ${totals.deletions}`);

fs.writeFileSync('analysis-result.json', `${JSON.stringify(analysis, null, 2)}\n`);
