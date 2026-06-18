#!/usr/bin/env node

const fs = require('node:fs');

const nextConfig = fs.existsSync('next.config.js') ? fs.readFileSync('next.config.js', 'utf8') : '';
const expectedHeaders = [
  'Content-Security-Policy',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
];
const missing = expectedHeaders.filter((header) => !nextConfig.includes(header));
const report = {
  timestamp: new Date().toISOString(),
  expectedHeaders,
  missing,
  status: missing.length === 0 ? 'pass' : 'warn',
};

fs.writeFileSync('security-headers-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`Security headers: status=${report.status} missing=${missing.length}`);
if (missing.length > 0) console.log(`Missing: ${missing.join(', ')}`);
