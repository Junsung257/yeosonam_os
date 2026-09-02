import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const MANIFEST = 'supabase/release-manifests/blog-orchestrator-v4-20260816.json';

type Entry = { file: string; sha256: string };
type Manifest = {
  schema_version: number;
  release: string;
  apply_mode: string;
  migrations: Array<Entry & { version: string }>;
  rollback: Entry;
};

function hash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function repositoryFile(root: string, relative: string): string {
  const normalizedRoot = resolve(root);
  const absolute = resolve(root, relative);
  if (absolute !== normalizedRoot && !absolute.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error(`blog_v4_release_path_escape:${relative}`);
  }
  if (!existsSync(absolute)) throw new Error(`blog_v4_release_file_missing:${relative}`);
  return absolute;
}

function verifyEntry(root: string, entry: Entry): Entry & { bytes: number } {
  if (!/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error(`blog_v4_release_hash_invalid:${entry.file}`);
  const path = repositoryFile(root, entry.file);
  const actual = hash(path);
  if (actual !== entry.sha256) throw new Error(`blog_v4_release_hash_mismatch:${entry.file}:${actual}`);
  return { ...entry, bytes: readFileSync(path).byteLength };
}

export function verifyBlogOrchestratorV4ReleaseBundle(root = process.cwd()) {
  const manifest = JSON.parse(readFileSync(repositoryFile(root, MANIFEST), 'utf8')) as Manifest;
  if (manifest.schema_version !== 1 || manifest.release !== 'blog-autopilot-v4-20260902') {
    throw new Error('blog_v4_release_identity_invalid');
  }
  if (manifest.apply_mode !== 'supabase-db-push-include-all-after-exact-dry-run') {
    throw new Error('blog_v4_release_apply_mode_invalid');
  }
  if (manifest.migrations.length !== 15) throw new Error('blog_v4_release_migration_count_invalid');
  const versions = manifest.migrations.map((entry) => entry.version);
  if (new Set(versions).size !== versions.length || versions.join() !== [...versions].sort().join()) {
    throw new Error('blog_v4_release_version_order_invalid');
  }
  const migrations = manifest.migrations.map((entry) => {
    if (!/^\d{14}$/.test(entry.version) || !entry.file.split('/').at(-1)?.startsWith(`${entry.version}_`)) {
      throw new Error(`blog_v4_release_version_filename_mismatch:${entry.file}`);
    }
    return { ...verifyEntry(root, entry), version: entry.version };
  });
  const rollback = verifyEntry(root, manifest.rollback);
  return { manifest: MANIFEST, release: manifest.release, applyMode: manifest.apply_mode, migrations, rollback };
}
