import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const marketingOperationScreens = [
  'src/app/admin/marketing/auto-publish/page.tsx',
  'src/app/admin/marketing/brand-kits/page.tsx',
  'src/app/admin/marketing/card-news/CardNewsListPageClient.tsx',
  'src/app/admin/marketing/card-news/[id]/page.tsx',
  'src/app/admin/marketing/card-news/campaign/new/page.tsx',
  'src/app/admin/marketing/card-news/new-html/page.tsx',
  'src/app/admin/marketing/card-news/new/page.tsx',
  'src/app/admin/marketing/card-news/variants/[group_id]/page.tsx',
  'src/app/admin/marketing/card-news/variants/new/page.tsx',
  'src/app/admin/marketing/content-hub/[cardNewsId]/page.tsx',
  'src/app/admin/marketing/creatives/page.tsx',
  'src/app/admin/marketing/published/page.tsx',
  'src/app/admin/marketing/social-configs/page.tsx',
  'src/components/admin/CardNewsEditor.tsx',
  'src/components/admin/CardNewsStudio.tsx',
];

describe('admin marketing operation button types', () => {
  it.each(marketingOperationScreens)('%s uses explicit button types', (relativePath) => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const buttonsWithoutType = [...source.matchAll(/<button\b(?![^>]*\btype=)[^>]*>/g)];

    expect(buttonsWithoutType.map((match) => match[0])).toEqual([]);
  });
});
