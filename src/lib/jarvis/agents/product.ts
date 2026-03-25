// ─── PRODUCT_MODE: 도구 선언 ──────────────────────────────────────────────────

export const PRODUCT_TOOL_DECLARATIONS = [
  {
    name: 'search_packages',
    description:
      '여행 상품을 검색하거나 추천합니다. 자연어 조건(예: "4월 화요일 마카오")을 파라미터로 분리해서 전달하세요. destination=마카오, month=4, dayOfWeek=화 처럼 쪼개서 입력합니다. 날짜별 가격 요약, 랜드사, 상품 특성을 포함해 반환합니다. matched_level이 exact가 아니면 "정확한 조건은 없지만 대안 상품"임을 사용자에게 안내하세요.',
    parameters: {
      type: 'OBJECT',
      properties: {
        destination:  { type: 'STRING', description: '목적지 (예: 장가계, 일본, 몽골, 서안, 다낭, 마카오)' },
        category:     { type: 'STRING', description: 'package | golf | honeymoon | cruise | theme' },
        keyword:      { type: 'STRING', description: '검색 키워드 (예: 실속, 품격, 노팁노옵션, 3박5일)' },
        month:        { type: 'NUMBER', description: '출발 월 숫자 (1~12). 예: "4월" → 4' },
        dayOfWeek:    { type: 'STRING', description: '출발 요일 (월/화/수/목/금/토/일 중 하나)' },
        departureDate:{ type: 'STRING', description: '정확한 출발일 YYYY-MM-DD' },
        productTags:  { type: 'STRING', description: '상품 특성 필터 (예: 가족전용, 소규모, 노팁, 에어텔). 쉼표로 여러 개 가능' },
        maxPrice:     { type: 'NUMBER', description: '최대 가격 (원 단위)' },
      },
    },
  },
  {
    name: 'get_price_quote',
    description:
      '특정 상품의 출발일 기준 정확한 견적을 계산합니다. ±3일 인접 날짜 중 더 저렴한 날짜도 자동으로 함께 반환하므로, adjacent_dates 필드를 확인해 50,000원 이상 절약 가능 날짜를 사용자에게 안내하세요.',
    parameters: {
      type: 'OBJECT',
      properties: {
        packageId:     { type: 'STRING', description: '상품 UUID (search_packages에서 반환된 id)' },
        departureDate: { type: 'STRING', description: '출발일 (YYYY-MM-DD)' },
        adultCount:    { type: 'NUMBER', description: '성인 수 (기본 1)' },
        childCount:    { type: 'NUMBER', description: '아동 수 (기본 0)' },
      },
      required: ['packageId', 'departureDate'],
    },
  },
  {
    name: 'find_cheapest_dates',
    description:
      '특정 상품의 지정 기간 내 가장 저렴한 출발일 TOP 5를 반환합니다. "언제가 제일 싸요?"류 질문에 사용하세요.',
    parameters: {
      type: 'OBJECT',
      properties: {
        packageId:  { type: 'STRING', description: '상품 UUID' },
        fromDate:   { type: 'STRING', description: '검색 시작일 YYYY-MM-DD (기본: 오늘)' },
        toDate:     { type: 'STRING', description: '검색 종료일 YYYY-MM-DD (기본: 6개월 후)' },
        adultCount: { type: 'NUMBER', description: '성인 수 (기본 1)' },
      },
      required: ['packageId'],
    },
  },
  {
    name: 'generate_itinerary',
    description:
      '특정 상품의 일정표를 생성합니다. "일정표 보여줘", "몇 박 며칠이야" 등에 사용하세요.',
    parameters: {
      type: 'OBJECT',
      properties: {
        packageId:     { type: 'STRING', description: '상품 UUID' },
        departureDate: { type: 'STRING', description: '출발일 YYYY-MM-DD (선택)' },
      },
      required: ['packageId'],
    },
  },
];
