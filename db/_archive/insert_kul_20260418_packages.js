/**
 * 쿠알라룸푸르/싱가포르/말라카 상품 등록 스크립트
 * 랜드사: 투어폰 (임시) | 마진율: 9% (임시) | 발권기한: null (미정)
 * 항공: D7(에어아시아X) - 부산(김해) ↔ 쿠알라룸푸르 직항
 * 생성일: 2026-04-18
 *
 * 실행법:
 *   node db/insert_kul_20260418_packages.js            # dry-run (검증만)
 *   node db/insert_kul_20260418_packages.js --insert   # DB 등록
 *
 * Error Registry Self-check:
 *   [ERR-20260418-01] min_participants: 6 (원문 "성인 6명부터 출발 확정")
 *   [ERR-20260418-02] notices_parsed: 원문 기타 섹션 전문 보존
 *   [ERR-20260418-04] optional_tours.price: string 형식 "$XX/인"
 *   [TransportBar]    schedule type: 'transport' 미사용 → 'flight'/'normal' 사용
 *   [써차지]          surcharges: [] (원문에 기간별 써차지 없음)
 *   [accommodations]  string[] (객체 아님)
 *   [remarks]         string[] (객체 아님)
 */

const { createInserter, validatePackage } = require('./templates/insert-template');

const inserter = createInserter({
  landOperator: '투어폰',
  commissionRate: 9,
  ticketingDeadline: null,
  destCode: 'KUL',
});

const { helpers: { flight, normal, optional, shopping, meal } } = inserter;

