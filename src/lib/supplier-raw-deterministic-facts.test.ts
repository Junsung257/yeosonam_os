import { describe, expect, it } from 'vitest';
import type { NormalizedIntake } from './intake-normalizer';
import {
  applySupplierRawDeterministicFacts,
  buildSupplierRawDeterministicItinerary,
  canUseSupplierRawDeterministicPreflight,
  extractSupplierRawDeterministicFacts,
} from './supplier-raw-deterministic-facts';
import { SUPPLIER_RAW_GOLDEN_FIXTURES } from './product-registration-golden-fixtures';

const baseIr: NormalizedIntake = {
  meta: {
    landOperator: '투어코코넛',
    region: 'UNK',
    country: '베트남',
    tripStyle: '3박5일',
    productType: '패키지',
    commissionRate: 10,
    ticketingDeadline: null,
    minParticipants: 4,
    departureAirport: '부산',
    airline: 'UNK',
    departureDays: null,
  },
  flights: { outbound: [], inbound: [] },
  priceGroups: [],
  hotels: [],
  inclusions: [],
  excludes: [],
  surcharges: [],
  optionalTours: [],
  days: [],
  notices: { manual: [], auto: [] },
  rawText: '',
  rawTextHash: '',
  sourceEvidence: {},
  normalizerVersion: 'test',
  extractedAt: '2026-05-31T00:00:00.000Z',
};

