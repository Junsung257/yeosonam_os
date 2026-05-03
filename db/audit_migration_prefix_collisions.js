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

console.log('═══════════════════════════════════════════════════════════');
console.log('  Migration Prefix Collision Audit');
console.log(`  Scanned: ${new Date().toISOString()}`);
console.log('═══════════════════════════════════════════════════════════');
console.log(`Total migration files: ${files.length}`);
console.log(`Prefix collisions: ${collisions.length}`);

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

if (failOnCollision) {
  process.exit(1);
}

