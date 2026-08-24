import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/release-manifests/blog-deepseek-auto-repair-v1-20260819.json'), 'utf8')) as {
  migrations: Array<{ file: string; sha256: string }>;
  rollback: { file: string; sha256: string };
};

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
}

for (const entry of [...manifest.migrations, manifest.rollback]) {
  const observed = sha256(entry.file);
  if (observed !== entry.sha256) throw new Error(`blog_auto_repair_migration_hash_mismatch:${entry.file}`);
}

console.log(`[blog-auto-repair-migration] PASS (${manifest.migrations.length} migration, 1 rollback)`);
