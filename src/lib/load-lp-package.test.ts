import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  packageRow: null as Record<string, unknown> | null,
  packageError: null as { message: string } | null,
  scores: [] as Record<string, unknown>[],
  mappedInput: null as Record<string, unknown> | null,
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

import { fetchLpPackageUncached } from './load-lp-package';

describe('fetchLpPackageUncached', () => {
  beforeEach(() => {
    mocks.packageRow = {
      id: 'pkg-1',
      title: 'Visible package',
      status: 'approved',
      audit_status: 'warnings',
      price: 100000,
    };
    mocks.packageError = null;
    mocks.scores = [];
    mocks.mappedInput = null;
  });

  it('returns landing data for customer-visible packages', async () => {
    const result = await fetchLpPackageUncached('pkg-1');

    expect(result).toMatchObject({ id: 'pkg-1', title: 'Visible package' });
    expect(mocks.mappedInput).toMatchObject({ id: 'pkg-1', status: 'approved' });
  });

  it('blocks packages that are not customer-visible', async () => {
    mocks.packageRow = {
      id: 'pkg-1',
      title: 'Pending package',
      status: 'pending',
      audit_status: 'blocked',
      price: 100000,
    };

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

    const result = await fetchLpPackageUncached('pkg-1');

    expect(result).toBeNull();
    expect(mocks.mappedInput).toBeNull();
  });
});
