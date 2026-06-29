export type GoldenPasteCaseKind =
  | 'catalog_shared_price_table'
  | 'optional_tour_usd'
  | 'inbound_next_day_arrival'
  | 'multiple_departure_dates'
  | 'missing_departure_date'
  | 'hotel_tba'
  | 'airline_tba'
  | 'long_inclusions_exclusions'
  | 'shopping_option_meal_noise'
  | 'separate_cancellation_policy';

export type GoldenPasteE2ECase = {
  id: string;
  kind: GoldenPasteCaseKind;
  rawText: string;
  expected: {
    title: string;
    destination: string | null;
    dayCount: number | null;
    adultPrice: number | null;
    departureDates: string[];
    optionalPriceCandidates: Array<{ amount: number; currency: 'USD' | 'KRW' }>;
    hotelRequired: boolean;
    airlineRequired: boolean;
    packagesProofRequired: true;
    lpProofRequired: true;
    downstreamEligibilityRequiresCustomerOpenContract: true;
  };
};

const baseExpected = {
  packagesProofRequired: true,
  lpProofRequired: true,
  downstreamEligibilityRequiresCustomerOpenContract: true,
} as const;

export const GOLDEN_PASTE_E2E_CASES: GoldenPasteE2ECase[] = [
  {
    id: 'paste-001-shared-price-table',
    kind: 'catalog_shared_price_table',
    rawText: [
      '상품명: [PASTE-GOLDEN] 다낭 호이안 5일',
      '출발: 부산 / 항공: BX',
      '일정: DAY 1 부산 출발, DAY 2 다낭 관광, DAY 5 부산 도착',
      '공통 가격표',
      '7/19 599,000원',
      '8/18, 8/25 639,000원',
    ].join('\n'),
    expected: { ...baseExpected, title: '[PASTE-GOLDEN] 다낭 호이안 5일', destination: '다낭', dayCount: 5, adultPrice: 599000, departureDates: ['2026-07-19', '2026-08-18', '2026-08-25'], optionalPriceCandidates: [], hotelRequired: true, airlineRequired: true },
  },
  {
    id: 'paste-002-optional-tour-usd',
    kind: 'optional_tour_usd',
    rawText: '상품명: [PASTE-GOLDEN] 방콕 파타야 5일\n성인 699,000원\n선택관광: 전통 마사지 USD30/인, 야시장 투어 $50/인',
    expected: { ...baseExpected, title: '[PASTE-GOLDEN] 방콕 파타야 5일', destination: '방콕', dayCount: 5, adultPrice: 699000, departureDates: [], optionalPriceCandidates: [{ amount: 30, currency: 'USD' }, { amount: 50, currency: 'USD' }], hotelRequired: true, airlineRequired: false },
  },
  {
    id: 'paste-003-inbound-next-day',
    kind: 'inbound_next_day_arrival',
    rawText: '상품명: [PASTE-GOLDEN] 나트랑 3박5일\n가는편 BX781 19:20-22:20\n오는편 BX782 23:20-06:20+1 익일도착\n성인 1,099,000원',
    expected: { ...baseExpected, title: '[PASTE-GOLDEN] 나트랑 3박5일', destination: '나트랑', dayCount: 5, adultPrice: 1099000, departureDates: [], optionalPriceCandidates: [], hotelRequired: true, airlineRequired: true },
  },
  {
    id: 'paste-004-multiple-dates',
    kind: 'multiple_departure_dates',
    rawText: '상품명: [PASTE-GOLDEN] 세부 4일\n출발일 2026-09-01, 2026-09-08, 2026-09-15\n성인 759,000원 / 아동 709,000원',
    expected: { ...baseExpected, title: '[PASTE-GOLDEN] 세부 4일', destination: '세부', dayCount: 4, adultPrice: 759000, departureDates: ['2026-09-01', '2026-09-08', '2026-09-15'], optionalPriceCandidates: [], hotelRequired: true, airlineRequired: false },
  },
  {
    id: 'paste-005-missing-date',
    kind: 'missing_departure_date',
    rawText: '상품명: [PASTE-GOLDEN] 호텔 미정 다낭 5일\n출발일 미정\n성인 699,000원',
    expected: { ...baseExpected, title: '[PASTE-GOLDEN] 호텔 미정 다낭 5일', destination: '다낭', dayCount: 5, adultPrice: 699000, departureDates: [], optionalPriceCandidates: [], hotelRequired: false, airlineRequired: false },
  },
  {
    id: 'paste-006-hotel-tba',
    kind: 'hotel_tba',
    rawText: '상품명: [PASTE-GOLDEN] 푸꾸옥 5일\n호텔: 미정 또는 동급\n성인 899,000원',
    expected: { ...baseExpected, title: '[PASTE-GOLDEN] 푸꾸옥 5일', destination: '푸꾸옥', dayCount: 5, adultPrice: 899000, departureDates: [], optionalPriceCandidates: [], hotelRequired: false, airlineRequired: false },
  },
  {
    id: 'paste-007-airline-tba',
    kind: 'airline_tba',
    rawText: '상품명: [PASTE-GOLDEN] 오사카 3일\n항공: 미정\n성인 599,000원',
    expected: { ...baseExpected, title: '[PASTE-GOLDEN] 오사카 3일', destination: '오사카', dayCount: 3, adultPrice: 599000, departureDates: [], optionalPriceCandidates: [], hotelRequired: true, airlineRequired: false },
  },
  {
    id: 'paste-008-long-terms',
    kind: 'long_inclusions_exclusions',
    rawText: '상품명: [PASTE-GOLDEN] 백두산 4일\n포함: 왕복항공권, 호텔, 일정표상 식사, 차량, 입장료\n불포함: 기사/가이드 경비, 개인경비, 매너팁, 선택관광, 싱글차지\n성인 859,000원',
    expected: { ...baseExpected, title: '[PASTE-GOLDEN] 백두산 4일', destination: '백두산', dayCount: 4, adultPrice: 859000, departureDates: [], optionalPriceCandidates: [], hotelRequired: true, airlineRequired: false },
  },
  {
    id: 'paste-009-noise',
    kind: 'shopping_option_meal_noise',
    rawText: '상품명: [PASTE-GOLDEN] 장가계 5일\n쇼핑센터 2회, 조식 후 이동, 선택관광 USD60, 중식 후 천문산 관광\n성인 799,000원',
    expected: { ...baseExpected, title: '[PASTE-GOLDEN] 장가계 5일', destination: '장가계', dayCount: 5, adultPrice: 799000, departureDates: [], optionalPriceCandidates: [{ amount: 60, currency: 'USD' }], hotelRequired: true, airlineRequired: false },
  },
  {
    id: 'paste-010-cancel-policy',
    kind: 'separate_cancellation_policy',
    rawText: '상품명: [PASTE-GOLDEN] 대만 4일\n성인 699,000원\n취소규정\n출발 30일 전 취소 수수료 없음\n출발 7일 전부터 여행약관에 따름',
    expected: { ...baseExpected, title: '[PASTE-GOLDEN] 대만 4일', destination: '대만', dayCount: 4, adultPrice: 699000, departureDates: [], optionalPriceCandidates: [], hotelRequired: true, airlineRequired: false },
  },
];
