import { describe, expect, it } from 'vitest';
import { evaluateCustomerDeliveryReadiness } from './customer-delivery-check';
import { TOURCOCONUT_NHA_TRANG_DALAT_RAW } from './product-registration-golden-fixtures';
import { buildSupplierRawDeterministicItinerary } from './supplier-raw-deterministic-facts';
import type { SourceEvidenceMap } from './source-evidence';

const RAW = `LJ115 21:35 부산 출발
LJ116 06:40 부산 도착
죽림선원 관광
왕복항공권
가이드/기사 경비`;

function basePkg(overrides: Record<string, unknown> = {}) {
  return {
    audit_status: 'clean',
    audit_report: {},
    title: '나트랑 3박5일',
    destination: '나트랑',
    trip_style: '3박5일',
    duration: 5,
    nights: 3,
    departure_airport: '부산',
    airline: 'LJ',
    min_participants: 6,
    price_tiers: [{ period_label: '기본', adult_price: 619000, status: 'available' }],
    inclusions: ['왕복항공권'],
    excludes: ['가이드/기사 경비'],
    itinerary_data: {
      meta: { flight_out: 'LJ115', flight_in: 'LJ116', departure_airport: '부산' },
      days: [
        { day: 1, schedule: [{ time: '21:35', activity: 'LJ115 부산 출발', type: 'flight' }] },
        { day: 2, schedule: [{ time: '09:00', activity: '죽림선원 관광', type: 'normal' }] },
        { day: 5, schedule: [{ time: '06:40', activity: '부산 도착', type: 'flight', transport: 'LJ116' }] },
      ],
    },
    raw_text: RAW,
    ...overrides,
  };
}

const FULL_EVIDENCE: SourceEvidenceMap = {
  'meta.region': [{ rawTextHash: 'h', start: 0, end: 1, quote: '나트랑', confidence: 1, source: 'manual' }],
  'meta.tripStyle': [{ rawTextHash: 'h', start: 0, end: 1, quote: '3박5일', confidence: 1, source: 'manual' }],
  'meta.minParticipants': [{ rawTextHash: 'h', start: 0, end: 1, quote: '6', confidence: 1, source: 'manual' }],
  'meta.airline': [{ rawTextHash: 'h', start: 0, end: 1, quote: 'LJ', confidence: 1, source: 'manual' }],
  'flights.outbound[0].code': [{ rawTextHash: 'h', start: 0, end: 1, quote: 'LJ115', confidence: 1, source: 'manual' }],
  'flights.inbound[0].code': [{ rawTextHash: 'h', start: 0, end: 1, quote: 'LJ116', confidence: 1, source: 'manual' }],
  'priceGroups[0].adultPrice': [{ rawTextHash: 'h', start: 0, end: 1, quote: '619000', confidence: 1, source: 'manual' }],
};

