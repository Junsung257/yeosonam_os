#!/usr/bin/env node

/**
 * Read-only deployment preflight for the admin dashboard migrations.
 *
 * This intentionally never calls `supabase db push`. It compares the reviewed
 * migration set with the linked project's migration history and fails strict
 * CI when any required migration is still local-only.
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const required = [
  '20260722150310_admin_dashboard_kpi_view_accuracy.sql',
  '20260722225239_admin_tenant_summary.sql',
  '20260722225812_admin_marketing_ltv_summary.sql',
  '20260722230001_admin_operations_kpi_aggregates.sql',
  '20260722234056_revoke_admin_dashboard_stats_public.sql',
  '20260722235844_enable_rls_on_policy_backed_tables.sql',
  '20260723123000_atomic_reviewed_product_approval.sql',
  '20260723124500_keyword_stats_accuracy.sql',
];

const strict = process.argv.includes('--strict');
const cliArgs = ['supabase', 'migration', 'list', '--linked', '--output-format', 'json'];
const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', `npx ${cliArgs.join(' ')}`]
  : cliArgs;
const result = spawnSync(command, args, {
  cwd: process.cwd(),
  encoding: 'utf8',
  windowsHide: true,
});

if (result.error || result.status !== 0) {
  console.error('[admin-activation] unable to read linked migration history');
  if (result.error?.message) console.error(result.error.message);
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  console.error('[admin-activation] Supabase CLI returned invalid JSON');
  process.exit(2);
}

const migrations = Array.isArray(payload?.migrations) ? payload.migrations : [];
const remoteVersions = new Set(
  migrations
    .map((row) => String(row?.remote ?? '').trim())
    .filter(Boolean),
);
const pending = required.filter((filename) => {
  const version = filename.slice(0, 14);
  return !remoteVersions.has(version);
});

const summary = {
  linked: true,
  required: required.length,
  applied: required.length - pending.length,
  pending,
  status: pending.length === 0 ? 'ready' : 'migration_pending',
};

console.log(JSON.stringify(summary, null, 2));
if (strict && pending.length > 0) process.exit(1);
