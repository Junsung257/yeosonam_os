import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createPublicPackageSnapshotAndDecision, fetchLatestPublicPackageSnapshot } from './repository';

type RpcResult = {
  rpcError?: Error | null;
  activeAttractionIds?: string[];
  attractionLookupError?: Error | null;
};

function makeSupabaseMock(result: RpcResult = {}) {
  const calls: Array<{ name: string; payload?: Record<string, unknown> }> = [];
  const supabase = {
    rpc(name: string, payload: Record<string, unknown>) {
      calls.push({ name, payload });
      return Promise.resolve({ data: { ok: true }, error: result.rpcError ?? null });
    },
    from(table: string) {
      if (table !== 'attractions') throw new Error(`unexpected table ${table}`);
      const requestedIds = new Set<string>();
      const chain = {
        select: () => chain,
        in(_column: string, values: string[]) {
          values.forEach(value => requestedIds.add(value));
          return chain;
        },
        eq() {
          const activeIds = new Set(result.activeAttractionIds ?? []);
          return Promise.resolve({
            data: [...requestedIds]
              .filter(id => activeIds.has(id))
              .map(id => ({ id })),
            error: result.attractionLookupError ?? null,
          });
        },
      };
      return chain;
    },
  };

  return { supabase, calls };
}

function makeSnapshotFetchSupabaseMock(row: Record<string, unknown> | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return {
    from: () => chain,
  };
}

function publishablePackage(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    package_revision: 3,
    title: 'Tokyo 3 nights',
    destination: 'Tokyo',
    duration: 4,
    nights: 3,
    price: 1_099_000,
    product_prices: [
      { target_date: '2026-08-07', adult_selling_price: 1_099_000, note: 'save fare' },
    ],
    price_dates: [
      { date: '2026-08-07', price: 1_099_000, confirmed: false },
    ],
    inclusions: ['Round-trip airfare and TAX'],
    excludes: ['Guide fee 40,000 KRW'],
    optional_tours: [],
    itinerary_data: { days: [{ day: 1, schedule: [{ activity: 'Odaiba sightseeing' }] }] },
    ...overrides,
  };
}

