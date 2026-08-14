import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

const MANIFEST_FILE = 'supabase/release-manifests/blog-quality-v3-20260811.json';
const EXPECTED_RELEASE = 'blog-quality-engine-v3-20260811';
const EXPECTED_MIGRATION_COUNT = 5;
const EXPECTED_ROLLBACK_FILE = 'supabase/rollbacks/20260811_blog_quality_v3_rollback.sql';

type ManifestEntry = {
  file: string;
  sha256: string;
};

type MigrationManifestEntry = ManifestEntry & {
  version: string;
};

type ReleaseManifest = {
  schema_version: number;
  release: string;
  migrations: MigrationManifestEntry[];
  rollback: ManifestEntry;
};

export type VerifiedBlogMigrationReleaseBundle = {
  release: string;
  manifestFile: string;
  migrations: Array<MigrationManifestEntry & { bytes: number }>;
  rollback: ManifestEntry & { bytes: number };
};

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertRepositoryFile(root: string, relativeFile: string): string {
  if (!relativeFile || basename(relativeFile) !== relativeFile.split('/').at(-1)) {
    throw new Error(`blog_v3_release_manifest_file_invalid:${relativeFile}`);
  }
  const resolvedRoot = resolve(root);
  const absolute = resolve(root, relativeFile);
  if (absolute !== resolvedRoot && !absolute.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`blog_v3_release_manifest_path_escape:${relativeFile}`);
  }
  if (!existsSync(absolute)) throw new Error(`blog_v3_release_file_missing:${relativeFile}`);
  return absolute;
}

function verifyEntry(root: string, entry: ManifestEntry): ManifestEntry & { bytes: number } {
  if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
    throw new Error(`blog_v3_release_sha256_invalid:${entry.file}`);
  }
  const bytes = readFileSync(assertRepositoryFile(root, entry.file));
  const actual = sha256(bytes);
  if (actual !== entry.sha256) {
    throw new Error(`blog_v3_release_sha256_mismatch:${entry.file}:${actual}`);
  }
  return { ...entry, bytes: bytes.byteLength };
}

export function verifyBlogMigrationReleaseBundleV3(
  root = process.cwd(),
): VerifiedBlogMigrationReleaseBundle {
  const manifestPath = assertRepositoryFile(root, MANIFEST_FILE);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ReleaseManifest;
  if (manifest.schema_version !== 1 || manifest.release !== EXPECTED_RELEASE) {
    throw new Error('blog_v3_release_manifest_identity_invalid');
  }
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length !== EXPECTED_MIGRATION_COUNT) {
    throw new Error('blog_v3_release_manifest_migration_count_invalid');
  }

  const versions = manifest.migrations.map((entry) => entry.version);
  const files = manifest.migrations.map((entry) => entry.file);
  if (new Set(versions).size !== versions.length || new Set(files).size !== files.length) {
    throw new Error('blog_v3_release_manifest_duplicate_entry');
  }
  if (versions.some((version, index) => !/^\d{14}$/.test(version)
    || !basename(files[index]).startsWith(`${version}_`))) {
    throw new Error('blog_v3_release_manifest_version_filename_mismatch');
  }
  if (versions.join('\n') !== [...versions].sort().join('\n')) {
    throw new Error('blog_v3_release_manifest_order_invalid');
  }

  const migrationDirectory = join(root, 'supabase', 'migrations');
  const onDiskV3Files = readdirSync(migrationDirectory)
    .filter((file) => /^20260811\d+_blog_quality_v3_.*\.sql$/.test(file))
    .sort();
  const manifestV3Files = files.map((file) => basename(file)).sort();
  if (onDiskV3Files.join('\n') !== manifestV3Files.join('\n')) {
    throw new Error('blog_v3_release_manifest_file_set_drift');
  }

  const migrations = manifest.migrations.map((entry) => ({
    ...verifyEntry(root, entry),
    version: entry.version,
  }));
  if (manifest.rollback.file !== EXPECTED_ROLLBACK_FILE) {
    throw new Error('blog_v3_release_rollback_file_invalid');
  }
  const rollback = verifyEntry(root, manifest.rollback);
  if (dirname(manifest.rollback.file).replaceAll('\\', '/') !== 'supabase/rollbacks') {
    throw new Error('blog_v3_release_rollback_location_invalid');
  }

  return {
    release: manifest.release,
    manifestFile: MANIFEST_FILE,
    migrations,
    rollback,
  };
}
