import { describe, expect, it, vi } from 'vitest';
import { resolveBlogCanonicalOrigin } from '@/lib/blog-canonical-url';

const queriedTables: string[] = [];

function queryResult(table: string) {
  const dataByTable: Record<string, unknown[]> = {
    travel_packages: [
      {
        id: 'pkg-osaka',
        destination: 'osaka',
        status: 'approved',
        publication_state: 'published',
        package_revision: 3,
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
        id: 'pkg-hidden',
        destination: 'hidden',
        status: 'pending',
        publication_state: 'needs_review',
        package_revision: 1,
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
    published_public_package_cards_v1: [
      {
        package_id: 'pkg-osaka',
        published_snapshot_id: 'snapshot-osaka',
        package_revision: 3,
        snapshot_hash: 'snapshot-hash-osaka',
        snapshot_schema_version: 'public_package_snapshot_v1',
        publish_gate_version: 'publish_gate_v1',
        source_evidence_digest: 'evidence-osaka',
        snapshot_created_at: '2026-06-03T00:00:00.000Z',
        published_at: '2026-06-03T00:00:00.000Z',
        card_projection: { id: 'pkg-osaka', title: 'Osaka public title', destination: 'osaka' },
        route_text_projection: [],
        snapshot_json: {
          images_public: [
            { url: 'https://cdn.yeosonam.com/public/osaka-hero.jpg', source: 'destination_metadata' },
          ],
          package: {
            id: 'pkg-osaka',
            title: 'Osaka public title',
            display_title: 'Osaka public title',
            destination: 'osaka',
            hero_image_url: 'https://cdn.yeosonam.com/public/osaka-hero.jpg',
            publication_state: 'published',
            package_revision: 3,
            price_dates: [{ date: '2026-07-12', price: 599000 }],
          },
          canonical_view: {},
        },
      },
    ],
  };

  const chain = {
    select: vi.fn(() => chain),
    in: vi.fn(() => (
      table === 'published_public_package_cards_v1'
        ? Promise.resolve({ data: dataByTable[table] ?? [], error: null })
        : chain
    )),
    eq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    order: vi.fn(() => (
      chain
    )),
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
    expect(queriedTables).toContain('published_public_package_cards_v1');
    expect(queriedTables).not.toContain('public_package_snapshots');
  });
});
