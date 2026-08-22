import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readJson } from './lib/blog-v4-schema-baseline-v4';

type ReleaseManifest = { release: string; migrations: Array<{ version: string; file: string; sha256: string }> };
type BaselineHistory = { embodiedMigrations?: string[]; pendingAfterBaseline?: string[] };

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function version(file: string): string {
  return basename(file).match(/^(\d{14})/)?.[1] ?? '';
}

function hash(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function main(): void {
  const manifestPath = resolve(argument('manifest') ?? 'supabase/release-manifests/blog-v4-longrun-20260822.json');
  const historyPath = argument('migration-history');
  const output = resolve(argument('output') ?? '.tmp/blog-v4-longrun/release');
  const sourceManifest = readJson<ReleaseManifest>(manifestPath);
  const history = historyPath ? readJson<BaselineHistory>(resolve(historyPath)) : {};
  const embodied = new Set(history.embodiedMigrations ?? []);
  const migrationsDir = resolve(argument('migrations-dir') ?? 'supabase/migrations');
  if (existsSync(output)) rmSync(output, { recursive: true, force: true });
  mkdirSync(resolve(output, 'supabase/migrations'), { recursive: true });
  const pending = sourceManifest.migrations.filter((entry) => !embodied.has(entry.version));
  if (pending.length === 0) throw new Error('blog_v4_longrun_release_has_no_pending_migrations');
  for (const entry of pending) {
    const source = resolve(entry.file);
    if (!existsSync(source)) throw new Error(`blog_v4_longrun_migration_missing:${source}`);
    const actualHash = hash(source);
    if (actualHash !== entry.sha256) throw new Error(`blog_v4_longrun_migration_hash_mismatch:${entry.version}`);
    copyFileSync(source, resolve(output, 'supabase/migrations', basename(source)));
  }
  const pendingVersions = pending.map((entry) => entry.version).sort();
  writeFileSync(resolve(output, 'release-manifest.json'), `${JSON.stringify({
    ...sourceManifest,
    migrations: pending,
    embodiedMigrations: [...embodied].sort(),
    pendingMigrations: pendingVersions,
    productionDataClone: false,
  }, null, 2)}\n`);
  writeFileSync(resolve(output, 'supabase/config.toml'), '[project]\n\n');
  process.stdout.write(`${JSON.stringify({ output, pendingMigrations: pendingVersions, embodiedMigrationCount: embodied.size }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Blog V4 long-run release workdir preparation failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