// ══════════════════════════════════════════════════════════════════
// PKG1: 쿠알라+싱가포르+말라카 3박 5일 (월/수 출발)
// ══════════════════════════════════════════════════════════════════
const PKG1 = {
  title: '쿠알라룸푸르 싱가포르 말라카 3박 5일 — 에어아시아 직항',
  destination: '쿠알라룸푸르/싱가포르/말라카',
  country: '말레이시아',
  category: 'package',
  product_type: '실속',
  trip_style: '3박5일',
  duration: 5,
  nights: 3,
  departure_airport: '부산(김해)',
  departure_days: ['월', '수'],
  airline: 'D7(에어아시아)',
  min_participants: 6, // [ERR-20260418-01] 원문: "성인 6명부터 출발 확정"
  status: 'pending',
  price: 1249000,

  // ── 써차지: 원문에 기간별 써차지 없음 ──
  surcharges: [],
  excluded_dates: [],

  // ── 가격표 (61건) ─────────────────────────────────────────────
  price_tiers: [],
  price_dates: [
    // 1,249,000원 — ★취항특가★
    { date: '2026-06-17', price: 1249000, confirmed: false, note: '★취항특가★' },

    // 1,299,000원
    { date: '2026-06-22', price: 1299000, confirmed: false },
    { date: '2026-06-29', price: 1299000, confirmed: false },
    { date: '2026-07-06', price: 1299000, confirmed: false },
    { date: '2026-07-13', price: 1299000, confirmed: false },
    { date: '2026-09-14', price: 1299000, confirmed: false },

    // 1,349,000원
    { date: '2026-06-24', price: 1349000, confirmed: false },
    { date: '2026-07-01', price: 1349000, confirmed: false },
    { date: '2026-07-08', price: 1349000, confirmed: false },

    // 1,399,000원
    { date: '2026-07-20', price: 1399000, confirmed: false },
    { date: '2026-08-10', price: 1399000, confirmed: false },
    { date: '2026-08-17', price: 1399000, confirmed: false },
    { date: '2026-08-19', price: 1399000, confirmed: false },
    { date: '2026-08-24', price: 1399000, confirmed: false },
    { date: '2026-08-26', price: 1399000, confirmed: false },
    { date: '2026-08-31', price: 1399000, confirmed: false },
    { date: '2026-09-02', price: 1399000, confirmed: false },
    { date: '2026-09-07', price: 1399000, confirmed: false },
    { date: '2026-09-09', price: 1399000, confirmed: false },
    { date: '2026-09-16', price: 1399000, confirmed: false },
    { date: '2026-09-28', price: 1399000, confirmed: false },
    { date: '2026-09-30', price: 1399000, confirmed: false },
    { date: '2026-10-12', price: 1399000, confirmed: false },
    { date: '2026-10-14', price: 1399000, confirmed: false },
    { date: '2026-10-19', price: 1399000, confirmed: false },
    { date: '2026-10-21', price: 1399000, confirmed: false },
    { date: '2026-10-26', price: 1399000, confirmed: false },
    { date: '2026-10-28', price: 1399000, confirmed: false },
    { date: '2026-11-02', price: 1399000, confirmed: false },
    { date: '2026-11-04', price: 1399000, confirmed: false },
    { date: '2026-11-09', price: 1399000, confirmed: false },
    { date: '2026-11-11', price: 1399000, confirmed: false },
    { date: '2026-11-16', price: 1399000, confirmed: false },
    { date: '2026-11-18', price: 1399000, confirmed: false },
    { date: '2026-11-23', price: 1399000, confirmed: false },
    { date: '2026-11-25', price: 1399000, confirmed: false },

    // 1,449,000원
    { date: '2026-07-15', price: 1449000, confirmed: false },
    { date: '2026-07-22', price: 1449000, confirmed: false },
    { date: '2026-08-12', price: 1449000, confirmed: false },

    // 1,499,000원
    { date: '2026-07-27', price: 1499000, confirmed: false },
    { date: '2026-08-03', price: 1499000, confirmed: false },

    // 1,549,000원
    { date: '2026-07-29', price: 1549000, confirmed: false },
    { date: '2026-08-05', price: 1549000, confirmed: false },

    // 1,699,000원
    { date: '2026-09-21', price: 1699000, confirmed: false },
    { date: '2026-10-05', price: 1699000, confirmed: false },
    { date: '2026-10-07', price: 1699000, confirmed: false },

    // 1,999,000원
    { date: '2026-09-23', price: 1999000, confirmed: false },
  ],

  // ── 포함사항 ──────────────────────────────────────────────────
  inclusions: [
    '왕복 항공료 및 텍스',
    '유류할증료',
    '왕복 기내식',
    '수화물 20KG',
    '2억 여행자보험',
    '전일정 숙박',
    '식사 (특식 2회: 무제한 삼겹살, 순두부 정식)',
    '차량',
    '한국 가이드 & 기사비용',
    '관광지 입장료',
    '관광세',
    '쿠알라룸푸르→싱가포르 국제선 편도',
  ],

  // ── 불포함사항 ────────────────────────────────────────────────
  excludes: [
    '기사/가이드 팁 US$40/인 (성인, 아동 동일)',
    '싱글차지 19만원',
    '기타 개인경비',
    '매너팁',
    '선택관광 비용',
  ],

  // ── 숙소 (string[]) ────────────────────────────────────────────
  accommodations: [
    '포포인츠 쉐라톤 쿠알라, 윈덤 그랜드 방사르 또는 동급 (5성급) × 3박',
  ],

  // ── 셀링포인트 (고객 어필용, 운영 정보 금지) ─────────────────
  product_highlights: [
    'D7 에어아시아 부산 직항',
    '5성급 호텔 숙박 + 특식 2회 (무제한 삼겹살·순두부정식)',
    '쿠알라+싱가포르+말라카 3개 도시 동시 체험',
  ],

  product_summary: '부산에서 에어아시아 직항으로 출발하는 3박 5일. 싱가포르 머라이언·센토사섬·가든스 바이 더 베이, 말라카 세계유산 구시가지, 쿠알라룸푸르 도심 야경까지 3개 도시를 알차게 담은 실속 패키지.',

  product_tags: ['쿠알라룸푸르', '싱가포르', '말라카', '말레이시아', '에어아시아', '부산출발', '직항'],

  // ── 선택관광 (9개) ────────────────────────────────────────────
  // [ERR-20260418-04] price: string 형식 사용
  optional_tours: [
    { name: '쿠알라 야경투어 (야시장+열대과일시식+KLCC 야경사진촬영)', price: '$50/인', day: 1 },
    { name: '말라카 트라이쇼', price: '$30/인', day: 3 },
    { name: '말라카 리버보트', price: '$35/인', day: 3 },
    { name: '반딧불투어 (말라카해협 선셋, 원숭이 먹이주기, 세미씨푸드, 반딧불보트)', price: '$60/인', day: 3 },
    { name: '발마사지 (1시간)', price: '$40/인', day: 4 },
    { name: '전신마사지 (1시간)', price: '$50/인', day: 4 },
    { name: '2층버스', price: '$45/인', day: 2 },
    { name: '리버보트 (싱가포르)', price: '$45/인', day: 2 },
    { name: '스카이 파크', price: '$60/인', day: 2 },
  ],

  // ── 유의사항 (원문 기타 섹션 전문 보존) [ERR-20260418-02] ────
  notices_parsed: [
    {
      type: 'CRITICAL',
      title: '필수 확인',
      text: '• 복수여권만 출국 가능하며, 여권 만기 6개월 이상 남아 있어야 입국이 가능합니다.\n• 전자 입국신고서(말레이시아 MDAC, 싱가포르 SG카드 각각) 개별 작성 필수입니다. 대행 해드리지 않습니다.\n• 예약 후 3일 내 200,000원/인 계약금 입금 시, 좌석 확정 가능하며, 계약금은 입금 후 어떠한 사유에도 환불이 불가합니다.',
    },
    {
      type: 'INFO',
      title: '기타 안내',
      text: '• 쇼핑 2회(잡화, 초콜릿) 포함 / 선택관광 가능 조건 상품입니다.\n• 룸타입은 개런티 절대 불가합니다. (트윈 또는 더블)\n• 상기 일정은 현지 및 항공사정에 의해 변경될 수 있습니다.',
    },
  ],

  special_notes: '쇼핑센터 2회 방문 (잡화, 초콜릿) / 선택관광 가능 조건 상품',

  // ── 일정표 ────────────────────────────────────────────────────
  itinerary_data: {
    meta: {
      title: '쿠알라룸푸르 싱가포르 말라카 3박 5일 — 에어아시아 직항',
      product_type: '실속',
      destination: '쿠알라룸푸르/싱가포르/말라카',
      nights: 3,
      days: 5,
      departure_airport: '부산(김해)',
      airline: 'D7(에어아시아)',
      flight_out: 'D7 631',
      flight_in: 'D7 630',
      departure_days: ['월', '수'],
      min_participants: 6,
      room_type: '2인1실',
      ticketing_deadline: null,
      hashtags: ['#쿠알라룸푸르', '#싱가포르', '#말라카', '#에어아시아', '#부산직항'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 항공료 및 텍스',
        '유류할증료',
        '왕복 기내식',
        '수화물 20KG',
        '2억 여행자보험',
        '전일정 숙박',
        '식사 (특식 2회: 무제한 삼겹살, 순두부 정식)',
        '차량',
        '한국 가이드 & 기사비용',
        '관광지 입장료',
        '관광세',
        '쿠알라룸푸르→싱가포르 국제선 편도',
      ],
      excludes: [
        '기사/가이드 팁 US$40/인 (성인, 아동 동일)',
        '싱글차지 19만원',
        '기타 개인경비',
        '매너팁',
        '선택관광 비용',
      ],
      shopping: '쇼핑센터 2회 방문 (잡화, 초콜릿)',
      // [ERR-20260418-04] remarks: string[] (객체 아님)
      remarks: [
        '복수여권만 출국 가능, 여권 만기 6개월 이상 필요',
        '전자 입국신고서(말레이시아 MDAC, 싱가포르 SG카드) 개별 작성 필수 — 대행 불가',
        '예약 후 3일 내 200,000원/인 계약금 입금 시 좌석 확정 가능, 계약금 환불 불가',
        '룸타입 개런티 불가 (트윈 또는 더블)',
        '일정은 현지 및 항공사정에 의해 변경될 수 있습니다',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '쿠알라룸푸르'],
        meals: meal(false, true, true, null, '기내식', '현지식'),
        schedule: [
          // [TransportBar 크래시 방지] type: 'flight' 사용 (transport 금지)
          flight('11:00', 'D7 631 부산(김해) 출발 → 쿠알라룸푸르 도착 16:30', 'D7 631'),
          normal(null, '가이드 미팅'),
          optional(null, '추천선택관광: 쿠알라 야경투어 $50/인 (야시장+열대과일시식+KLCC 야경사진촬영)'),
          normal(null, '석식 후 호텔 투숙'),
          { time: null, activity: '포포인츠 쉐라톤 쿠알라 / 윈덤 그랜드 방사르 또는 동급 (5성급) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '포포인츠 쉐라톤 쿠알라 / 윈덤 그랜드 방사르 또는 동급', grade: '5성급', note: null },
      },
      {
        day: 2,
        regions: ['쿠알라룸푸르', '싱가포르', '조호바루'],
        meals: meal(true, true, true, '호텔식', '스팀보트', '페라나칸'),
        schedule: [
          normal(null, '호텔 조식 후 출발'),
          flight(null, 'AK705 쿠알라룸푸르 → 싱가포르 이동', 'AK705'),
          normal(null, '▶머라이언공원'),
          normal(null, '▶에스플러네이드 (외관)'),
          normal(null, '▶차이나타운 (싱가포르)'),
          normal(null, '▶보타닉가든'),
          normal(null, '▶센토사섬 (케이블카 편도, 실로소비치 포함)'),
          normal(null, '▶가든스 바이 더 베이 (클라우드포레스트돔+플라워돔)'),
          optional(null, '추천선택관광: 2층버스 $45/인, 리버보트 $45/인, 스카이파크 $60/인'),
          normal(null, '석식 후 조호바루 이동'),
          { time: null, activity: '포포인츠 쉐라톤 쿠알라 / 윈덤 그랜드 방사르 또는 동급 (5성급) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '포포인츠 쉐라톤 쿠알라 / 윈덤 그랜드 방사르 또는 동급', grade: '5성급', note: null },
      },
      {
        day: 3,
        regions: ['쿠알라룸푸르', '말라카'],
        meals: meal(true, true, true, '호텔식', '순두부 정식', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후 출발'),
          normal(null, '▶세인트 폴 교회'),
          normal(null, '▶산티아고 요새'),
          normal(null, '▶쳉훈텐 사원'),
          normal(null, '▶차이나타운 (말라카)'),
          normal(null, '▶스타더이스'),
          optional(null, '추천선택관광: 말라카 트라이쇼 $30/인, 리버보트 $35/인, 반딧불투어 $60/인'),
          normal(null, '석식 후 호텔 투숙'),
          { time: null, activity: '포포인츠 쉐라톤 쿠알라 / 윈덤 그랜드 방사르 또는 동급 (5성급) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '포포인츠 쉐라톤 쿠알라 / 윈덤 그랜드 방사르 또는 동급', grade: '5성급', note: null },
      },
      {
        day: 4,
        regions: ['쿠알라룸푸르'],
        meals: meal(true, true, true, '호텔식', '현지식', '무제한 삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후 출발'),
          normal(null, '▶왕궁'),
          normal(null, '▶국립 이슬람사원'),
          normal(null, '▶메르데카 광장'),
          normal(null, '▶KLCC (외관)'),
          optional(null, '추천선택관광: 발마사지 1시간 $40/인, 전신마사지 1시간 $50/인'),
          normal(null, '석식 후 공항 이동'),
          normal(null, '▶푸트라자야 야경감상'),
        ],
        // Day 4: 마지막 전날, 공항 이동으로 숙박 없음
        hotel: { name: null, grade: null, note: '공항 이동 (심야 출발)' },
      },
      {
        day: 5,
        regions: ['쿠알라룸푸르', '부산'],
        meals: meal(true, false, false, '기내식', null, null),
        schedule: [
          flight('02:00', 'D7 630 쿠알라룸푸르 출발 → 부산(김해) 도착 09:45', 'D7 630'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [
      { name: '쿠알라 야경투어 (야시장+열대과일시식+KLCC 야경사진촬영)', price: '$50/인', day: 1 },
      { name: '2층버스 (싱가포르)', price: '$45/인', day: 2 },
      { name: '리버보트 (싱가포르)', price: '$45/인', day: 2 },
      { name: '스카이 파크 (싱가포르)', price: '$60/인', day: 2 },
      { name: '말라카 트라이쇼', price: '$30/인', day: 3 },
      { name: '말라카 리버보트', price: '$35/인', day: 3 },
      { name: '반딧불투어 (말라카해협 선셋, 원숭이 먹이주기, 세미씨푸드, 반딧불보트)', price: '$60/인', day: 3 },
      { name: '발마사지 (1시간)', price: '$40/인', day: 4 },
      { name: '전신마사지 (1시간)', price: '$50/인', day: 4 },
    ],
  },

  itinerary: [
    '제1일: 부산 → 쿠알라룸푸르 (D7 631 11:00→16:30) | 가이드 미팅, 호텔 투숙',
    '제2일: 쿠알라 → 싱가포르(AK705) → 조호바루 → 쿠알라 | 머라이언, 센토사섬, 가든스 바이 더 베이',
    '제3일: 쿠알라 → 말라카 → 쿠알라 | 세인트 폴 교회, 산티아고 요새, 쳉훈텐 사원, 스타더이스',
    '제4일: 쿠알라룸푸르 시티투어 | 왕궁, 국립이슬람사원, 메르데카 광장, KLCC, 푸트라자야 야경',
    '제5일: 쿠알라룸푸르 → 부산 (D7 630 02:00→09:45)',
  ],

  raw_text: `[D7] 쿠알라룸푸르/싱가포르/말라카 3박5일
여행기간: 2026년 6월 17일부터~ (월/수 출발)
출발인원: 성인 6명부터 출발 확정

포함
왕복항공권, 텍스 및 유류할증료 (왕복 기내식 및 수화물 20KG), 2억 여행자보험
전일정 숙박, 식사, 차량, 가이드, 관광지 입장료, 한국가이드, 기사, 관광세
특식 2회 (무제한 삼겹살, 순두부 정식) // 쿠알라룸푸르→싱가포르 국제선 편도 포함

불포함
기사 가이드 팁 US$40/인 (성인, 아동 동일), 기타 개인경비, 매너팁, 선택관광 비용, 싱글차지 19만원

기타
*쇼핑 2회(잡화, 초콜릿) 포함 / 선택관광 가능 조건 상품입니다.
*전자 입국신고서(말레이시아 MDAC, 싱가포르 SG카드 각각) 개별 작성 필수입니다. 대행 해드리지 않습니다.
*복수여권만 출국 가능하며, 여권 만기 6개월 이상 남아 있어야 입국이 가능합니다.
*룸타입은 개런티 절대 불가합니다. (트윈 또는 더블)
*예약 후 3일 내 200,000원/인 계약금 입금 시, 좌석 확정 가능
 계약금은 입금 후 어떠한 사유에도 환불이 불가합니다.`,
  filename: 'kul_sin_20260418_pending.txt',
  file_type: 'manual',
  confidence: 1.0,
};

// ══════════════════════════════════════════════════════════════════
// PKG2: 쿠알라+싱가포르+말라카+겐팅 4박 6일 (금 출발)
// ══════════════════════════════════════════════════════════════════
const PKG2 = {
  title: '쿠알라룸푸르 싱가포르 말라카 겐팅 4박 6일 — 에어아시아 직항',
  destination: '쿠알라룸푸르/싱가포르/말라카',
  country: '말레이시아',
  category: 'package',
  product_type: '품격',
  trip_style: '4박6일',
  duration: 6,
  nights: 4,
  departure_airport: '부산(김해)',
  departure_days: ['금'],
  airline: 'D7(에어아시아)',
  min_participants: 6, // [ERR-20260418-01] 원문: "성인 6명부터 출발 확정"
  status: 'pending',
  price: 1399000,

  // ── 써차지: 원문에 기간별 써차지 없음 ──
  surcharges: [],
  excluded_dates: [],

  // ── 가격표 (20건) ─────────────────────────────────────────────
  price_tiers: [],
  price_dates: [
    // 1,399,000원 — ★취항특가★
    { date: '2026-06-19', price: 1399000, confirmed: false, note: '★취항특가★' },

    // 1,449,000원
    { date: '2026-06-26', price: 1449000, confirmed: false },
    { date: '2026-07-03', price: 1449000, confirmed: false },
    { date: '2026-07-10', price: 1449000, confirmed: false },
    { date: '2026-08-21', price: 1449000, confirmed: false },

    // 1,499,000원
    { date: '2026-08-14', price: 1499000, confirmed: false },

    // 1,549,000원
    { date: '2026-07-17', price: 1549000, confirmed: false },
    { date: '2026-07-24', price: 1549000, confirmed: false },
    { date: '2026-07-31', price: 1549000, confirmed: false },
    { date: '2026-08-07', price: 1549000, confirmed: false },
    { date: '2026-11-20', price: 1549000, confirmed: false },

    // 1,599,000원
    { date: '2026-08-28', price: 1599000, confirmed: false },
    { date: '2026-09-11', price: 1599000, confirmed: false },
    { date: '2026-09-25', price: 1599000, confirmed: false },
    { date: '2026-10-02', price: 1599000, confirmed: false },
    { date: '2026-10-16', price: 1599000, confirmed: false },
    { date: '2026-11-13', price: 1599000, confirmed: false },

    // 1,649,000원
    { date: '2026-09-04', price: 1649000, confirmed: false },
    { date: '2026-10-23', price: 1649000, confirmed: false },
    { date: '2026-11-06', price: 1649000, confirmed: false },

    // 1,699,000원
    { date: '2026-10-09', price: 1699000, confirmed: false },
  ],

  // ── 포함사항 (3박5일과 동일) ───────────────────────────────────
  inclusions: [
    '왕복 항공료 및 텍스',
    '유류할증료',
    '왕복 기내식',
    '수화물 20KG',
    '2억 여행자보험',
    '전일정 숙박',
    '식사 (특식 2회: 무제한 삼겹살, 순두부 정식)',
    '차량',
    '한국 가이드 & 기사비용',
    '관광지 입장료',
    '관광세',
    '쿠알라룸푸르→싱가포르 국제선 편도',
  ],

  // ── 불포함사항 (원문: 싱글차지 28만원, 팁 $50/인으로 다름) ────
  excludes: [
    '기사/가이드 팁 US$50/인 (성인, 아동 동일)',
    '싱글차지 28만원',
    '기타 개인경비',
    '매너팁',
    '선택관광 비용',
  ],

  // ── 숙소 (string[]) ────────────────────────────────────────────
  accommodations: [
    '포포인츠 쉐라톤 쿠알라, 윈덤 그랜드 방사르 또는 동급 (5성급) × 2박',
    '라마다 조호, 오조 조호바루 또는 동급 (4성급) × 1박',
    '이비스 말라카 또는 동급 (4성급) × 1박',
  ],

  // ── 셀링포인트 ────────────────────────────────────────────────
  product_highlights: [
    'D7 에어아시아 부산 직항',
    '쿠알라+싱가포르+말라카+겐팅 4개 지역 완전체',
    '겐팅 하이랜드 카지노 + 바투동굴 힌두교 성지 포함',
  ],

  product_summary: '부산에서 에어아시아 직항으로 출발하는 4박 6일. 싱가포르, 말라카, 쿠알라룸푸르에 더해 겐팅 하이랜드 스카이웨이·카지노와 바투동굴까지 품격 있게 담은 4개 지역 완전체 패키지.',

  product_tags: ['쿠알라룸푸르', '싱가포르', '말라카', '겐팅', '말레이시아', '에어아시아', '부산출발'],

  // ── 선택관광 (PKG1과 동일 9개) ────────────────────────────────
  optional_tours: [
    { name: '쿠알라 야경투어 (야시장+열대과일시식+KLCC 야경사진촬영)', price: '$50/인', day: 1 },
    { name: '말라카 트라이쇼', price: '$30/인', day: 3 },
    { name: '말라카 리버보트', price: '$35/인', day: 3 },
    { name: '반딧불투어 (말라카해협 선셋, 원숭이 먹이주기, 세미씨푸드, 반딧불보트)', price: '$60/인', day: 3 },
    { name: '발마사지 (1시간)', price: '$40/인', day: 5 },
    { name: '전신마사지 (1시간)', price: '$50/인', day: 5 },
    { name: '2층버스 (싱가포르)', price: '$45/인', day: 2 },
    { name: '리버보트 (싱가포르)', price: '$45/인', day: 2 },
    { name: '스카이 파크 (싱가포르)', price: '$60/인', day: 2 },
  ],

  // ── 유의사항 (3박5일과 동일) [ERR-20260418-02] ────────────────
  notices_parsed: [
    {
      type: 'CRITICAL',
      title: '필수 확인',
      text: '• 복수여권만 출국 가능하며, 여권 만기 6개월 이상 남아 있어야 입국이 가능합니다.\n• 전자 입국신고서(말레이시아 MDAC, 싱가포르 SG카드 각각) 개별 작성 필수입니다. 대행 해드리지 않습니다.\n• 예약 후 3일 내 200,000원/인 계약금 입금 시, 좌석 확정 가능하며, 계약금은 입금 후 어떠한 사유에도 환불이 불가합니다.',
    },
    {
      type: 'INFO',
      title: '기타 안내',
      text: '• 쇼핑 2회(잡화, 초콜릿) 포함 / 선택관광 가능 조건 상품입니다.\n• 룸타입은 개런티 절대 불가합니다. (트윈 또는 더블)\n• 상기 일정은 현지 및 항공사정에 의해 변경될 수 있습니다.',
    },
  ],

  special_notes: '쇼핑센터 2회 방문 (잡화, 초콜릿) / 선택관광 가능 조건 상품',

  // ── 일정표 ────────────────────────────────────────────────────
  itinerary_data: {
    meta: {
      title: '쿠알라룸푸르 싱가포르 말라카 겐팅 4박 6일 — 에어아시아 직항',
      product_type: '품격',
      destination: '쿠알라룸푸르/싱가포르/말라카',
      nights: 4,
      days: 6,
      departure_airport: '부산(김해)',
      airline: 'D7(에어아시아)',
      flight_out: 'D7 631',
      flight_in: 'D7 630',
      departure_days: ['금'],
      min_participants: 6,
      room_type: '2인1실',
      ticketing_deadline: null,
      hashtags: ['#쿠알라룸푸르', '#싱가포르', '#말라카', '#겐팅', '#에어아시아', '#부산직항'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 항공료 및 텍스',
        '유류할증료',
        '왕복 기내식',
        '수화물 20KG',
        '2억 여행자보험',
        '전일정 숙박',
        '식사 (특식 2회: 무제한 삼겹살, 순두부 정식)',
        '차량',
        '한국 가이드 & 기사비용',
        '관광지 입장료',
        '관광세',
        '쿠알라룸푸르→싱가포르 국제선 편도',
      ],
      excludes: [
        '기사/가이드 팁 US$50/인 (성인, 아동 동일)',
        '싱글차지 28만원',
        '기타 개인경비',
        '매너팁',
        '선택관광 비용',
      ],
      shopping: '쇼핑센터 2회 방문 (잡화, 초콜릿)',
      remarks: [
        '복수여권만 출국 가능, 여권 만기 6개월 이상 필요',
        '전자 입국신고서(말레이시아 MDAC, 싱가포르 SG카드) 개별 작성 필수 — 대행 불가',
        '예약 후 3일 내 200,000원/인 계약금 입금 시 좌석 확정 가능, 계약금 환불 불가',
        '룸타입 개런티 불가 (트윈 또는 더블)',
        '일정은 현지 및 항공사정에 의해 변경될 수 있습니다',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '쿠알라룸푸르'],
        meals: meal(false, true, true, null, '기내식', '현지식'),
        schedule: [
          flight('11:00', 'D7 631 부산(김해) 출발 → 쿠알라룸푸르 도착 16:30', 'D7 631'),
          normal(null, '가이드 미팅'),
          // ERR-KUL-03: 원문 4박6일 1일차에는 "추천선택관광: 야경투어" 항목 없음. 3박5일에서 복사된 교차 오염.
          normal(null, '석식 후 호텔 투숙'),
          { time: null, activity: '포포인츠 쉐라톤 쿠알라 / 윈덤 그랜드 방사르 또는 동급 (5성급) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '포포인츠 쉐라톤 쿠알라 / 윈덤 그랜드 방사르 또는 동급', grade: '5성급', note: null },
      },
      {
        day: 2,
        regions: ['쿠알라룸푸르', '싱가포르', '조호바루'],
        meals: meal(true, true, true, '호텔식', '스팀보트', '페라나칸'),
        schedule: [
          normal(null, '호텔 조식 후 출발'),
          flight(null, 'AK705 쿠알라룸푸르 → 싱가포르 이동', 'AK705'),
          normal(null, '▶머라이언공원'),
          normal(null, '▶에스플러네이드 (외관)'),
          normal(null, '▶차이나타운 (싱가포르)'),
          normal(null, '▶보타닉가든'),
          normal(null, '▶센토사섬 (케이블카 편도, 실로소비치 포함)'),
          normal(null, '▶가든스 바이 더 베이 (클라우드포레스트돔+플라워돔)'),
          optional(null, '추천선택관광: 2층버스 $45/인, 리버보트 $45/인, 스카이파크 $60/인'),
          normal(null, '석식 후 조호바루 이동'),
          { time: null, activity: '라마다 조호 / 오조 조호바루 또는 동급 (4성급) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '라마다 조호 / 오조 조호바루 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 3,
        regions: ['쿠알라룸푸르', '말라카'],
        meals: meal(true, true, true, '호텔식', '순두부 정식', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후 출발'),
          normal(null, '▶세인트 폴 교회'),
          normal(null, '▶산티아고 요새'),
          normal(null, '▶쳉훈텐 사원'),
          normal(null, '▶차이나타운 (말라카)'),
          normal(null, '▶스타더이스'),
          optional(null, '추천선택관광: 말라카 트라이쇼 $30/인, 리버보트 $35/인, 반딧불투어 $60/인'),
          normal(null, '석식 후 호텔 투숙'),
          { time: null, activity: '이비스 말라카 또는 동급 (4성급) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '이비스 말라카 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 4,
        regions: ['쿠알라룸푸르'],
        meals: meal(true, true, true, '호텔식', '현지식', '한식'),
        schedule: [
          normal(null, '호텔 조식 후 출발'),
          normal(null, '▶왕궁'),
          normal(null, '▶국립 이슬람사원'),
          normal(null, '▶KLCC (외관)'),
          normal(null, '석식 후 호텔 투숙'),
          { time: null, activity: '포포인츠 쉐라톤 쿠알라 / 윈덤 그랜드 방사르 또는 동급 (5성급) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '포포인츠 쉐라톤 쿠알라 / 윈덤 그랜드 방사르 또는 동급', grade: '5성급', note: null },
      },
      {
        day: 5,
        regions: ['쿠알라룸푸르', '겐팅 하이랜드'],
        meals: meal(true, true, true, '호텔식', '현지식', '무제한 삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후 출발'),
          normal(null, '▶겐팅 하이랜드 (왕복 스카이웨이 탑승)'),
          normal(null, '▶겐팅 하이랜드 카지노 체험 및 자유시간'),
          normal(null, '▶바투동굴 (힌두교 최대 성지)'),
          optional(null, '추천선택관광: 발마사지 1시간 $40/인, 전신마사지 1시간 $50/인'),
          normal(null, '석식 후 공항으로 이동'),
        ],
        hotel: { name: null, grade: null, note: '공항 이동 (심야 출발)' },
      },
      {
        day: 6,
        regions: ['쿠알라룸푸르', '부산'],
        meals: meal(true, false, false, '기내식', null, null),
        schedule: [
          flight('02:00', 'D7 630 쿠알라룸푸르 출발 → 부산(김해) 도착 09:45', 'D7 630'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [
      { name: '쿠알라 야경투어 (야시장+열대과일시식+KLCC 야경사진촬영)', price: '$50/인', day: 1 },
      { name: '2층버스 (싱가포르)', price: '$45/인', day: 2 },
      { name: '리버보트 (싱가포르)', price: '$45/인', day: 2 },
      { name: '스카이 파크 (싱가포르)', price: '$60/인', day: 2 },
      { name: '말라카 트라이쇼', price: '$30/인', day: 3 },
      { name: '말라카 리버보트', price: '$35/인', day: 3 },
      { name: '반딧불투어 (말라카해협 선셋, 원숭이 먹이주기, 세미씨푸드, 반딧불보트)', price: '$60/인', day: 3 },
      { name: '발마사지 (1시간)', price: '$40/인', day: 5 },
      { name: '전신마사지 (1시간)', price: '$50/인', day: 5 },
    ],
  },

  itinerary: [
    '제1일: 부산 → 쿠알라룸푸르 (D7 631 11:00→16:30) | 가이드 미팅, 호텔 투숙',
    '제2일: 쿠알라 → 싱가포르(AK705) → 조호바루 | 머라이언, 센토사섬, 가든스 바이 더 베이',
    '제3일: 쿠알라 → 말라카 → 쿠알라 | 세인트 폴 교회, 산티아고 요새, 쳉훈텐 사원, 스타더이스',
    '제4일: 쿠알라룸푸르 시티투어 | 왕궁, 국립이슬람사원, KLCC',
    '제5일: 겐팅 하이랜드 + 바투동굴 | 스카이웨이, 카지노 체험, 힌두교 성지',
    '제6일: 쿠알라룸푸르 → 부산 (D7 630 02:00→09:45)',
  ],

  raw_text: `[D7] 쿠알라룸푸르/싱가포르/말라카/겐팅 4박6일
여행기간: 2026년 6월 19일부터~ (금 출발)
출발인원: 성인 6명부터 출발 확정

포/불포함: 3박5일과 동일 (단, 싱글차지 28만원, 기사/가이드 팁 US$50/인)`,
  filename: 'kul_sin_20260418_pending.txt',
  file_type: 'manual',
  confidence: 1.0,
};

// ── dry-run 검증 ──────────────────────────────────────────────────
function dryRun() {
  console.log('\n=== dry-run 검증 ===\n');
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const [label, pkg] of [['PKG1 (3박5일)', PKG1], ['PKG2 (4박6일)', PKG2]]) {
    const { errors, warnings } = validatePackage(pkg);
    totalErrors += errors.length;
    totalWarnings += warnings.length;

    console.log(`[${label}]`);
    console.log(`  title:       ${pkg.title}`);
    console.log(`  destination: ${pkg.destination}`);
    console.log(`  duration:    ${pkg.nights}박 ${pkg.duration}일`);
    console.log(`  price_dates: ${pkg.price_dates.length}건`);
    console.log(`  itinerary:   ${pkg.itinerary_data.days.length}일`);
    console.log(`  optional:    ${pkg.optional_tours.length}건`);
    console.log(`  min_pax:     ${pkg.min_participants}명`);
    console.log(`  surcharges:  ${pkg.surcharges.length}건`);
    console.log(`  notices:     ${pkg.notices_parsed.length}건`);

    // 가격대별 요약
    const priceGroups = {};
    pkg.price_dates.forEach(p => {
      if (!priceGroups[p.price]) priceGroups[p.price] = [];
      priceGroups[p.price].push(p.date);
    });
    console.log('  가격대:');
    Object.entries(priceGroups).sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([price, dates]) => {
      console.log(`    ${Number(price).toLocaleString()}원: ${dates.length}개 출발일`);
    });

    if (warnings.length > 0) {
      console.log(`  경고 (${warnings.length}건):`);
      warnings.forEach(w => console.log(`    W: ${w}`));
    }
    if (errors.length > 0) {
      console.error(`  오류 (${errors.length}건):`);
      errors.forEach(e => console.error(`    E: ${e}`));
    } else {
      console.log(`  validatePackage: 오류 0건, 경고 ${warnings.length}건`);
    }
    console.log('');
  }

  if (totalErrors > 0) {
    console.error(`\n→ 오류 ${totalErrors}건 수정 후 --insert를 실행하세요.`);
    process.exit(1);
  } else {
    console.log(`\n검증 통과 — 오류 0건 (경고 ${totalWarnings}건)`);
    console.log('\n→ 실제 등록하려면:  node db/insert_kul_20260418_packages.js --insert');
  }
}

// ── 실행 분기 ────────────────────────────────────────────────────
const ALL_PACKAGES = [PKG1, PKG2];
const doInsert = process.argv.includes('--insert');

if (doInsert) {
  inserter.run(ALL_PACKAGES);
} else {
  dryRun();
}
