import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const buttonWithoutTypePattern = /<button\b(?![^>]*\btype=)[^>]*>/g;
const formPattern = /<form\b/;

const tsxFiles = execFileSync('git', ['ls-files', 'src/**/*.tsx'], {
  encoding: 'utf8',
})
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.includes('/attractions/'));

describe('non-form TSX action buttons', () => {
  it.each(tsxFiles.filter((file) => !formPattern.test(readFileSync(file, 'utf8'))))(
    '%s declares an explicit button type',
    (file) => {
      const source = readFileSync(file, 'utf8');

      expect(source.match(buttonWithoutTypePattern) ?? []).toEqual([]);
    },
  );
});
