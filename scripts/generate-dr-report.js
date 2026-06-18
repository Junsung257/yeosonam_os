#!/usr/bin/env node

const fs = require('node:fs');

function readJson(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const report = {
  timestamp: new Date().toISOString(),
  backupSchedule: readJson('backup-schedule.json', { issues: [], status: 'missing' }),
  rollback: readJson('rollback-analysis.json', { risks: [], status: 'missing' }),
  rto: readJson('rto-rpo.json', { violations: [], status: 'missing' }),
  integrity: readJson('integrity-checks.json', { failedChecks: 1, status: 'missing' }),
};

const totalIssues =
  (report.backupSchedule.issues || []).length +
  (report.rollback.risks || []).length +
  (report.rto.violations || []).length +
  Number(report.integrity.failedChecks || 0);

const readiness = totalIssues === 0 ? 'READY' : totalIssues <= 2 ? 'READY_WITH_WARNINGS' : 'NEEDS_ATTENTION';
const output = {
  ...report,
  totalIssues,
  readiness,
};

fs.writeFileSync('dr-readiness.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(`DR readiness: ${readiness} issues=${totalIssues}`);
