import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const customerSharedInteractionScreens = [
  'src/app/influencer/[code]/create-content/page.tsx',
  'src/app/influencer/[code]/products/page.tsx',
  'src/app/itinerary/[id]/page.tsx',
  'src/app/reels/[token]/ReelsShareClient.tsx',
  'src/app/share/rfq/[token]/RfqShareClient.tsx',
  'src/components/BookingDrawer.tsx',
  'src/components/ConsentBanner.tsx',
  'src/components/JarvisFloatingWidget.tsx',
];

describe('customer shared interaction button types', () => {
  it.each(customerSharedInteractionScreens)('%s uses explicit button types', (relativePath) => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const buttonsWithoutType = [...source.matchAll(/<button\b(?![^>]*\btype=)[^>]*>/g)];

    expect(buttonsWithoutType.map((match) => match[0])).toEqual([]);
  });
});
