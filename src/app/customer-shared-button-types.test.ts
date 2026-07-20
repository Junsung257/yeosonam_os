import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = [
  'src/components/BookingDrawer.tsx',
  'src/components/ConsentBanner.tsx',
  'src/components/JarvisFloatingWidget.tsx',
  'src/app/itinerary/[id]/page.tsx',
  'src/app/influencer/[code]/create-content/page.tsx',
  'src/app/influencer/[code]/products/page.tsx',
  'src/app/influencer/[code]/assets/page.tsx',
  'src/app/reels/[token]/ReelsShareClient.tsx',
  'src/app/share/rfq/[token]/RfqShareClient.tsx',
  'src/app/affiliate/card-news/[id]/page.tsx',
  'src/app/mypage/mileage/page.tsx',
  'src/app/passport-assist/page.tsx',
  'src/app/share/[code]/page.tsx',
] as const;

const buttonWithoutTypePattern = /<button\b(?![^>]*\btype=)[^>]*>/g;

describe('customer-facing shared action buttons', () => {
  it.each(files)('%s declares an explicit button type', (file) => {
    const source = readFileSync(file, 'utf8');

    expect(source.match(buttonWithoutTypePattern) ?? []).toEqual([]);
  });
});
