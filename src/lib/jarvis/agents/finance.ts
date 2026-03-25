// ─── FINANCE_MODE: 도구 선언 ──────────────────────────────────────────────────

export const FINANCE_TOOL_DECLARATIONS = [
  {
    name: 'get_booking_stats',
    description:
      '이번 달 예약 재무 통계를 조회합니다. 총 판매가, 입금 완료액, 미수금(잔금), 진행 중 예약 수 등을 반환합니다.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'bulk_process_reservations',
    description:
      '2건 이상의 고객 등록 및 예약을 한 번에 일괄 처리합니다. 사용자가 표나 목록 형태로 다수의 예약 데이터를 입력하면 반드시 이 도구를 사용하세요. 개별 find_customer/create_booking 호출 금지.',
    parameters: {
      type: 'OBJECT',
      properties: {
        items: {
          type: 'ARRAY',
          description: '처리할 예약 목록',
          items: {
            type: 'OBJECT',
            properties: {
              date:        { type: 'STRING', description: '출발일. YYYY-MM-DD 또는 "2026년 3월 14일" 형식 모두 가능.' },
              name:        { type: 'STRING', description: '고객명 (필수)' },
              destination: { type: 'STRING', description: '목적지 또는 상품명' },
              status:      { type: 'STRING', description: '예약 상태 (기본: 상담중)' },
              agency:      { type: 'STRING', description: '랜드사명' },
            },
            required: ['name'],
          },
        },
      },
      required: ['items'],
    },
  },
];
