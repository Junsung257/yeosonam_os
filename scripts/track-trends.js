#!/usr/bin/env node

const fs = require('node:fs');

function readJson(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const metrics = {
  timestamp: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  vitals: readJson('vitals-result.json', { status: 'missing' }),
  bundle: readJson('bundle-result.json', { status: 'missing' }),
  api: readJson('api-perf-result.json', { status: 'missing' }),
  db: readJson('db-perf-result.json', { status: 'missing' }),
};

const historyFile = '.perf-history.jsonl';
const history = fs.existsSync(historyFile)
  ? fs.readFileSync(historyFile, 'utf8').split(/\r?\n/).filter(Boolean)
  : [];
history.push(JSON.stringify(metrics));

fs.writeFileSync(historyFile, `${history.slice(-100).join('\n')}\n`);
fs.writeFileSync('perf-trend-report.json', `${JSON.stringify(metrics, null, 2)}\n`);
console.log('Performance trends recorded');
