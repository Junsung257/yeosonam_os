import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/release-manifests/ai-control-plane-v1-20260819.json'), 'utf8')) as {
  migrations: Array<{ file: string; sha256: string }>;
  rollbacks: Array<{ file: string; sha256: string }>;
};

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
}

for (const entry of [...manifest.migrations, ...manifest.rollbacks]) {
  const observed = sha256(entry.file);
  if (observed !== entry.sha256) throw new Error(`ai_control_plane_hash_mismatch:${entry.file}`);
}
console.log(`[ai-control-plane-migration] PASS (${manifest.migrations.length} migration, ${manifest.rollbacks.length} rollback)`);
