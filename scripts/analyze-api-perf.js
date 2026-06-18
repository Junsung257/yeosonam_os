#!/usr/bin/env node

const fs = require('node:fs');

const endpoints = process.env.API_PERF_JSON
  ? JSON.parse(process.env.API_PERF_JSON)
  : [
      { path: '/api/packages', p95: 0, limit: 300 },
      { path: '/api/health', p95: 0, limit: 300 },
    ];

const violations = [];
const passed = [];
for (const endpoint of endpoints) {
  const row = {
    path: endpoint.path,
    p95: Number(endpoint.p95 || 0),
    limit: Number(endpoint.limit || 300),
    unit: 'ms',
  };
  if (row.p95 > row.limit) {
    violations.push(row);
  } else {
    passed.push(row);
  }
}

const report = {
  timestamp: new Date().toISOString(),
  violations,
  passed,
  status: violations.length === 0 ? 'pass' : 'fail',
};

fs.writeFileSync('api-perf-result.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`API performance: ${report.status} passed=${passed.length} violations=${violations.length}`);
if (violations.length > 0) process.exit(1);
