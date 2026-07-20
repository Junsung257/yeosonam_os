import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const buttonWithoutTypePattern = /<button\b(?![^>]*\btype=)[^>]*>/g;

const tsxFiles = execFileSync('git', ['ls-files', 'src/**/*.tsx'], {
  encoding: 'utf8',
})
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.includes('/attractions/'));

describe('tsx action buttons', () => {
  it.each(tsxFiles)('%s declares an explicit button type', (file) => {
    const source = readFileSync(file, 'utf8');

    expect(source.match(buttonWithoutTypePattern) ?? []).toEqual([]);
  });
});
