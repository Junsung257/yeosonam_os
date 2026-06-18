#!/usr/bin/env node

const fs = require('node:fs');

function readJson(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const trends = {
  timestamp: new Date().toISOString(),
  month: new Date().toISOString().slice(0, 7),
  vercel: readJson('vercel-cost.json', { warnings: [], critical: [] }),
  supabase: readJson('supabase-cost.json', { warnings: [], critical: [] }),
  ai: readJson('ai-cost.json', { warnings: [], critical: [], totalCost: 0, totalBudget: 0 }),
};

const totalCritical = trends.vercel.critical.length + trends.supabase.critical.length + trends.ai.critical.length;
const totalWarnings = trends.vercel.warnings.length + trends.supabase.warnings.length + trends.ai.warnings.length;
const report = {
  ...trends,
  totalCritical,
  totalWarnings,
};

const historyFile = '.cost-history.jsonl';
const history = fs.existsSync(historyFile)
  ? fs.readFileSync(historyFile, 'utf8').split(/\r?\n/).filter(Boolean)
  : [];
history.push(JSON.stringify(report));
fs.writeFileSync(historyFile, `${history.slice(-30).join('\n')}\n`);
fs.writeFileSync('cost-trend-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Cost trends: warnings=${totalWarnings} critical=${totalCritical}`);
