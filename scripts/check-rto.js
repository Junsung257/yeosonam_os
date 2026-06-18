#!/usr/bin/env node

const fs = require('node:fs');

const objectives = process.env.RTO_OBJECTIVES_JSON
  ? JSON.parse(process.env.RTO_OBJECTIVES_JSON)
  : {
      Database: { rtoMinutes: 15, rpoMinutes: 5, currentRtoMinutes: 0, currentRpoMinutes: 0 },
      Application: { rtoMinutes: 5, rpoMinutes: 0, currentRtoMinutes: 0, currentRpoMinutes: 0 },
      StaticAssets: { rtoMinutes: 2, rpoMinutes: 0, currentRtoMinutes: 0, currentRpoMinutes: 0 },
    };

const violations = [];
for (const [service, data] of Object.entries(objectives)) {
  if (Number(data.currentRtoMinutes) > Number(data.rtoMinutes)) {
    violations.push({ service, type: 'RTO', actual: data.currentRtoMinutes, target: data.rtoMinutes });
  }
  if (Number(data.currentRpoMinutes) > Number(data.rpoMinutes)) {
    violations.push({ service, type: 'RPO', actual: data.currentRpoMinutes, target: data.rpoMinutes });
  }
}

const report = {
  timestamp: new Date().toISOString(),
  objectives,
  violations,
  status: violations.length === 0 ? 'pass' : 'fail',
};

fs.writeFileSync('rto-rpo.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`RTO/RPO: ${report.status} violations=${violations.length}`);
if (violations.length > 0) process.exit(1);
