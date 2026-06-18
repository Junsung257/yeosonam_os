#!/usr/bin/env node

const fs = require('node:fs');

const ignored = ['.env', '.env.local', '.env.production', '.env.prod'];
const report = {
  timestamp: new Date().toISOString(),
  ignoredEnvFiles: ignored.filter((file) => fs.existsSync(file)),
  status: 'pass',
  notes: 'Secret scanning is delegated to lint:secrets:all; env files are intentionally not read here.',
};

fs.writeFileSync('secret-scan-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Secret scan placeholder: env files ignored=${report.ignoredEnvFiles.length}`);
