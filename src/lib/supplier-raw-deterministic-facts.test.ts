import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NormalizedIntake } from './intake-normalizer';
import { recoverCatalogSplitFromRawText } from './product-registration/catalog-split-recovery';
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
  it('recovers Korean day-line supplier itineraries for customer landing schedules', () => {
    const rawText = `
[크라운] 큐슈 BX조석 스기노이 2박 3일
1일
부산
후쿠오카
BX142
09:00
10:00
김해 국제공항 출발
후쿠오카 국제공항 도착
전용차량
벳부 이동
▶ 유황재배지 유노하나 관광
▶ 가마도 지옥순례 및 족욕체험
*특전: 라무네(일본사이다)+계란 인당 1개 제공
호텔 이동 후 석식 및 휴식, ♨온천욕
조: 없음
중: 현지식
석: 호텔식
HOTEL: 스기노이 호텔 (니지관)
2일
유후인
전용차량
유후인 이동
▶ 긴린 호수 및 민예거리 관광
쿠로가와 이동
▶ 쿠로가와 온천마을 산책
벳부 이동
조: 호텔식
중: 현지식
석: 호텔식
HOTEL: 스기노이 호텔 (니지관)
3일
벳부
후쿠오카
전용차량
호텔 조식 후 체크아웃
면세점 쇼핑 후 후쿠오카 타워(내부관광) 관광
후쿠오카 국제공항 출발
김해 국제공항 도착
조: 호텔식
중: 없음
석: 없음
`;

    const itinerary = buildSupplierRawDeterministicItinerary(rawText);
    const activities = itinerary?.days.flatMap(day => day.schedule.map(item => item.activity)) ?? [];

    expect(itinerary?.days).toHaveLength(3);
    expect(activities).toContain('유황재배지 유노하나 관광');
    expect(activities).toContain('가마도 지옥순례 및 족욕체험');
    expect(activities).toContain('긴린 호수 및 민예거리 관광');
    expect(activities).toContain('쿠로가와 온천마을 산책');
    expect(activities).toContain('호텔 이동 후 석식 및 휴식, ♨온천욕');
    expect(itinerary?.days[0]?.hotel?.name).toBe('스기노이 호텔 (니지관)');
    expect(itinerary?.days[0]?.meals.dinner_note).toBe('호텔식');
  });

  it('extracts PKG-following product titles before notice sections', () => {
    const facts = extractSupplierRawDeterministicFacts(`
26.5.19배포
PKG
BX후쿠오카 파라다이스 골프 패키지 54H 초석 2박3일
2026.5.19
출 발 일
매일출발
[현금영수증 발급 안내 드립니다]
현금영수증은 항공요금(항공사)+행사비(랜드사)로 나눠서 발급해드립니다.
`);

    expect(facts.title).toBe('BX후쿠오카 파라다이스 골프 패키지 54H 초석 2박3일');
  });

  it('infers unlabeled flight codes from catalog schedule tables', () => {
    const facts = extractSupplierRawDeterministicFacts(`
PKG
BX나리타 치바 죠시 골프 54H 3박4일
일 자
제1일
부 산
나리타
BX112
07:50
10:00
김해 국제공항 출발
나리타 국제공항 도착
제4일
나리타
부 산
BX111
11:00
13:30
나리타 국제공항 출발
김해 국제공항 도착
`);

    expect(facts.airline).toBe('BX');
    expect(facts.outbound?.code).toBe('BX112');
    expect(facts.inbound?.code).toBe('BX111');
  });

  it('uses header flight schedule codes without treating years as flight numbers', () => {
    const raw = `
5. 부산출발 :양방향_화살표: 서안 칠채산 PKG
항공 스케줄
부산-서안 BX341 22:00/00:35+1
서안-부산 BX342 02:10/06:30
부산-서안 칠채산(황하석림/바단지린사막) 3박5일 PKG
출발날짜
2026년 수요일출발
날 짜
지 역
교통편
시 간
주 요 일 정
식 사
제1일
부 산
서 안

BX341
22:00
00:35(+1)
부산 김해 국제공항 출발
서안 도착 후 가이드 미팅
호텔 체크인 및 휴식
석:불포함
HOTEL: [서안] 홀리데인익스프레호텔 또는 동급 (4성)
제5일
서 안
부 산

BX342
02:10
06:30
서안 국제공항 출발
부산 김해 국제공항 도착
조:불포함
`;

    const facts = extractSupplierRawDeterministicFacts(raw);
    const itinerary = buildSupplierRawDeterministicItinerary(raw);
    const activityText = itinerary?.days.flatMap(day => day.schedule.map(item => item.activity)).join('\n') ?? '';

    expect(facts.outbound).toMatchObject({
      code: 'BX341',
      departure: { time: '22:00', airport: '부산' },
      arrival: { time: '00:35', airport: '서안' },
    });
    expect(facts.inbound).toMatchObject({
      code: 'BX342',
      departure: { time: '02:10', airport: '서안' },
      arrival: { time: '06:30', airport: '부산' },
    });
    expect(itinerary?.meta.flight_out).toBe('BX341');
    expect(itinerary?.meta.flight_in).toBe('BX342');
    expect(itinerary?.meta.flight_in).not.toBe('2026');
    expect((itinerary as { flight_segments?: unknown[] } | null)?.flight_segments).toHaveLength(2);
    expect(activityText).not.toMatch(/^(BX341|BX342|22:00|00:35\(\+1\)|02:10|06:30)$/m);
  });

  it('keeps pasted catalog table columns out of the customer itinerary and notices', () => {
    const rawText = readFileSync(
      join(process.cwd(), 'src/lib/product-registration/golden-corpus/fixtures/joshi-golf-menu-multiproduct.txt'),
      'utf8',
    );
    const products = recoverCatalogSplitFromRawText(rawText);
    const joshi = products.find(product => product.extractedData.title?.includes('죠시'));
    expect(joshi).toBeTruthy();

    const sectionRawText = joshi!.sectionRawText ?? '';
    const facts = extractSupplierRawDeterministicFacts(sectionRawText);
    const itinerary = buildSupplierRawDeterministicItinerary(sectionRawText);
    const scheduleText = itinerary?.days.flatMap(day => day.schedule.map(item => item.activity)).join('\n') ?? '';

    expect(facts.inclusions).toEqual(expect.arrayContaining([
      '왕복항공료(15KG)',
      '유류할증료(6월기준)',
      '호텔',
      '식사(조식,중식)',
    ]));
    expect(facts.inclusions).not.toContain('식사(조식');
    expect(facts.inclusions).not.toContain('중식)');
    expect(facts.notices.map(notice => notice.text).join('\n')).not.toContain('주 요 행 사 일 정');
    expect(facts.notices.map(notice => notice.text).join('\n')).not.toContain('제1일');

    expect(itinerary?.meta.flight_out).toBe('BX112');
    expect(itinerary?.meta.flight_in).toBe('BX111');
    expect(itinerary?.days).toHaveLength(4);
    expect(itinerary?.days[0].hotel?.name).toBe('호텔 죠시 또는 동급 (2인실-스탠다드)');
    expect(itinerary?.days[0].meals.lunch).toBe(true);
    expect(itinerary?.days[0].meals.lunch_note).toBe('클럽식');
    expect(itinerary?.days[0].meals.dinner).toBe(false);
    expect(itinerary?.days[0].meals.dinner_note).toBe('불포함');
    expect(scheduleText).not.toMatch(/^(BX112|BX111|07:50|10:00|10:55|13:15|전용차량|도보|전 일)$/m);
    expect(scheduleText).not.toMatch(/^라운딩 후$/m);
    expect(scheduleText).not.toContain('출발 2시간 전');
    expect(scheduleText).toContain('김해공항 국제선 2층 미팅 후 수속');
    expect(scheduleText).not.toContain('호텔 조식 후 체크아웃 후');
    expect(scheduleText).not.toContain('셔틀탑승');
    expect(scheduleText).toContain('라운딩 후 호텔 체크인 및 휴식');
    expect(scheduleText).toContain('호텔 조식 후 체크아웃');
    expect(scheduleText).toContain('셔틀 탑승 후 공항으로 이동 (약 1시간 소요, 현지 운전기사님 수송 후 개별 수속)');
    expect(scheduleText).not.toContain('https://www.unimat-golf.jp/choshi/hotel.html');
    expect(itinerary?.days[0].schedule).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'flight', transport: 'BX112', time: '07:50', activity: '김해 국제공항 출발' }),
      expect.objectContaining({ type: 'flight', transport: 'BX112', time: '10:00', activity: '나리타 국제공항 도착' }),
    ]));
    expect(itinerary?.days[3].schedule).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'flight', transport: 'BX111', time: '10:55', activity: '나리타 국제공항 출발' }),
      expect.objectContaining({ type: 'flight', transport: 'BX111', time: '13:15', activity: '김해 국제공항 도착' }),
    ]));
    expect((itinerary as { flight_segments?: unknown[] } | null)?.flight_segments).toHaveLength(2);

    const narita = products.find(product => product.extractedData.title?.includes('나리타노모리'));
    expect(narita).toBeTruthy();
    const naritaItinerary = buildSupplierRawDeterministicItinerary(narita!.sectionRawText ?? '');
    const naritaScheduleText = naritaItinerary?.days.flatMap(day => day.schedule.map(item => item.activity)).join('\n') ?? '';
    expect(naritaScheduleText).not.toContain('저녁 메뉴 안내');
    expect(naritaScheduleText).not.toContain('松花堂御膳');
    expect(naritaScheduleText).not.toContain('일본골프상품 취소규정');
    expect(naritaScheduleText).not.toContain('현금영수증');
    expect(naritaItinerary?.days[3].schedule).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'flight', transport: 'BX111', time: '10:55', activity: '나리타 국제공항 출발' }),
      expect.objectContaining({ type: 'flight', transport: 'BX111', time: '13:15', activity: '김해 국제공항 도착' }),
    ]));
  });

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

  it('recovers freeform local-pay option blocks without a standard optional-tour section', () => {
    const raw = `2026.05.29기준
※현지지불옵션 $50/인※
식  사: 양꼬치특식 $30, 샤브샤브특식 $30
관광지: 맥주박물관+찌모루시장+잔교 $50, 운상해천대하전망대+5.4광장야경 $50
마사지: 전신(1시간) $30, 발+전신(90분) $50
⚫강력추천옵션 택1 $50/인⚫`;

    const facts = extractSupplierRawDeterministicFacts(raw);

    expect(facts.optionalTours).toHaveLength(5);
    expect(facts.optionalTours.map(tour => tour.name)).toEqual([
      '현지지불옵션',
      '식 사: 양꼬치특식 , 샤브샤브특식',
      '관광지: 맥주박물관+찌모루시장+잔교 , 운상해천대하전망대+5.4광장야경',
      '마사지: 전신(1시간) , 발+전신(90분)',
      '강력추천옵션 택1',
    ]);
    expect(facts.optionalTours.map(tour => tour.priceLabel)).toEqual([
      '$50/인',
      '$30/인',
      '$50/인',
      '$30/인',
      '$50/인',
    ]);
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

  it('pairs Korean catalog return flights across day 4 departure and day 5 arrival', () => {
    const raw = `BX 나트랑 다이아몬드베이 골프텔 3박5일
2026.5.1
일 자
지 역
교통편
시 간
주요 행사 일정
식 사
제1일

부 산
나트랑

BX781

19:20
22:20

김해 국제공항 출발
나트랑 깜란 국제공항 도착
제2일
나트랑
전 일
호텔 조식 후 자유시간
제3일
나트랑
전 일
호텔 조식 후 자유시간
제4일
나트랑
전용차량




BX782
전 일


22:00

23:20
호텔 미팅후 / 나트랑 공항으로 이동
나트랑 깜란 국제공항 출발
제5일
부 산

06:20
김해 국제공항 도착`;

    const itinerary = buildSupplierRawDeterministicItinerary(raw);

    expect(itinerary?.flight_segments).toEqual([
      expect.objectContaining({
        leg: 'outbound',
        flight_no: 'BX781',
        dep_time: '19:20',
        arr_time: '22:20',
        arr_day_offset: 0,
        day_pair: [0, 0],
      }),
      expect.objectContaining({
        leg: 'inbound',
        flight_no: 'BX782',
        dep_time: '23:20',
        arr_time: '06:20',
        arr_day_offset: 1,
        day_pair: [3, 4],
      }),
    ]);
  });

  it('keeps Vietnamese golf cancellation appendix out of catalog itinerary days', () => {
    const raw = `BX 나트랑 다이아몬드베이 골프텔 3박5일
일 자
지 역
교통편
시 간
주    요    행   사   일   정
식 사
제1일
부 산
나트랑
BX781
19:20
22:20
김해 국제공항 출발
나트랑 깜란 국제공항 도착
HOTEL: 다이아몬드CC 골프텔 빌라동
제2일
나트랑
전용차량
전 일
호텔 조식 후
다이아몬드CC 18홀 라운딩
조:호텔식
중:불포함
석:불포함
HOTEL: 다이아몬드CC 골프텔 빌라동
제3일
나트랑
전용차량
전 일
호텔 조식 후
다이아몬드CC 18홀 라운딩
조:호텔식
중:불포함
석:불포함
HOTEL: 다이아몬드CC 골프텔 빌라동
제4일
나트랑
전용차량
BX782
전 일
23:20
호텔 조식 후
다이아몬드CC 18홀 라운딩
나트랑 깜란 국제공항 출발
조:호텔식
중:불포함
석:불포함
제5일
부 산
06:20
김해 국제공항 도착

상기 일정은 현지 사정, 천재지변으로 인해 변경될 수 있습니다.  베트남 골프상품 취소규정 안내

◎ 기간에 따른 취소 수수료 규정 안내 [특별약관적용]
[현금영수증 발급 안내 드립니다]
본 행사는 특별 약관 상품으로 상기 내용을 꼭 확인 부탁드립니다.`;

    const itinerary = buildSupplierRawDeterministicItinerary(raw);
    const scheduleText = itinerary?.days.flatMap(day => day.schedule.map(item => item.activity)).join('\n') ?? '';

    expect(itinerary?.days).toHaveLength(5);
    expect(scheduleText).toContain('김해 국제공항 도착');
    expect(scheduleText).not.toContain('베트남 골프상품 취소규정');
    expect(scheduleText).not.toContain('현금영수증');
    expect(scheduleText).not.toContain('특별 약관 상품');
  });
});
