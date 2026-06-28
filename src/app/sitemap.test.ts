import { describe, expect, it, vi } from 'vitest';

const queriedTables: string[] = [];

function queryResult(table: string) {
  const dataByTable: Record<string, unknown[]> = {
    active_destinations: [
      { destination: '오사카', package_count: 2 },
      { destination: '석가장', package_count: 0 },
    ],
    content_creatives: [
      {
        slug: 'osaka-weather',
        destination: '오사카',
        angle_type: 'value',
        published_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-02T00:00:00.000Z',
      },
    ],
  };

  const chain = {
    select: vi.fn(() => chain),
    in: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    abortSignal: vi.fn(() => Promise.resolve({ data: dataByTable[table] ?? [], error: null })),
  };

  return chain;
}

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  isSupabaseAdminConfigured: true,
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      queriedTables.push(table);
      return queryResult(table);
    }),
  },
}));

vi.mock('@/lib/cron-resource-saver', () => ({
  shouldSkipPublicDbReadsForResourceSaver: () => false,
}));

describe('sitemap', () => {
  it('keeps noindex package detail pages out of sitemap', async () => {
    queriedTables.length = 0;
    const { default: sitemap } = await import('./sitemap');

    const routes = await sitemap();
    const urls = routes.map((route) => route.url);
    const expectedBaseUrl = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.yeosonam.com')
      .replace(/\/+$/, '');

    expect(urls).toContain(`${expectedBaseUrl}/packages`);
    expect(urls).toContain(`${expectedBaseUrl}/destinations/${encodeURIComponent('오사카')}`);
    expect(urls).not.toContain(`${expectedBaseUrl}/destinations/${encodeURIComponent('석가장')}`);
    expect(urls).toContain(`${expectedBaseUrl}/blog/osaka-weather`);
    expect(urls.some((url) => /\/packages\/[^/]+$/.test(url))).toBe(false);
    expect(queriedTables).not.toContain('travel_packages');
  });
});
