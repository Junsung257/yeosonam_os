import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const MANIFEST = 'supabase/release-manifests/blog-content-factory-v4-20260819.json';

type Entry = { file: string; sha256: string };
type Manifest = {
  schema_version: number;
  release: string;
  apply_mode: string;
  migrations: Array<Entry & { version: string }>;
  rollback: Entry;
};

function repositoryFile(root: string, relative: string): string {
  const repositoryRoot = resolve(root);
  const absolute = resolve(repositoryRoot, relative);
  if (absolute !== repositoryRoot && !absolute.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error(`blog_content_factory_release_path_escape:${relative}`);
  }
  if (!existsSync(absolute)) throw new Error(`blog_content_factory_release_file_missing:${relative}`);
  return absolute;
}

function verifyEntry(root: string, entry: Entry): Entry & { bytes: number } {
  if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
    throw new Error(`blog_content_factory_release_hash_invalid:${entry.file}`);
  }
  const file = repositoryFile(root, entry.file);
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (actual !== entry.sha256) {
    throw new Error(`blog_content_factory_release_hash_mismatch:${entry.file}:${actual}`);
  }
  return { ...entry, bytes: readFileSync(file).byteLength };
}

export function verifyBlogContentFactoryV4ReleaseBundle(root = process.cwd()) {
  const manifest = JSON.parse(readFileSync(repositoryFile(root, MANIFEST), 'utf8')) as Manifest;
  if (manifest.schema_version !== 1 || manifest.release !== 'blog-content-factory-v4-20260819') {
    throw new Error('blog_content_factory_release_identity_invalid');
  }
  if (manifest.apply_mode !== 'supabase-db-push-exact-dry-run-required') {
    throw new Error('blog_content_factory_release_apply_mode_invalid');
  }
  if (manifest.migrations.length !== 1) throw new Error('blog_content_factory_release_migration_count_invalid');
  const migration = manifest.migrations[0]!;
  if (!/^\d{14}$/.test(migration.version)
    || !migration.file.split('/').at(-1)?.startsWith(`${migration.version}_`)) {
    throw new Error(`blog_content_factory_release_version_filename_mismatch:${migration.file}`);
  }
  return {
    manifest: MANIFEST,
    release: manifest.release,
    applyMode: manifest.apply_mode,
    migrations: [{ ...verifyEntry(root, migration), version: migration.version }],
    rollback: verifyEntry(root, manifest.rollback),
  };
}
