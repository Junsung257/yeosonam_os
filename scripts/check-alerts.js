#!/usr/bin/env node

const fs = require('node:fs');

function readJson(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const reports = [
  ['Vercel', readJson('vercel-cost.json', { critical: [] })],
  ['Supabase', readJson('supabase-cost.json', { critical: [] })],
  ['AI', readJson('ai-cost.json', { critical: [] })],
];

const critical = reports.flatMap(([provider, report]) =>
  (report.critical || []).map((item) => ({ provider, ...item })),
);
const alert = {
  timestamp: new Date().toISOString(),
  critical,
  status: critical.length > 0 ? 'alert' : 'pass',
};

fs.writeFileSync('cost-alerts.json', `${JSON.stringify(alert, null, 2)}\n`);
console.log(`Cost alerts: status=${alert.status} critical=${critical.length}`);
if (critical.length > 0) process.exit(1);
