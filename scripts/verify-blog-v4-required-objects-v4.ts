import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readJson, type RequiredObject } from './lib/blog-v4-schema-baseline-v4';

type DiscoveryReport = {
  requiredObjects: RequiredObject[];
  [key: string]: unknown;
};

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function assertReadOnly(sql: string): void {
  if (!/^select\b/i.test(sql.trim()) || /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke|call)\b/i.test(sql)) {
    throw new Error('required_object_contract_query_not_read_only');
  }
}

function npxInvocation(): { command: string; prefix: string[] } {
  if (process.platform !== 'win32') return { command: 'npx', prefix: [] };
  const npxCli = resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (!existsSync(npxCli)) throw new Error('windows_npx_cli_missing');
  return { command: process.execPath, prefix: [npxCli] };
}

function dbQuery(sql: string): string {
  const invocation = npxInvocation();
  const version = process.env.SUPABASE_CLI_VERSION ?? '2.111.0';
  const base = ['--yes', `supabase@${version}`, 'db', 'query'];
  const help = execFileSync(invocation.command, [...invocation.prefix, ...base, '--help'], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (!help.includes('--output-format')) throw new Error('supabase_db_query_output_format_flag_missing');
  const args = [...base, '--output-format', 'json'];
  if (process.argv.includes('--local')) {
    if (!help.includes('--local')) throw new Error('supabase_db_query_local_flag_missing');
    args.push('--local');
  } else {
    const envName = argument('database-url-env') ?? 'SUPABASE_STAGING_DATABASE_URL';
    const databaseUrl = process.env[envName];
    const productionRef = process.env.SUPABASE_PRODUCTION_PROJECT_REF?.toLowerCase();
    const expectedRef = argument('expected-project-ref')?.toLowerCase();
    if (!databaseUrl || !expectedRef || !productionRef) throw new Error('staging_database_contract_inputs_missing');
    if (expectedRef === productionRef) throw new Error('staging_database_contract_ref_is_production');
    let url: URL;
    try { url = new URL(databaseUrl); } catch { throw new Error('staging_database_url_invalid'); }
    if (!url.hostname.toLowerCase().includes(expectedRef) && !decodeURIComponent(url.username).toLowerCase().endsWith(`.${expectedRef}`)) {
      throw new Error('staging_database_url_project_ref_mismatch');
    }
    if (!help.includes('--db-url')) throw new Error('supabase_db_query_db_url_flag_missing');
    args.push('--db-url', databaseUrl);
  }
  args.push(sql);
  return execFileSync(invocation.command, [...invocation.prefix, ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseEvidence(raw: string): Array<{ object_name: string; present: boolean }> {
  const parsed = JSON.parse(raw) as { rows?: Array<{ evidence?: unknown }> };
  const value = parsed.rows?.[0]?.evidence;
  if (!Array.isArray(value)) throw new Error('required_object_contract_evidence_missing');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof (entry as { object_name?: unknown }).object_name !== 'string') {
      throw new Error('required_object_contract_evidence_invalid');
    }
    return { object_name: (entry as { object_name: string }).object_name, present: (entry as { present?: boolean }).present === true };
  });
}

function main(): void {
  const requiredPath = argument('required-objects');
  if (!requiredPath) throw new Error('usage: --required-objects=<schema-dependencies.json> --stage=replay|staging');
  const discoveryPath = resolve(requiredPath);
  if (!existsSync(discoveryPath)) throw new Error(`required_object_discovery_missing:${discoveryPath}`);
  const discovery = readJson<DiscoveryReport>(discoveryPath);
  const required = discovery.requiredObjects.filter((entry) => entry.providerType !== 'target_release' && entry.kind === 'table');
  const names = [...new Set(required.map((entry) => entry.name))].sort();
  if (names.length === 0) throw new Error('required_object_contract_empty');
  const sql = `select coalesce(json_agg(json_build_object('object_name', object_name, 'present', to_regclass(object_name) is not null) order by object_name), '[]'::json) as evidence from unnest(array[${names.map((name) => `'${name.replaceAll("'", "''")}'`).join(',')}]) as object_name`;
  assertReadOnly(sql);
  const observed = parseEvidence(dbQuery(sql));
  const observedMap = new Map(observed.map((entry) => [entry.object_name, entry.present]));
  const missing = names.filter((name) => observedMap.get(name) !== true);
  const stage = argument('stage') ?? 'replay';
  const contract = {
    schemaVersion: 1,
    stage,
    queryKind: 'to_regclass_read_only',
    requiredObjects: names,
    presentObjects: names.filter((name) => observedMap.get(name) === true),
    missingObjects: missing,
    passed: missing.length === 0,
    checkedAt: new Date().toISOString(),
  };
  const output = resolve(argument('output') ?? `.tmp/blog-v4-longrun/object-contract-${stage}.json`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  if (argument('discovery-report')) {
    const updated = { ...discovery, requiredObjects: discovery.requiredObjects.map((entry) => {
      const present = entry.kind === 'table' ? observedMap.get(entry.name) ?? false : null;
      const status = present === true
        ? 'present'
        : entry.providerMigrationFound
          ? 'provider_recorded_but_object_absent'
          : 'provider_migration_not_found';
      return stage === 'replay'
        ? { ...entry, presentAfterReplay: present, status }
        : { ...entry, presentInStaging: present, status };
    }) };
    writeFileSync(resolve(argument('discovery-report')!), `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
  if (!contract.passed) throw new Error(`required_object_contract_failed:${missing.join(',')}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Blog V4 required object verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
