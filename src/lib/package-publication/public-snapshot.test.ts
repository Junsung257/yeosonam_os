import { describe, expect, it } from 'vitest';

import { evaluateCustomerMobileProof } from '@/lib/customer-mobile-proof';
import { buildPublicPackageSnapshot } from './public-snapshot';
import { evaluatePublicSnapshotPublishGate } from './publish-gate';

const VALID_ATTRACTION_ID = '5728e681-636b-42fa-87b5-a2f0b7b0379c';

function yanjiPackage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ddcae752-b354-4120-a519-18123df67dba',
    package_revision: 7,
    title: '연길 5성 온천 4박5일',
    display_title: null,
    destination: '연길',
    duration: 5,
    nights: 4,
    price: 599000,
    product_prices: [{ target_date: '2026-07-12', adult_selling_price: 599000 }],
    price_dates: [{ date: '2026-07-12', price: 599000, confirmed: false }],
    products: {
      display_name: '연길·백두산 패키지',
      thumbnail_urls: ['https://images.pexels.com/photos/123/pexels-photo-123.jpeg'],
    },
    status: 'active',
    raw_text: [
      '연길 5성 온천 4박5일',
      '선택관광: 노옵션',
      'DAY 2 백두산 천지 관광',
      '온천욕으로 휴식 수영복 개별지참',
      '포 함 내 역 차량 가이드 상품가 599,000원/인',
    ].join('\n'),
    itinerary_data: {
      days: [
        { day: 1, schedule: [{ activity: '도문 이동', attraction_ids: [] }] },
        { day: 2, schedule: [{ activity: '백두산 천지 관광', attraction_ids: [VALID_ATTRACTION_ID] }] },
      ],
    },
    optional_tours: ['7월 5', '599', '000원/인', '포 함 내 역', '차량', '가이드', '노옵션'],
    inclusions: ['왕복항공료', '숙박료', '가이드'],
    excludes: ['개인경비', '기사/가이드경비 $50/인'],
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
      package_revision: 7,
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

