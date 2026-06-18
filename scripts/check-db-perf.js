#!/usr/bin/env node

const fs = require('node:fs');

const queries = process.env.DB_PERF_JSON
  ? JSON.parse(process.env.DB_PERF_JSON)
  : [
      { id: 'baseline', avgTime: 0, limit: 200, occurrences: 0 },
    ];

const violations = [];
const optimal = [];
for (const query of queries) {
  const row = {
    id: query.id,
    avgTime: Number(query.avgTime || 0),
    limit: Number(query.limit || 200),
    occurrences: Number(query.occurrences || 0),
    unit: 'ms',
  };
  if (row.avgTime > row.limit) {
    violations.push(row);
  } else {
    optimal.push(row);
  }
}

const report = {
  timestamp: new Date().toISOString(),
  violations,
  optimal,
  status: violations.length === 0 ? 'pass' : 'fail',
};

fs.writeFileSync('db-perf-result.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`DB performance: ${report.status} optimal=${optimal.length} violations=${violations.length}`);
if (violations.length > 0) process.exit(1);
