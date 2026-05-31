export const PRODUCT_REGISTRATION_REQUIRED_SCENARIOS = [
  'free_text_itinerary',
  'alternate_labels',
  'table_heavy_price',
  'multi_departure_price',
  'optional_tour_heavy',
  'ocr_noisy',
] as const;

export type ProductRegistrationScenario = typeof PRODUCT_REGISTRATION_REQUIRED_SCENARIOS[number];

export type SupplierRawGoldenFixture = {
  id: string;
  landOperator: string;
  scenarios: ProductRegistrationScenario[];
  rawText: string;
  expected: {
    title: string;
    destination: string;
    departureAirport: string;
    airline: string;
    outboundFlight: string;
    inboundFlight: string;
    departureDates: string[];
    adultPrice: number;
    childPrice: number;
    minParticipants: number;
    dayCount: number;
    optionalTourCount?: number;
    llmSkippable: boolean;
  };
};

export const TOURCOCONUT_NHA_TRANG_DALAT_RAW: SupplierRawGoldenFixture = {
  id: 'tourcoconut-nha-trang-dalat-free-text',
  landOperator: '투어코코넛',
  scenarios: ['free_text_itinerary', 'multi_departure_price'],
  rawText: `투어코코넛 나트랑/달랏 5성 3박5일 상품 안내
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
취소료는 여행약관과 항공사 규정에 따라 적용됩니다.`,
  expected: {
    title: '[RAW-GOLDEN] 나트랑/달랏 5성 3박5일',
    destination: '나트랑/달랏',
    departureAirport: '부산',
    airline: 'LJ',
    outboundFlight: 'LJ115',
    inboundFlight: 'LJ116',
    departureDates: ['2027-02-04', '2027-02-11'],
    adultPrice: 889000,
    childPrice: 889000,
    minParticipants: 6,
    dayCount: 5,
    llmSkippable: true,
  },
};

export const ALT_LABEL_PHU_QUOC_RAW: SupplierRawGoldenFixture = {
  id: 'alt-label-phu-quoc-day-format',
  landOperator: '투어코코넛',
  scenarios: ['alternate_labels', 'free_text_itinerary'],
  rawText: `행사명: [ALT-GOLDEN] 푸꾸옥 리조트 3박5일
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
현지 사정에 따라 일정 순서가 변경될 수 있습니다.`,
  expected: {
    title: '[ALT-GOLDEN] 푸꾸옥 리조트 3박5일',
    destination: '푸꾸옥 리조트',
    departureAirport: '부산',
    airline: 'LJ',
    outboundFlight: 'LJ111',
    inboundFlight: 'LJ112',
    departureDates: ['2027-03-05', '2027-03-12'],
    adultPrice: 999000,
    childPrice: 999000,
    minParticipants: 8,
    dayCount: 5,
    llmSkippable: true,
  },
};

export const TABLE_PRICE_DANANG_RAW: SupplierRawGoldenFixture = {
  id: 'table-price-danang-variant',
  landOperator: '테이블투어',
  scenarios: ['table_heavy_price', 'multi_departure_price', 'free_text_itinerary'],
  rawText: `상품명: [TABLE-GOLDEN] 다낭/호이안 4박5일
출발공항 부산 / 항공 BX 에어부산
출발편 BX773 08:30 부산 출발 11:20 다낭 도착
귀국편 BX774 12:20 다낭 출발 18:40 부산 도착
출발일자 | 성인 | 아동
2027-04-01 | 779,000원 | 729,000원
2027-04-08 | 799,000원 | 749,000원
최소출발 10명 이상

포함사항
왕복항공권, 일정표 명시 호텔, 일정표 명시 식사

불포함사항
가이드/기사 경비, 개인경비, 매너팁

1일차 부산/다낭
08:30 BX773 부산 출발
11:20 다낭 도착
호텔: 다낭 5성 호텔
식사 조X 중기내식 석현지식

2일차 다낭
09:00 바나힐 관광
호텔: 다낭 5성 호텔
식사 조호텔식 중현지식 석현지식

3일차 호이안
10:00 호이안 구시가지 관광
호텔: 다낭 5성 호텔
식사 조호텔식 중현지식 석현지식

4일차 다낭
10:00 미케비치 자유시간
호텔: 다낭 5성 호텔
식사 조호텔식 중현지식 석현지식

5일차 다낭/부산
12:20 BX774 다낭 출발
18:40 부산 도착
식사 조호텔식 중기내식 석X

공지
항공 및 현지 사정에 따라 일정 순서가 변경될 수 있습니다.`,
  expected: {
    title: '[TABLE-GOLDEN] 다낭/호이안 4박5일',
    destination: '다낭/호이안',
    departureAirport: '부산',
    airline: 'BX',
    outboundFlight: 'BX773',
    inboundFlight: 'BX774',
    departureDates: ['2027-04-01', '2027-04-08'],
    adultPrice: 779000,
    childPrice: 729000,
    minParticipants: 10,
    dayCount: 5,
    llmSkippable: true,
  },
};

