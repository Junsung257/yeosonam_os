#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const migrationsDir = 'supabase/migrations';
const risks = [];
let rollbackable = 0;
let scanned = 0;

if (fs.existsSync(migrationsDir)) {
  const migrations = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .slice(-20);

  for (const file of migrations) {
    scanned += 1;
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const riskDetails = [];
    if (/DROP\s+TABLE/i.test(content)) riskDetails.push('DROP TABLE');
    if (/ALTER\s+TABLE[^;]+DROP\s+COLUMN/i.test(content)) riskDetails.push('DROP COLUMN');
    if (/DELETE\s+FROM(?!\s+\w+\s+WHERE)/i.test(content)) riskDetails.push('Unbounded DELETE');
    if (/TRUNCATE\s+TABLE/i.test(content)) riskDetails.push('TRUNCATE TABLE');

    if (riskDetails.length > 0) {
      risks.push({ file, risks: riskDetails });
    } else {
      rollbackable += 1;
    }
  }
}

const report = {
  timestamp: new Date().toISOString(),
  scanned,
  rollbackable,
  risky: risks.length,
  risks,
  status: risks.length === 0 ? 'pass' : 'warn',
};

fs.writeFileSync('rollback-analysis.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Rollback analysis: scanned=${scanned} risky=${risks.length}`);
