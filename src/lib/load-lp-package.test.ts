import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  packageRow: null as Record<string, unknown> | null,
  packageError: null as { message: string } | null,
  publicSnapshotRow: null as Record<string, unknown> | null,
  publicationPointerRow: null as Record<string, unknown> | null,
  scores: [] as Record<string, unknown>[],
  mappedInput: null as Record<string, unknown> | null,
  cacheKeys: [] as string[],
}));

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown, cacheKeys: string[]) => {
    mocks.cacheKeys = cacheKeys;
    return fn;
  },
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: {
    rpc(name: string) {
      if (name === 'resolve_product_registration_public_route') {
        return Promise.resolve({
          data: {
            catalog_product_id: 'catalog-product-test',
            package_id: 'pkg-1',
          },
          error: null,
        });
      }
      if (name === 'get_product_registration_availability_overlays') {
        return Promise.resolve({ data: [], error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table: string) {
      if (table === 'travel_packages') {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          async single() {
            return { data: mocks.packageRow, error: mocks.packageError };
          },
          async maybeSingle() {
            return { data: mocks.packageRow, error: mocks.packageError };
          },
        };
        return query;
      }

      if (table === 'product_registration_v5_publication_pointers') {
        const query = {
          select() { return query; },
          eq() { return query; },
          is() { return query; },
          async maybeSingle() { return { data: mocks.publicationPointerRow, error: null }; },
        };
        return query;
      }

      if (table === 'product_registration_v5_kill_switches') {
        const query = {
          select() { return query; },
          eq() { return query; },
          async or() { return { data: [], error: null }; },
        };
        return query;
      }

      if (table === 'package_scores') {
        const query = {
          get data() {
            return mocks.scores;
          },
          error: null,
          select() {
            return query;
          },
          eq() {
            return query;
          },
          order() {
            return query;
          },
        };
        return query;
      }

      if (table === 'product_registration_drafts') {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          not() {
            return query;
          },
          order() {
            return query;
          },
          limit() {
            return query;
          },
          async maybeSingle() {
            return { data: null, error: null };
          },
        };
        return query;
      }

      if (table === 'upload_jobs') {
        const query = {
          select() {
            return query;
          },
          in() {
            return query;
          },
          not() {
            return query;
          },
          order() {
            return query;
          },
          limit: async () => ({ data: [], error: null }),
        };
        return query;
      }

      if (table === 'public_package_snapshots') {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          in() {
            return query;
          },
          order() {
            return query;
          },
          limit() {
            return query;
          },
          async maybeSingle() {
            return {
              data: mocks.publicSnapshotRow ? {
                catalog_product_id: 'catalog-product-test',
                canonical_revision_id: 'rev-1',
                ...mocks.publicSnapshotRow,
              } : null,
              error: null,
            };
          },
        };
        return query;
      }

      throw new Error(`unexpected table ${table}`);
    },
  },
}));

vi.mock('@/lib/lp-hero-resolver', () => ({
  resolveLpHeroPhotoUrl: vi.fn(async () => null),
}));

vi.mock('@/lib/map-travel-package-to-lp', () => ({
  mapTravelPackageToLandingData: vi.fn((pkg: Record<string, unknown>) => {
    mocks.mappedInput = pkg;
    return { id: pkg.id, title: pkg.title, priceFrom: pkg.price };
  }),
}));

vi.mock('@/lib/upload-verify', () => ({
  evaluateVerifyChecks: vi.fn((pkg: Record<string, unknown>) => ({
    status: String(pkg.title ?? '').startsWith('Stale') ? 'blocked' : 'clean',
    checks: [],
    fixable: [],
    passCount: 0,
    warnCount: 0,
    failCount: String(pkg.title ?? '').startsWith('Stale') ? 1 : 0,
  })),
}));

import { fetchLpPackageUncached } from './load-lp-package';

