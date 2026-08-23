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
    public_blog_content_creatives: [
      {
        slug: 'osaka-weather',
        destination: 'osaka',
        angle_type: 'value',
        published_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-02T00:00:00.000Z',
      },
      {
        slug: 'travel-emergency-medicine-summer-checklist',
        destination: null,
        angle_type: 'value',
        published_at: '2026-06-13T00:00:00.000Z',
        updated_at: '2026-08-13T00:00:00.000Z',
      },
    ],
    public_package_snapshots: [
      {
        id: 'snapshot-osaka',
        package_id: 'pkg-osaka',
        catalog_product_id: 'catalog-osaka',
        canonical_revision_id: 'revision-osaka',
        package_revision: 3,
        status: 'published',
        created_at: '2026-06-03T00:00:00.000Z',
        card_projection: { id: 'pkg-osaka', title: 'Osaka public title', destination: 'osaka' },
        lp_projection: { id: 'pkg-osaka', title: 'Osaka public title', destination: 'osaka' },
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
      {
        id: 'snapshot-hoian-danang',
        package_id: 'pkg-hoian-danang',
        catalog_product_id: 'catalog-hoian-danang',
        canonical_revision_id: 'revision-hoian-danang',
        package_revision: 2,
        status: 'published',
        created_at: '2026-06-04T00:00:00.000Z',
        card_projection: { id: 'pkg-hoian-danang', title: 'Hoi An Da Nang public title', destination: '호이안-다낭' },
        lp_projection: { id: 'pkg-hoian-danang', title: 'Hoi An Da Nang public title', destination: '호이안-다낭' },
        snapshot_json: {
          images_public: [],
          package: {
            id: 'pkg-hoian-danang',
            title: 'Hoi An Da Nang public title',
            display_title: 'Hoi An Da Nang public title',
            destination: '호이안-다낭',
            publication_state: 'published',
            package_revision: 2,
            price_dates: [{ date: '2026-07-13', price: 699000 }],
          },
          canonical_view: {},
        },
      },
    ],
    product_registration_v5_publication_pointers: [
      {
        package_id: 'pkg-osaka',
        catalog_product_id: 'catalog-osaka',
        current_revision_id: 'revision-osaka',
        current_snapshot_id: 'snapshot-osaka',
        state: 'published',
      },
      {
        package_id: 'pkg-hoian-danang',
        catalog_product_id: 'catalog-hoian-danang',
        current_revision_id: 'revision-hoian-danang',
        current_snapshot_id: 'snapshot-hoian-danang',
        state: 'published',
      },
    ],
  };

  const chain = {
    select: vi.fn(() => chain),
    in: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    or: vi.fn(() => chain),
    not: vi.fn(() => chain),
    order: vi.fn(() => (
      table === 'public_package_snapshots'
        ? Promise.resolve({ data: dataByTable[table] ?? [], error: null })
        : chain
    )),
    limit: vi.fn(() => chain),
    abortSignal: vi.fn(() => Promise.resolve({ data: dataByTable[table] ?? [], error: null })),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: dataByTable[table] ?? [], error: null }).then(resolve),
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
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
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
    expect(urls).toContain(`${expectedBaseUrl}/destinations/%EB%8B%A4%EB%82%AD`);
    expect(urls).not.toContain(`${expectedBaseUrl}/destinations/%ED%98%B8%EC%9D%B4%EC%95%88-%EB%8B%A4%EB%82%AD`);
    expect(urls).not.toContain(`${expectedBaseUrl}/destinations/hidden`);
    expect(urls).toContain(`${expectedBaseUrl}/blog/osaka-weather`);
    expect(urls).not.toContain(`${expectedBaseUrl}/blog/travel-emergency-medicine-summer-checklist`);
    expect(urls.some((url) => /\/packages\/[^/]+$/.test(url))).toBe(false);
    expect(queriedTables).not.toContain('travel_packages');
    expect(queriedTables).toContain('product_registration_v5_publication_pointers');
    expect(queriedTables).toContain('public_package_snapshots');
    expect(queriedTables).toContain('public_blog_content_creatives');
  }, 30_000);
});
