import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';

import { verifyBlogAutopublishRecoveryReleaseBundle } from './lib/blog-autopublish-recovery-release-bundle';
import { readLinkedMigrationVersionsV4 } from './lib/blog-supabase-release-workdir-v4';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function assertTemporaryOutput(root: string, output: string): string {
  const temporaryRoot = resolve(root, '.tmp');
  const absolute = resolve(root, output);
  if (absolute === temporaryRoot || !absolute.startsWith(`${temporaryRoot}${sep}`)) {
    throw new Error(`blog_autopublish_recovery_release_workdir_must_be_under_tmp:${output}`);
  }
  return absolute;
}

function migrationDigest(directory: string): string {
  const hash = createHash('sha256');
  for (const file of readdirSync(directory).filter((value) => value.endsWith('.sql')).sort()) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(resolve(directory, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

try {
  const root = resolve(process.cwd());
  const output = argument('output') ?? '.tmp/blog-autopublish-recovery-supabase-release';
  const outputDirectory = assertTemporaryOutput(root, output);
  const config = resolve(root, 'supabase/config.toml');
  const linkedMetadata = resolve(root, 'supabase/.temp');
  if (!existsSync(config) || !existsSync(linkedMetadata)) {
    throw new Error('blog_autopublish_recovery_supabase_link_metadata_missing');
  }
  const bundle = verifyBlogAutopublishRecoveryReleaseBundle(root);
  const remoteVersions = readLinkedMigrationVersionsV4();
  if (existsSync(outputDirectory)) rmSync(outputDirectory, { recursive: true, force: true });
  const supabaseDirectory = resolve(outputDirectory, 'supabase');
  const migrationDirectory = resolve(supabaseDirectory, 'migrations');
  mkdirSync(migrationDirectory, { recursive: true });
  cpSync(config, resolve(supabaseDirectory, 'config.toml'));
  cpSync(linkedMetadata, resolve(supabaseDirectory, '.temp'), { recursive: true });

  for (const version of remoteVersions) {
    writeFileSync(
      resolve(migrationDirectory, `${version}_remote_history_placeholder.sql`),
      `-- ${version} is already applied to the linked project.\n-- Release-only placeholder; no historical SQL is replayed.\n`,
      'utf8',
    );
  }
  const alreadyApplied: string[] = [];
  const pending: string[] = [];
  for (const migration of bundle.migrations) {
    if (remoteVersions.includes(migration.version)) {
      alreadyApplied.push(migration.version);
      continue;
    }
    pending.push(migration.version);
    cpSync(resolve(root, migration.file), resolve(migrationDirectory, basename(migration.file)));
  }
  const summary = {
    schemaVersion: 1,
    release: bundle.release,
    outputDirectory: relative(root, outputDirectory).replaceAll('\\', '/'),
    remoteAppliedCount: remoteVersions.length,
    placeholderCount: remoteVersions.length,
    releaseMigrationCount: bundle.migrations.length,
    alreadyAppliedReleaseVersions: alreadyApplied,
    pendingReleaseVersions: pending,
    migrationDirectoryDigest: migrationDigest(migrationDirectory),
  };
  writeFileSync(resolve(outputDirectory, 'release-workdir-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`blog autopublish recovery Supabase workdir preparation failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
