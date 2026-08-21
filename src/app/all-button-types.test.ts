import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function trackedTsxFiles(): string[] {
  return execFileSync('git', ['ls-files', 'src/**/*.tsx'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((relativePath) => !relativePath.includes('/attractions/'));
}

describe('tracked TSX button types', () => {
  it('uses explicit types for every non-attractions button', () => {
    const offenders = trackedTsxFiles().flatMap((relativePath) => {
      const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
      return [...source.matchAll(/<button\b(?![^>]*\btype=)[^>]*>/g)].map((match) => ({
        relativePath,
        button: match[0],
      }));
    });

    expect(offenders).toEqual([]);
  }, 30_000);
});
