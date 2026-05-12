#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const VERCEL_JSON = path.join(__dirname, '..', 'vercel.json');
const HARD_LIMIT = 50;
const FAIL_THRESHOLD = 45;
const WARN_THRESHOLD = 40;

const args = process.argv.slice(2);
const ci = args.includes('--ci');

let raw;
try {
  raw = fs.readFileSync(VERCEL_JSON, 'utf8');
} catch (err) {
  console.error(`Cannot read vercel.json: ${err.message}`);
  process.exit(1);
}

let cfg;
try {
  cfg = JSON.parse(raw);
} catch (err) {
  console.error(`vercel.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

const functions = cfg.functions || {};
const entries = Object.entries(functions);
const count = entries.length;

console.log(`vercel.json functions entries: ${count}/${HARD_LIMIT}`);

const cronGlobKey = 'src/app/api/cron/**/*.ts';
const cronGlob = functions[cronGlobKey];
const redundant = [];
if (cronGlob) {
  for (const [pattern, conf] of entries) {
    if (pattern === cronGlobKey) continue;
    if (!pattern.startsWith('src/app/api/cron/')) continue;
    if (JSON.stringify(conf) === JSON.stringify(cronGlob)) {
      redundant.push(pattern);
    }
  }
}

const errors = [];
const warnings = [];

if (redundant.length > 0) {
  warnings.push(
    `${redundant.length} cron entries duplicate the glob default — remove them:\n` +
      redundant.map((p) => `   - ${p}`).join('\n'),
  );
}

if (count > HARD_LIMIT) {
  errors.push(
    `Exceeds Vercel hard limit (${count} > ${HARD_LIMIT}). Deployment will fail with "functions should NOT have more than 50 properties".`,
  );
} else if (count >= FAIL_THRESHOLD) {
  const msg = `${count} entries >= fail threshold ${FAIL_THRESHOLD}. Required headroom (5+) below hard limit ${HARD_LIMIT}.\n   → Move route-level overrides to Next.js exports: export const maxDuration = N`;
  if (ci) errors.push(msg);
  else warnings.push(msg);
} else if (count >= WARN_THRESHOLD) {
  warnings.push(
    `${count} entries >= soft warn ${WARN_THRESHOLD}. Plan to consolidate before reaching ${FAIL_THRESHOLD}.`,
  );
}

for (const w of warnings) console.warn(`WARN  ${w}`);
for (const e of errors) console.error(`FAIL  ${e}`);

if (errors.length > 0) process.exit(1);

console.log('OK — within healthy range.');