describe('evaluateCustomerDeliveryReadiness', () => {
  it('allows the shared Tourcoconut golden corpus fixture for customer delivery', () => {
    const fixture = TOURCOCONUT_NHA_TRANG_DALAT_RAW;
    const result = evaluateCustomerDeliveryReadiness({
      pkg: basePkg({
        title: fixture.expected.title,
        destination: fixture.expected.destination,
        price_tiers: [{ period_label: 'raw departures', adult_price: fixture.expected.adultPrice, status: 'available' }],
        itinerary_data: buildSupplierRawDeterministicItinerary(fixture.rawText),
        raw_text: fixture.rawText,
      }) as Parameters<typeof evaluateCustomerDeliveryReadiness>[0]['pkg'],
      sourceEvidence: null,
      failedChecks: [],
      requireCompletedAudit: true,
    });

    expect(result.customerDeliverable).toBe(true);
    expect(result.publishGate.decision).toBe('allow');
    expect(result.sourceEvidenceCoverage.ratio).toBe(1);
    expect(result.renderClaimCoverage.ratio).toBe(1);
  });

  it('rebuilds source evidence from the package row when intake evidence is missing', () => {
    const result = evaluateCustomerDeliveryReadiness({
      pkg: basePkg() as Parameters<typeof evaluateCustomerDeliveryReadiness>[0]['pkg'],
      sourceEvidence: null,
      failedChecks: [],
      requireCompletedAudit: true,
    });

    expect(result.sourceEvidenceOrigin).toBe('fallback');
    expect(result.sourceEvidenceCoverage.covered).toBeGreaterThan(0);
    expect(result.renderClaimCoverage.unsupported.map(c => c.value)).not.toContain('죽림선원 관광');
  });

  it('blocks customer delivery for unsupported final render claims', () => {
    const result = evaluateCustomerDeliveryReadiness({
      pkg: basePkg({
        itinerary_data: {
          meta: { flight_out: 'LJ115', flight_in: 'LJ116', departure_airport: '부산' },
          days: [{ day: 1, schedule: [{ activity: '원문에 없는 럭셔리 요트 투어', type: 'normal' }] }],
        },
      }) as Parameters<typeof evaluateCustomerDeliveryReadiness>[0]['pkg'],
      sourceEvidence: null,
      failedChecks: [],
      requireCompletedAudit: true,
    });

    expect(result.customerDeliverable).toBe(false);
    expect(result.publishGate.decision).toBe('block');
    expect(result.finalRenderFailedChecks.some(c => c.id?.startsWith('final_render_unsupported'))).toBe(true);
  });

  it('ignores stale persisted render failures and recomputes them from the current render', () => {
    const result = evaluateCustomerDeliveryReadiness({
      pkg: basePkg() as Parameters<typeof evaluateCustomerDeliveryReadiness>[0]['pkg'],
      sourceEvidence: FULL_EVIDENCE,
      failedChecks: [
        {
          id: 'render_claim_unsupported',
          passed: false,
          severity: 'critical',
          message: 'old placeholder failure',
        },
      ],
      requireCompletedAudit: true,
    });

    expect(result.renderClaimCoverage.unsupported).toHaveLength(0);
    expect(result.publishGate.reasons).not.toContain('critical 품질 실패: old placeholder failure');
    expect(result.publishGate.decision).not.toBe('block');
  });

  it('treats confidence mismatch as an operational warning, not a customer-delivery blocker', () => {
    const result = evaluateCustomerDeliveryReadiness({
      pkg: basePkg() as Parameters<typeof evaluateCustomerDeliveryReadiness>[0]['pkg'],
      sourceEvidence: FULL_EVIDENCE,
      failedChecks: [
        {
          id: 'confidence_verify_mismatch',
          passed: false,
          severity: 'critical',
          message: 'calibration candidate',
        },
      ],
      requireCompletedAudit: true,
    });

    expect(result.publishGate.decision).toBe('force_required');
    expect(result.publishGate.reasons).toHaveLength(0);
    expect(result.publishGate.warnings.some(w => w.includes('calibration candidate'))).toBe(true);
  });

  it('allows a supplier raw golden sample when deterministic fields and render claims are source-backed', () => {
    const raw = `상품명: [RAW-GOLDEN] 나트랑/달랏 5성 3박5일
출발공항 부산 / 항공 LJ 진에어
출발편 LJ115 21:35 부산 출발 00:25 나트랑 도착
귀국편 LJ116 01:00 나트랑 출발 06:40 부산 도착
출발일: 2027-02-04, 2027-02-11
최소출발 6명 이상

요금표
성인 889,000원 / 아동 889,000원

포함사항
왕복항공권, 전 일정 호텔, 일정표에 명시된 식사

불포함사항
가이드/기사 경비, 개인경비 및 매너팁

일정표
1일차 부산/나트랑
21:35 LJ115 부산 출발
00:25 나트랑 도착
호텔: 나트랑 5성 호텔
식사 조:X 중:X 석:X

2일차 나트랑/달랏
09:00 죽림선원 관광
호텔: 달랏 5성 호텔
식사 조:호텔식 중:현지식 석:현지식

3일차 달랏
10:00 달랏 시내 자유시간
호텔: 달랏 5성 호텔
식사 조:호텔식 중:현지식 석:현지식

4일차 달랏/나트랑
18:00 공항 이동
01:00 LJ116 나트랑 출발
숙박: 기내
식사 조:호텔식 중:현지식 석:현지식

5일차 부산
06:40 부산 도착
식사 조:X 중:X 석:X

공지
여권 만료일은 출발일 기준 6개월 이상 남아 있어야 합니다.
현지 사정과 항공 스케줄에 따라 일정 순서가 변경될 수 있습니다.
취소료는 여행약관과 항공사 규정에 따라 적용됩니다.`;

    const result = evaluateCustomerDeliveryReadiness({
      pkg: basePkg({
        title: '[RAW-GOLDEN] 나트랑/달랏 5성 3박5일',
        destination: '나트랑/달랏',
        price_tiers: [{ period_label: '원문 출발일', adult_price: 889000, status: 'available' }],
        itinerary_data: buildSupplierRawDeterministicItinerary(raw),
        raw_text: raw,
      }) as Parameters<typeof evaluateCustomerDeliveryReadiness>[0]['pkg'],
      sourceEvidence: null,
      failedChecks: [],
      requireCompletedAudit: true,
    });

    expect(result.customerDeliverable).toBe(true);
    expect(result.publishGate.decision).toBe('allow');
    expect(result.sourceEvidenceCoverage.ratio).toBe(1);
    expect(result.renderClaimCoverage.ratio).toBe(1);
  });
});
