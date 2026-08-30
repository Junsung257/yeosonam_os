import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const MANIFEST = 'supabase/release-manifests/blog-editorial-harness-v5-20260830.json';
const RELEASE = 'blog-editorial-harness-v5-20260830';
const APPLY_MODE = 'supabase-db-push-include-all-after-exact-dry-run';

type Entry = { file: string; sha256: string };
type Manifest = {
  schema_version: number;
  release: string;
  apply_mode: string;
  migrations: Array<Entry & { version: string }>;
  rollback: Entry;
};

function repositoryFile(root: string, relative: string): string {
  const normalizedRoot = resolve(root);
  const absolute = resolve(root, relative);
  if (absolute !== normalizedRoot && !absolute.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error(`blog_v5_release_path_escape:${relative}`);
  }
  if (!existsSync(absolute)) throw new Error(`blog_v5_release_file_missing:${relative}`);
  return absolute;
}

function verifyEntry(root: string, entry: Entry): Entry & { bytes: number } {
  if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
    throw new Error(`blog_v5_release_hash_invalid:${entry.file}`);
  }
  const path = repositoryFile(root, entry.file);
  const bytes = readFileSync(path);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== entry.sha256) {
    throw new Error(`blog_v5_release_hash_mismatch:${entry.file}:${actual}`);
  }
  return { ...entry, bytes: bytes.byteLength };
}

export function verifyBlogEditorialHarnessV5ReleaseBundle(root = process.cwd()) {
  const manifest = JSON.parse(readFileSync(repositoryFile(root, MANIFEST), 'utf8')) as Manifest;
  if (manifest.schema_version !== 1 || manifest.release !== RELEASE) {
    throw new Error('blog_v5_release_identity_invalid');
  }
  if (manifest.apply_mode !== APPLY_MODE) throw new Error('blog_v5_release_apply_mode_invalid');
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length !== 1) {
    throw new Error('blog_v5_release_migration_count_invalid');
  }
  const migration = manifest.migrations[0]!;
  if (!/^\d{14}$/.test(migration.version)
    || !migration.file.split('/').at(-1)?.startsWith(`${migration.version}_`)) {
    throw new Error(`blog_v5_release_version_filename_mismatch:${migration.file}`);
  }
  return {
    manifest: MANIFEST,
    release: manifest.release,
    applyMode: manifest.apply_mode,
    migrations: [{ ...verifyEntry(root, migration), version: migration.version }],
    rollback: verifyEntry(root, manifest.rollback),
  };
}
