import { describe, expect, it } from 'vitest';

import { mergePackageRowsWithCurrentPublicSnapshots } from './snapshot-projection';

describe('public snapshot card projection', () => {
  it('drops customer packages when only stale snapshots exist', () => {
    const packages = [
      { id: 'pkg-1', package_revision: 3, title: 'raw title' },
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
      { id: 'pkg-1', package_revision: 3, title: 'raw supplier title', destination: 'raw dest' },
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
      { id: 'pkg-1', package_revision: 3, title: 'raw supplier title', destination: 'raw dest' },
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
      {
        id: 'pkg-1',
        package_revision: 3,
        title: 'raw supplier title',
        destination: 'raw destination',
        product_summary: 'raw supplier summary',
        inclusions: ['raw inclusion'],
      },
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

  it('drops current snapshots without source-backed price dates instead of exposing projection price', () => {
    const packages = [
      { id: 'pkg-1', package_revision: 3, title: 'raw supplier title', price: 599000 },
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
      { id: 'pkg-1', package_revision: 3, title: 'raw supplier title' },
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
});
