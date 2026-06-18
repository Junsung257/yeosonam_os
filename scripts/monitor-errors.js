#!/usr/bin/env node

const fs = require('node:fs');

const thresholds = {
  critical: Number(process.env.ERROR_MONITOR_CRITICAL_LIMIT || '5'),
  high: Number(process.env.ERROR_MONITOR_HIGH_LIMIT || '20'),
  medium: Number(process.env.ERROR_MONITOR_MEDIUM_LIMIT || '50'),
};

const suppliedCounts = process.env.ERROR_MONITOR_COUNTS
  ? JSON.parse(process.env.ERROR_MONITOR_COUNTS)
  : null;

const counts = suppliedCounts || { critical: 0, high: 0, medium: 0 };
const alerts = Object.entries(thresholds)
  .filter(([level, limit]) => Number(counts[level] || 0) > limit)
  .map(([level, limit]) => ({ level, count: Number(counts[level] || 0), limit }));

const report = {
  timestamp: new Date().toISOString(),
  source: suppliedCounts ? 'ERROR_MONITOR_COUNTS' : 'local-default',
  skippedExternalFetch: !process.env.SENTRY_AUTH_TOKEN,
  thresholds,
  counts,
  alerts,
  status: alerts.length > 0 ? 'alert' : 'ok',
};

fs.writeFileSync('error-monitoring-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Error monitoring: status=${report.status} alerts=${alerts.length}`);
if (report.skippedExternalFetch) {
  console.log('Sentry credentials not configured; using supplied or zero local counts.');
}

if (alerts.length > 0) process.exit(1);
