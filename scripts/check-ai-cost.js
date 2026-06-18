#!/usr/bin/env node

const fs = require('node:fs');

const services = process.env.AI_COST_JSON
  ? JSON.parse(process.env.AI_COST_JSON)
  : {
      'AI Providers': { estimatedCost: 0, budget: 200 },
      'Messaging': { estimatedCost: 0, budget: 50 },
    };

const rows = Object.entries(services).map(([service, data]) => {
  const budget = Number(data.budget || 0);
  const estimatedCost = Number(data.estimatedCost || 0);
  const percent = budget > 0 ? (estimatedCost / budget) * 100 : 0;
  return {
    service,
    ...data,
    estimatedCost,
    budget,
    percent: Number(percent.toFixed(1)),
    status: percent >= 100 ? 'critical' : percent >= 80 ? 'warning' : 'ok',
  };
});

const totalCost = rows.reduce((sum, row) => sum + row.estimatedCost, 0);
const totalBudget = rows.reduce((sum, row) => sum + row.budget, 0);
const warnings = rows.filter((row) => row.status === 'warning');
const critical = rows.filter((row) => row.status === 'critical');
const report = {
  timestamp: new Date().toISOString(),
  source: process.env.AI_COST_JSON ? 'AI_COST_JSON' : 'local-default',
  services: rows,
  totalCost,
  totalBudget,
  warnings,
  critical,
};

fs.writeFileSync('ai-cost.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`AI cost: total=${totalCost}/${totalBudget} warnings=${warnings.length} critical=${critical.length}`);
if (critical.length > 0) process.exit(1);
