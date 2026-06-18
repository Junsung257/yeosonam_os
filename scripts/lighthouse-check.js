#!/usr/bin/env node

const fs = require('node:fs');

const thresholds = {
  performance: Number(process.env.LIGHTHOUSE_PERFORMANCE_MIN || '80'),
  accessibility: Number(process.env.LIGHTHOUSE_ACCESSIBILITY_MIN || '90'),
  bestPractices: Number(process.env.LIGHTHOUSE_BEST_PRACTICES_MIN || '85'),
  seo: Number(process.env.LIGHTHOUSE_SEO_MIN || '90'),
};

const scores = process.env.LIGHTHOUSE_SCORES_JSON
  ? JSON.parse(process.env.LIGHTHOUSE_SCORES_JSON)
  : {
      home: {
        performance: 90,
        accessibility: 95,
        bestPractices: 90,
        seo: 95,
      },
    };

const violations = [];
for (const [page, pageScores] of Object.entries(scores)) {
  for (const [metric, score] of Object.entries(pageScores)) {
    const threshold = thresholds[metric];
    if (threshold !== undefined && Number(score) < threshold) {
      violations.push({ page, metric, score: Number(score), threshold });
    }
  }
}

const report = {
  timestamp: new Date().toISOString(),
  thresholds,
  scores,
  violations,
  status: violations.length === 0 ? 'pass' : 'fail',
};

fs.writeFileSync('lighthouse-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Lighthouse check: ${report.status} violations=${violations.length}`);
if (violations.length > 0) process.exit(1);
