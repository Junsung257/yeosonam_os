import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateMetadata } from './page';

describe('/blog metadata', () => {
  it('uses the persisted rendered reading time on both list and detail', () => {
    const listSource = readFileSync(join(process.cwd(), 'src/app/blog/BlogData.tsx'), 'utf8');
    const detailSource = readFileSync(join(process.cwd(), 'src/app/blog/[slug]/page.tsx'), 'utf8');

    expect(listSource).toContain('readPersistedBlogReadingTime(post.quality_gate)');
    expect(detailSource).toContain('readPersistedBlogReadingTime(post.quality_gate)');
    expect(listSource).toContain('quality_gate');
    expect(detailSource).toContain('quality_gate');
  });

  it('keeps the unfiltered magazine indexable', async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) });

    expect(metadata.alternates?.canonical).toMatch(/\/blog$/);
    expect(metadata.robots).toBeUndefined();
  });

  it.each([
    { destination: '다낭' },
    { angle: 'food' },
    { page: '2' },
  ])('noindexes query-filter variants while retaining the /blog canonical', async (searchParams) => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve(searchParams) });

    expect(metadata.alternates?.canonical).toMatch(/\/blog$/);
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
  });
});
