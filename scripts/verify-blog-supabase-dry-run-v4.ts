import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function argumentsList(name: string): string[] {
  const prefix = `--${name}=`;
  return process.argv
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.slice(prefix.length).trim())
    .filter(Boolean);
}

function main(): void {
  const input = argument('input');
  if (!input) throw new Error('usage: --input=<supabase db push --dry-run output>');
  const path = resolve(input);
  if (!existsSync(path)) throw new Error(`supabase_dry_run_output_missing:${path}`);
  const manifestPath = argument('manifest')
    ?? 'supabase/release-manifests/blog-orchestrator-v4-20260816.json';
  const manifest = JSON.parse(readFileSync(
    resolve(manifestPath),
    'utf8',
  )) as { migrations: Array<{ version: string; file: string }> };
  const output = readFileSync(path, 'utf8');
  const observed = [...new Set(
    [...output.matchAll(/(?<!\d)(20\d{12})(?:_[a-zA-Z0-9_-]+)?(?:\.sql)?(?!\d)/g)].map((match) => match[1]!),
  )].sort();
  const expected = manifest.migrations.map((entry) => entry.version).sort();
  const allowedExtras = argumentsList('allow-extra');
  for (const version of allowedExtras) {
    if (!/^\d{14}$/.test(version)) throw new Error(`supabase_dry_run_allowed_extra_invalid:${version}`);
  }
  if (observed.length === 0 && process.argv.includes('--allow-empty')) {
    process.stdout.write(`${JSON.stringify({ passed: true, mode: 'already_applied', expected, observed, allowedExtras }, null, 2)}\n`);
    return;
  }
  const unexpected = observed.filter((version) => !expected.includes(version) && !allowedExtras.includes(version));
  if (unexpected.length > 0) {
    throw new Error(`supabase_dry_run_set_mismatch:unexpected=${unexpected.join(',')}`);
  }
  const missing = expected.filter((version) => !observed.includes(version));
  if (process.argv.includes('--require-exact') && missing.length > 0) {
    throw new Error(`supabase_dry_run_set_mismatch:missing=${missing.join(',')}`);
  }
  const mode = observed.length === expected.length ? 'exact_pending_set' : 'pending_manifest_subset';
  process.stdout.write(`${JSON.stringify({ passed: true, mode, expected, observed, allowedExtras }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`blog V4 Supabase dry-run verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
