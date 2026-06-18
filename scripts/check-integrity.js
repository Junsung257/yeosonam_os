#!/usr/bin/env node

const fs = require('node:fs');

const checks = process.env.INTEGRITY_CHECKS_JSON
  ? JSON.parse(process.env.INTEGRITY_CHECKS_JSON)
  : [
      { name: 'Migration files readable', status: fs.existsSync('supabase/migrations') ? 'pass' : 'warn' },
      { name: 'Application source readable', status: fs.existsSync('src') ? 'pass' : 'fail' },
      { name: 'Package manifest readable', status: fs.existsSync('package.json') ? 'pass' : 'fail' },
    ];

const failed = checks.filter((check) => check.status === 'fail');
const warnings = checks.filter((check) => check.status === 'warn');
const report = {
  timestamp: new Date().toISOString(),
  checks,
  failedChecks: failed.length,
  warnings: warnings.length,
  status: failed.length === 0 ? 'pass' : 'fail',
};

fs.writeFileSync('integrity-checks.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Integrity checks: ${report.status} failed=${failed.length} warnings=${warnings.length}`);
if (failed.length > 0) process.exit(1);
