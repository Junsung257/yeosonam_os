import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const adminCoreOperationScreens = [
  'src/app/admin/AdminPageClient.tsx',
  'src/app/admin/content-hub/page.tsx',
  'src/app/admin/control-tower/page.tsx',
  'src/app/admin/ledger/page.tsx',
  'src/app/admin/packages/[id]/review/page.tsx',
  'src/app/admin/search-ads/page.tsx',
];

describe('admin core operation button types', () => {
  it.each(adminCoreOperationScreens)('%s uses explicit button types', (relativePath) => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const buttonsWithoutType = [...source.matchAll(/<button\b(?![^>]*\btype=)[^>]*>/g)];

    expect(buttonsWithoutType.map((match) => match[0])).toEqual([]);
  });
});
