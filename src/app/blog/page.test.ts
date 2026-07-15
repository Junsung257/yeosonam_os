import { describe, expect, it } from 'vitest';

import { generateMetadata } from './page';

describe('/blog metadata', () => {
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
