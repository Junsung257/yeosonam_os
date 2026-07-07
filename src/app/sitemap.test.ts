import { describe, expect, it, vi } from 'vitest';
import { resolveBlogCanonicalOrigin } from '@/lib/blog-canonical-url';

const queriedTables: string[] = [];

function queryResult(table: string) {
  const dataByTable: Record<string, unknown[]> = {
    travel_packages: [
      {
        destination: 'osaka',
        status: 'approved',
        audit_status: 'warnings',
        audit_report: {
          customer_open_contract: {
            ok: true,
            status: 'pass',
            mobile_browser_proof: { ok: true },
          },
        },
      },
      {
        destination: 'hidden',
        status: 'pending',
        audit_status: 'blocked',
        audit_report: {
          customer_open_contract: {
            ok: false,
            status: 'blocked',
            blockers: ['not public'],
            mobile_browser_proof: { ok: false },
          },
        },
      },
    ],
    content_creatives: [
      {
        slug: 'osaka-weather',
        destination: 'osaka',
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
    const expectedBaseUrl = resolveBlogCanonicalOrigin();

    expect(urls).toContain(`${expectedBaseUrl}/packages`);
    expect(urls).toContain(`${expectedBaseUrl}/destinations/osaka`);
    expect(urls).not.toContain(`${expectedBaseUrl}/destinations/hidden`);
    expect(urls).toContain(`${expectedBaseUrl}/blog/osaka-weather`);
    expect(urls.some((url) => /\/packages\/[^/]+$/.test(url))).toBe(false);
    expect(queriedTables).toContain('travel_packages');
  });
});
