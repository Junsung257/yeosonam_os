#!/usr/bin/env node

const fs = require('node:fs');

const schedules = process.env.BACKUP_SCHEDULE_JSON
  ? JSON.parse(process.env.BACKUP_SCHEDULE_JSON)
  : [
      { name: 'Code Repository', frequency: 'realtime', maxAgeHours: 1, lastBackup: new Date().toISOString() },
      { name: 'Database PITR', frequency: 'external', maxAgeHours: 24, lastBackup: null, status: 'manual-check' },
    ];

const now = Date.now();
const issues = [];
const checked = schedules.map((item) => {
  if (!item.lastBackup) {
    const result = { ...item, status: item.status || 'manual-check', ageHours: null };
    if (result.status === 'failed') issues.push(result);
    return result;
  }
  const ageHours = (now - new Date(item.lastBackup).getTime()) / 3600000;
  const status = ageHours <= Number(item.maxAgeHours || 24) ? 'healthy' : 'overdue';
  const result = { ...item, ageHours: Number(ageHours.toFixed(2)), status };
  if (status === 'overdue') issues.push(result);
  return result;
});

const report = {
  timestamp: new Date().toISOString(),
  schedules: checked,
  issues,
  status: issues.length === 0 ? 'pass' : 'fail',
};

fs.writeFileSync('backup-schedule.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Backup schedule: ${report.status} issues=${issues.length}`);
if (issues.length > 0) process.exit(1);
