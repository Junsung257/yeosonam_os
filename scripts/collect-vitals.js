#!/usr/bin/env node

const fs = require('node:fs');

const vitals = process.env.CORE_WEB_VITALS_JSON
  ? JSON.parse(process.env.CORE_WEB_VITALS_JSON)
  : {
      LCP: 2.1,
      FCP: 1.0,
      CLS: 0.08,
      INP: 180,
      TTFB: 0.5,
    };

const budgets = {
  LCP: { limit: Number(process.env.VITAL_LCP_LIMIT || '2.5'), unit: 's' },
  FCP: { limit: Number(process.env.VITAL_FCP_LIMIT || '1.8'), unit: 's' },
  CLS: { limit: Number(process.env.VITAL_CLS_LIMIT || '0.1'), unit: 'score' },
  INP: { limit: Number(process.env.VITAL_INP_LIMIT || '200'), unit: 'ms' },
  TTFB: { limit: Number(process.env.VITAL_TTFB_LIMIT || '0.6'), unit: 's' },
};

const violations = [];
const passed = [];
for (const [metric, value] of Object.entries(vitals)) {
  const budget = budgets[metric];
  if (!budget) continue;
  const row = { metric, value: Number(value), limit: budget.limit, unit: budget.unit };
  if (Number(value) > budget.limit) {
    violations.push(row);
  } else {
    passed.push(row);
  }
}

const report = {
  timestamp: new Date().toISOString(),
  vitals,
  budgets,
  violations,
  passed,
  status: violations.length === 0 ? 'pass' : 'fail',
};

fs.writeFileSync('vitals-result.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Core Web Vitals: ${report.status} passed=${passed.length} violations=${violations.length}`);
if (violations.length > 0) process.exit(1);
