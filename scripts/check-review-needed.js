#!/usr/bin/env node

const fs = require('node:fs');

function readJson(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const analysis = readJson('analysis-result.json', {
  filesChanged: 0,
  patterns: {},
});
const practices = readJson('practices-result.json', {
  hasTests: false,
  issues: [],
});

const patternCounts = Object.fromEntries(
  Object.entries(analysis.patterns || {}).map(([name, items]) => [name, Array.isArray(items) ? items.length : 0]),
);
const issueCount = Object.values(patternCounts).reduce((sum, count) => sum + count, 0);
const practiceIssues = Array.isArray(practices.issues) ? practices.issues.length : 0;
const reviewNeeded = issueCount > 0 || practiceIssues > 0;

const report = {
  reviewNeeded,
  issueCount,
  practiceIssues,
  patternCounts,
};

if (reviewNeeded) {
  console.log(`${issueCount + practiceIssues} review signal(s) detected`);
} else {
  console.log('No review signals detected');
}

fs.writeFileSync('review-needed.json', `${JSON.stringify(report, null, 2)}\n`);
