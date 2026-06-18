#!/usr/bin/env node

const fs = require('node:fs');

const usage = process.env.SUPABASE_USAGE_JSON
  ? JSON.parse(process.env.SUPABASE_USAGE_JSON)
  : {
      databaseSizeGB: { current: 0, limit: 8, period: 'project' },
      monthlyActiveUsers: { current: 0, limit: 50000, period: 'month' },
      storageGB: { current: 0, limit: 5, period: 'project' },
    };

function classify(resource, data) {
  const percent = data.limit > 0 ? (Number(data.current) / Number(data.limit)) * 100 : 0;
  return {
    resource,
    ...data,
    percent: Number(percent.toFixed(1)),
    status: percent >= 100 ? 'critical' : percent >= 80 ? 'warning' : 'ok',
  };
}

const resources = Object.entries(usage).map(([resource, data]) => classify(resource, data));
const warnings = resources.filter((item) => item.status === 'warning');
const critical = resources.filter((item) => item.status === 'critical');
const report = {
  timestamp: new Date().toISOString(),
  source: process.env.SUPABASE_USAGE_JSON ? 'SUPABASE_USAGE_JSON' : 'local-default',
  resources,
  warnings,
  critical,
};

fs.writeFileSync('supabase-cost.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Supabase cost: warnings=${warnings.length} critical=${critical.length}`);
if (critical.length > 0) process.exit(1);
