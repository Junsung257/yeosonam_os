import { describe, expect, it } from 'vitest';

import { mergePackageRowsWithCurrentPublicSnapshots } from './snapshot-projection';

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
          },
        },
        card_projection: { title: 'current card title' },
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('current card title');
    expect(merged[0].destination).toBe('current dest');
    expect((merged[0] as Record<string, unknown>)._public_snapshot).toEqual({
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
        inclusions: ['raw inclusion'],
      }),
    ];
    const merged = mergePackageRowsWithCurrentPublicSnapshots(packages, [
      {
        package_id: 'pkg-1',
        package_revision: 3,
        status: 'published',
        created_at: '2026-07-09T00:00:00.000Z',
        snapshot_json: { package: { title: 'public title', price_dates: [{ date: '2026-07-12', price: 599000 }] } },
        card_projection: {},
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'pkg-1', title: 'public title' });
    expect(merged[0]).not.toHaveProperty('destination');
    expect(merged[0]).not.toHaveProperty('product_summary');
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
          },
        },
        card_projection: { title: 'public card title' },
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
          },
        },
        card_projection: {
          title: '연길·백두산 노옵션 핵심관광 4박5일',
          summary: '좌석 확보 완료',
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
          },
        },
        card_projection: { title: 'public card title' },
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
          },
        },
        card_projection: { title: 'public card title' },
      },
    ]);

    expect(merged).toEqual([]);
  });
});
