import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  packageRow: null as Record<string, unknown> | null,
  packageError: null as { message: string } | null,
  publicSnapshotRow: null as Record<string, unknown> | null,
  scores: [] as Record<string, unknown>[],
  mappedInput: null as Record<string, unknown> | null,
  mappedHero: null as string | null,
}));

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: {
    from(table: string) {
      if (table === 'travel_packages') {
        return {
          select() {
            return {
              eq() {
                return {
                  async single() {
                    return { data: mocks.packageRow, error: mocks.packageError };
                  },
                };
              },
            };
          },
        };
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
            return { data: mocks.publicSnapshotRow, error: null };
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
  mapTravelPackageToLandingData: vi.fn((pkg: Record<string, unknown>, hero: string | null) => {
    mocks.mappedInput = pkg;
    mocks.mappedHero = hero;
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
    mocks.packageError = null;
    mocks.scores = [];
    mocks.mappedInput = null;
    mocks.mappedHero = null;
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

  it('allows blocked packages only for internal mobile proof rendering', async () => {
    mocks.packageRow = {
      id: 'pkg-1',
      title: '[랜드사 원문] 도쿄 특가',
      display_title: 'SPECIAL PRICE',
      destination: '도쿄',
      duration: 4,
      nights: 3,
      trip_style: '3박 4일',
      status: 'pending',
      audit_status: 'blocked',
      price: 1_000_000,
      price_dates: [{ date: '2026-08-07', price: 1_000_000 }],
      products: {
        display_name: '도쿄 패키지',
        thumbnail_urls: ['https://cdn.yeosonam.com/public/pkg-1-hero.jpg'],
      },
      itinerary_data: {
        days: [
          { day: 1, schedule: [{ activity: '도쿄 도착 후 숙소 이동', type: 'transfer' }] },
          { day: 2, schedule: [{ activity: '도쿄 핵심 관광', type: 'sightseeing' }] },
          { day: 3, schedule: [{ activity: '자유 일정', type: 'sightseeing' }] },
          { day: 4, schedule: [{ activity: '귀국', type: 'flight' }] },
        ],
      },
    };

    const result = await fetchLpPackageUncached('pkg-1', { allowNonPublicProof: true });

    expect(result).toMatchObject({ id: 'pkg-1' });
    expect(mocks.mappedInput).toMatchObject({
      id: 'pkg-1',
      title: expect.not.stringContaining('랜드사 원문'),
      _public_snapshot: expect.objectContaining({ status: 'proof' }),
    });
    expect(mocks.mappedInput?.title).not.toBe('SPECIAL PRICE');
    expect(mocks.mappedInput).not.toHaveProperty('audit_status');
    expect(mocks.mappedHero).toBe('https://cdn.yeosonam.com/public/pkg-1-hero.jpg');
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

    const result = await fetchLpPackageUncached('pkg-1');

    expect(result).toBeNull();
    expect(mocks.mappedInput).toBeNull();
  });

  it('allows live-audit-blocked packages only for internal mobile proof rendering', async () => {
    mocks.packageRow = {
      id: 'pkg-1',
      title: '[랜드사 원문] 도쿄 특가',
      display_title: 'SPECIAL PRICE',
      destination: '도쿄',
      status: 'active',
      audit_status: 'clean',
      audit_report: {
        customer_open_contract: {
          ok: true,
          status: 'pass',
          mobile_browser_proof: { ok: true },
        },
      },
      duration: 4,
      nights: 3,
      trip_style: '3박 4일',
      raw_text: `
spot
7/2,9
999,-
1,159,-

PKG
premium villa golf package 3n5d
`,
      accommodations: ['villa'],
      products: {
        display_name: '도쿄 패키지',
        thumbnail_urls: ['https://cdn.yeosonam.com/public/pkg-1-hero.jpg'],
      },
      price_dates: [
        { date: '2027-07-02', price: 999000 },
        { date: '2027-07-09', price: 999000 },
      ],
      itinerary_data: {
        days: [
          { day: 1, schedule: [{ activity: '도쿄 도착 후 숙소 이동', type: 'transfer' }] },
          { day: 2, schedule: [{ activity: '도쿄 핵심 관광', type: 'sightseeing' }] },
          { day: 3, schedule: [{ activity: '자유 일정', type: 'sightseeing' }] },
          { day: 4, schedule: [{ activity: '귀국', type: 'flight' }] },
        ],
      },
    };

    const result = await fetchLpPackageUncached('pkg-1', { allowNonPublicProof: true });

    expect(result).toMatchObject({ id: 'pkg-1' });
    expect(mocks.mappedInput).toMatchObject({
      id: 'pkg-1',
      title: expect.not.stringContaining('랜드사 원문'),
      _public_snapshot: expect.objectContaining({ status: 'proof' }),
    });
    expect(mocks.mappedInput?.title).not.toBe('SPECIAL PRICE');
  });
});
