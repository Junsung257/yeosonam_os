import { describe, expect, it } from 'vitest';

import { diagnosePublicSnapshotGeneration } from './public-snapshot-diagnostics';
import { buildPublicPackageSnapshot } from './public-snapshot';
import { evaluatePublicSnapshotPublishGate } from './publish-gate';

function samplePackage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sample-yanji-baekdu',
    package_revision: 1,
    title: '연길 5성 온천 4박5일',
    destination: '연길',
    duration: 5,
    nights: 4,
    price: 599000,
    price_dates: [{ date: '2026-07-12', price: 599000, confirmed: false }],
    products: {
      display_name: '연길·백두산 패키지',
      thumbnail_urls: ['https://cdn.yeosonam.com/packages/yanji.jpg'],
    },
    raw_text: [
      '연길 5성 온천 4박5일',
      '선택관광: 노옵션',
      '포함내역',
      '왕복항공료',
      '숙박료',
      '식사(일정표)',
      '관광지입장료',
      '현지차량',
      '가이드',
      '불포함내역',
      '개인경비',
      '기사/가이드경비 $50/인',
      'DAY 1 연길 이동',
      'DAY 2 백두산 천지 관광',
    ].join('\n'),
    inclusions: ['포 함 내 역', '차량', '가이드', '599', '000원/인', '노옵션'],
    excludes: ['불포함 내역', '개인경비', '기사/가이드경비 $50/인', '7월 5'],
    optional_tours: ['7월 5', '599', '000원/인', '포 함 내 역', '차량', '가이드', '노옵션'],
    itinerary_data: {
      days: [
        { day: 1, schedule: [{ activity: '연길 이동', attraction_ids: [] }] },
        { day: 2, schedule: [{ activity: '백두산 천지 관광', attraction_ids: ['5728e681-636b-42fa-87b5-a2f0b7b0379c'] }] },
      ],
    },
    ...overrides,
  };
}

function diagnosticByField(report: ReturnType<typeof diagnosePublicSnapshotGeneration>) {
  return new Map(report.diagnostics.map(item => [item.field, item]));
}

describe('public snapshot generation diagnostics', () => {
  it('classifies a regenerated no-option package by customer-facing field', () => {
    const pkg = samplePackage();
    const { snapshot } = buildPublicPackageSnapshot(pkg);
    const report = diagnosePublicSnapshotGeneration({ pkg, snapshot });
    const byField = diagnosticByField(report);

    expect(report.overall_status).toBe('generated');
    expect(byField.get('title')?.status).toBe('generated');
    expect(byField.get('summary')?.status).toBe('generated');
    expect(byField.get('price')?.status).toBe('generated');
    expect(byField.get('itinerary')?.status).toBe('generated');
    expect(byField.get('terms')?.status).toBe('generated');
    expect(byField.get('optional_tours')?.status).toBe('generated');
    expect(byField.get('optional_tours')?.evidence).toEqual(expect.arrayContaining(['optional_tour_status=none_explicit']));
    expect(snapshot.optional_tours_public).toEqual([]);
    expect(snapshot.inclusions_public).not.toEqual(expect.arrayContaining(['599', '000원/인', '노옵션']));
  });

  it('reports what to regenerate when price evidence is missing but present in source text', () => {
    const pkg = samplePackage({
      price: null,
      price_dates: [],
      raw_text: [
        '다낭/호이안 3박5일 노팁 노옵션',
        '상품가 799,000원/인',
        '포함내역',
        '왕복항공료',
      ].join('\n'),
    });
    const { snapshot } = buildPublicPackageSnapshot(pkg);
    const gate = evaluatePublicSnapshotPublishGate({
      pkg: {
        ...pkg,
        images_public: snapshot.images_public,
        hero_image_url: snapshot.package.hero_image_url,
        thumbnail_urls: snapshot.package.thumbnail_urls,
      },
      publicSnapshotTitle: snapshot.public_title,
      publicSnapshotHash: 'snapshot-hash',
      snapshotExists: true,
      customerOpenContractOk: true,
      routeTextDump: snapshot.route_text_dump,
      mobileProof: {
        ok: false,
        reason: 'not checked in unit test',
        proof: null,
      },
    });
    const report = diagnosePublicSnapshotGeneration({ pkg, snapshot, hardBlockers: gate.hard_blockers });
    const price = diagnosticByField(report).get('price');

    expect(price?.status).toBe('repairable');
    expect(price?.evidence).toEqual(expect.arrayContaining(['raw_price_pattern_present']));
    expect(price?.repair_actions.join('\n')).toContain('price_dates');
    expect(gate.required_actions.join('\n')).toContain('원문 가격표');
    expect(gate.required_actions.join('\n')).toContain('선택관광/포함/불포함 섹션');
    expect(report.repair_actions.join('\n')).toContain('원문 가격표');
  });

  it('separates customer copy blockers from repairable generation fields', () => {
    const pkg = samplePackage();
    const { snapshot } = buildPublicPackageSnapshot(pkg);
    const report = diagnosePublicSnapshotGeneration({
      pkg,
      snapshot: {
        ...snapshot,
        route_text_dump: [...snapshot.route_text_dump, '예약 즉시 항공·숙박 확보', 'Decision guide'],
      },
      hardBlockers: [
        {
          code: 'risky_reservation_claim',
          message: 'customer copy contains risky reservation/guarantee wording',
          severity: 'critical',
        },
        {
          code: 'english_internal_copy',
          message: 'internal or English operational copy is customer-visible: Decision guide',
          severity: 'critical',
        },
      ],
    });
    const byField = diagnosticByField(report);

    expect(report.overall_status).toBe('blocked');
    expect(byField.get('customer_copy')?.status).toBe('blocked');
    expect(byField.get('customer_copy')?.repair_actions.join('\n')).toContain('승인된 고객용 템플릿');
    expect(byField.get('terms')?.status).toBe('generated');
    expect(byField.get('optional_tours')?.status).toBe('generated');
  });
});
