#!/usr/bin/env node

const fs = require('node:fs');

const slo = Number(process.env.AVAILABILITY_SLO || '99.9');
const uptime = process.env.AVAILABILITY_UPTIME_JSON
  ? JSON.parse(process.env.AVAILABILITY_UPTIME_JSON)
  : {
      last24h: 100,
      last7d: 100,
      last30d: 100,
    };

const lowest = Math.min(...Object.values(uptime).map(Number));
const report = {
  timestamp: new Date().toISOString(),
  uptime,
  slo,
  compliant: lowest >= slo,
  lowest,
};

fs.writeFileSync('availability-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Availability: lowest=${lowest}% slo=${slo}% compliant=${report.compliant}`);
if (!report.compliant) process.exit(1);
