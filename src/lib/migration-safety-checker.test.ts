import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const checker = require('../../scripts/migration-safety-checker.js') as {
  MigrationChecker: new (file: string, content: string, options?: { indexCorpus?: string }) => {
    run(): Array<{ severity: string; type: string }>;
  };
  analyzeChangeSet(changes: Array<Record<string, unknown>>, options?: { approvals?: Record<string, unknown> }): {
    files: Array<{ issues: Array<{ severity: string }> }>;
  };
  applyExactApprovals(result: Record<string, unknown>, approvals: Record<string, unknown>): {
    files: Array<{ issues: Array<{ severity: string }> }>;
    approvedIssues: number;
  };
  collectMigrationChanges(input: { base: string; head: string; cwd: string }): Array<{
    status: string;
    path: string;
    oldPath?: string;
  }>;
  determineExitCode(result: { files: Array<{ issues: Array<{ severity: string }> }> }): number;
  parseNameStatusZ(output: string): Array<{ status: string; path: string; oldPath?: string }>;
  stripDollarQuotedBodies(content: string): string;
};

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('migration safety checker', () => {
  it('parses added, modified, deleted, and renamed records from a NUL manifest', () => {
    expect(checker.parseNameStatusZ([
      'A', 'supabase/migrations/20260101000000_add.sql',
      'M', 'supabase/migrations/20260101000001_modify.sql',
      'D', 'supabase/migrations/20260101000002_delete.sql',
      'R100', 'supabase/migrations/20260101000003_old.sql', 'supabase/migrations/20260101000003_new.sql',
      '',
    ].join('\0'))).toEqual([
      expect.objectContaining({ status: 'A', path: expect.stringContaining('_add.sql') }),
      expect.objectContaining({ status: 'M', path: expect.stringContaining('_modify.sql') }),
      expect.objectContaining({ status: 'D', path: expect.stringContaining('_delete.sql') }),
      expect.objectContaining({ status: 'R', oldPath: expect.stringContaining('_old.sql'), path: expect.stringContaining('_new.sql') }),
    ]);
  });

  it('reports a missing local foreign-key index as HIGH and passes when indexed', () => {
    const migration = `
      CREATE TABLE public.child_rows (
        id uuid PRIMARY KEY,
        parent_id uuid NOT NULL REFERENCES public.parent_rows(id)
      );
      ALTER TABLE public.child_rows ENABLE ROW LEVEL SECURITY;
      CREATE POLICY child_rows_service ON public.child_rows FOR ALL TO service_role USING (true);
    `;
    const missing = new checker.MigrationChecker('20260101000000_child.sql', migration).run();
    expect(missing).toContainEqual(expect.objectContaining({ severity: 'high', type: 'foreign-key-index' }));

    const indexed = `${migration}\nCREATE INDEX idx_child_parent ON public.child_rows(parent_id);`;
    expect(new checker.MigrationChecker('20260101000000_child.sql', indexed).run())
      .not.toContainEqual(expect.objectContaining({ type: 'foreign-key-index' }));
  });

  it('recognizes tables created in a custom schema before checking their indexes', () => {
    const migration = `
      CREATE TABLE internal_product_registration.image_fallback_runs (
        id uuid PRIMARY KEY,
        source_id uuid NOT NULL
      );
      ALTER TABLE internal_product_registration.image_fallback_runs ENABLE ROW LEVEL SECURITY;
      CREATE POLICY image_fallback_runs_service
        ON internal_product_registration.image_fallback_runs
        FOR ALL TO service_role USING (true);
      CREATE INDEX idx_image_fallback_runs_source
        ON internal_product_registration.image_fallback_runs(source_id);
    `;
    const issues = new checker.MigrationChecker('20260101000000_custom_schema.sql', migration).run();
    expect(issues).not.toContainEqual(expect.objectContaining({ type: 'lock-heavy' }));

    const existingTableIndex = `
      CREATE INDEX idx_image_fallback_runs_source
        ON internal_product_registration.image_fallback_runs(source_id);
    `;
    expect(new checker.MigrationChecker('20260101000001_existing_custom_schema.sql', existingTableIndex).run())
      .toContainEqual(expect.objectContaining({ severity: 'high', type: 'lock-heavy' }));
  });

  it('returns nonzero for HIGH and CRITICAL findings', () => {
    expect(checker.determineExitCode({ files: [{ issues: [{ severity: 'high' }] }] })).toBe(1);
    expect(checker.determineExitCode({ files: [{ issues: [{ severity: 'critical' }] }] })).toBe(1);
    expect(checker.determineExitCode({ files: [{ issues: [{ severity: 'medium' }] }] })).toBe(0);
  });

  it('does not treat DML inside a function definition as migration-time deletion', () => {
    const migration = `
      CREATE FUNCTION public.refresh_rows() RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        DELETE FROM public.runtime_rows;
      END;
      $$;
    `;
    expect(checker.stripDollarQuotedBodies(migration)).not.toContain('DELETE FROM');
    expect(new checker.MigrationChecker('20260101000000_function.sql', migration).run())
      .not.toContainEqual(expect.objectContaining({ type: 'destructive' }));
  });

  it('accepts a safety approval only for an exact file hash and exact issue set', () => {
    const content = 'CREATE INDEX idx_runtime_rows ON public.runtime_rows(id);\n';
    const change = { status: 'A', path: 'supabase/migrations/20260101000000_index.sql', content, oldContent: null };
    const raw = checker.analyzeChangeSet([change]);
    const issue = raw.files[0].issues[0];
    const hash = createRequire(import.meta.url)('node:crypto').createHash('sha256').update(content).digest('hex');
    const approvals = {
      '20260101000000_index.sql': {
        sha256: hash,
        status: 'A',
        rationale: 'verified fixture',
        evidence: 'test',
        approvedIssues: [issue],
      },
    };

    expect(checker.analyzeChangeSet([change], { approvals }).files).toHaveLength(0);
    expect(checker.analyzeChangeSet([{ ...change, content: `${content}-- changed\n` }], { approvals }).files)
      .toHaveLength(1);
  });

  it('accepts compact approvals only when every issue count matches exactly', () => {
    const content = [
      'CREATE INDEX idx_runtime_rows ON public.runtime_rows(id);',
      'CREATE INDEX idx_runtime_rows_slug ON public.runtime_rows(slug);',
      '',
    ].join('\n');
    const change = { status: 'A', path: 'supabase/migrations/20260101000000_indexes.sql', content, oldContent: null };
    const raw = checker.analyzeChangeSet([change]);
    const issueKey = 'high:lock-heavy:CREATE INDEX on an existing table must use CONCURRENTLY';
    const hash = createRequire(import.meta.url)('node:crypto').createHash('sha256').update(content).digest('hex');
    const approval = {
      sha256: hash,
      status: 'A',
      rationale: 'verified fixture',
      evidence: 'test',
      approvedIssueCounts: { [issueKey]: 2 },
    };

    expect(checker.analyzeChangeSet([change], { approvals: { '20260101000000_indexes.sql': approval } }).files)
      .toHaveLength(0);
    expect(checker.analyzeChangeSet([change], {
      approvals: { '20260101000000_indexes.sql': { ...approval, approvedIssueCounts: { [issueKey]: 1 } } },
    }).files).toHaveLength(1);
  });

  it('collects the complete merge range including A/M/D/R and blocks history rewrites', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'migration-safety-'));
    temporaryDirectories.push(cwd);
    mkdirSync(join(cwd, 'supabase', 'migrations'), { recursive: true });
    git(cwd, ['init', '-q']);
    git(cwd, ['config', 'user.email', 'test@example.com']);
    git(cwd, ['config', 'user.name', 'Migration Test']);
    const migrations = join(cwd, 'supabase', 'migrations');
    writeFileSync(join(migrations, '20260101000000_modify.sql'), 'SELECT 1;\n');
    writeFileSync(join(migrations, '20260101000001_delete.sql'), "SELECT 'delete-only';\n");
    writeFileSync(join(migrations, '20260101000002_rename.sql'), "SELECT 'rename-only';\n");
    git(cwd, ['add', 'supabase/migrations']);
    git(cwd, ['commit', '-qm', 'base']);
    const base = git(cwd, ['rev-parse', 'HEAD']);

    writeFileSync(join(migrations, '20260101000000_modify.sql'), 'SELECT 2;\n');
    rmSync(join(migrations, '20260101000001_delete.sql'));
    renameSync(
      join(migrations, '20260101000002_rename.sql'),
      join(migrations, '20260101000002_renamed.sql'),
    );
    writeFileSync(join(migrations, '20260101000003_add.sql'), "SELECT 'add-only';\n");
    git(cwd, ['add', '-A', 'supabase/migrations']);
    git(cwd, ['commit', '-qm', 'head']);
    const head = git(cwd, ['rev-parse', 'HEAD']);

    const changes = checker.collectMigrationChanges({ base, head, cwd });
    expect(new Set(changes.map((change) => change.status))).toEqual(new Set(['A', 'M', 'D', 'R']));
    const result = checker.analyzeChangeSet(changes);
    expect(checker.determineExitCode(result)).toBe(1);
    expect(result.files.flatMap((file) => file.issues.map((issue) => issue.severity)))
      .toContain('critical');
  }, 20_000);
});
