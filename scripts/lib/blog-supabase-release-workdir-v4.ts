import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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

import { verifyBlogOrchestratorV4ReleaseBundle } from './blog-orchestrator-v4-release-bundle';

const VERSION_PATTERN = /^\d{14}$/;
export const BLOG_RELEASE_SUPABASE_CLI_PACKAGE = 'supabase@2.116.0';

type ReleaseMigration = {
  version: string;
  file: string;
  sha256: string;
};

export type BlogSupabaseReleaseWorkdirSummaryV4 = {
  schemaVersion: 1;
  release: string;
  outputDirectory: string;
  remoteAppliedCount: number;
  placeholderCount: number;
  releaseMigrationCount: number;
  alreadyAppliedReleaseVersions: string[];
  pendingReleaseVersions: string[];
  migrationDirectoryDigest: string;
};

function assertVersion(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    throw new Error(`blog_v4_remote_migration_version_invalid:${String(value)}`);
  }
}

function assertTemporaryOutput(root: string, output: string): string {
  const repositoryRoot = resolve(root);
  const temporaryRoot = resolve(repositoryRoot, '.tmp');
  const absolute = resolve(repositoryRoot, output);
  if (absolute === temporaryRoot || !absolute.startsWith(`${temporaryRoot}${sep}`)) {
    throw new Error(`blog_v4_release_workdir_must_be_under_tmp:${output}`);
  }
  return absolute;
}

function migrationDigest(directory: string): string {
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(resolve(directory, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function parseLinkedMigrationVersionsV4(output: string): string[] {
  const parsed = JSON.parse(output) as {
    rows?: Array<{ evidence?: { versions?: unknown[] } | string }>;
    migrations?: Array<{ remote?: unknown }>;
  };
  const evidence = parsed.rows?.[0]?.evidence;
  const normalizedEvidence = typeof evidence === 'string'
    ? JSON.parse(evidence) as { versions?: unknown[] }
    : evidence;
  const values = Array.isArray(parsed.migrations)
    ? parsed.migrations
        .map((migration) => migration.remote)
        .filter((version) => version !== '')
    : normalizedEvidence?.versions;
  if (!Array.isArray(values)) throw new Error('blog_v4_remote_migration_versions_missing');
  for (const value of values) assertVersion(value);
  const versions = [...new Set(values as string[])].sort();
  if (versions.length !== values.length) throw new Error('blog_v4_remote_migration_versions_duplicate');
  return versions;
}

export function readLinkedMigrationVersionsV4(): string[] {
  const options = {
    encoding: 'utf8' as const,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
  };
  const arguments_ = [
    '--yes',
    BLOG_RELEASE_SUPABASE_CLI_PACKAGE,
    'migration',
    'list',
    '--linked',
    '--output-format',
    'json',
  ];
  const output = process.platform === 'win32'
    ? execFileSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$nodeExe = (Get-Command node).Source; $npxCli = Join-Path (Split-Path $nodeExe) 'node_modules\\npm\\bin\\npx-cli.js'; & $nodeExe $npxCli ${arguments_.join(' ')}`,
      ], options)
    : execFileSync('npx', arguments_, options);
  return parseLinkedMigrationVersionsV4(output);
}

export function prepareBlogSupabaseReleaseWorkdirV4(input: {
  root?: string;
  output: string;
  remoteVersions: string[];
}): BlogSupabaseReleaseWorkdirSummaryV4 {
  const root = resolve(input.root ?? process.cwd());
  const outputDirectory = assertTemporaryOutput(root, input.output);
  const linkedMetadata = resolve(root, 'supabase/.temp');
  const config = resolve(root, 'supabase/config.toml');
  if (!existsSync(config)) throw new Error('blog_v4_supabase_config_missing');
  if (!existsSync(linkedMetadata)) throw new Error('blog_v4_supabase_link_metadata_missing');

  const bundle = verifyBlogOrchestratorV4ReleaseBundle(root);
  const releaseMigrations = bundle.migrations as ReleaseMigration[];
  const releaseByVersion = new Map(releaseMigrations.map((entry) => [entry.version, entry]));
  for (const version of input.remoteVersions) assertVersion(version);
  const remoteVersions = [...new Set(input.remoteVersions)].sort();
  if (remoteVersions.length !== input.remoteVersions.length) {
    throw new Error('blog_v4_remote_migration_versions_duplicate');
  }

  if (existsSync(outputDirectory)) rmSync(outputDirectory, { recursive: true, force: true });
  const supabaseDirectory = resolve(outputDirectory, 'supabase');
  const migrationDirectory = resolve(supabaseDirectory, 'migrations');
  mkdirSync(migrationDirectory, { recursive: true });
  cpSync(config, resolve(supabaseDirectory, 'config.toml'));
  cpSync(linkedMetadata, resolve(supabaseDirectory, '.temp'), { recursive: true });

  let placeholderCount = 0;
  for (const version of remoteVersions) {
    const release = releaseByVersion.get(version);
    if (release) {
      cpSync(resolve(root, release.file), resolve(migrationDirectory, basename(release.file)));
      continue;
    }
    writeFileSync(
      resolve(migrationDirectory, `${version}_remote_history_placeholder.sql`),
      `-- ${version} is already applied to the linked project.\n-- This release-only workdir intentionally carries no historical SQL.\n`,
      'utf8',
    );
    placeholderCount += 1;
  }

  for (const release of releaseMigrations) {
    if (remoteVersions.includes(release.version)) continue;
    cpSync(resolve(root, release.file), resolve(migrationDirectory, basename(release.file)));
  }

  const alreadyAppliedReleaseVersions = releaseMigrations
    .map((entry) => entry.version)
    .filter((version) => remoteVersions.includes(version));
  const pendingReleaseVersions = releaseMigrations
    .map((entry) => entry.version)
    .filter((version) => !remoteVersions.includes(version));
  const summary: BlogSupabaseReleaseWorkdirSummaryV4 = {
    schemaVersion: 1,
    release: bundle.release,
    outputDirectory: relative(root, outputDirectory).replaceAll('\\', '/'),
    remoteAppliedCount: remoteVersions.length,
    placeholderCount,
    releaseMigrationCount: releaseMigrations.length,
    alreadyAppliedReleaseVersions,
    pendingReleaseVersions,
    migrationDirectoryDigest: migrationDigest(migrationDirectory),
  };
  writeFileSync(
    resolve(outputDirectory, 'release-workdir-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
  return summary;
}
