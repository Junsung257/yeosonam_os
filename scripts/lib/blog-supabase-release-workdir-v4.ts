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

import { verifyBlogOrchestratorV4ReleaseBundle } from './blog-orchestrator-v4-release-bundle';
import { verifyBlogContentFactoryV4ReleaseBundle } from './blog-content-factory-v4-release-bundle';
import {
  parseLinkedMigrationVersionsV4,
  type BlogRemoteMigrationEvidenceV4,
  validateBlogRemoteMigrationEvidenceV4,
} from './blog-remote-migration-evidence-v4';

export { parseLinkedMigrationVersionsV4 } from './blog-remote-migration-evidence-v4';

type ReleaseMigration = {
  version: string;
  file: string;
  sha256: string;
};

export type BlogSupabaseReleaseWorkdirSummaryV4 = {
  schemaVersion: 1;
  release: string;
  environment: BlogRemoteMigrationEvidenceV4['environment'];
  expectedProjectRef: string;
  linkedProjectRef: string;
  remoteEvidenceSha256: string;
  outputDirectory: string;
  remoteAppliedCount: number;
  placeholderCount: number;
  releaseMigrationCount: number;
  alreadyAppliedReleaseVersions: string[];
  pendingReleaseVersions: string[];
  migrationDirectoryDigest: string;
};

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

export function prepareBlogSupabaseReleaseWorkdirV4(input: {
  root?: string;
  linkedWorkdir?: string;
  output: string;
  remoteEvidence: BlogRemoteMigrationEvidenceV4;
  allowProductionEvidence?: boolean;
  release?: 'orchestrator' | 'content_factory';
}): BlogSupabaseReleaseWorkdirSummaryV4 {
  const root = resolve(input.root ?? process.cwd());
  const outputDirectory = assertTemporaryOutput(root, input.output);
  const linkedMetadata = resolve(input.linkedWorkdir ?? root, 'supabase/.temp');
  const config = resolve(root, 'supabase/config.toml');
  if (!existsSync(config)) throw new Error('blog_v4_supabase_config_missing');
  if (!existsSync(linkedMetadata)) throw new Error('blog_v4_supabase_link_metadata_missing');
  const linkedProjectRef = readFileSync(resolve(linkedMetadata, 'project-ref'), 'utf8').trim().toLowerCase();
  const remoteEvidence = validateBlogRemoteMigrationEvidenceV4(input.remoteEvidence, {
    linkedProjectRef,
    allowProductionRead: input.allowProductionEvidence,
  });
  const remoteVersions = remoteEvidence.remoteVersions;

  const bundle = input.release === 'content_factory'
    ? verifyBlogContentFactoryV4ReleaseBundle(root)
    : verifyBlogOrchestratorV4ReleaseBundle(root);
  const releaseMigrations = bundle.migrations as ReleaseMigration[];
  const releaseByVersion = new Map(releaseMigrations.map((entry) => [entry.version, entry]));

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
    environment: remoteEvidence.environment,
    expectedProjectRef: remoteEvidence.expectedProjectRef,
    linkedProjectRef,
    remoteEvidenceSha256: remoteEvidence.evidenceSha256,
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
