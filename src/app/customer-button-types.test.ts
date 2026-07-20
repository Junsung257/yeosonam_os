import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const customerConversionScreens = [
  'src/app/free-travel/FreeTravelClient.tsx',
  'src/app/private-tour/PrivateTourLandingClient.tsx',
];

describe('customer conversion button types', () => {
  it.each(customerConversionScreens)('%s uses explicit button types', (relativePath) => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const buttonsWithoutType = [...source.matchAll(/<button\b(?![^>]*\btype=)[^>]*>/g)];

    expect(buttonsWithoutType.map((match) => match[0])).toEqual([]);
  });
});