describe('applySupplierRawDeterministicFacts', () => {
  it.each(SUPPLIER_RAW_GOLDEN_FIXTURES)(
    'pins the supplier golden corpus fast path: $id',
    fixture => {
      const facts = extractSupplierRawDeterministicFacts(fixture.rawText);
      const itinerary = buildSupplierRawDeterministicItinerary(fixture.rawText);

      expect(canUseSupplierRawDeterministicPreflight(fixture.rawText)).toBe(fixture.expected.llmSkippable);
      expect(facts.title).toBe(fixture.expected.title);
      expect(facts.departureAirport).toBe(fixture.expected.departureAirport);
      expect(facts.airline).toBe(fixture.expected.airline);
      expect(facts.minParticipants).toBe(fixture.expected.minParticipants);
      expect(facts.prices.adult).toBe(fixture.expected.adultPrice);
      expect(facts.prices.child).toBe(fixture.expected.childPrice);
      if (fixture.expected.optionalTourCount !== undefined) {
        expect(facts.optionalTours).toHaveLength(fixture.expected.optionalTourCount);
      }
      expect(facts.dates).toEqual(fixture.expected.departureDates);
      expect(facts.outbound?.code).toBe(fixture.expected.outboundFlight);
      expect(facts.inbound?.code).toBe(fixture.expected.inboundFlight);
      expect(itinerary?.days).toHaveLength(fixture.expected.dayCount);
    },
  );

  it('recovers customer-facing facts from supplier raw text', () => {
    const raw = `상품명: [RAW-E2E3] 나트랑/달랏 5성 3박5일
출발공항 부산 / 항공 LJ 진에어
출발편 LJ115 21:35 부산 출발 00:25 나트랑 도착
귀국편 LJ116 01:00 나트랑 출발 06:40 부산 도착
출발일: 2026-07-02, 2026-07-09
최소출발 6명 이상
요금표
성인 719,000원 / 아동 719,000원

포함사항
왕복항공권, 전 일정 호텔, 일정표에 명시된 식사

불포함사항
가이드/기사 경비, 개인경비 및 매너팁

공지
여권 만료일은 출발일 기준 6개월 이상 남아 있어야 합니다.
현지 사정과 항공 스케줄에 따라 일정 순서가 변경될 수 있습니다.
취소료는 여행약관과 항공사 규정에 따라 적용됩니다.`;

    const facts = extractSupplierRawDeterministicFacts(raw);
    expect(facts.title).toBe('[RAW-E2E3] 나트랑/달랏 5성 3박5일');
    expect(facts.tripStyle).toBe('3박5일');
    expect(facts.durationDays).toBe(5);
    expect(facts.departureAirport).toBe('부산');
    expect(facts.outbound?.code).toBe('LJ115');
    expect(facts.inbound?.code).toBe('LJ116');
    expect(facts.inclusions).toContain('왕복항공권');
    expect(facts.excludes).toContain('가이드/기사 경비');
    expect(facts.notices.length).toBe(3);

    const fixed = applySupplierRawDeterministicFacts(baseIr, raw);
    expect(fixed.meta.region).toBe('나트랑/달랏');
    expect(fixed.meta.tripStyle).toBe('3박5일');
    expect(fixed.meta.departureAirport).toBe('부산');
    expect(fixed.meta.minParticipants).toBe(6);
    expect(fixed.meta.airline).toBe('LJ');
    expect(fixed.flights.outbound[0]?.code).toBe('LJ115');
    expect(fixed.flights.inbound[0]?.code).toBe('LJ116');
    expect(fixed.priceGroups[0].dates).toEqual(['2026-07-02', '2026-07-09']);
    expect(fixed.priceGroups[0].adultPrice).toBe(719000);
  });

  it('builds a complete itinerary and marks the supplier format as LLM-skippable', () => {
    const raw = `투어코코넛 나트랑/달랏 5성 3박5일 상품 안내
상품명: [RAW-GOLDEN] 나트랑/달랏 5성 3박5일
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

    expect(canUseSupplierRawDeterministicPreflight(raw)).toBe(true);
    const itinerary = buildSupplierRawDeterministicItinerary(raw);
    expect(itinerary?.meta.flight_out).toBe('LJ115');
    expect(itinerary?.meta.flight_in).toBe('LJ116');
    expect(itinerary?.days).toHaveLength(5);
    expect(itinerary?.days[0].schedule[0]).toMatchObject({ type: 'flight', transport: 'LJ115' });
    expect(itinerary?.days[4].schedule[0]).toMatchObject({ type: 'flight', transport: 'LJ116' });
    expect(itinerary?.days[4].schedule).toHaveLength(1);
  });

  it('supports common alternate supplier labels without LLM normalization', () => {
    const raw = `행사명: [ALT-GOLDEN] 푸꾸옥 리조트 3박5일
출발지: 부산 / 이용항공 LJ 진에어
가는편: LJ111 22:00 부산 출발 01:10 푸꾸옥 도착
오는편: LJ112 02:20 푸꾸옥 출발 08:30 부산 도착
출발일자: 2027.03.05 / 2027.03.12
최소인원 8명

요금표
대인 999,000원 / 소아 999,000원

포함내역
왕복항공권, 리조트 숙박, 일정표상 식사

불포함내역
가이드/기사 경비, 개인경비

DAY 1 부산/푸꾸옥
22:00 LJ111 부산 출발
01:10 푸꾸옥 도착
호텔: 푸꾸옥 5성 리조트
식사 조:X 중:X 석:X

DAY 2 푸꾸옥
09:00 사오비치 관광
호텔: 푸꾸옥 5성 리조트
식사 조:호텔식 중:현지식 석:현지식

DAY 3 푸꾸옥
10:00 빈원더스 자유시간
호텔: 푸꾸옥 5성 리조트
식사 조:호텔식 중:현지식 석:현지식

DAY 4 푸꾸옥
18:00 공항 이동
02:20 LJ112 푸꾸옥 출발
숙박: 기내
식사 조:호텔식 중:현지식 석:현지식

DAY 5 부산
08:30 부산 도착
식사 조:X 중:X 석:X

비고
여권 만료일은 출발일 기준 6개월 이상 남아 있어야 합니다.
현지 사정에 따라 일정 순서가 변경될 수 있습니다.`;

    expect(canUseSupplierRawDeterministicPreflight(raw)).toBe(true);
    const facts = extractSupplierRawDeterministicFacts(raw);
    expect(facts.title).toBe('[ALT-GOLDEN] 푸꾸옥 리조트 3박5일');
    expect(facts.departureAirport).toBe('부산');
    expect(facts.airline).toBe('LJ');
    expect(facts.minParticipants).toBe(8);
    expect(facts.prices.adult).toBe(999000);
    expect(facts.dates).toEqual(['2027-03-05', '2027-03-12']);
    expect(facts.outbound?.code).toBe('LJ111');
    expect(facts.inbound?.code).toBe('LJ112');
    expect(facts.inclusions).toContain('왕복항공권');
    expect(facts.excludes).toContain('가이드/기사 경비');

    const itinerary = buildSupplierRawDeterministicItinerary(raw);
    expect(itinerary?.days).toHaveLength(5);
    expect(itinerary?.days[0].regions).toEqual(['부산', '푸꾸옥']);
    expect(itinerary?.days[4].schedule[0]).toMatchObject({ type: 'flight', transport: 'LJ112' });
  });
});