describe('public package snapshot gate', () => {
  it('generates a customer-safe Yanji title and treats no-option as a policy, not an optional tour', () => {
    const { snapshot, optionalTourClassification } = buildPublicPackageSnapshot(yanjiPackage());

    expect(snapshot.public_title).toBe('연길·백두산 노옵션 핵심관광 4박5일');
    expect(snapshot.public_title).not.toContain('온천');
    expect(snapshot.public_subtitle).not.toMatch(/온천|5성/);
    expect(snapshot.card_projection.badges).not.toEqual(expect.arrayContaining(['온천', '5성호텔']));
    expect(snapshot.lp_projection.summary).not.toMatch(/온천|5성/);
    expect(optionalTourClassification.status).toBe('none_explicit');
    expect(snapshot.optional_tours_public).toEqual([]);
    expect(snapshot.package.optional_tours).toEqual([]);
    expect(snapshot.option_policy.badges).toContain('노옵션');
  });

  it('does not fall back to a raw supplier summary for the LP projection', () => {
    const { snapshot } = buildPublicPackageSnapshot(yanjiPackage({
      optional_tours: [],
      product_summary: '관리자노트: 랜드사 커미션 9% 내부 확인',
    }));

    expect(snapshot.lp_projection.summary).toBeTruthy();
    expect(snapshot.lp_projection.summary).not.toContain('관리자노트');
    expect(snapshot.lp_projection.summary).not.toContain('랜드사 커미션');
    expect(snapshot.package.product_summary).toBe(snapshot.lp_projection.summary);
    expect(snapshot.package.product_summary).not.toContain('관리자노트');
    expect(snapshot.package.product_summary).not.toContain('랜드사 커미션');
  });

  it('fails closed when a policy title cannot include a verified duration', () => {
    const pkg = yanjiPackage({
      duration: null,
      nights: null,
      title: '연길 핵심관광',
      display_title: null,
      trip_style: null,
      raw_text: '선택관광: 노옵션\nDAY 2 백두산 천지 관광',
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg: {
        ...pkg,
        images_public: snapshot.images_public,
        hero_image_url: snapshot.package.hero_image_url,
        thumbnail_urls: snapshot.package.thumbnail_urls,
      },
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(snapshot.public_title).toBe('');
    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers.map(blocker => blocker.code)).toContain('public_title_missing');
  });

  it('stores the canonical render view inside the public snapshot', () => {
    const { snapshot } = buildPublicPackageSnapshot(yanjiPackage({ optional_tours: [] }));

    expect(snapshot.canonical_view).toEqual(expect.objectContaining({
      days: expect.any(Array),
      flightHeader: expect.any(Object),
      inclusions: expect.any(Object),
      optionalTours: expect.any(Object),
    }));
  });

  it('builds the canonical render view from the same cleaned public snapshot package', () => {
    const { snapshot } = buildPublicPackageSnapshot(yanjiPackage());
    const canonicalView = snapshot.canonical_view as {
      optionalTours?: { count?: number; flat?: unknown[] };
    };

    expect(snapshot.package.title).toBe(snapshot.public_title);
    expect(snapshot.package.optional_tours).toEqual(snapshot.optional_tours_public);
    expect(canonicalView.optionalTours?.count).toBe(0);
    expect(canonicalView.optionalTours?.flat).toEqual([]);
    expect(JSON.stringify(snapshot.canonical_view)).not.toContain('599');
    expect(JSON.stringify(snapshot.canonical_view)).not.toContain('포 함 내 역');
  });

  it('keeps internal nested price and operator fields out of the public snapshot package', () => {
    const { snapshot } = buildPublicPackageSnapshot(yanjiPackage({
      optional_tours: [{
        name: '야간 시티투어',
        price: '$40',
        commission_rate: 9,
        supplier_note: 'supplier only',
      }],
      itinerary_data: {
        days: [{
          day: 1,
          schedule: [{
            activity: '오다이바 관광',
            internal_note: '랜드사 커미션',
            net_price: 900_000,
            margin_rate: 0.1,
          }],
        }],
      },
    }));

    const schedule = (((snapshot.package.itinerary_data as Record<string, unknown>).days as Array<Record<string, unknown>>)[0]
      ?.schedule as Array<Record<string, unknown>>)[0];
    const serializedPackage = JSON.stringify(snapshot.package);

    expect(schedule).not.toHaveProperty('internal_note');
    expect(schedule).not.toHaveProperty('net_price');
    expect(schedule).not.toHaveProperty('margin_rate');
    expect(serializedPackage).not.toContain('commission_rate');
    expect(serializedPackage).not.toContain('supplier_note');
  });

  it('uses customer selling price rows as the public representative price', () => {
    const { snapshot } = buildPublicPackageSnapshot(yanjiPackage({
      optional_tours: [],
      price: 900_000,
      product_prices: [
        { target_date: '2026-08-07', adult_selling_price: 1_099_000, note: '세이브' },
        { target_date: '2026-08-08', adult_selling_price: 1_199_000, note: '스탠다드' },
      ],
    }));

    expect(snapshot.package.price).toBe(1_099_000);
    expect(snapshot.price_display).toContain('1,099,000');
    expect(snapshot.card_projection.price).toBe(1_099_000);
    expect(snapshot.lp_projection.price).toBe(1_099_000);
  });

  it('collects approved image candidates into the public snapshot and projections', () => {
    const { snapshot } = buildPublicPackageSnapshot(yanjiPackage({
      optional_tours: [],
      lp_hero_image_url: 'https://cdn.yeosonam.com/packages/yanji-hero.jpg',
      products: {
        display_name: '연길·백두산 패키지',
        thumbnail_urls: ['https://cdn.yeosonam.com/packages/yanji-card.jpg'],
      },
      itinerary_data: {
        days: [{
          day: 1,
          schedule: [{
            activity: '백두산 천지 관광',
            photos: [{ src_medium: 'https://images.pexels.com/photos/456/pexels-photo-456.jpeg' }],
            attraction_ids: [VALID_ATTRACTION_ID],
          }],
        }],
      },
    }));

    expect(snapshot.images_public).toEqual([
      expect.objectContaining({
        url: 'https://cdn.yeosonam.com/packages/yanji-hero.jpg',
        source: 'package_hero',
      }),
      expect.objectContaining({
        url: 'https://cdn.yeosonam.com/packages/yanji-card.jpg',
        source: 'product_thumbnail',
      }),
      expect.objectContaining({
        url: 'https://images.pexels.com/photos/456/pexels-photo-456.jpeg',
        source: 'attraction_photo',
      }),
    ]);
    expect(snapshot.package.hero_image_url).toBe('https://cdn.yeosonam.com/packages/yanji-hero.jpg');
    expect(snapshot.card_projection.thumbnail_urls).toEqual([
      'https://cdn.yeosonam.com/packages/yanji-hero.jpg',
      'https://cdn.yeosonam.com/packages/yanji-card.jpg',
      'https://images.pexels.com/photos/456/pexels-photo-456.jpeg',
    ]);
    expect(snapshot.lp_projection.lp_hero_image_url).toBe('https://cdn.yeosonam.com/packages/yanji-hero.jpg');
  });

  it('fails closed instead of exposing a raw package price without source-backed price dates', () => {
    const pkg = yanjiPackage({
      optional_tours: [],
      price: 599000,
      product_prices: [],
      price_dates: [],
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg: {
        ...pkg,
        images_public: snapshot.images_public,
        hero_image_url: snapshot.package.hero_image_url,
        thumbnail_urls: snapshot.package.thumbnail_urls,
      },
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(snapshot.price_display).toBeNull();
    expect(snapshot.card_projection.price).toBeNull();
    expect(snapshot.lp_projection.price).toBeNull();
    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers.map(blocker => blocker.code)).toContain('price_source_missing');
  });

  it('fails closed when no public image candidate exists', () => {
    const pkg = yanjiPackage({
      optional_tours: [],
      products: { display_name: '연길·백두산 패키지', thumbnail_urls: [] },
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg: {
        ...pkg,
        images_public: snapshot.images_public,
        thumbnail_urls: snapshot.package.thumbnail_urls,
      },
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      mobileProof: mobileProofForSnapshot(snapshotHash),
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(snapshot.images_public).toEqual([]);
    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'public_image_missing' }),
    ]));
  });

  it('blocks publication while polluted optional_tours remain in the DB row', () => {
    const pkg = yanjiPackage();
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining([
      'optional_tour_display_pollution',
      'masked_data_pollution',
    ]));
  });

  it('allows the repaired no-option package once fragments are removed and snapshot exists', () => {
    const pkg = yanjiPackage({
      display_title: '연길·백두산 노옵션 핵심관광 4박5일',
      optional_tours: [],
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg: {
        ...pkg,
        images_public: snapshot.images_public,
        hero_image_url: snapshot.package.hero_image_url,
        thumbnail_urls: snapshot.package.thumbnail_urls,
      },
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      mobileProof: mobileProofForSnapshot(snapshotHash),
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(gate.hard_blockers).toEqual([]);
    expect(gate.publishable).toBe(true);
    expect(gate.publication_state).toBe('published');
  });

  it('fails closed when public snapshot publication has no mobile browser proof', () => {
    const pkg = yanjiPackage({ optional_tours: [] });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'stale_mobile_proof' }),
    ]));
  });

  it('fails closed when mobile proof is not bound to the public snapshot hash', () => {
    const pkg = yanjiPackage({ optional_tours: [] });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      mobileProof: mobileProofForSnapshot('old-hash'),
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'public_snapshot_hash_mismatch' }),
    ]));
  });

  it('fails closed when the customer-open contract was not explicitly passed', () => {
    const pkg = yanjiPackage({
      display_title: '연길·백두산 노옵션 핵심관광 4박5일',
      optional_tours: [],
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers.map(blocker => blocker.code)).toContain('unsupported_customer_claim');
    expect(gate.hard_blockers.map(blocker => blocker.message).join('\n')).toContain('customer_open_contract');
  });

  it('keeps customer-open contract blockers as publish gate blockers', () => {
    const pkg = yanjiPackage({
      display_title: '연길·백두산 노옵션 핵심관광 4박5일',
      optional_tours: [],
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: false,
      customerOpenContractBlockers: ['source_verify:blocked'],
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers.map(blocker => blocker.message)).toContain('source_verify:blocked');
  });

  it('blocks an onsen title when onsen is only a minor service, not the trip theme', () => {
    const pkg = yanjiPackage({
      optional_tours: [],
      raw_text: [
        '연길 5성 온천 4박5일',
        'DAY 2 백두산 천지 관광',
        '온천욕으로 휴식 수영복 개별지참',
      ].join('\n'),
      itinerary_data: {
        days: [
          { day: 1, schedule: [{ activity: '연길 도착', attraction_ids: [] }] },
          { day: 2, schedule: [{ activity: '백두산 천지 관광', attraction_ids: [VALID_ATTRACTION_ID] }] },
          { day: 3, schedule: [{ activity: '온천욕으로 휴식', attraction_ids: [] }] },
        ],
      },
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers.map(blocker => blocker.code)).toContain('unsupported_title_claim');
  });

  it('blocks unsupported onsen claims in LP summary even when the title is safe', () => {
    const safeTitle = '연길·백두산 노옵션 핵심관광 4박5일';
    const pkg = yanjiPackage({
      title: safeTitle,
      display_title: safeTitle,
      optional_tours: [],
      raw_text: [
        '연길 백두산 핵심관광 4박5일',
        'DAY 2 백두산 천지 관광',
      ].join('\n'),
      _lp_projection: {
        title: safeTitle,
        summary: '온천 중심 휴식 여행으로 편하게 다녀오는 일정입니다.',
      },
    });
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: 'hash',
      publicSnapshotTitle: safeTitle,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: [safeTitle],
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'unsupported_title_claim',
        fieldPath: '_lp_projection.summary',
      }),
    ]));
  });

  it('blocks risky departure-confirmed claims in card badges', () => {
    const safeTitle = '연길·백두산 노옵션 핵심관광 4박5일';
    const pkg = yanjiPackage({
      title: safeTitle,
      display_title: safeTitle,
      optional_tours: [],
      raw_text: '연길 백두산 핵심관광 4박5일',
      _card_projection: {
        title: safeTitle,
        badges: ['출발확정'],
      },
    });
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: 'hash',
      publicSnapshotTitle: safeTitle,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: [safeTitle],
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'unsupported_title_claim',
        fieldPath: '_card_projection.badges.0',
      }),
    ]));
  });

  it('allows an onsen title only when the source has strong onsen-theme evidence', () => {
    const pkg = yanjiPackage({
      title: '규슈 온천·관광 3박4일',
      display_title: '규슈 온천·관광 3박4일',
      destination: '규슈',
      optional_tours: [],
      raw_text: [
        '규슈 온천·관광 3박4일',
        '쿠로가와 온천마을 산책',
        '온천 료칸 숙박',
      ].join('\n'),
      itinerary_data: {
        days: [
          { day: 1, schedule: [{ activity: '쿠로가와 온천마을 산책', attraction_ids: [VALID_ATTRACTION_ID] }] },
          { day: 2, schedule: [{ activity: '온천 료칸 숙박', attraction_ids: [] }] },
        ],
      },
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(gate.hard_blockers.map(blocker => blocker.code)).not.toContain('unsupported_title_claim');
  });

  it('blocks risky departure-confirmed wording in customer titles even when it appears in source text', () => {
    const pkg = yanjiPackage({
      title: '연길·백두산 출발확정 4박5일',
      display_title: '연길·백두산 출발확정 4박5일',
      optional_tours: [],
      raw_text: '2명부터 출발확정 연길·백두산 4박5일',
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers.map(blocker => blocker.code)).toContain('unsupported_title_claim');
  });

  it('blocks 5-star title claims when the source has no hotel-grade evidence', () => {
    const pkg = yanjiPackage({
      title: '연길·백두산 5성 핵심관광 4박5일',
      display_title: '연길·백두산 5성 핵심관광 4박5일',
      optional_tours: [],
      raw_text: '연길·백두산 핵심관광 4박5일',
      itinerary_data: {
        days: [
          { day: 1, schedule: [{ activity: '연길 도착 후 호텔 투숙', attraction_ids: [] }] },
          { day: 2, schedule: [{ activity: '백두산 천지 관광', attraction_ids: [VALID_ATTRACTION_ID] }] },
        ],
      },
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers.map(blocker => blocker.code)).toContain('unsupported_title_claim');
  });

  it('allows 5-star title claims when hotel-grade evidence is present', () => {
    const pkg = yanjiPackage({
      title: '나트랑 5성 핵심관광 3박5일',
      display_title: '나트랑 5성 핵심관광 3박5일',
      destination: '나트랑',
      optional_tours: [],
      raw_text: '호텔: 나트랑 5성 호텔 또는 동급',
      itinerary_data: {
        days: [
          { day: 1, hotel: { name: '나트랑 리조트', grade: '5성' }, schedule: [] },
          { day: 2, schedule: [{ activity: '나트랑 시내 관광', attraction_ids: [VALID_ATTRACTION_ID] }] },
        ],
      },
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(gate.hard_blockers.map(blocker => blocker.code)).not.toContain('unsupported_title_claim');
  });

  it('fails closed on malformed attraction ids', () => {
    const pkg = yanjiPackage({
      optional_tours: [],
      itinerary_data: {
        days: [
          { day: 2, schedule: [{ activity: '백두산 천지 관광', attraction_ids: ['fcf2-4df5-broken'] }] },
        ],
      },
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers.map(blocker => blocker.code)).toContain('broken_attraction_id');
  });

  it('blocks risky reservation guarantee copy', () => {
    const pkg = yanjiPackage({
      optional_tours: [],
      product_summary: '예약 즉시 항공·숙박 확보',
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: [...snapshot.route_text_dump, '예약 즉시 항공·숙박 확보'],
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers.map(blocker => blocker.code)).toContain('risky_reservation_claim');
  });

  it('sanitizes risky itinerary customer copy from the public snapshot and blocks the masked source pollution', () => {
    const riskyItineraryCopy = '\uC219\uBC15 \uD655\uC815 \uD6C4 \uC548\uB0B4\uB4DC\uB9BD\uB2C8\uB2E4.';
    const pkg = yanjiPackage({
      optional_tours: [],
      itinerary_data: {
        days: [
          {
            day: 1,
            schedule: [
              {
                activity: riskyItineraryCopy,
                attraction_ids: [],
              },
            ],
          },
        ],
      },
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    const publicSnapshotText = [
      snapshot.route_text_dump.join('\n'),
      JSON.stringify(snapshot.itinerary_public),
      JSON.stringify(snapshot.canonical_view),
    ].join('\n');
    expect(publicSnapshotText).not.toContain(riskyItineraryCopy);
    expect(publicSnapshotText).not.toMatch(/숙박\s*확정/);
    expect(snapshot.route_text_dump).toEqual(expect.arrayContaining(['예약 가능 여부는 담당자 확인 후 안내됩니다.']));
    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'masked_data_pollution', fieldPath: 'itinerary_data.days.0.schedule.0.activity' }),
      expect.objectContaining({ code: 'risky_reservation_claim' }),
    ]));
  });

  it('blocks customer-facing seat or lodging guarantee wording through the shared risky-copy gate', () => {
    const pkg = yanjiPackage({
      optional_tours: [],
      product_summary: '\uD56D\uACF5 \uC88C\uC11D \uD655\uBCF4 \uC644\uB8CC, \uC219\uBC15 \uD655\uC815 \uD6C4 \uC548\uB0B4\uB4DC\uB9BD\uB2C8\uB2E4.',
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: [
        ...snapshot.route_text_dump,
        '\uD56D\uACF5 \uC88C\uC11D \uD655\uBCF4 \uC644\uB8CC',
        '\uC219\uBC15 \uD655\uC815',
      ],
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'risky_reservation_claim' }),
    ]));
  });

  it('sanitizes risky marketing copies from the public snapshot and blocks the masked source pollution', () => {
    const riskyMarketingCopy = '\uCD5C\uC800\uAC00 \uBCF4\uC7A5 \uC0C1\uB2F4\uC73C\uB85C \uC9C0\uAE08 \uD655\uC778\uD558\uC138\uC694.';
    const pkg = yanjiPackage({
      optional_tours: [],
      marketing_copies: [
        { type: 'social', title: '\uCD94\uCC9C \uBB38\uAD6C', body: riskyMarketingCopy },
      ],
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    const publicSnapshotText = [
      snapshot.route_text_dump.join('\n'),
      JSON.stringify(snapshot.package.marketing_copies),
      JSON.stringify(snapshot.canonical_view),
    ].join('\n');
    expect(publicSnapshotText).not.toContain(riskyMarketingCopy);
    expect(publicSnapshotText).not.toMatch(/최저가\s*보장/);
    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'masked_data_pollution', fieldPath: 'marketing_copies.0.body' }),
      expect.objectContaining({ code: 'risky_reservation_claim' }),
    ]));
  });

  it('blocks Korean internal land-operator copy at the public snapshot gate', () => {
    const pkg = yanjiPackage({
      optional_tours: [],
      product_summary: '관리자노트: 랜드사 커미션 9% 내부 확인',
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: [...snapshot.route_text_dump, '관리자노트: 랜드사 커미션 9% 내부 확인'],
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers.map(blocker => blocker.code)).toContain('customer_forbidden_internal_terms');
  });

  it('blocks customer-facing photo placeholder copy at the public snapshot gate', () => {
    const pkg = yanjiPackage({
      optional_tours: [],
      product_summary: '이미지 준비 중 · 조건 먼저 확인 가능',
    });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      publicSnapshotTitle: snapshot.public_title,
      customerOpenContractOk: true,
      snapshotExists: true,
      routeTextDump: [...snapshot.route_text_dump, '사진 준비중'],
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers.map(blocker => blocker.code)).toContain('placeholder_or_mojibake');
  });

  it('invalidates mobile proof when the expected public snapshot hash differs', () => {
    const result = evaluateCustomerMobileProof({
      auditReport: {
        mobile_browser_proof: {
          status: 'pass',
          checked_at: '2026-07-07T00:00:00.000Z',
          package_updated_at: '2026-07-07T00:00:00.000Z',
          package_revision: 7,
          public_snapshot_hash: 'old-hash',
          source: 'hwp-mobile-browser-proof',
          screen_hash: 'screen',
          customer_visible_hash: 'visible',
          surfaces: ['packages', 'lp'],
          surface_results: [
            {
              surface: 'packages',
              status: 'pass',
              screen_hash: 'a',
              customer_visible_hash: 'b',
              public_snapshot_hash: 'old-hash',
              checks: [
                { name: 'packages_reservation_cta_visible', ok: true },
                { name: 'packages_reservation_sheet_opens', ok: true },
                { name: 'packages_reservation_sheet_has_product_context', ok: true },
              ],
            },
            {
              surface: 'lp',
              status: 'pass',
              screen_hash: 'c',
              customer_visible_hash: 'd',
              public_snapshot_hash: 'old-hash',
              checks: [
                { name: 'lp_lead_cta_visible', ok: true },
                { name: 'lp_lead_sheet_opens', ok: true },
                { name: 'lp_lead_sheet_has_customer_copy', ok: true },
              ],
            },
          ],
        },
      },
      packageUpdatedAt: '2026-07-07T00:00:00.000Z',
      packageRevision: 7,
      publicSnapshotHash: 'new-hash',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/public snapshot hash/);
  });
});
