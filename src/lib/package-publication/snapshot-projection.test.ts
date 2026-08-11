import { describe, expect, it } from 'vitest';

import {
  fetchAndMergeCurrentPublicPackageCardSnapshots,
  mergePackageRowsWithCurrentPublicSnapshots,
} from './snapshot-projection';

type FetchMockOptions = {
  activeAttractionIds?: string[];
  nonCustomerPublishableAttractionIds?: string[];
  attractionNames?: Record<string, string>;
  attractionLookupError?: Error | null;
};

function openPackage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const updatedAt = '2026-07-09T00:00:00.000Z';
  return {
    id: 'pkg-1',
    package_revision: 3,
    status: 'active',
    publication_state: 'published',
    updated_at: updatedAt,
    optional_tours: [],
    itinerary_data: { days: [{ day: 1, schedule: [{ activity: 'public schedule', attraction_ids: [] }] }] },
    audit_report: {
      customer_open_contract: { ok: true, status: 'pass', blockers: [] },
      mobile_browser_proof: {
        status: 'pass',
        checked_at: updatedAt,
        package_updated_at: updatedAt,
        source: 'hwp-mobile-browser-proof',
        screen_hash: 'screen',
        customer_visible_hash: 'visible',
        surfaces: ['packages', 'lp'],
        surface_results: [
          {
            surface: 'packages',
            status: 'pass',
            screen_hash: 'packages-screen',
            customer_visible_hash: 'packages-visible',
            checks: [
              { name: 'packages_reservation_cta_visible', ok: true },
              { name: 'packages_reservation_sheet_opens', ok: true },
              { name: 'packages_reservation_sheet_has_product_context', ok: true },
            ],
          },
          {
            surface: 'lp',
            status: 'pass',
            screen_hash: 'lp-screen',
            customer_visible_hash: 'lp-visible',
            checks: [
              { name: 'lp_lead_cta_visible', ok: true },
              { name: 'lp_lead_sheet_opens', ok: true },
              { name: 'lp_lead_sheet_has_customer_copy', ok: true },
            ],
          },
        ],
      },
    },
    ...overrides,
  };
}

