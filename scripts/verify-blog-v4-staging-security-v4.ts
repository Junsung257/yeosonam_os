import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readJson, type RequiredObject } from './lib/blog-v4-schema-baseline-v4';

type DiscoveryReport = { requiredObjects: RequiredObject[]; [key: string]: unknown };

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function npxInvocation(): { command: string; prefix: string[] } {
  if (process.platform !== 'win32') return { command: 'npx', prefix: [] };
  const npxCli = resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (!existsSync(npxCli)) throw new Error('windows_npx_cli_missing');
  return { command: process.execPath, prefix: [npxCli] };
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function main(): void {
  const discoveryPath = argument('discovery-report');
  const output = resolve(argument('output') ?? '.tmp/blog-v4-longrun/staging-security.json');
  const expectedRef = argument('expected-project-ref')?.toLowerCase();
  const productionRef = process.env.SUPABASE_PRODUCTION_PROJECT_REF?.toLowerCase();
  const envName = argument('database-url-env') ?? 'SUPABASE_STAGING_DATABASE_URL';
  const databaseUrl = process.env[envName];
  if (!discoveryPath || !expectedRef || !productionRef || !databaseUrl) throw new Error('staging_security_contract_inputs_missing');
  if (expectedRef === productionRef) throw new Error('staging_security_ref_is_production');
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error('staging_security_database_url_invalid'); }
  if (!url.hostname.toLowerCase().includes(expectedRef) && !decodeURIComponent(url.username).toLowerCase().endsWith(`.${expectedRef}`)) {
    throw new Error('staging_security_database_url_project_ref_mismatch');
  }
  const discovery = readJson<DiscoveryReport>(resolve(discoveryPath));
  const tables = [...new Set(discovery.requiredObjects.filter((entry) => entry.kind === 'table' && entry.providerType !== 'target_release').map((entry) => entry.name))].sort();
  const functionsPath = resolve(dirname(resolve(discoveryPath)), 'required-functions.json');
  const functions = existsSync(functionsPath)
    ? [...new Set(readJson<RequiredObject[]>(functionsPath).map((entry) => entry.name.split('.').at(-1)).filter(Boolean) as string[])].sort()
    : [];
  if (tables.length === 0) throw new Error('staging_security_required_tables_empty');
  const tableValues = tables.map(sqlLiteral).join(',');
  const functionValues = functions.length > 0 ? functions.map(sqlLiteral).join(',') : sqlLiteral('__none__');
  const sql = `select json_build_object(
    'rlsMissing', coalesce((select json_agg(format('%s.%s', n.nspname, c.relname) order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname = any(array[${tableValues}]) and c.relrowsecurity = false), '[]'::json),
    'unsafeSecurityDefiners', coalesce((select json_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any(array[${functionValues}]) and p.prosecdef and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) config where config like 'search_path=%')), '[]'::json)
  ) as evidence`;
  if (!/^select\b/i.test(sql.trim()) || /\b(insert|update|delete|alter|create|drop|grant|revoke|call)\b/i.test(sql)) throw new Error('staging_security_query_not_read_only');
  const invocation = npxInvocation();
  const version = process.env.SUPABASE_CLI_VERSION ?? '2.111.0';
  const base = [...invocation.prefix, '--yes', `supabase@${version}`, 'db', 'query'];
  const help = execFileSync(invocation.command, [...base, '--help'], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (!help.includes('--output-format') || !help.includes('--db-url')) throw new Error('supabase_db_query_contract_missing');
  const raw = execFileSync(invocation.command, [...base, '--output-format', 'json', '--db-url', databaseUrl, sql], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(raw) as { rows?: Array<{ evidence?: { rlsMissing?: unknown[]; unsafeSecurityDefiners?: unknown[] } }> };
  const evidence = parsed.rows?.[0]?.evidence;
  if (!evidence) throw new Error('staging_security_evidence_missing');
  const rlsMissing = Array.isArray(evidence.rlsMissing) ? evidence.rlsMissing : [];
  const unsafeSecurityDefiners = Array.isArray(evidence.unsafeSecurityDefiners) ? evidence.unsafeSecurityDefiners : [];
  const result = {
    schemaVersion: 1,
    queryKind: 'rls_and_security_definer_read_only',
    expectedProjectRef: expectedRef,
    productionProjectRefCompared: true,
    requiredTables: tables,
    requiredFunctions: functions,
    rlsMissing,
    unsafeSecurityDefiners,
    passed: rlsMissing.length === 0 && unsafeSecurityDefiners.length === 0,
    productionWrites: 0,
    checkedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) throw new Error('staging_security_contract_failed');
}

try {
  main();
} catch (error) {
  process.stderr.write(`Blog V4 staging security verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
