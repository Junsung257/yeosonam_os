import { describe, expect, it } from 'vitest';

import { buildRegistrationRemediationPlan } from './operator-remediation';

describe('buildRegistrationRemediationPlan', () => {
  it('routes missing land-operator and commission evidence to upload metadata input', () => {
    const plan = buildRegistrationRemediationPlan([
      'COMMERCIAL_METADATA: land_operator_required 랜드사 확인이 필요합니다.',
      'COMMERCIAL_METADATA: commission_rate_required 커미션율 확인이 필요합니다.',
    ]);

    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'commercial_metadata',
        field: 'commercial_metadata',
        actionHref: '/admin/upload',
      }),
    ]);
    expect(plan.supplierRequestText).toBeNull();
  });

  it('routes attraction review to the existing owner-admin queue without creating a master', () => {
    const plan = buildRegistrationRemediationPlan([
      'v3:gate:attraction_unmatched_queue_clear:1 unmatched attraction events require review',
      'v3:gate:entity_attraction_unresolved_clear:1 unresolved attraction entities require review',
      'v3:unmatched_attraction:광부고성',
      'mobile_media:attraction.unmatched_major:광부고성',
      'v3:needs_review',
    ]);

    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({
      kind: 'attraction_review',
      field: 'attraction_master',
      actionHref: '/admin/attractions/unmatched',
      sourcePhrases: ['광부고성'],
    });
    expect(plan.supplierRequestText).toBeNull();
  });

  it('builds an exact supplier request for every missing commercial fact', () => {
    const plan = buildRegistrationRemediationPlan([
      { id: 'variant_0.minimum_departure', status: 'fail', detail: 'minimum departure evidence exists' },
      { id: 'variant_0.flight', status: 'fail', detail: 'air package has flight evidence' },
      { id: 'variant_0.high_risk_notice_values', status: 'fail', detail: 'high-risk standard notices must have required values and review status' },
    ], {
      productTitle: '테스트 상품',
    });

    expect(plan.actions.map(action => action.field)).toEqual([
      'minimum_departure',
      'round_trip_flight',
      'unpriced_surcharge',
    ]);
    expect(plan.supplierRequestText).toContain('상품: 테스트 상품');
    expect(plan.supplierRequestText).toContain('고객 오픈 전 원문 보완 요청');
    expect(plan.supplierRequestText).toContain('성인 기준 확정 인원수');
    expect(plan.supplierRequestText).toContain('출발편·귀국편');
    expect(plan.supplierRequestText).toContain('“추가비용 없음”');
  });

  it('does not request supplier facts for parser-owned price and itinerary failures', () => {
    const plan = buildRegistrationRemediationPlan([
      { id: 'C12', status: 'fail', label: '가격표 원문 재대조', detail: '원문 가격 3건 인식, DB price_dates 없음' },
      { id: 'C16', status: 'fail', label: 'customer render duration contract', detail: 'duration mismatch' },
    ]);

    expect(plan.actions.map(action => action.field)).toEqual(['price', 'itinerary']);
    expect(plan.actions.every(action => action.kind === 'system_repair')).toBe(true);
    expect(plan.supplierRequestText).toBeNull();
  });

  it('routes a brand-only landing image to operator media remediation', () => {
    const plan = buildRegistrationRemediationPlan([
      'PUBLIC_CUSTOMER_IMAGE_MISSING: brand fallback is preview-only',
    ]);

    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'system_repair',
        field: 'customer_image',
        title: '고객 대표 이미지 연결',
      }),
    ]);
    expect(plan.supplierRequestText).toBeNull();
  });

  it('ignores passing checks and returns ready when no actionable issue remains', () => {
    const plan = buildRegistrationRemediationPlan([
      { id: 'C4', status: 'pass', detail: '가격 일치' },
      { id: 'C10', status: 'skip', detail: '옵션 투어 없음' },
    ]);

    expect(plan).toEqual({
      ready: true,
      actions: [],
      supplierRequestText: null,
    });
  });
});
