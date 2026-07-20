import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const adminFormInteractionScreens = [
  'src/app/admin/customers/page.tsx',
  'src/app/admin/customers/[id]/page.tsx',
  'src/app/admin/flight-alerts/page.tsx',
];

describe('admin form interaction button types', () => {
  it.each(adminFormInteractionScreens)('%s uses explicit button types', (relativePath) => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const buttonsWithoutType = [...source.matchAll(/<button\b(?![^>]*\btype=)[^>]*>/g)];

    expect(buttonsWithoutType.map((match) => match[0])).toEqual([]);
  });
});
