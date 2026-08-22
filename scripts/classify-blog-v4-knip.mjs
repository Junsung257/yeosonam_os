#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const baselinePath = resolve('scripts/knip-baseline.json');
const outputPath = resolve('artifacts/blog-v4-integration/knip-classification.json');
const issueTypes = [
  'files',
  'dependencies',
  'devDependencies',
  'optionalPeerDependencies',
  'unlisted',
  'unresolved',
  'binaries',
  'exports',
  'types',
  'duplicates',
  'enumMembers',
  'namespaceMembers',
  'catalog',
];

function runKnip() {
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/c', '.\\node_modules\\.bin\\knip.cmd', '--reporter', 'json', '--no-exit-code'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
    : spawnSync('./node_modules/.bin/knip', ['--reporter', 'json', '--no-exit-code'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
  if (result.status !== 0 && !result.stdout) {
    throw new Error(result.stderr || `knip_failed:${result.status}`);
  }
  return JSON.parse(result.stdout || '{"issues":[]}');
}

function issueKey(type, file, item) {
  const name = Array.isArray(item) ? item.map(entry => entry.name).join(',') : item.name;
  return `${type}:${file}:${name}`;
}

function collectIssues(report) {
  const issues = [];
  for (const issue of report.issues ?? []) {
    for (const type of issueTypes) {
      for (const item of issue[type] ?? []) {
        const name = Array.isArray(item) ? item.map(entry => entry.name).join(',') : item.name;
        issues.push({ key: issueKey(type, issue.file, item), type, file: issue.file, name });
      }
    }
  }
  return issues.sort((a, b) => a.key.localeCompare(b.key));
}

function isBlogScope(issue) {
  return issue.file.startsWith('src/lib/blog')
    || issue.file.startsWith('src/app/blog/')
    || (issue.file.startsWith('scripts/') && issue.file.includes('blog'))
    || issue.file.startsWith('.github/workflows/blog-v4-')
    || issue.file === 'package.json';
}

function classify(issue) {
  if (issue.type === 'binaries' && (
    issue.file.startsWith('.github/workflows/')
    || issue.file === 'package.json'
  )) {
    return {
      bucket: 'workflowEntrypoints',
      reason: 'CLI binary is invoked by a checked-in workflow or package script; it is not a source export to delete.',
    };
  }
  if (issue.file.startsWith('vendor/')) {
    return {
      bucket: 'generatedEntrypoints',
      reason: 'Vendored compatibility declaration is generated/maintained outside the application source graph.',
    };
  }
  if (isBlogScope(issue)) {
    return {
      bucket: 'domainReviewRequired',
      reason: 'Blog or Blog-adjacent entry/API surface; requires domain-aware review before deletion or allowlisting.',
    };
  }
  return {
    bucket: 'baselineDrift',
    reason: 'Issue is outside the Blog V4 release scope and reproduces in the clean #1140 worktree; no bulk deletion is authorized here.',
  };
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).issues ?? [];
const baselineSet = new Set(baseline);
const currentIssues = collectIssues(runKnip());
const added = currentIssues.filter(issue => !baselineSet.has(issue.key));
const buckets = {
  realDeadCode: [],
  workflowEntrypoints: [],
  generatedEntrypoints: [],
  baselineDrift: [],
  domainReviewRequired: [],
  unresolved: [],
};

for (const issue of added) {
  const decision = classify(issue);
  buckets[decision.bucket].push({ ...issue, reason: decision.reason });
}

const classifiedCount = Object.entries(buckets)
  .filter(([bucket]) => bucket !== 'unresolved')
  .reduce((sum, [, entries]) => sum + entries.length, 0);
const issueSetSha256 = createHash('sha256')
  .update(added.map(issue => issue.key).join('\n'), 'utf8')
  .digest('hex');
const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  command: 'npm run check:deadcode:raw -- --reporter json --no-exit-code',
  baselinePath: 'scripts/knip-baseline.json',
  baselineIssueCount: baseline.length,
  currentIssueCount: currentIssues.length,
  newIssueCount: added.length,
  classifiedCount,
  issueSetSha256,
  comparison: {
    worktree: 'C:/dev/yeosonam-os-blog-v4-content-factory',
    observedResult: 'current=1381 baseline=1029 new=396 resolved=44',
    interpretation: 'The same issue set is present on the clean #1140 worktree; this artifact does not authorize mass baseline addition or deletion.',
  },
  counts: Object.fromEntries(Object.entries(buckets).map(([bucket, entries]) => [bucket, entries.length])),
  ...buckets,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ output: 'artifacts/blog-v4-integration/knip-classification.json', ...artifact.counts }, null, 2)}\n`);
