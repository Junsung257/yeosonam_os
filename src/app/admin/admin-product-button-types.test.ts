import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const productOperationScreens = [
  'src/app/admin/packages/PackagesPageClient.tsx',
  'src/app/admin/products/assemble-free-travel/page.tsx',
  'src/app/admin/products/review/page.tsx',
  'src/app/admin/content-queue/page.tsx',
];

describe('admin product operation buttons', () => {
  it.each(productOperationScreens)('%s uses explicit button types', (relativePath) => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const buttonsWithoutType = [...source.matchAll(/<button\b(?![^>]*\btype=)[^>]*>/g)];

    expect(buttonsWithoutType.map((match) => match[0])).toEqual([]);
  });
});