export const OPTIONAL_TOUR_BANGKOK_RAW: SupplierRawGoldenFixture = {
  id: 'optional-tour-heavy-bangkok',
  landOperator: '옵션월드',
  scenarios: ['optional_tour_heavy', 'free_text_itinerary'],
  rawText: `상품명: [OPTION-GOLDEN] 방콕/파타야 3박5일
출발공항 부산 / 항공 LJ 진에어
출발편 LJ021 20:10 부산 출발 00:20 방콕 도착
귀국편 LJ022 01:30 방콕 출발 08:50 부산 도착
출발일자: 2027-05-06, 2027-05-13
최소출발 8명 이상
요금표
성인 699,000원 / 아동 649,000원

포함사항
왕복항공권, 전 일정 호텔, 일정표 명시 식사

불포함사항
가이드/기사 경비, 개인경비, 매너팁

선택관광
- 파타야 산호섬 해양스포츠 $60/인
- 알카자 쇼 $40/인
- 전통 마사지 $30/인
- 야간 시티투어 $50/인

1일차 부산/방콕
20:10 LJ021 부산 출발
00:20 방콕 도착
호텔: 방콕 4성 호텔
식사 조X 중X 석기내식

2일차 방콕/파타야
09:00 왕궁 관광
호텔: 파타야 4성 호텔
식사 조호텔식 중현지식 석현지식

3일차 파타야
10:00 농눅빌리지 관광
호텔: 파타야 4성 호텔
식사 조호텔식 중현지식 석현지식

4일차 파타야/방콕
18:00 공항 이동
01:30 LJ022 방콕 출발
식사 조호텔식 중현지식 석X

5일차 부산
08:50 부산 도착
식사 조X 중X 석X

비고
선택관광은 현지 사정에 따라 변경될 수 있습니다.`,
  expected: {
    title: '[OPTION-GOLDEN] 방콕/파타야 3박5일',
    destination: '방콕/파타야',
    departureAirport: '부산',
    airline: 'LJ',
    outboundFlight: 'LJ021',
    inboundFlight: 'LJ022',
    departureDates: ['2027-05-06', '2027-05-13'],
    adultPrice: 699000,
    childPrice: 649000,
    minParticipants: 8,
    dayCount: 5,
    optionalTourCount: 4,
    llmSkippable: true,
  },
};

export const OCR_NOISY_CEBU_RAW: SupplierRawGoldenFixture = {
  id: 'ocr-noisy-cebu',
  landOperator: '오씨알투어',
  scenarios: ['ocr_noisy', 'free_text_itinerary'],
  rawText: `상품명: [OCR-GOLDEN] 세부 리조트 3박5일
출발공항 부산 / 항공 7C 제주항공
출발편 7C2451 21:00 부산 출발 00:35 세부 도착
귀국편 7C2452 01:35 세부 출발 07:10 부산 도착
출발일자 : 2027.06.03 / 2027.06.10
최소 출발 6명 이상
요금표 성인 759,000원 / 아동 709,000원

포함사항
왕복항공권 , 리조트 숙박 , 일정표 명시 식사

불포함사항
가이드/기사 경비 , 개인경비 , 매너팁

1일차 부산/세부
21:00 7C2451 부산 출발
00:35 세부 도착
호텔: 세부 5성 리조트
식사 조X 중X 석기내식

2일차 세부
09:00 아일랜드 호핑투어
호텔: 세부 5성 리조트
식사 조호텔식 중현지식 석현지식

3일차 세부
10:00 리조트 자유시간
호텔: 세부 5성 리조트
식사 조호텔식 중자유식 석현지식

4일차 세부
18:00 공항 이동
01:35 7C2452 세부 출발
식사 조호텔식 중현지식 석X

5일차 부산
07:10 부산 도착
식사 조X 중X 석X

안내사항
OCR 추출 특성상 공백이 일부 포함될 수 있으나 원문 날짜와 항공편을 우선합니다.`,
  expected: {
    title: '[OCR-GOLDEN] 세부 리조트 3박5일',
    destination: '세부 리조트',
    departureAirport: '부산',
    airline: '7C',
    outboundFlight: '7C2451',
    inboundFlight: '7C2452',
    departureDates: ['2027-06-03', '2027-06-10'],
    adultPrice: 759000,
    childPrice: 709000,
    minParticipants: 6,
    dayCount: 5,
    llmSkippable: true,
  },
};

export const SUPPLIER_RAW_GOLDEN_FIXTURES: SupplierRawGoldenFixture[] = [
  TOURCOCONUT_NHA_TRANG_DALAT_RAW,
  ALT_LABEL_PHU_QUOC_RAW,
  TABLE_PRICE_DANANG_RAW,
  OPTIONAL_TOUR_BANGKOK_RAW,
  OCR_NOISY_CEBU_RAW,
];
