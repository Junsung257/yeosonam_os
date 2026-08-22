import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function csvArgument(name: string): string[] {
  return (argument(name) ?? '').split(',').map((value) => value.trim()).filter(Boolean);
}

function npxInvocation(): { command: string; prefix: string[] } {
  if (process.platform !== 'win32') return { command: 'npx', prefix: [] };
  const npxCli = resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (!existsSync(npxCli)) throw new Error('windows_npx_cli_missing');
  return { command: process.execPath, prefix: [npxCli] };
}

type CredentialMode = 'url' | 'linked-password';

function approvedProductionRead(sourceRef: string | null): boolean {
  return process.argv.includes('--approve-production-schema-read')
    && process.env.BLOG_SCHEMA_READ_APPROVED === 'true'
    && sourceRef != null;
}

function sourceProjectRef(sourceRef: string): string {
  if (!/^[a-z0-9]{20}$/.test(sourceRef)) throw new Error('schema_only_source_project_ref_invalid');
  return sourceRef;
}

function productionDatabaseUrl(expectedRef: string): string {
  const envName = argument('database-url-env') ?? 'SUPABASE_PRODUCTION_SCHEMA_ONLY_DATABASE_URL';
  const value = process.env[envName];
  if (!value) throw new Error(`schema_only_database_url_missing:${envName}`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('schema_only_database_url_invalid');
  }
  const host = url.hostname.toLowerCase();
  const username = decodeURIComponent(url.username).toLowerCase();
  const ref = expectedRef.toLowerCase();
  const projectRefMatches = host.includes(ref) || username === `postgres.${ref}` || username.endsWith(`.${ref}`);
  if (!projectRefMatches) throw new Error('schema_only_database_url_project_ref_mismatch');
  return value;
}

function productionDbPassword(): string {
  const value = process.env.SUPABASE_PRODUCTION_DB_PASSWORD?.trim();
  if (!value) throw new Error('schema_only_database_password_missing:SUPABASE_PRODUCTION_DB_PASSWORD');
  return value;
}

function resolveCredentialMode(): CredentialMode {
  if (process.env.SUPABASE_PRODUCTION_SCHEMA_ONLY_DATABASE_URL?.trim()) return 'url';
  if (process.env.SUPABASE_PRODUCTION_DB_PASSWORD?.trim()) return 'linked-password';
  throw new Error('schema_read_credential_missing');
}

function main(): void {
  const input = argument('input');
  const outputDir = resolve(argument('output-dir') ?? 'supabase/staging-baselines/yeosonam-v1');
  const sourceRef = argument('source-ref') ?? process.env.SUPABASE_PRODUCTION_PROJECT_REF;
  if (!sourceRef) throw new Error('schema_baseline_source_ref_required');
  mkdirSync(outputDir, { recursive: true });
  if (input) {
    if (!existsSync(resolve(input))) throw new Error(`schema_baseline_input_missing:${resolve(input)}`);
    const result = execFileSync(process.execPath, [
      resolve('node_modules/tsx/dist/cli.mjs'),
      resolve('scripts/sanitize-yeosonam-schema-baseline-v4.ts'),
      `--input=${resolve(input)}`,
      `--output-dir=${outputDir}`,
      `--source-ref=${sourceRef}`,
      ...(argument('required-objects') ? [`--required-objects=${resolve(argument('required-objects')!)}`] : []),
      ...(argument('embodied-migrations') ? [`--embodied-migrations=${argument('embodied-migrations')}`] : []),
      ...(argument('pending-after-baseline') ? [`--pending-after-baseline=${argument('pending-after-baseline')}`] : []),
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    writeFileSync(resolve(outputDir, 'credential-mode.json'), `${JSON.stringify({ credentialMode: 'offline-input' }, null, 2)}\n`, 'utf8');
    process.stdout.write(result);
    return;
  }
  if (!approvedProductionRead(sourceRef)) {
    throw new Error('production_schema_only_read_approval_required');
  }
  const projectRef = sourceProjectRef(sourceRef);
  const credentialMode = resolveCredentialMode();
  const databaseUrl = credentialMode === 'url' ? productionDatabaseUrl(projectRef) : null;
  const databasePassword = credentialMode === 'linked-password' ? productionDbPassword() : null;
  const tempPath = resolve(tmpdir(), `yeosonam-schema-only-${randomUUID()}.sql`);
  const linkedWorkdir = resolve(tmpdir(), `yeosonam-schema-only-workdir-${randomUUID()}`);
  try {
    const invocation = npxInvocation();
    const cliVersion = process.env.SUPABASE_CLI_VERSION ?? '2.111.0';
    const cliBase = [...invocation.prefix, '--yes', `supabase@${cliVersion}`];
    const dumpBase = [...cliBase, 'db', 'dump'];
    const help = execFileSync(invocation.command, [...dumpBase, '--help'], {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const flag of ['--db-url', '--linked', '--password', '--schema', '--file']) {
      if (!help.includes(flag)) throw new Error(`supabase_db_dump_flag_missing:${flag}`);
    }
    let args: string[];
    if (credentialMode === 'url') {
      args = [...dumpBase, '--db-url', databaseUrl!, '--schema', 'public', '--file', tempPath];
    } else {
      mkdirSync(resolve(linkedWorkdir, 'supabase'), { recursive: true });
      writeFileSync(resolve(linkedWorkdir, 'supabase', 'config.toml'), '[project]\n\n', 'utf8');
      const linkHelp = execFileSync(invocation.command, [...cliBase, 'link', '--help'], {
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      for (const flag of ['--project-ref', '--password', '--workdir']) {
        if (!linkHelp.includes(flag)) throw new Error(`supabase_link_flag_missing:${flag}`);
      }
      execFileSync(invocation.command, [
        ...cliBase,
        'link',
        '--workdir', linkedWorkdir,
        '--project-ref', projectRef,
        '--password', databasePassword!,
        '--yes',
      ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      args = [
        ...dumpBase,
        '--workdir', linkedWorkdir,
        '--linked',
        '--password', databasePassword!,
        '--schema', 'public',
        '--file', tempPath,
      ];
    }
    const schemas = csvArgument('schemas');
    const schemaArgs = schemas.length > 0 ? schemas : ['public'];
    args.splice(args.indexOf('--schema'), 2);
    for (const schema of schemaArgs) args.push('--schema', schema);
    execFileSync(invocation.command, [...invocation.prefix, ...args], {
      encoding: 'utf8',
      maxBuffer: 100 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = execFileSync(process.execPath, [
      resolve('node_modules/tsx/dist/cli.mjs'),
      resolve('scripts/sanitize-yeosonam-schema-baseline-v4.ts'),
      `--input=${tempPath}`,
      `--output-dir=${outputDir}`,
      `--source-ref=${projectRef}`,
      ...(argument('required-objects') ? [`--required-objects=${resolve(argument('required-objects')!)}`] : []),
      ...(argument('embodied-migrations') ? [`--embodied-migrations=${argument('embodied-migrations')}`] : []),
      ...(argument('pending-after-baseline') ? [`--pending-after-baseline=${argument('pending-after-baseline')}`] : []),
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    writeFileSync(resolve(outputDir, 'credential-mode.json'), `${JSON.stringify({ credentialMode }, null, 2)}\n`, 'utf8');
    process.stdout.write(result);
  } finally {
    if (existsSync(tempPath)) rmSync(tempPath, { force: true });
    if (existsSync(linkedWorkdir)) rmSync(linkedWorkdir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`Yeosonam schema baseline collection failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
