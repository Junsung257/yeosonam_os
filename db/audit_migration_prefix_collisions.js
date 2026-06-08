#!/usr/bin/env node
/**
 * Supabase migration filename prefix collision audit.
 *
 * Usage:
 *   node db/audit_migration_prefix_collisions.js
 *   node db/audit_migration_prefix_collisions.js --fail-on-collision
 */
const fs = require('fs');
const path = require('path');

const failOnCollision = process.argv.includes('--fail-on-collision');
const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
const KNOWN_HISTORICAL_COLLISION_PREFIXES = new Set([
  '20260423000000',
  '20260423010000',
  '20260423020000',
  '20260426000000',
  '20260504250000',
  '20260506100000',
  '20260510000000',
  '20260512000000',
  '20260513000000',
  '20260513100000',
  '20260513200000',
  '20260513300000',
  '20260513400000',
  '20260519100000',
  '20260524000000',
  '20260601142000',
]);

if (!fs.existsSync(migrationsDir)) {
  console.error(`migrations directory not found: ${migrationsDir}`);
  process.exit(1);
}

const files = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isFile() && d.name.endsWith('.sql'))
  .map((d) => d.name)
  .sort();

const groups = new Map();
for (const file of files) {
  const key = file.slice(0, 14);
  if (!/^\d{14}$/.test(key)) continue;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(file);
}

const collisions = [...groups.entries()]
  .filter(([, names]) => names.length > 1)
  .sort((a, b) => a[0].localeCompare(b[0]));
const newCollisions = collisions.filter(([prefix]) => !KNOWN_HISTORICAL_COLLISION_PREFIXES.has(prefix));

console.log('═══════════════════════════════════════════════════════════');
console.log('  Migration Prefix Collision Audit');
console.log(`  Scanned: ${new Date().toISOString()}`);
console.log('═══════════════════════════════════════════════════════════');
console.log(`Total migration files: ${files.length}`);
console.log(`Prefix collisions: ${collisions.length}`);
console.log(`Known historical collisions: ${collisions.length - newCollisions.length}`);
console.log(`New/unbaselined collisions: ${newCollisions.length}`);

if (collisions.length === 0) {
  console.log('\n✅ No collisions found.');
  process.exit(0);
}

console.log('\n⚠️  Duplicate timestamp prefixes detected:');
for (const [prefix, names] of collisions) {
  console.log(`- ${prefix} (${names.length})`);
  for (const name of names) {
    console.log(`  • ${name}`);
  }
}

if (failOnCollision && newCollisions.length > 0) {
  process.exit(1);
}

