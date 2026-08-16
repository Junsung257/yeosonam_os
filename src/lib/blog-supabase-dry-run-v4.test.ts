import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const versions = [
  '20260606115000', '20260814033000', '20260815093943', '20260815120135', '20260815211325',
  '20260816015102', '20260816093000', '20260816094500', '20260816120000',
  '20260816123000',
];
const tsxCli = join(dirname(require.resolve('tsx')), 'cli.mjs');

function run(text: string, name: string) {
  const root = mkdtempSync(join(tmpdir(), 'blog-v4-dry-run-'));
  const path = join(root, name);
  writeFileSync(path, text, 'utf8');
  return spawnSync(process.execPath, [
    tsxCli,
    'scripts/verify-blog-supabase-dry-run-v4.ts',
    `--input=${path}`,
  ], { cwd: process.cwd(), encoding: 'utf8' });
}

function runAllowEmpty(name: string) {
  const root = mkdtempSync(join(tmpdir(), 'blog-v4-dry-run-'));
  const path = join(root, name);
  writeFileSync(path, 'No pending migrations.\n', 'utf8');
  return spawnSync(process.execPath, [
    tsxCli,
    'scripts/verify-blog-supabase-dry-run-v4.ts',
    `--input=${path}`,
    '--allow-empty',
  ], { cwd: process.cwd(), encoding: 'utf8' });
}

describe('Blog V4 Supabase dry-run exact-set verifier', () => {
  it('passes only the ten pinned release migrations', () => {
    const result = run(versions.map((version) => ` • ${version}_migration.sql`).join('\n'), 'pass.txt');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"passed": true');
  });

  it('fails for any unexpected migration outside the pinned manifest', () => {
    const result = run([...versions.slice(1), '20260816130000'].join('\n'), 'fail.txt');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('supabase_dry_run_set_mismatch');
  });

  it('accepts a pending subset when earlier pinned migrations were already applied', () => {
    const result = run(' • 20260814033000_blog_medication_high_risk_policy.sql', 'subset.txt');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('pending_manifest_subset');
  });

  it('permits an empty set only for an idempotent release rerun', () => {
    const result = runAllowEmpty('empty.txt');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('already_applied');
  });
});
