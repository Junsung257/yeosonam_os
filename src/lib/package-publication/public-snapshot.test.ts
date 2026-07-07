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

describe('public package snapshot gate', () => {
  it('generates a customer-safe Yanji title and treats no-option as a policy, not an optional tour', () => {
    const { snapshot, optionalTourClassification } = buildPublicPackageSnapshot(yanjiPackage());

    expect(snapshot.public_title).toBe('연길·백두산 노옵션 핵심관광 4박5일');
    expect(snapshot.public_title).not.toContain('온천');
    expect(optionalTourClassification.status).toBe('none_explicit');
    expect(snapshot.optional_tours_public).toEqual([]);
    expect(snapshot.package.optional_tours).toEqual([]);
    expect(snapshot.option_policy.badges).toContain('노옵션');
  });

  it('blocks publication while polluted optional_tours remain in the DB row', () => {
    const pkg = yanjiPackage();
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
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
    const pkg = yanjiPackage({ optional_tours: [] });
    const { snapshot, snapshotHash } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg,
      publicSnapshotHash: snapshotHash,
      snapshotExists: true,
      routeTextDump: snapshot.route_text_dump,
    });

    expect(gate.publishable).toBe(true);
    expect(gate.publication_state).toBe('published');
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
      snapshotExists: true,
      routeTextDump: [...snapshot.route_text_dump, '예약 즉시 항공·숙박 확보'],
    });

    expect(gate.publishable).toBe(false);
    expect(gate.hard_blockers.map(blocker => blocker.code)).toContain('risky_reservation_claim');
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
            { surface: 'packages', status: 'pass', screen_hash: 'a', customer_visible_hash: 'b', public_snapshot_hash: 'old-hash' },
            { surface: 'lp', status: 'pass', screen_hash: 'c', customer_visible_hash: 'd', public_snapshot_hash: 'old-hash' },
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
