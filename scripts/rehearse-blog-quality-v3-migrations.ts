import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const V3_MIGRATIONS = [
  '20260811132017_blog_quality_v3_policy.sql',
  '20260811132023_blog_quality_v3_demand_evidence.sql',
  '20260811132031_blog_quality_v3_snapshots_media.sql',
  '20260811132037_blog_quality_v3_measurement.sql',
  '20260811210920_blog_quality_v3_reliability_followup.sql',
];

function stripDollarQuotedBodies(sql: string): string {
  const delimiter = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/g;
  let cursor = 0;
  let output = '';
  let match: RegExpExecArray | null;
  while ((match = delimiter.exec(sql)) !== null) {
    const end = sql.indexOf(match[0], delimiter.lastIndex);
    if (end < 0) break;
    output += sql.slice(cursor, match.index);
    cursor = end + match[0].length;
    delimiter.lastIndex = cursor;
  }
  return output + sql.slice(cursor);
}

function runSupabase(args: string[]): string {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return execFileSync(executable, ['supabase', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readSupabaseProjectId(): string {
  const configPath = join(process.cwd(), 'supabase', 'config.toml');
  if (!existsSync(configPath)) throw new Error('supabase_config_missing');
  const match = readFileSync(configPath, 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m);
  if (!match?.[1]) throw new Error('supabase_project_id_missing');
  return match[1].trim();
}

function isDedicatedRehearsalProjectId(projectId: string): boolean {
  return /(?:^|[-_])(rehearsal|ephemeral|scratch)(?:[-_]|$)/i.test(projectId);
}

function assertDedicatedLocalRehearsalTarget(projectId: string): void {
  const confirmedProjectId = process.env.BLOG_LOCAL_MIGRATION_REHEARSAL_PROJECT_ID?.trim();
  if (!confirmedProjectId || confirmedProjectId !== projectId) {
    throw new Error('local_migration_rehearsal_project_id_confirmation_missing_or_mismatched');
  }
  if (!isDedicatedRehearsalProjectId(projectId)) {
    throw new Error(`local_migration_rehearsal_requires_dedicated_project_id:${projectId}`);
  }

  const rawStatus = runSupabase(['status', '--output', 'json']);
  const status = JSON.parse(rawStatus) as { DB_URL?: string };
  if (!status.DB_URL) throw new Error('local_migration_rehearsal_db_url_missing');
  const host = new URL(status.DB_URL).hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error(`local_migration_rehearsal_non_loopback_db_forbidden:${host}`);
  }
}

function assertStaticContracts(): Array<{ migration: string; bytes: number }> {
  return V3_MIGRATIONS.map((migration) => {
    const path = join(process.cwd(), 'supabase', 'migrations', migration);
    if (!existsSync(path)) throw new Error(`v3_migration_missing:${migration}`);
    const sql = readFileSync(path, 'utf8');
    if (/\b(?:delete\s+from|truncate\s+table)\b/i.test(stripDollarQuotedBodies(sql).replace(/--[^\n]*/g, ''))) {
      throw new Error(`v3_migration_unbounded_data_mutation_review_required:${migration}`);
    }
    return { migration, bytes: Buffer.byteLength(sql, 'utf8') };
  });
}

function main(): void {
  const forbidden = process.argv.filter((arg) => (
    arg === '--linked' || arg === '--apply' || arg.startsWith('--db-url')
  ));
  if (forbidden.length > 0) throw new Error(`production_or_remote_target_forbidden:${forbidden.join(',')}`);
  const executeLocalReset = process.argv.includes('--local-reset');
  const migrations = assertStaticContracts();
  const projectId = readSupabaseProjectId();
  const plan = {
    mode: executeLocalReset ? 'local_ephemeral_reset' : 'dry_run',
    remote_access_allowed: false,
    project_id: projectId,
    dedicated_rehearsal_project: isDedicatedRehearsalProjectId(projectId),
    migrations,
    commands: [
      'npx supabase status --output json',
      'npx supabase db reset --local --no-seed',
      'npx supabase db lint --local --schema public --level error --fail-on error',
      'npx supabase test db --local supabase/tests/blog_public_eligibility_v3.sql supabase/tests/blog_quality_v3_reliability.sql',
    ],
  };
  console.log(JSON.stringify(plan, null, 2));
  if (!executeLocalReset) return;
  if (process.env.BLOG_LOCAL_MIGRATION_REHEARSAL_CONFIRM !== 'LOCAL_EPHEMERAL_DB') {
    throw new Error('local_migration_rehearsal_confirmation_missing');
  }

  assertDedicatedLocalRehearsalTarget(projectId);
  runSupabase(['db', 'reset', '--local', '--no-seed']);
  runSupabase(['db', 'lint', '--local', '--schema', 'public', '--level', 'error', '--fail-on', 'error']);
  runSupabase([
    'test', 'db', '--local',
    'supabase/tests/blog_public_eligibility_v3.sql',
    'supabase/tests/blog_quality_v3_reliability.sql',
  ]);
  console.log(JSON.stringify({ ok: true, target: 'local_ephemeral_only' }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
