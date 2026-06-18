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

function readJson(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function baseRef(analysis) {
  return analysis.baseRef || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');
}

const analysis = readJson('analysis-result.json', { baseRef: null, files: {}, filesChanged: 0 });
const base = baseRef(analysis);
const changedFiles = Object.keys(analysis.files || {});
const diff = base ? git(['diff', `${base}...HEAD`]) : git(['diff', 'HEAD']);

const checks = {
  hasTests: changedFiles.some((file) => /\.(spec|test)\.(ts|tsx|js|jsx)$/i.test(file) || /(^|\/)tests?\//i.test(file)),
  hasDocumentation: changedFiles.some((file) => /\.mdx?$/i.test(file)) || git(['diff', '--name-only', `${base}...HEAD`, '--', '*.md', '*.mdx']).length > 0,
  followsConventions: false,
  hasErrorHandling: /try\s*\{|catch\s*\(|\.catch\s*\(/.test(diff),
  hasTypeDefinitions: false,
  issues: [],
};

try {
  const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'));
  checks.hasTypeDefinitions = Boolean(tsconfig.compilerOptions?.strict);
} catch {
  checks.issues.push('tsconfig.json could not be read');
}

const commitMessages = git(['log', `${base}...HEAD`, '--format=%B']);
checks.followsConventions = /^(feat|fix|refactor|docs|test|perf|style|chore)(\(.+\))?:/m.test(commitMessages);

if (!checks.hasTests && analysis.filesChanged > 3) {
  checks.issues.push('More than three code files changed without a changed test file');
}
if (!checks.hasTypeDefinitions) {
  checks.issues.push('TypeScript strict mode is not enabled');
}

console.log('Code quality checklist');
console.log(`Has tests: ${checks.hasTests}`);
console.log(`Has documentation: ${checks.hasDocumentation}`);
console.log(`Type definitions: ${checks.hasTypeDefinitions}`);
console.log(`Error handling: ${checks.hasErrorHandling}`);
console.log(`Conventional commits: ${checks.followsConventions}`);

fs.writeFileSync('practices-result.json', `${JSON.stringify(checks, null, 2)}\n`);
