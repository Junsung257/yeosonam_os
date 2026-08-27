import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createPublicPackageSnapshotAndDecision, fetchLatestPublicPackageSnapshot } from './repository';
import { buildPublicPackageSnapshot } from './public-snapshot';

type RpcResult = {
  rpcError?: Error | null;
  activeAttractionIds?: string[];
  nonCustomerPublishableAttractionIds?: string[];
  attractionNames?: Record<string, string>;
  attractionLookupError?: Error | null;
  v4Job?: Record<string, unknown> | null;
  v4Normalization?: Record<string, unknown> | null;
};

function makeSupabaseMock(result: RpcResult = {}) {
  const calls: Array<{ name: string; payload?: Record<string, unknown> }> = [];
  const supabase = {
    rpc(name: string, payload: Record<string, unknown>) {
      calls.push({ name, payload });
      return Promise.resolve({ data: { ok: true }, error: result.rpcError ?? null });
    },
    from(table: string) {
      if (table === 'product_registration_drafts') {
        const draft = result.v4Job?.id ? { upload_job_id: result.v4Job.id } : null;
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          not: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: draft, error: null }),
        };
        return chain;
      }
      if (table === 'upload_jobs') {
        const response = { data: result.v4Job ? [result.v4Job] : [], error: null };
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          not: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: result.v4Job ?? null, error: null }),
          then: (resolve: (value: typeof response) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(response).then(resolve, reject),
        };
        return chain;
      }
      if (table === 'product_registration_v4_normalizations') {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: result.v4Normalization ?? null, error: null }),
        };
        return chain;
      }
      if (table === 'product_registration_v5_kill_switches') {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          or: () => Promise.resolve({ data: [], error: null }),
        };
        return chain;
      }
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
          const nonCustomerPublishableIds = new Set(result.nonCustomerPublishableAttractionIds ?? []);
          return Promise.resolve({
            data: [...requestedIds]
              .filter(id => activeIds.has(id))
              .map(id => ({
                id,
                name: result.attractionNames?.[id] ?? 'Safe public attraction',
                category: 'sightseeing',
                badge_type: 'tour',
                is_active: true,
                customer_publishable: !nonCustomerPublishableIds.has(id),
              })),
            error: result.attractionLookupError ?? null,
          });
        },
      };
      return chain;
    },
  };

  return { supabase, calls };
}