describe('fetchLpPackageUncached', () => {
  beforeEach(() => {
    mocks.packageRow = {
      id: 'pkg-1',
      title: 'Raw visible package',
      status: 'active',
      publication_state: 'published',
      package_revision: 3,
      updated_at: '2026-07-10T00:00:00.000Z',
      audit_status: 'warnings',
      audit_report: {
        mobile_browser_proof: {
          status: 'pass',
          source: 'hwp-mobile-browser-proof',
          checked_at: '2026-07-10T00:05:00.000Z',
          package_updated_at: '2026-07-10T00:00:00.000Z',
          screen_hash: 'screen-hash',
          customer_visible_hash: 'visible-hash',
          surfaces: ['packages', 'lp'],
          surface_results: [
            {
              surface: 'packages',
              status: 'pass',
              screen_hash: 'packages-screen-hash',
              customer_visible_hash: 'packages-visible-hash',
              checks: [
                { name: 'packages_reservation_cta_visible', ok: true },
                { name: 'packages_reservation_sheet_opens', ok: true },
                { name: 'packages_reservation_sheet_has_product_context', ok: true },
              ],
            },
            {
              surface: 'lp',
              status: 'pass',
              screen_hash: 'lp-screen-hash',
              customer_visible_hash: 'lp-visible-hash',
              checks: [
                { name: 'lp_lead_cta_visible', ok: true },
                { name: 'lp_lead_sheet_opens', ok: true },
                { name: 'lp_lead_sheet_has_customer_copy', ok: true },
              ],
            },
          ],
        },
        customer_open_contract: {
          ok: true,
          status: 'pass',
          mobile_browser_proof: { ok: true },
        },
      },
      price: 100000,
    };
    mocks.publicSnapshotRow = {
      id: 'snap-1',
      package_id: 'pkg-1',
      package_revision: 3,
      canonical_revision_id: 'rev-1',
      snapshot_hash: 'snapshot-hash',
      snapshot_json: {
        images_public: [
          { url: 'https://cdn.yeosonam.com/public/pkg-1-hero.jpg', source: 'product_thumbnail' },
        ],
        package: {
          id: 'pkg-1',
          title: 'Raw visible package',
          status: 'active',
          hero_image_url: 'https://cdn.yeosonam.com/public/pkg-1-hero.jpg',
          price: 1230000,
          price_dates: [{ date: '2026-07-12', price: 1230000 }],
        },
      },
      card_projection: { title: 'Snapshot customer title' },
      lp_projection: { title: 'Snapshot customer title', summary: '고객용 요약' },
      route_text_dump: ['Snapshot customer title', '고객용 요약'],
      status: 'published',
      created_at: '2026-07-10T00:00:00.000Z',
    };
    mocks.publicationPointerRow = {
      tenant_id: '00000000-0000-0000-0000-000000000001',
      package_id: 'pkg-1',
      catalog_product_id: 'catalog-product-test',
      current_revision_id: 'rev-1',
      current_snapshot_id: 'snap-1',
      state: 'published',
    };
    mocks.packageError = null;
    mocks.scores = [];
    mocks.mappedInput = null;
  });

  it('uses the current-inventory cache contract', () => {
    expect(mocks.cacheKeys).toEqual(['lp-package-v4-current-inventory-source-notices']);
  });

  it('returns landing data only through the approved public snapshot', async () => {
    const result = await fetchLpPackageUncached('pkg-1');

    expect(result).toMatchObject({ id: 'pkg-1', title: 'Snapshot customer title' });
    expect(mocks.mappedInput).toMatchObject({
      id: 'pkg-1',
      title: 'Snapshot customer title',
      status: 'active',
      _public_snapshot: expect.objectContaining({ snapshot_hash: 'snapshot-hash' }),
    });
  });

  it('blocks otherwise-visible packages when publication_state is missing', async () => {
    mocks.packageRow = {
      id: 'pkg-1',
      title: 'Legacy approved package',
      status: 'approved',
      audit_status: 'warnings',
      audit_report: {
        customer_open_contract: {
          ok: true,
          status: 'pass',
          mobile_browser_proof: { ok: true },
        },
      },
      price: 100000,
    };
    mocks.publicSnapshotRow = null;

    const result = await fetchLpPackageUncached('pkg-1');

    expect(result).toBeNull();
    expect(mocks.mappedInput).toBeNull();
  });

  it('blocks packages that are not customer-visible', async () => {
    mocks.packageRow = {
      id: 'pkg-1',
      title: 'Pending package',
      status: 'pending',
      audit_status: 'blocked',
      price: 100000,
    };
    mocks.publicSnapshotRow = null;

    const result = await fetchLpPackageUncached('pkg-1');

    expect(result).toBeNull();
    expect(mocks.mappedInput).toBeNull();
  });

  it('rejects unsigned raw-row mobile proof rendering', async () => {
    mocks.packageRow = {
      id: 'pkg-1',
      title: 'Blocked proof package',
      status: 'pending',
      audit_status: 'blocked',
      price: 100000,
    };
    mocks.publicSnapshotRow = null;
    mocks.publicationPointerRow = null;

    const result = await fetchLpPackageUncached('pkg-1');

    expect(result).toBeNull();
    expect(mocks.mappedInput).toBeNull();
  });

  it('blocks stale active packages when the live source audit now fails', async () => {
    mocks.packageRow = {
      id: 'pkg-1',
      title: 'Stale active package',
      status: 'active',
      audit_status: 'clean',
      audit_report: {
        customer_open_contract: {
          ok: true,
          status: 'pass',
          mobile_browser_proof: { ok: true },
        },
      },
      duration: 5,
      raw_text: `
spot
7/2,9
999,-
1,159,-

PKG
premium villa golf package 3n5d
`,
      accommodations: ['villa'],
      price_dates: [
        { date: '2027-07-02', price: 999000 },
        { date: '2027-07-09', price: 999000 },
      ],
    };
    mocks.publicSnapshotRow = null;

    const result = await fetchLpPackageUncached('pkg-1');

    expect(result).toBeNull();
    expect(mocks.mappedInput).toBeNull();
  });

  it('renders from an approved public snapshot without re-running live raw-row verification', async () => {
    mocks.packageRow = {
      id: 'pkg-1',
      title: 'Stale active package',
      status: 'active',
      audit_status: 'clean',
      publication_state: 'published',
      package_revision: 3,
      audit_report: {
        customer_open_contract: {
          ok: true,
          status: 'pass',
          mobile_browser_proof: { ok: true },
        },
      },
      duration: 5,
      raw_text: `
spot
7/2,9
999,-
1,159,-

PKG
premium villa golf package 3n5d
`,
    };
    mocks.publicSnapshotRow = {
      id: 'snap-1',
      package_id: 'pkg-1',
      package_revision: 3,
      canonical_revision_id: 'rev-1',
      snapshot_hash: 'snapshot-hash',
      snapshot_json: {
        images_public: [
          { url: 'https://cdn.yeosonam.com/public/pkg-1-hero.jpg', source: 'product_thumbnail' },
        ],
        package: {
          id: 'pkg-1',
          title: 'Snapshot customer title',
          status: 'active',
          hero_image_url: 'https://cdn.yeosonam.com/public/pkg-1-hero.jpg',
          price: 1230000,
          price_dates: [{ date: '2026-07-12', price: 1230000 }],
        },
      },
      card_projection: { title: 'Snapshot customer title' },
      lp_projection: { title: 'Snapshot customer title', summary: '고객용 요약' },
      route_text_dump: ['Snapshot customer title'],
      status: 'published',
      created_at: '2026-07-10T00:00:00.000Z',
    };

    const result = await fetchLpPackageUncached('pkg-1');

    expect(result).toMatchObject({ id: 'pkg-1', title: 'Snapshot customer title' });
    expect(mocks.mappedInput).toMatchObject({
      id: 'pkg-1',
      title: 'Snapshot customer title',
      _lp_projection: {},
      _public_snapshot: expect.objectContaining({ snapshot_hash: 'snapshot-hash' }),
    });
  });

  it('does not render a public snapshot while the source package is still non-public', async () => {
    mocks.packageRow = {
      id: 'pkg-1',
      title: 'Staged package',
      status: 'draft',
      audit_status: 'warnings',
      publication_state: 'needs_review',
      package_revision: 3,
      audit_report: {
        customer_open_contract: {
          ok: true,
          status: 'pass',
          mobile_browser_proof: { ok: true },
        },
      },
      price: 100000,
    };
    mocks.publicSnapshotRow = {
      id: 'snap-1',
      package_id: 'pkg-1',
      package_revision: 3,
      snapshot_hash: 'snapshot-hash',
      snapshot_json: {
        package: {
          id: 'pkg-1',
          title: 'Snapshot customer title',
          status: 'active',
          price: 1230000,
        },
      },
      card_projection: { title: 'Snapshot customer title' },
      lp_projection: { title: 'Snapshot customer title', summary: '고객용 요약' },
      route_text_dump: ['Snapshot customer title'],
      status: 'published',
      created_at: '2026-07-10T00:00:00.000Z',
    };
    mocks.publicationPointerRow = null;

    const result = await fetchLpPackageUncached('pkg-1');

    expect(result).toBeNull();
    expect(mocks.mappedInput).toBeNull();
  });

  it('does not bypass the publication pointer for a legacy proof header', async () => {
    mocks.packageRow = {
      id: 'pkg-1',
      title: 'Stale proof package',
      status: 'active',
      audit_status: 'clean',
      audit_report: {
        customer_open_contract: {
          ok: true,
          status: 'pass',
          mobile_browser_proof: { ok: true },
        },
      },
      duration: 5,
      raw_text: `
spot
7/2,9
999,-
1,159,-

PKG
premium villa golf package 3n5d
`,
      accommodations: ['villa'],
      price_dates: [
        { date: '2027-07-02', price: 999000 },
        { date: '2027-07-09', price: 999000 },
      ],
    };
    mocks.publicSnapshotRow = null;
    mocks.publicationPointerRow = null;

    const result = await fetchLpPackageUncached('pkg-1');

    expect(result).toBeNull();
    expect(mocks.mappedInput).toBeNull();
  });
});
