#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationsDir = path.join(root, 'supabase', 'migrations');
const baseline = '20260330000000_foundational_schema_baseline.sql';
const requiredRestores = [
  '20260519125000_restore_legacy_manual_schema.sql',
  '20260531105000_restore_ad_landing_mappings.sql',
  '20260601194000_restore_affiliate_content_insights.sql',
  '20260603064700_restore_pin_attempts.sql',
];
const requiredReplayBridges = [
  '20260426000002_post_engagement_snapshots_tenant_baseline.sql',
];

const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
};

if (!fs.existsSync(migrationsDir)) {
  fail(`Missing migrations directory: ${migrationsDir}`);
  process.exit(1);
}

const files = fs
  .readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

const groups = new Map();
for (const file of files) {
  const prefix = file.slice(0, 14);
  if (!/^\d{14}$/.test(prefix)) {
    fail(`Invalid migration filename prefix: ${file}`);
    continue;
  }
  const group = groups.get(prefix) ?? [];
  group.push(file);
  groups.set(prefix, group);
}

for (const [prefix, names] of groups) {
  if (names.length > 1) {
    fail(`Duplicate migration prefix ${prefix}: ${names.join(', ')}`);
  }
}

const expectedOrder = files[0];
if (expectedOrder !== baseline) {
  fail(`Foundational baseline must be the first migration; found ${expectedOrder ?? '(none)'}`);
}

for (const name of [baseline, ...requiredRestores, ...requiredReplayBridges]) {
  if (!files.includes(name)) fail(`Required baseline migration is missing: ${name}`);
}

const baselineSql = fs.readFileSync(path.join(migrationsDir, baseline), 'utf8');
for (const pattern of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+[^;]+\bSET\b/i, /\bDELETE\s+FROM\b/i]) {
  if (pattern.test(baselineSql)) {
    fail(`Foundational baseline contains a data mutation matching ${pattern}`);
  }
}

if (process.exitCode) process.exit(1);
console.log(`✅ Migration baseline audit passed (${files.length} unique migrations).`);
console.log('   Full SQL replay still requires a clean Supabase CLI/Docker environment.');