function makeFetchSupabaseMock(snapshotRows: Record<string, unknown>[], options: FetchMockOptions = {}) {
  return {
    from(table: string) {
      if (table === 'product_registration_v5_publication_pointers') {
        const response = { data: [], error: null };
        const pointerChain: any = {
          select: () => pointerChain,
          in: () => pointerChain,
          eq: () => pointerChain,
          then: (resolve: (value: typeof response) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(response).then(resolve, reject),
        };
        return pointerChain;
      }
      if (table === 'product_registration_v5_kill_switches') {
        const response = { data: [], error: null };
        const switchChain: any = {
          select: () => switchChain,
          eq: () => switchChain,
          or: () => Promise.resolve(response),
        };
        return switchChain;
      }
      if (table === 'public_package_snapshots') {
        const snapshotChain = {
          select: () => snapshotChain,
          in: () => snapshotChain,
          order: () => Promise.resolve({ data: snapshotRows, error: null }),
        };
        return snapshotChain;
      }
      if (table === 'product_registration_drafts') {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          not: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
        return chain;
      }
      if (table === 'upload_jobs') {
        const response = { data: [], error: null };
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          not: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (resolve: (value: typeof response) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(response).then(resolve, reject),
        };
        return chain;
      }
      if (table === 'product_registration_v4_normalizations') {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
        return chain;
      }
      if (table !== 'attractions') throw new Error(`unexpected table ${table}`);
      const requestedIds = new Set<string>();
      const attractionChain = {
        select: () => attractionChain,
        in(_column: string, values: string[]) {
          values.forEach(value => requestedIds.add(value));
          return attractionChain;
        },
        eq() {
          const activeIds = new Set(options.activeAttractionIds ?? []);
          const nonCustomerPublishableIds = new Set(options.nonCustomerPublishableAttractionIds ?? []);
          return Promise.resolve({
            data: [...requestedIds]
              .filter(id => activeIds.has(id))
              .map(id => ({
                id,
                name: options.attractionNames?.[id] ?? 'Safe public attraction',
                category: 'sightseeing',
                badge_type: 'tour',
                is_active: true,
                customer_publishable: !nonCustomerPublishableIds.has(id),
              })),
            error: options.attractionLookupError ?? null,
          });
        },
      };
      return attractionChain;
    },
  };
}

describe('public snapshot card projection', () => {
  it('drops customer packages when only stale snapshots exist', () => {
    const packages = [
      openPackage({ title: 'raw title' }),
    ];
    const merged = mergePackageRowsWithCurrentPublicSnapshots(packages, [
      {
        package_id: 'pkg-1',
        package_revision: 2,
        status: 'published',
        created_at: '2026-07-09T00:00:00.000Z',
        snapshot_json: { package: { title: 'old public title' } },
        card_projection: { title: 'old card title' },
      },
    ]);

    expect(merged).toEqual([]);
  });

  it('uses the current revision snapshot projection instead of raw card text', () => {
    const packages = [
      openPackage({ title: 'raw supplier title', destination: 'raw dest' }),
    ];
    const merged = mergePackageRowsWithCurrentPublicSnapshots(packages, [
      {
        package_id: 'pkg-1',
        package_revision: 2,
        status: 'published',
        created_at: '2026-07-08T00:00:00.000Z',
        snapshot_json: { package: { title: 'old public title' } },
        card_projection: { title: 'old card title' },
      },
      {
        package_id: 'pkg-1',
        package_revision: 3,
        status: 'published',
        created_at: '2026-07-09T00:00:00.000Z',
        snapshot_json: {
          package: {
            title: 'current public title',
            destination: 'current dest',
            price_dates: [{ date: '2026-07-12', price: 599000 }],
            hero_image_url: 'https://cdn.yeosonam.com/public-current.jpg',
          },
        },
        card_projection: { title: 'current card title', hero_image_url: 'https://cdn.yeosonam.com/public-current.jpg' },
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('current card title');
    expect(merged[0].destination).toBe('current dest');
    expect((merged[0] as Record<string, unknown>)._public_snapshot).toEqual({
      id: null,
      snapshot_hash: null,
      status: 'published',
      created_at: '2026-07-09T00:00:00.000Z',
      package_revision: 3,
    });
  });

  it('drops rows when the current snapshot has no public title instead of falling back to raw title', () => {
    const packages = [
      openPackage({ title: 'raw supplier title', destination: 'raw dest' }),
    ];
    const merged = mergePackageRowsWithCurrentPublicSnapshots(packages, [
      {
        package_id: 'pkg-1',
        package_revision: 3,
        status: 'published',
        created_at: '2026-07-09T00:00:00.000Z',
        snapshot_json: { package: { destination: 'public dest' } },
        card_projection: { destination: 'public dest' },
      },
    ]);

    expect(merged).toEqual([]);
  });

  it('does not preserve raw customer fields when the snapshot omits them', () => {
    const packages = [
      openPackage({
        title: 'raw supplier title',
        destination: 'raw destination',
        product_summary: 'raw supplier summary',
        marketing_copies: [{ title: 'raw promo title', body: 'raw promo body' }],
        inclusions: ['raw inclusion'],
      }),
    ];
    const merged = mergePackageRowsWithCurrentPublicSnapshots(packages, [
      {
        package_id: 'pkg-1',
        package_revision: 3,
        status: 'published',
        created_at: '2026-07-09T00:00:00.000Z',
        snapshot_json: { package: { title: 'public title', price_dates: [{ date: '2026-07-12', price: 599000 }], hero_image_url: 'https://cdn.yeosonam.com/public.jpg' } },
        card_projection: {},
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'pkg-1', title: 'public title' });
    expect(merged[0]).not.toHaveProperty('destination');
    expect(merged[0]).not.toHaveProperty('product_summary');
    expect(merged[0]).not.toHaveProperty('marketing_copies');
    expect(merged[0]).not.toHaveProperty('inclusions');
  });

  it('strips internal root and nested fields after merging a public snapshot', () => {
    const packages = [
      openPackage({
        title: 'raw supplier title',
        internal_code: 'LAND-SECRET',
        catalog_id: 'catalog-secret',
        audit_status: 'clean',
        seats_held: 12,
        seats_confirmed: 6,
        products: [
          {
            display_name: '공개 상품명',
            internal_code: 'PRODUCT-SECRET',
            net_price: 510000,
            cost_price: 500000,
            margin_rate: 0.12,
          },
        ],
      }),
    ];
    const merged = mergePackageRowsWithCurrentPublicSnapshots(packages, [
      {
        package_id: 'pkg-1',
        package_revision: 3,
        status: 'published',
        created_at: '2026-07-09T00:00:00.000Z',
        snapshot_json: {
          package: {
            title: 'public title',
            products: [
              {
                display_name: '공개 상품명',
                internal_code: 'SNAPSHOT-PRODUCT-SECRET',
                net_price: 510000,
              },
            ],
            price_dates: [{ date: '2026-07-12', price: 599000 }],
            hero_image_url: 'https://cdn.yeosonam.com/public.jpg',
          },
        },
        card_projection: { title: 'public card title', hero_image_url: 'https://cdn.yeosonam.com/public.jpg' },
      },
    ]) as Array<Record<string, unknown>>;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'pkg-1', title: 'public card title' });
    expect(merged[0]).not.toHaveProperty('internal_code');
    expect(merged[0]).not.toHaveProperty('catalog_id');
    expect(merged[0]).not.toHaveProperty('audit_status');
    expect(merged[0]).not.toHaveProperty('audit_report');
    expect(merged[0]).not.toHaveProperty('seats_held');
    expect(merged[0]).not.toHaveProperty('seats_confirmed');
    expect(merged[0].products).toEqual([{ display_name: '공개 상품명' }]);
  });

  it('drops current snapshots without source-backed price dates instead of exposing projection price', () => {
    const packages = [
      openPackage({ title: 'raw supplier title', price: 599000 }),
    ];
    const merged = mergePackageRowsWithCurrentPublicSnapshots(packages, [
      {
        package_id: 'pkg-1',
        package_revision: 3,
        status: 'published',
        created_at: '2026-07-09T00:00:00.000Z',
        snapshot_json: {
          package: {
            title: '연길·백두산 노옵션 핵심관광 4박5일',
            price: 599000,
            price_dates: [],
          },
        },
        card_projection: { title: '연길·백두산 노옵션 핵심관광 4박5일', price: 599000 },
      },
    ]);

    expect(merged).toEqual([]);
  });

  it('drops current snapshots without a public image candidate', () => {
    const packages = [
      openPackage({ title: 'raw supplier title' }),
    ];
    const merged = mergePackageRowsWithCurrentPublicSnapshots(packages, [
      {
        package_id: 'pkg-1',
        package_revision: 3,
        status: 'published',
        created_at: '2026-07-09T00:00:00.000Z',
        snapshot_json: {
          package: {
            title: '연길·백두산 노옵션 핵심관광 4박5일',
            price_dates: [{ date: '2026-07-12', price: 599000 }],
          },
          images_public: [],
        },
        card_projection: { title: '연길·백두산 노옵션 핵심관광 4박5일' },
      },
    ]);

    expect(merged).toEqual([]);
  });

  it('drops current snapshots with risky customer promise copy in projections', () => {
    const packages = [
      openPackage({ title: 'raw supplier title' }),
    ];
    const merged = mergePackageRowsWithCurrentPublicSnapshots(packages, [
      {
        package_id: 'pkg-1',
        package_revision: 3,
        status: 'published',
        created_at: '2026-07-09T00:00:00.000Z',
        snapshot_json: {
          package: {
            title: '연길·백두산 노옵션 핵심관광 4박5일',
            price_dates: [{ date: '2026-07-12', price: 599000 }],
            hero_image_url: 'https://cdn.yeosonam.com/public.jpg',
          },
        },
        card_projection: {
          title: '연길·백두산 노옵션 핵심관광 4박5일',
          summary: '좌석 확보 완료',
          hero_image_url: 'https://cdn.yeosonam.com/public.jpg',
        },
        route_text_dump: ['연길·백두산 노옵션 핵심관광 4박5일', '좌석 확보 완료'],
      },
    ]);

    expect(merged).toEqual([]);
  });

  it('fails closed before snapshot merge when the source package is not customer-openable', () => {
    const blockedPackage = openPackage({
      audit_report: {
        customer_open_contract: {
          ok: false,
          status: 'blocked',
          blockers: ['mobile proof missing'],
        },
      },
    });

    const merged = mergePackageRowsWithCurrentPublicSnapshots([blockedPackage], [
      {
        package_id: 'pkg-1',
        package_revision: 3,
        status: 'published',
        created_at: '2026-07-09T00:00:00.000Z',
        snapshot_json: {
          package: {
            title: 'public title',
            price_dates: [{ date: '2026-07-12', price: 599000 }],
            hero_image_url: 'https://cdn.yeosonam.com/public.jpg',
          },
        },
        card_projection: { title: 'public card title', hero_image_url: 'https://cdn.yeosonam.com/public.jpg' },
      },
    ]);

    expect(merged).toEqual([]);
  });

  it('fails closed before snapshot merge when publication_state is not public', () => {
    const nonPublicPackage = openPackage({ publication_state: 'needs_review' });

    const merged = mergePackageRowsWithCurrentPublicSnapshots([nonPublicPackage], [
      {
        package_id: 'pkg-1',
        package_revision: 3,
        status: 'published',
        created_at: '2026-07-09T00:00:00.000Z',
        snapshot_json: {
          package: {
            title: 'public title',
            price_dates: [{ date: '2026-07-12', price: 599000 }],
            hero_image_url: 'https://cdn.yeosonam.com/public.jpg',
          },
        },
        card_projection: { title: 'public card title', hero_image_url: 'https://cdn.yeosonam.com/public.jpg' },
      },
    ]);

    expect(merged).toEqual([]);
  });

  it('drops fetched card snapshots with non-customer-publishable attraction ids', async () => {
    const nonPublicAttractionId = '44444444-4444-4444-8444-444444444444';
    const packages = [
      openPackage({ title: 'raw supplier title' }),
    ];

    const merged = await fetchAndMergeCurrentPublicPackageCardSnapshots(
      makeFetchSupabaseMock([
        {
          package_id: 'pkg-1',
          package_revision: 3,
          status: 'published',
          created_at: '2026-07-09T00:00:00.000Z',
          snapshot_json: {
            package: {
              title: 'Yanji Baekdusan no-option core tour 4 nights 5 days',
              destination: 'Yanji',
              price_dates: [{ date: '2026-07-12', price: 599000 }],
              hero_image_url: 'https://cdn.yeosonam.com/public.jpg',
              itinerary_data: {
                days: [
                  {
                    day: 1,
                    schedule: [
                      { activity: 'Legacy non-public attraction', attraction_ids: [nonPublicAttractionId] },
                    ],
                  },
                ],
              },
            },
          },
          card_projection: { title: 'Yanji Baekdusan no-option core tour 4 nights 5 days', hero_image_url: 'https://cdn.yeosonam.com/public.jpg' },
        },
      ], {
        activeAttractionIds: [nonPublicAttractionId],
        nonCustomerPublishableAttractionIds: [nonPublicAttractionId],
      }) as never,
      packages,
    );

    expect(merged).toEqual([]);
  });

  it('fails closed for fetched card snapshots with attraction ids when approval lookup fails', async () => {
    const attractionId = '55555555-5555-4555-8555-555555555555';
    const packages = [
      openPackage({ title: 'raw supplier title' }),
    ];

    const merged = await fetchAndMergeCurrentPublicPackageCardSnapshots(
      makeFetchSupabaseMock([
        {
          package_id: 'pkg-1',
          package_revision: 3,
          status: 'published',
          created_at: '2026-07-09T00:00:00.000Z',
          snapshot_json: {
            package: {
              title: 'Yanji Baekdusan no-option core tour 4 nights 5 days',
              destination: 'Yanji',
              price_dates: [{ date: '2026-07-12', price: 599000 }],
              hero_image_url: 'https://cdn.yeosonam.com/public.jpg',
              itinerary_data: {
                days: [
                  { day: 1, schedule: [{ activity: 'Attraction lookup error', attraction_ids: [attractionId] }] },
                ],
              },
            },
          },
          card_projection: { title: 'Yanji Baekdusan no-option core tour 4 nights 5 days', hero_image_url: 'https://cdn.yeosonam.com/public.jpg' },
        },
      ], {
        attractionLookupError: new Error('attractions unavailable'),
      }) as never,
      packages,
    );

    expect(merged).toEqual([]);
  });

  it('drops fetched card snapshots with product-like customer-publishable attraction names', async () => {
    const productLikeAttractionId = '66666666-6666-4666-8666-666666666666';
    const packages = [
      openPackage({ title: 'raw supplier title' }),
    ];

    const merged = await fetchAndMergeCurrentPublicPackageCardSnapshots(
      makeFetchSupabaseMock([
        {
          package_id: 'pkg-1',
          package_revision: 3,
          status: 'published',
          created_at: '2026-07-09T00:00:00.000Z',
          snapshot_json: {
            package: {
              title: 'Yanji Baekdusan no-option core tour 4 nights 5 days',
              destination: 'Yanji',
              price_dates: [{ date: '2026-07-12', price: 599000 }],
              hero_image_url: 'https://cdn.yeosonam.com/public.jpg',
              itinerary_data: {
                days: [
                  { day: 1, schedule: [{ activity: 'Product-like attraction', attraction_ids: [productLikeAttractionId] }] },
                ],
              },
            },
          },
          card_projection: { title: 'Yanji Baekdusan no-option core tour 4 nights 5 days', hero_image_url: 'https://cdn.yeosonam.com/public.jpg' },
        },
      ], {
        activeAttractionIds: [productLikeAttractionId],
        attractionNames: {
          [productLikeAttractionId]: 'Tokyo eSIM unlimited data product',
        },
      }) as never,
      packages,
    );

    expect(merged).toEqual([]);
  });
});
