// ─── BOOKING_MODE: 도구 선언 ──────────────────────────────────────────────────

export const BOOKING_TOOL_DECLARATIONS = [
  {
    name: 'find_customer',
    description: '이름 또는 전화번호로 기존 고객을 검색합니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name:  { type: 'STRING', description: '고객 이름' },
        phone: { type: 'STRING', description: '전화번호 (선택)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_customer',
    description: '신규 고객을 등록합니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name:            { type: 'STRING', description: '고객 이름 (필수)' },
        phone:           { type: 'STRING', description: '전화번호' },
        passportExpiry:  { type: 'STRING', description: '여권 만료일 (YYYY-MM-DD)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_booking',
    description:
      '새 예약을 생성합니다. 고객 ID가 필요하므로 find_customer 또는 create_customer를 먼저 호출하세요. 가격이 있다면 get_price_quote로 먼저 확인하세요.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customerId:    { type: 'STRING', description: '고객 UUID' },
        packageId:     { type: 'STRING', description: '상품 UUID (있으면 입력)' },
        packageTitle:  { type: 'STRING', description: '상품명 또는 목적지' },
        departureDate: { type: 'STRING', description: '출발일 (YYYY-MM-DD)' },
        adultCount:    { type: 'NUMBER', description: '성인 인원 수 (기본 1)' },
        childCount:    { type: 'NUMBER', description: '아동 인원 수 (기본 0)' },
        pricePerAdult: { type: 'NUMBER', description: '성인 1인 가격 (원)' },
        pricePerChild: { type: 'NUMBER', description: '아동 1인 가격 (원, 없으면 성인가와 동일)' },
        status:        { type: 'STRING', description: '예약 상태. 상담중(기본) | pending | 가계약 | confirmed' },
        notes:         { type: 'STRING', description: '메모 (선택)' },
        paidAmount:    { type: 'NUMBER', description: '현재까지 입금된 금액 (원). 없으면 0.' },
        companions: {
          type: 'ARRAY',
          description: '대표자 외 동반자 명단. 이름만 필수, 여권정보 있으면 함께 입력.',
          items: {
            type: 'OBJECT',
            properties: {
              name:            { type: 'STRING', description: '동반자 이름' },
              phone:           { type: 'STRING', description: '연락처 (선택)' },
              passport_no:     { type: 'STRING', description: '여권번호 (선택)' },
              passport_expiry: { type: 'STRING', description: '여권만료일 YYYY-MM-DD (선택)' },
            },
            required: ['name'],
          },
        },
      },
      required: ['customerId'],
    },
  },
  {
    name: 'get_bookings',
    description: '예약 목록을 조회합니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        status:     { type: 'STRING', description: 'pending | confirmed | completed | cancelled | all' },
        customerId: { type: 'STRING', description: '특정 고객의 예약만 조회' },
        limit:      { type: 'NUMBER', description: '최대 조회 수 (기본 10)' },
      },
    },
  },
  {
    name: 'update_booking',
    description: '예약 상태를 변경합니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        bookingId: { type: 'STRING', description: '예약 UUID' },
        status:    { type: 'STRING', description: 'confirmed | completed | cancelled' },
      },
      required: ['bookingId', 'status'],
    },
  },
  {
    name: 'delete_booking',
    description:
      '예약을 휴지통으로 이동합니다 (소프트 삭제). 실수로 삭제해도 관리자 화면에서 복구 가능합니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        bookingId: { type: 'STRING', description: '삭제할 예약의 UUID' },
        reason:    { type: 'STRING', description: '삭제 사유 (선택, 메모에 기록됩니다)' },
      },
      required: ['bookingId'],
    },
  },
  {
    name: 'get_price_quote',
    description:
      '특정 상품의 출발일 기준 정확한 견적을 계산합니다. 예약 생성 전 가격 확인용.',
    parameters: {
      type: 'OBJECT',
      properties: {
        packageId:     { type: 'STRING', description: '상품 UUID' },
        departureDate: { type: 'STRING', description: '출발일 (YYYY-MM-DD)' },
        adultCount:    { type: 'NUMBER', description: '성인 수 (기본 1)' },
        childCount:    { type: 'NUMBER', description: '아동 수 (기본 0)' },
      },
      required: ['packageId', 'departureDate'],
    },
  },
];
