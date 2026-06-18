#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const budgets = {
  js: { limitKB: Number(process.env.BUNDLE_JS_LIMIT_KB || '30000'), path: '.next/static/chunks' },
  css: { limitKB: Number(process.env.BUNDLE_CSS_LIMIT_KB || '512'), path: '.next/static/css' },
};

function directorySizeKB(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).reduce((sum, file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    return sum + (stat.isDirectory() ? directorySizeKB(filePath) : stat.size / 1024);
  }, 0);
}

const passed = [];
const violations = [];
for (const [type, budget] of Object.entries(budgets)) {
  const sizeKB = Number(directorySizeKB(budget.path).toFixed(1));
  const row = { type, sizeKB, limitKB: budget.limitKB, path: budget.path };
  if (sizeKB > budget.limitKB) {
    violations.push(row);
  } else {
    passed.push(row);
  }
}

const report = {
  timestamp: new Date().toISOString(),
  passed,
  violations,
  status: violations.length === 0 ? 'pass' : 'fail',
};

fs.writeFileSync('bundle-result.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Bundle budget: ${report.status} passed=${passed.length} violations=${violations.length}`);
if (violations.length > 0) process.exit(1);
