#!/usr/bin/env node

const fs = require('node:fs');

const usage = process.env.VERCEL_USAGE_JSON
  ? JSON.parse(process.env.VERCEL_USAGE_JSON)
  : {
      functionInvocations: { current: 0, limit: 1000000, period: 'month' },
      bandwidthGB: { current: 0, limit: 100, period: 'month' },
      buildMinutes: { current: 0, limit: 6000, period: 'month' },
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
  source: process.env.VERCEL_USAGE_JSON ? 'VERCEL_USAGE_JSON' : 'local-default',
  resources,
  warnings,
  critical,
};

fs.writeFileSync('vercel-cost.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Vercel cost: warnings=${warnings.length} critical=${critical.length}`);
if (critical.length > 0) process.exit(1);
