#!/usr/bin/env node

const fs = require('node:fs');

const defaultServices = [
  { name: 'Supabase', status: 'unknown', source: 'manual' },
  { name: 'Vercel', status: 'unknown', source: 'manual' },
  { name: 'AI Providers', status: 'unknown', source: 'manual' },
  { name: 'Messaging', status: 'unknown', source: 'manual' },
];

const services = process.env.SERVICE_STATUS_JSON
  ? JSON.parse(process.env.SERVICE_STATUS_JSON)
  : defaultServices;

const impacted = services.filter((service) => !['operational', 'unknown'].includes(service.status));
const report = {
  timestamp: new Date().toISOString(),
  services,
  impacted,
  status: impacted.length > 0 ? 'degraded' : 'pass',
  notes: process.env.SERVICE_STATUS_JSON
    ? 'Using SERVICE_STATUS_JSON input.'
    : 'No external service status input configured; recorded manual placeholders.',
};

fs.writeFileSync('service-status-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Service status: ${report.status} impacted=${impacted.length}`);
for (const service of services) {
  console.log(`${service.status.toUpperCase()} ${service.name}`);
}