function makeSnapshotFetchSupabaseMock(row: Record<string, unknown> | null, result: RpcResult = {}) {
  const effectiveRow: Record<string, unknown> | null = row ? {
    catalog_product_id: row.catalog_product_id ?? 'catalog-product-test',
    canonical_revision_id: row.canonical_revision_id ?? 'canonical-revision-test',
    ...row,
  } : null;
  const snapshotJson = effectiveRow?.snapshot_json
    && typeof effectiveRow.snapshot_json === 'object'
    && !Array.isArray(effectiveRow.snapshot_json)
    ? effectiveRow.snapshot_json as Record<string, unknown>
    : {};
  const snapshotChain = {
    select: () => snapshotChain,
    eq: () => snapshotChain,
    in: () => snapshotChain,
    order: () => snapshotChain,
    limit: () => snapshotChain,
    maybeSingle: () => Promise.resolve({ data: effectiveRow, error: null }),
  };
  return {
    rpc(name: string) {
      if (name === 'get_product_registration_customer_route_state') {
        return Promise.resolve({
          data: effectiveRow ? {
            state: 'PUBLIC',
            catalog_product_id: effectiveRow.catalog_product_id,
            package_id: effectiveRow.package_id,
            revision_id: effectiveRow.canonical_revision_id,
            snapshot_id: effectiveRow.id,
            pointer_version: 1,
          } : { state: 'NOT_FOUND' },
          error: null,
        });
      }
      if (name === 'get_product_registration_availability_overlays') {
        return Promise.resolve({ data: [], error: null });
      }
      if (name === 'resolve_product_registration_public_route') {
        return Promise.resolve({
          data: effectiveRow ? {
            tenant_id: 'tenant-1',
            catalog_product_id: effectiveRow.catalog_product_id,
            package_id: effectiveRow.package_id,
          } : null,
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table: string) {
      if (table === 'public_catalog_view') {
        const publicCatalogRow = effectiveRow ? {
          id: effectiveRow.package_id,
          catalog_product_id: effectiveRow.catalog_product_id,
          revision_id: effectiveRow.canonical_revision_id,
          snapshot_id: effectiveRow.id,
          snapshot_hash: effectiveRow.snapshot_hash,
          pointer_version: 1,
          booking_mode: 'inquiry',
          last_verified_at: effectiveRow.created_at,
          public_detail: {
            ...snapshotJson,
            package_revision: effectiveRow.package_revision,
            card_projection: effectiveRow.card_projection,
            lp_projection: effectiveRow.lp_projection,
            route_text_dump: effectiveRow.route_text_dump,
            renderer_build_id: effectiveRow.renderer_build_id,
          },
        } : null;
        const query = {
          select() { return query; },
          eq() { return query; },
          async maybeSingle() { return { data: publicCatalogRow, error: null }; },
        };
        return query;
      }
      if (table === 'travel_packages') {
        const identityChain: any = {
          select: () => identityChain,
          eq: () => identityChain,
          maybeSingle: () => Promise.resolve({ data: effectiveRow ? { id: effectiveRow.package_id } : null, error: null }),
        };
        return identityChain;
      }
      if (table === 'product_registration_v5_publication_pointers') {
        const pointerChain: any = {
          select: () => pointerChain,
          eq: () => pointerChain,
          is: () => pointerChain,
          maybeSingle: () => Promise.resolve({
            data: effectiveRow ? {
              tenant_id: null,
              package_id: effectiveRow.package_id,
              catalog_product_id: effectiveRow.catalog_product_id,
              current_revision_id: effectiveRow.canonical_revision_id,
              current_snapshot_id: effectiveRow.id,
              state: 'published',
            } : null,
            error: null,
          }),
        };
        return pointerChain;
      }
      if (table === 'public_package_snapshots') return snapshotChain;
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
      if (table === 'product_registration_v5_kill_switches') {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          or: () => Promise.resolve({ data: [], error: null }),
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
          const activeIds = new Set(result.activeAttractionIds ?? []);
          const nonCustomerPublishableIds = new Set(result.nonCustomerPublishableAttractionIds ?? []);
          return Promise.resolve({
            data: [...requestedIds]
              .filter(id => activeIds.has(id))
              .map(id => ({
                id,
                name: result.attractionNames?.[id] ?? 'Safe public attraction',
                category: 'sightseeing',
                badge_type: 'tour',
                is_active: true,
                customer_publishable: !nonCustomerPublishableIds.has(id),
              })),
            error: result.attractionLookupError ?? null,
          });
        },
      };
      return attractionChain;
    },
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
    products: {
      display_name: 'Tokyo package',
      thumbnail_urls: ['https://cdn.yeosonam.com/packages/tokyo.jpg'],
    },
    inclusions: ['Round-trip airfare and TAX'],
    excludes: ['Guide fee 40,000 KRW'],
    optional_tours: [],
    itinerary_data: { days: [{ day: 1, schedule: [{ activity: 'Odaiba sightseeing' }] }] },
    ...overrides,
  };
}

function mobileProofForSnapshot(snapshotHash: string) {
  return {
    ok: true,
    reason: 'actual /packages and /lp mobile browser proof passed',
    proof: {
      status: 'pass',
      checked_at: '2026-07-07T00:00:00.000Z',
      package_updated_at: '2026-07-07T00:00:00.000Z',
      package_revision: 3,
      public_snapshot_hash: snapshotHash,
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
          public_snapshot_hash: snapshotHash,
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
          public_snapshot_hash: snapshotHash,
          checks: [
            { name: 'lp_lead_cta_visible', ok: true },
            { name: 'lp_lead_sheet_opens', ok: true },
            { name: 'lp_lead_sheet_has_customer_copy', ok: true },
          ],
        },
      ],
    },
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
      { tenantId: 'tenant-1', expectedPackageRevision: 3 },
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
            hero_image_url: 'https://cdn.yeosonam.com/packages/yanji.jpg',
          },
          images_public: [
            { url: 'https://cdn.yeosonam.com/packages/yanji.jpg', source: 'package_hero', alt: '연길' },
          ],
        },
        card_projection: {
          title: '연길·백두산 노옵션 핵심관광 4박5일',
          destination: '연길',
          hero_image_url: 'https://cdn.yeosonam.com/packages/yanji.jpg',
        },
        lp_projection: {
          title: '연길·백두산 노옵션 핵심관광 4박5일',
          summary: '일정, 항공, 숙소, 포함 조건을 상담 전 빠르게 확인할 수 있어요.',
        },
        route_text_dump: ['연길·백두산 노옵션 핵심관광 4박5일'],
        status: 'published',
        created_at: '2026-07-13T00:00:00.000Z',
      }) as never,
      'pkg-2',
      { tenantId: 'tenant-1', expectedPackageRevision: 3 },
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
      { tenantId: 'tenant-1', expectedPackageRevision: 3 },
    );

    expect(snapshot).toBeNull();
  });

  it('does not return legacy public snapshots with risky customer promise copy', async () => {
    const snapshot = await fetchLatestPublicPackageSnapshot(
      makeSnapshotFetchSupabaseMock({
        id: 'snap-risky-copy',
        package_id: 'pkg-risky-copy',
        package_revision: 3,
        snapshot_hash: 'hash-risky-copy',
        snapshot_json: {
          package: {
            id: 'pkg-risky-copy',
            title: '연길·백두산 노옵션 핵심관광 4박5일',
            display_title: '연길·백두산 노옵션 핵심관광 4박5일',
            destination: '연길',
            price_dates: [{ date: '2026-07-12', price: 599000 }],
          },
        },
        card_projection: { title: '연길·백두산 노옵션 핵심관광 4박5일' },
        lp_projection: {
          title: '연길·백두산 노옵션 핵심관광 4박5일',
          summary: '예약 즉시 항공·숙박 확보',
        },
        route_text_dump: ['연길·백두산 노옵션 핵심관광 4박5일', '예약 즉시 항공·숙박 확보'],
        status: 'published',
        created_at: '2026-07-13T00:00:00.000Z',
      }) as never,
      'pkg-risky-copy',
      { tenantId: 'tenant-1', expectedPackageRevision: 3 },
    );

    expect(snapshot).toBeNull();
  });

  it('does not re-evaluate a proved immutable snapshot against mutable attraction state', async () => {
    const nonPublicAttractionId = '44444444-4444-4444-8444-444444444444';
    const snapshot = await fetchLatestPublicPackageSnapshot(
      makeSnapshotFetchSupabaseMock({
        id: 'snap-non-public-attraction',
        package_id: 'pkg-non-public-attraction',
        package_revision: 3,
        snapshot_hash: 'hash-non-public-attraction',
        snapshot_json: {
          package: {
            id: 'pkg-non-public-attraction',
            title: 'Yanji Baekdusan no-option core tour 4 nights 5 days',
            destination: 'Yanji',
            price_dates: [{ date: '2026-07-12', price: 599000 }],
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
        card_projection: { title: 'Yanji Baekdusan no-option core tour 4 nights 5 days' },
        lp_projection: {
          title: 'Yanji Baekdusan no-option core tour 4 nights 5 days',
          summary: 'Check schedule, airline, hotel, and included conditions before consultation.',
        },
        route_text_dump: ['Yanji Baekdusan no-option core tour 4 nights 5 days'],
        status: 'published',
        created_at: '2026-07-13T00:00:00.000Z',
      }, {
        activeAttractionIds: [nonPublicAttractionId],
        nonCustomerPublishableAttractionIds: [nonPublicAttractionId],
      }) as never,
      'pkg-non-public-attraction',
      { tenantId: 'tenant-1', expectedPackageRevision: 3 },
    );

    expect(snapshot?.row.id).toBe('snap-non-public-attraction');
  });

  it('does not make customer reads depend on attraction lookup availability', async () => {
    const attractionId = '55555555-5555-4555-8555-555555555555';
    const snapshot = await fetchLatestPublicPackageSnapshot(
      makeSnapshotFetchSupabaseMock({
        id: 'snap-attraction-lookup-error',
        package_id: 'pkg-attraction-lookup-error',
        package_revision: 3,
        snapshot_hash: 'hash-attraction-lookup-error',
        snapshot_json: {
          package: {
            id: 'pkg-attraction-lookup-error',
            title: 'Yanji Baekdusan no-option core tour 4 nights 5 days',
            destination: 'Yanji',
            price_dates: [{ date: '2026-07-12', price: 599000 }],
            itinerary_data: {
              days: [
                { day: 1, schedule: [{ activity: 'Attraction lookup error', attraction_ids: [attractionId] }] },
              ],
            },
          },
        },
        card_projection: { title: 'Yanji Baekdusan no-option core tour 4 nights 5 days' },
        lp_projection: { title: 'Yanji Baekdusan no-option core tour 4 nights 5 days' },
        route_text_dump: ['Yanji Baekdusan no-option core tour 4 nights 5 days'],
        status: 'published',
        created_at: '2026-07-13T00:00:00.000Z',
      }, {
        attractionLookupError: new Error('attractions unavailable'),
      }) as never,
      'pkg-attraction-lookup-error',
      { tenantId: 'tenant-1', expectedPackageRevision: 3 },
    );

    expect(snapshot?.row.id).toBe('snap-attraction-lookup-error');
  });

  it('does not reinterpret snapshot attraction names from mutable master data', async () => {
    const productLikeAttractionId = '66666666-6666-4666-8666-666666666666';
    const snapshot = await fetchLatestPublicPackageSnapshot(
      makeSnapshotFetchSupabaseMock({
        id: 'snap-product-like-attraction',
        package_id: 'pkg-product-like-attraction',
        package_revision: 3,
        snapshot_hash: 'hash-product-like-attraction',
        snapshot_json: {
          package: {
            id: 'pkg-product-like-attraction',
            title: 'Yanji Baekdusan no-option core tour 4 nights 5 days',
            destination: 'Yanji',
            price_dates: [{ date: '2026-07-12', price: 599000 }],
            itinerary_data: {
              days: [
                { day: 1, schedule: [{ activity: 'Product-like attraction', attraction_ids: [productLikeAttractionId] }] },
              ],
            },
          },
        },
        card_projection: { title: 'Yanji Baekdusan no-option core tour 4 nights 5 days' },
        lp_projection: { title: 'Yanji Baekdusan no-option core tour 4 nights 5 days' },
        route_text_dump: ['Yanji Baekdusan no-option core tour 4 nights 5 days'],
        status: 'published',
        created_at: '2026-07-13T00:00:00.000Z',
      }, {
        activeAttractionIds: [productLikeAttractionId],
        attractionNames: {
          [productLikeAttractionId]: 'Tokyo eSIM unlimited data product',
        },
      }) as never,
      'pkg-product-like-attraction',
      { tenantId: 'tenant-1', expectedPackageRevision: 3 },
    );

    expect(snapshot?.row.id).toBe('snap-product-like-attraction');
  });

  it('retires the mutable package publication writer without making an RPC call', async () => {
    const { supabase, calls } = makeSupabaseMock();
    await expect(createPublicPackageSnapshotAndDecision(
      supabase as never,
      publishablePackage(),
    )).rejects.toThrow('LEGACY_PUBLICATION_WRITER_RETIRED_USE_REGISTRATION_KERNEL');
    expect(calls).toEqual([]);
  });

  it.skip('publishes snapshot, decision, and package final state through one atomic RPC', async () => {
    const { supabase, calls } = makeSupabaseMock();
    const pkg = publishablePackage();
    const { snapshotHash } = buildPublicPackageSnapshot(pkg);

    const result = await createPublicPackageSnapshotAndDecision(
      supabase as never,
      pkg,
      {
        customerOpenContractOk: true,
        mobileProof: mobileProofForSnapshot(snapshotHash),
      },
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

  it.skip('blocks the central snapshot writer when a V4 package lacks canonical normalization', async () => {
    const { supabase, calls } = makeSupabaseMock({
      v4Job: {
        id: 'job-v4-1',
        source_document_id: 'doc-v4-1',
        extraction_id: 'ext-v4-1',
        v4_stage: 'normalized',
        v4_canonical_normalization_id: null,
        v4_stage_state: { packageId: '11111111-1111-4111-8111-111111111111' },
      },
    });

    const result = await createPublicPackageSnapshotAndDecision(
      supabase as never,
      publishablePackage(),
      {
        customerOpenContractOk: true,
        mobileProof: mobileProofForSnapshot(buildPublicPackageSnapshot(publishablePackage()).snapshotHash),
      },
    );

    expect(result.publishable).toBe(false);
    expect(result.publicationState).toBe('blocked');
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'v4_canonical_normalization_required' }),
    ]));
    expect(calls[0].payload).toMatchObject({
      p_snapshot_status: 'blocked',
      p_publication_state: 'blocked',
      p_publishable: false,
    });
  });

  it.skip('evaluates customer title claims from the public snapshot title, not the raw supplier title', async () => {
    const { supabase, calls } = makeSupabaseMock();
    const pkg = publishablePackage({
      id: '22222222-2222-4222-8222-222222222222',
      title: '연길 5성 온천 4박5일 출발확정',
      destination: '연길',
      duration: 5,
      nights: 4,
      raw_text: [
        '선택관광: 노옵션',
        'DAY 2 백두산 천지 관광',
        '온천욕으로 휴식',
      ].join('\n'),
      products: {
        display_name: '연길·백두산 패키지',
        thumbnail_urls: ['https://cdn.yeosonam.com/packages/yanji.jpg'],
      },
      itinerary_data: {
        days: [
          { day: 1, schedule: [{ activity: '연길 이동' }] },
          { day: 2, schedule: [{ activity: '백두산 천지 관광' }] },
        ],
      },
    });
    const { snapshotHash } = buildPublicPackageSnapshot(pkg);

    const result = await createPublicPackageSnapshotAndDecision(
      supabase as never,
      pkg,
      {
        customerOpenContractOk: true,
        mobileProof: mobileProofForSnapshot(snapshotHash),
      },
    );

    expect(result.publishable).toBe(true);
    expect(calls[0].payload?.p_hard_blockers).toEqual([]);
    const snapshot = calls[0].payload?.p_snapshot_json as { public_title?: string; route_text_dump?: string[] };
    expect(snapshot.public_title).toBe('연길·백두산 노옵션 핵심관광 4박5일');
    expect(snapshot.route_text_dump?.join('\n')).not.toMatch(/출발확정|온천|5성/);
  });

  it.skip('blocks publication when itinerary attraction ids do not exist in active attractions', async () => {
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
      {
        packagePatch: {
          status: 'active',
          publication_state: 'published',
          updated_at: '2026-07-14T00:00:00.000Z',
        },
      },
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
      p_package_patch: expect.objectContaining({
        status: 'draft',
        publication_state: 'blocked',
        updated_at: '2026-07-14T00:00:00.000Z',
      }),
    });
  });

  it.skip('blocks publication when itinerary attraction ids are not customer-publishable', async () => {
    const nonPublicAttractionId = '44444444-4444-4444-8444-444444444444';
    const { supabase, calls } = makeSupabaseMock({
      activeAttractionIds: [nonPublicAttractionId],
      nonCustomerPublishableAttractionIds: [nonPublicAttractionId],
    });

    const result = await createPublicPackageSnapshotAndDecision(
      supabase as never,
      publishablePackage({
        itinerary_data: {
          days: [
            { day: 1, schedule: [{ activity: 'Odaiba sightseeing', attraction_ids: [nonPublicAttractionId] }] },
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
        message: expect.stringContaining(nonPublicAttractionId),
      }),
    ]));
    expect(calls[0].payload).toMatchObject({
      p_snapshot_status: 'blocked',
      p_publication_state: 'blocked',
      p_publishable: false,
    });
  });

  it.skip('fails closed when active attraction lookup fails before publication', async () => {
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

  it.skip('throws when the atomic publication RPC fails', async () => {
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