describe('createPublicPackageSnapshotAndDecision', () => {
  it('does not return a latest public snapshot when customer title evidence is missing', async () => {
    const snapshot = await fetchLatestPublicPackageSnapshot(
      makeSnapshotFetchSupabaseMock({
        id: 'snap-1',
        package_id: 'pkg-1',
        package_revision: 3,
        snapshot_hash: 'hash-1',
        snapshot_json: { package: { title: 'Raw supplier title', destination: 'Tokyo' } },
        card_projection: { destination: 'Tokyo' },
        lp_projection: { summary: 'Tokyo trip' },
        route_text_dump: ['Tokyo trip'],
        status: 'published',
        created_at: '2026-07-13T00:00:00.000Z',
      }) as never,
      'pkg-1',
      { expectedPackageRevision: 3 },
    );

    expect(snapshot).toBeNull();
  });

  it('normalizes legacy snapshot packages to projection-approved customer copy', async () => {
    const snapshot = await fetchLatestPublicPackageSnapshot(
      makeSnapshotFetchSupabaseMock({
        id: 'snap-2',
        package_id: 'pkg-2',
        package_revision: 3,
        snapshot_hash: 'hash-2',
        snapshot_json: {
          package: {
            id: 'pkg-2',
            price_dates: [{ date: '2026-07-12', price: 599000 }],
            title: '[BX] 랜드사 원문 제목',
            display_title: '[BX] 랜드사 원문 제목',
            product_summary: '관리자노트: 랜드사 커미션 9% 내부 확인',
            destination: '연길',
          },
        },
        card_projection: { title: '연길·백두산 노옵션 핵심관광 4박5일', destination: '연길' },
        lp_projection: {
          title: '연길·백두산 노옵션 핵심관광 4박5일',
          summary: '일정, 항공, 숙소, 포함 조건을 상담 전 빠르게 확인할 수 있어요.',
        },
        route_text_dump: ['연길·백두산 노옵션 핵심관광 4박5일'],
        status: 'published',
        created_at: '2026-07-13T00:00:00.000Z',
      }) as never,
      'pkg-2',
      { expectedPackageRevision: 3 },
    );

    expect(snapshot?.package.title).toBe('연길·백두산 노옵션 핵심관광 4박5일');
    expect(snapshot?.package.display_title).toBe('연길·백두산 노옵션 핵심관광 4박5일');
    expect(snapshot?.package.product_summary).toBe('일정, 항공, 숙소, 포함 조건을 상담 전 빠르게 확인할 수 있어요.');
    expect(JSON.stringify(snapshot?.package)).not.toContain('랜드사 커미션');
  });

  it('does not return legacy public snapshots that only contain a raw package price', async () => {
    const snapshot = await fetchLatestPublicPackageSnapshot(
      makeSnapshotFetchSupabaseMock({
        id: 'snap-raw-price',
        package_id: 'pkg-raw-price',
        package_revision: 3,
        snapshot_hash: 'hash-raw-price',
        snapshot_json: {
          package: {
            id: 'pkg-raw-price',
            title: '연길·백두산 노옵션 핵심관광 4박5일',
            display_title: '연길·백두산 노옵션 핵심관광 4박5일',
            destination: '연길',
            price: 599000,
            price_dates: [],
          },
        },
        card_projection: { title: '연길·백두산 노옵션 핵심관광 4박5일', price: 599000 },
        lp_projection: { title: '연길·백두산 노옵션 핵심관광 4박5일', price: 599000 },
        route_text_dump: ['연길·백두산 노옵션 핵심관광 4박5일'],
        status: 'published',
        created_at: '2026-07-13T00:00:00.000Z',
      }) as never,
      'pkg-raw-price',
      { expectedPackageRevision: 3 },
    );

    expect(snapshot).toBeNull();
  });

  it('publishes snapshot, decision, and package final state through one atomic RPC', async () => {
    const { supabase, calls } = makeSupabaseMock();

    const result = await createPublicPackageSnapshotAndDecision(
      supabase as never,
      publishablePackage(),
      { customerOpenContractOk: true },
      {
        packagePatch: {
          status: 'active',
          audit_status: 'clean',
          audit_report: { customer_open_contract: { ok: true } },
        },
      },
    );

    expect(result.publishable).toBe(true);
    expect(result.publicationState).toBe('published');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('publish_package_snapshot_atomic');
    expect(calls[0].payload).toMatchObject({
      p_package_id: '11111111-1111-4111-8111-111111111111',
      p_package_revision: 3,
      p_publication_state: 'published',
      p_publishable: true,
      p_snapshot_status: 'published',
      p_decision_source: 'publish_gate_v1',
      p_package_patch: expect.objectContaining({
        status: 'active',
        publication_state: 'published',
        package_revision: 3,
        audit_status: 'clean',
      }),
    });
  });

  it('blocks publication when itinerary attraction ids do not exist in active attractions', async () => {
    const missingAttractionId = '22222222-2222-4222-8222-222222222222';
    const { supabase, calls } = makeSupabaseMock({ activeAttractionIds: [] });

    const result = await createPublicPackageSnapshotAndDecision(
      supabase as never,
      publishablePackage({
        itinerary_data: {
          days: [
            { day: 1, schedule: [{ activity: 'Odaiba sightseeing', attraction_ids: [missingAttractionId] }] },
          ],
        },
      }),
      { customerOpenContractOk: true },
    );

    expect(result.publishable).toBe(false);
    expect(result.publicationState).toBe('blocked');
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'broken_attraction_id',
        message: expect.stringContaining(missingAttractionId),
      }),
    ]));
    expect(calls[0].payload).toMatchObject({
      p_snapshot_status: 'blocked',
      p_publication_state: 'blocked',
      p_publishable: false,
    });
  });

  it('fails closed when active attraction lookup fails before publication', async () => {
    const attractionId = '33333333-3333-4333-8333-333333333333';
    const { supabase, calls } = makeSupabaseMock({
      attractionLookupError: new Error('attractions unavailable'),
    });

    const result = await createPublicPackageSnapshotAndDecision(
      supabase as never,
      publishablePackage({
        itinerary_data: {
          days: [
            { day: 1, schedule: [{ activity: 'Odaiba sightseeing', attraction_ids: [attractionId] }] },
          ],
        },
      }),
      { customerOpenContractOk: true },
    );

    expect(result.publishable).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'audit_query_failed' }),
      expect.objectContaining({ code: 'broken_attraction_id' }),
    ]));
    expect(calls[0].payload).toMatchObject({
      p_snapshot_status: 'blocked',
      p_publication_state: 'blocked',
      p_publishable: false,
    });
  });

  it('throws when the atomic publication RPC fails', async () => {
    const { supabase, calls } = makeSupabaseMock({
      rpcError: new Error('atomic publish failed'),
    });

    await expect(createPublicPackageSnapshotAndDecision(
      supabase as never,
      publishablePackage(),
    )).rejects.toThrow('atomic publish failed');

    expect(calls.map(call => call.name)).toEqual(['publish_package_snapshot_atomic']);
  });

  it('ships an RPC migration that atomically writes snapshot, decision, and package state', () => {
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260710153000_atomic_package_publication_rpc.sql'),
      'utf8',
    );
    const body = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.publish_package_snapshot_atomic'),
      sql.indexOf('REVOKE ALL ON FUNCTION public.publish_package_snapshot_atomic'),
    );

    expect(sql).toContain('LANGUAGE plpgsql');
    expect(sql).toContain('SECURITY INVOKER');
    expect(body).toContain('INSERT INTO public.public_package_snapshots');
    expect(body).toContain('INSERT INTO public.package_publish_decisions');
    expect(body).toContain('UPDATE public.travel_packages AS tp');
    expect(body).toContain('GET DIAGNOSTICS v_updated_count = ROW_COUNT');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.publish_package_snapshot_atomic');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.publish_package_snapshot_atomic');
    expect(sql).toContain('TO service_role');
    expect(sql).not.toContain('SECURITY DEFINER');
  });
});
