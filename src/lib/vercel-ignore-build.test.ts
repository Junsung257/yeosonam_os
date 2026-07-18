import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateVercelIgnoreBuild,
  parseGitNameStatusZ,
} from '../../scripts/vercel-ignore-build.mjs';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createRepository() {
  const cwd = mkdtempSync(join(tmpdir(), 'vercel-ignore-'));
  temporaryDirectories.push(cwd);
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Vercel Test']);
  writeFileSync(join(cwd, 'README.md'), '# base\n');
  git(cwd, ['add', 'README.md']);
  git(cwd, ['commit', '-qm', 'base']);
  const base = git(cwd, ['rev-parse', 'HEAD']);

  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'app.ts'), 'export const app = true;\n');
  git(cwd, ['add', 'src/app.ts']);
  git(cwd, ['commit', '-qm', 'code']);
  const code = git(cwd, ['rev-parse', 'HEAD']);

  mkdirSync(join(cwd, 'docs'), { recursive: true });
  writeFileSync(join(cwd, 'docs', 'note.md'), '# docs only\n');
  git(cwd, ['add', 'docs/note.md']);
  git(cwd, ['commit', '-qm', 'docs']);
  const head = git(cwd, ['rev-parse', 'HEAD']);
  return { cwd, base, code, head };
}

describe('Vercel ignored build range', () => {
  it('builds when an earlier commit in the deployment range changed code', () => {
    const repo = createRepository();
    expect(evaluateVercelIgnoreBuild({
      cwd: repo.cwd,
      env: { NODE_ENV: 'test', VERCEL_GIT_COMMIT_SHA: repo.head, VERCEL_GIT_PREVIOUS_SHA: repo.base },
      logger: () => undefined,
    })).toBe(1);
  }, 20_000);

  it('skips when the complete range contains documentation only', () => {
    const repo = createRepository();
    expect(evaluateVercelIgnoreBuild({
      cwd: repo.cwd,
      env: { NODE_ENV: 'test', VERCEL_GIT_COMMIT_SHA: repo.head, VERCEL_GIT_PREVIOUS_SHA: repo.code },
      logger: () => undefined,
    })).toBe(0);
  }, 20_000);

  it('fails closed when the base commit is absent from shallow history', () => {
    const repo = createRepository();
    expect(evaluateVercelIgnoreBuild({
      cwd: repo.cwd,
      env: { NODE_ENV: 'test', VERCEL_GIT_COMMIT_SHA: repo.head, VERCEL_GIT_PREVIOUS_SHA: 'f'.repeat(40) },
      logger: () => undefined,
    })).toBe(1);
  }, 20_000);

  it('builds for deleted or renamed source paths', () => {
    const repo = createRepository();
    renameSync(join(repo.cwd, 'src', 'app.ts'), join(repo.cwd, 'docs', 'app.md'));
    git(repo.cwd, ['add', '-A']);
    git(repo.cwd, ['commit', '-qm', 'rename source into docs']);
    const head = git(repo.cwd, ['rev-parse', 'HEAD']);
    expect(evaluateVercelIgnoreBuild({
      cwd: repo.cwd,
      env: { NODE_ENV: 'test', VERCEL_GIT_COMMIT_SHA: head, VERCEL_GIT_PREVIOUS_SHA: repo.head },
      logger: () => undefined,
    })).toBe(1);
  }, 20_000);

  it('parses both sides of rename records and deletion records', () => {
    expect(parseGitNameStatusZ([
      'D', 'src/deleted.ts',
      'R100', 'src/old.ts', 'docs/new.md',
      '',
    ].join('\0'))).toEqual(['src/deleted.ts', 'src/old.ts', 'docs/new.md']);
  });
});
