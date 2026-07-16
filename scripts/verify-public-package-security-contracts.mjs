#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');

const MIGRATIONS = [
  'supabase/migrations/20260707115319_public_package_snapshot_gate.sql',
  'supabase/migrations/20260710153000_atomic_package_publication_rpc.sql',
  'supabase/migrations/20260715114704_public_package_published_pointer.sql',
];

const sql = MIGRATIONS
  .map(file => `\n-- ${file}\n${readFileSync(file, 'utf8')}`)
  .join('\n');

const checks = [];

function add(id, pass, message, evidence = '') {
  checks.push({ id, status: pass ? 'pass' : 'fail', message, evidence });
}

function has(pattern) {
  return pattern.test(sql);
}

function tableSecurity(table) {
  add(
    `${table}:rls-enabled`,
    has(new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i')),
    `${table} must enable RLS.`,
  );
  add(
    `${table}:anon-auth-revoked`,
    has(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+public\\.${table}\\s+FROM\\s+(?:PUBLIC,\\s*)?anon,\\s*authenticated`, 'i')),
    `${table} must revoke direct anon/authenticated access.`,
  );
  add(
    `${table}:service-role-granted`,
    has(new RegExp(`GRANT\\s+ALL\\s+ON\\s+TABLE\\s+public\\.${table}\\s+TO\\s+service_role`, 'i')),
    `${table} must be service-role controlled.`,
  );
  add(
    `${table}:no-anon-grant`,
    !has(new RegExp(`GRANT\\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE).*ON\\s+TABLE\\s+public\\.${table}\\s+TO\\s+(?:anon|authenticated)`, 'i')),
    `${table} must not grant direct access to anon/authenticated.`,
  );
}

function projectionViewSecurity(view) {
  add(
    `${view}:security-invoker`,
    has(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+VIEW\\s+public\\.${view}\\s+WITH\\s*\\(\\s*security_invoker\\s*=\\s*true\\s*\\)`, 'i')),
    `${view} must use security_invoker.`,
  );
  add(
    `${view}:anon-auth-public-revoked`,
    has(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+public\\.${view}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`, 'i')),
    `${view} must revoke PUBLIC/anon/authenticated access.`,
  );
  add(
    `${view}:service-role-select`,
    has(new RegExp(`GRANT\\s+SELECT\\s+ON\\s+TABLE\\s+public\\.${view}\\s+TO\\s+service_role`, 'i')),
    `${view} must grant SELECT only through service_role.`,
  );
  add(
    `${view}:no-anon-select`,
    !has(new RegExp(`GRANT\\s+SELECT\\s+ON\\s+TABLE\\s+public\\.${view}\\s+TO\\s+(?:anon|authenticated)`, 'i')),
    `${view} must not grant SELECT to anon/authenticated.`,
  );
}

for (const table of [
  'public_package_snapshots',
  'package_publish_decisions',
  'quarantined_package_fields',
  'field_evidence_ledger',
  'package_render_proofs',
]) {
  tableSecurity(table);
}

for (const view of [
  'published_public_packages_v1',
  'published_public_package_cards_v1',
  'published_public_package_details_v1',
  'published_public_package_api_v1',
  'published_public_package_marketing_v1',
  'published_public_package_partner_v1',
]) {
  projectionViewSecurity(view);
}

add(
  'content-creatives:snapshot-provenance',
  has(/ALTER\s+TABLE\s+public\.content_creatives[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+source_snapshot_id\s+uuid/i) &&
    has(/ALTER\s+TABLE\s+public\.content_creatives[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+source_snapshot_hash\s+text/i) &&
    has(/ALTER\s+TABLE\s+public\.content_creatives[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+marketing_projection_version\s+text/i) &&
    has(/CONSTRAINT\s+content_creatives_source_snapshot_id_fkey[\s\S]*REFERENCES\s+public\.public_package_snapshots\(id\)[\s\S]*ON\s+DELETE\s+RESTRICT/i),
  'content_creatives must preserve public snapshot provenance and FK integrity.',
);

add(
  'ad-creatives:snapshot-provenance',
  has(/ALTER\s+TABLE\s+public\.ad_creatives[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+source_snapshot_id\s+uuid/i) &&
    has(/ALTER\s+TABLE\s+public\.ad_creatives[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+source_snapshot_hash\s+text/i) &&
    has(/ALTER\s+TABLE\s+public\.ad_creatives[\s\S]*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+marketing_projection_version\s+text/i) &&
    has(/CONSTRAINT\s+ad_creatives_source_snapshot_id_fkey[\s\S]*REFERENCES\s+public\.public_package_snapshots\(id\)[\s\S]*ON\s+DELETE\s+RESTRICT/i),
  'ad_creatives must preserve public snapshot provenance and FK integrity.',
);

add(
  'rpc:security-invoker',
  has(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.publish_package_snapshot_atomic[\s\S]*LANGUAGE\s+plpgsql[\s\S]*SECURITY\s+INVOKER/i) &&
    !has(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.publish_package_snapshot_atomic[\s\S]*SECURITY\s+DEFINER/i),
  'publish_package_snapshot_atomic must be SECURITY INVOKER, not SECURITY DEFINER.',
);

add(
  'rpc:search-path-fixed',
  has(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.publish_package_snapshot_atomic[\s\S]*SET\s+search_path\s*=\s*public,\s*extensions/i),
  'publish_package_snapshot_atomic must fix search_path.',
);

add(
  'rpc:anon-auth-revoked',
  has(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.publish_package_snapshot_atomic[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated/i),
  'publish_package_snapshot_atomic must revoke PUBLIC/anon/authenticated execution.',
);

add(
  'rpc:service-role-execute',
  has(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.publish_package_snapshot_atomic[\s\S]*TO\s+service_role/i),
  'publish_package_snapshot_atomic must grant EXECUTE only to service_role.',
);

add(
  'customer-dto:server-read-model',
  !has(/GRANT\s+SELECT\s+ON\s+TABLE\s+public\.published_public_package_(?:cards|details|api|marketing|partner)_v1\s+TO\s+(?:anon|authenticated)/i),
  'Public DTO projections must be served through the server read model, not direct anon/authenticated grants.',
);

const failed = checks.filter(check => check.status !== 'pass');
const report = {
  status: failed.length === 0 ? 'pass' : 'fail',
  passed: checks.length - failed.length,
  failed: failed.length,
  migrations: MIGRATIONS,
  checks,
};

if (json) console.log(JSON.stringify(report, null, 2));
else {
  for (const check of checks) console.log(`${check.status.toUpperCase()} ${check.id}`);
}

if (failed.length > 0) process.exit(1);
