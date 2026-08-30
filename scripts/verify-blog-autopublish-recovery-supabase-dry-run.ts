import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

try {
  const input = argument('input');
  if (!input) throw new Error('usage: --input=<supabase db push --dry-run output>');
  const path = resolve(input);
  if (!existsSync(path)) throw new Error(`supabase_dry_run_output_missing:${path}`);
  const manifest = JSON.parse(readFileSync(
    resolve('supabase/release-manifests/blog-autopublish-recovery-20260831.json'),
    'utf8',
  )) as { migrations: Array<{ version: string }> };
  const output = readFileSync(path, 'utf8');
  const observed = [...new Set(
    [...output.matchAll(/\b(20\d{12})(?:_[a-zA-Z0-9_-]+)?(?:\.sql)?\b/g)]
      .map((match) => match[1]!),
  )].sort();
  const expected = manifest.migrations.map((entry) => entry.version).sort();
  if (observed.length === 0 && process.argv.includes('--allow-empty')) {
    process.stdout.write(`${JSON.stringify({ passed: true, mode: 'already_applied', expected, observed }, null, 2)}\n`);
  } else if (observed.join(',') !== expected.join(',')) {
    throw new Error(`supabase_dry_run_set_mismatch:expected=${expected.join(',')};observed=${observed.join(',')}`);
  } else {
    process.stdout.write(`${JSON.stringify({ passed: true, mode: 'exact_pending_set', expected, observed }, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`blog autopublish recovery Supabase dry-run verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
