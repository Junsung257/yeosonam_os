import './load-script-env';

import { isSupabaseAdminConfigured, supabaseAdmin } from '../src/lib/supabase';

const REQUIRED_TABLES = [
  'product_registration_v5_segments',
  'product_registration_v5_revisions',
  'product_registration_v5_claims',
  'product_registration_v5_claim_evidence',
  'product_registration_v5_proof_runs',
  'product_registration_v5_publication_pointers',
  'product_registration_v5_publication_outbox',
  'product_registration_v5_job_stage_runs',
  'product_registration_v5_idempotency_ledger',
  'product_registration_v5_price_rules',
  'product_registration_v5_itinerary_items',
  'product_registration_v5_kill_switches',
  'product_registration_v5_cache_convergence_runs',
  'product_registration_v5_publication_policies',
] as const;

const REQUIRED_COLUMN_PROBES: ReadonlyArray<{ table: string; columns: string }> = [
  {
    table: 'product_registration_v5_revisions',
    columns: 'id,package_id,job_id,normalization_id,source_document_id,extraction_id,revision_no,payload_hash,lineage_hash,status',
  },
  {
    table: 'product_registration_v5_proof_runs',
    columns: 'id,package_id,revision_id,public_snapshot_id,snapshot_hash,renderer_build_id,proof_suite_version,route,status',
  },
  {
    table: 'product_registration_v5_publication_pointers',
    columns: 'package_id,channel,locale,current_revision_id,current_snapshot_id,state,pointer_version',
  },
  {
    table: 'product_registration_v5_publication_outbox',
    columns: 'id,aggregate_type,aggregate_id,event_type,dedupe_key,status',
  },
] as const;

type Check = {
  name: string;
  ok: boolean;
  detail?: string;
};

const strict = process.argv.includes('--strict') || process.argv.includes('--require-db');
const json = process.argv.includes('--json');

async function checkTable(table: string): Promise<Check> {
  if (!supabaseAdmin) return { name: `table:${table}`, ok: false, detail: 'SUPABASE_ADMIN_UNAVAILABLE' };
  const { error, count } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) return { name: `table:${table}`, ok: false, detail: error.message };
  return { name: `table:${table}`, ok: true, detail: `count=${count ?? 0}` };
}

async function checkColumns(table: string, columns: string): Promise<Check> {
  if (!supabaseAdmin) return { name: `columns:${table}`, ok: false, detail: 'SUPABASE_ADMIN_UNAVAILABLE' };
  const { error } = await supabaseAdmin.from(table).select(columns, { count: 'exact', head: true }).limit(0);
  if (error) return { name: `columns:${table}`, ok: false, detail: error.message };
  return { name: `columns:${table}`, ok: true };
}

async function checkCasRpc(): Promise<Check> {
  if (!supabaseAdmin) return { name: 'rpc:publish_product_registration_v5_snapshot_atomic', ok: false, detail: 'SUPABASE_ADMIN_UNAVAILABLE' };
  const { error } = await supabaseAdmin.rpc('publish_product_registration_v5_snapshot_atomic', {
    p_package_id: null,
    p_revision_id: null,
    p_snapshot_id: null,
    p_snapshot_hash: null,
    p_proof_run_id: null,
    p_expected_pointer_version: 0,
    p_idempotency_key: 'v5-verifier-probe',
  });
  if (!error) {
    return { name: 'rpc:publish_product_registration_v5_snapshot_atomic', ok: false, detail: 'RPC_ACCEPTED_INVALID_PROBE' };
  }
  if (!/V5_PUBLICATION_LINEAGE_REQUIRED/i.test(error.message)) {
    return { name: 'rpc:publish_product_registration_v5_snapshot_atomic', ok: false, detail: error.message };
  }
  return { name: 'rpc:publish_product_registration_v5_snapshot_atomic', ok: true, detail: 'lineage guard responded' };
}

async function main(): Promise<void> {
  const checks: Check[] = [];
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    checks.push({ name: 'supabase_admin_configured', ok: false, detail: 'SUPABASE_ADMIN_UNAVAILABLE' });
  } else {
    checks.push({ name: 'supabase_admin_configured', ok: true });
    for (const table of REQUIRED_TABLES) checks.push(await checkTable(table));
    for (const probe of REQUIRED_COLUMN_PROBES) checks.push(await checkColumns(probe.table, probe.columns));
    checks.push(await checkCasRpc());
  }

  const failed = checks.filter(check => !check.ok);
  const result = {
    engine: 'product-registration-v5',
    strict,
    checkedAt: new Date().toISOString(),
    tables: REQUIRED_TABLES,
    checks,
    ok: failed.length === 0,
    failedCount: failed.length,
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`V5 migration verification: ${result.ok ? 'PASS' : 'FAIL'}`);
    for (const check of checks) {
      console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    }
  }
  if (strict && !result.ok) process.exitCode = 1;
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
