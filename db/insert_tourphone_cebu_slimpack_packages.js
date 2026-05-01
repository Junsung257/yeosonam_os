/**
 * 부산-세부 프로모션 특가 슬림팩 5일 — 3개 호텔 변형
 *   1) 알테라 OR 티샤인 (동일 가격, 호텔 선택 가능)
 *   2) 솔레아
 *   3) 두짓타니
 * 랜드사: 투어폰 (10%)
 * 항공: BX(에어부산) 부산(김해)–세부 직항 (BX711 / BX712)
 *
 * 출발일: 5/2, 5/23, 6/2, 6/3, 7/15, 7/16, 8/13, 8/14
 *   - 화요일 출발(6/2) 은 항공시간 다름: 19:50 → 00:50 (vs 평일 21:10 → 00:35)
 */

const fs = require('fs');
const path = require('path');
const { createInserter } = require('./templates/insert-template');

const RAW_TEXT = fs.readFileSync(
  path.join(__dirname, '..', 'scratch', 'cebu-tourphone-slimpack-raw.txt'),
  'utf-8',
);

const inserter = createInserter({
  landOperator: '투어폰',
  commissionRate: 10,
  ticketingDeadline: null,
  destCode: 'CEB',
});
const { helpers: { flight, normal, optional, shopping, meal } } = inserter;

// ── 공용 데이터 ───────────────────────────────────────────
// 원문에 명시된 항목만 inclusions 로 (Zero-Hallucination)
const INCLUSIONS = [
  '왕복 항공료 (BX711 / BX712)',
  '숙박 (예약호텔 / 리조트)',
  '일정상 식사',
  '가이드',
  '차량 (공항 ↔ 리조트 전용차량 / 일정 중 현지차량)',
  '스쿠버다이빙 강습',
  '세부 디스커버리 투어 (재래시장, 열대과일 상점방문)',
  '막탄 시내관광 (막탄슈라인, 막탄 산토리니 성당)',
];

// 원문 식사 컬럼·옵션 표기에서 도출한 불포함만 (Zero-Hallucination)
const EXCLUDES = [
  '석식 2회 (제1일 석식, 제3일 석식, 제4일 석식)',
  '중식 1회 (제3일 중식)',
  '조식 1회 (제5일 조식)',
  '아일랜드 호핑투어 (선택관광 1인 $80, 선포함시 5만원)',
  '이트래블 QR코드 발급 (대행 불가, 고객 직접 발급)',
];

const SHOPPING_TEXT = '쇼핑 3회 (필리핀 기념품 및 토산품)';

const OPTIONAL_TOURS = [
  {
    name: '아일랜드 호핑투어',
    price_usd: 80,
    price_krw: 50000,
    price: '$80',
    note: '스노클링 + 바다낚시 + 중식BBQ 포함 / 선포함시 1인 5만원 (스노클링 장비, 구명조끼렌탈피 포함)',
    region: '세부',
  },
];

const COMMON_NOTICES = [
  { type: 'CRITICAL', title: '여권 유효기간', text: '여권 유효기간은 입국일 기준 6개월 이상 남아 있어야 합니다.' },
  { type: 'CRITICAL', title: '이트래블 QR코드', text: '필리핀 입국 시 이트래블 QR코드(https://etravel.gov.ph) 발급 필수입니다. 대행 해드리지 않으니 고객님께서 직접 발급 받아주셔야 합니다.' },
  { type: 'CRITICAL', title: '미성년자 입국 조건', text: '어린이 만 15세 미만 입국 시 — 엄마만 동반 시 영문주민등록등본 / 부모 미동반 시 필리핀 대사관 공증 필요합니다.' },
  { type: 'POLICY', title: '단체관광 원칙', text: '본 상품은 순수한 단체관광을 목적으로 한 패키지상품으로 여행 기간 중 개별적인 일정(친지방문, 미계약업체조인)이 불가하며, 만약 개별일정 진행 시에는 일정상 포함된 식사·특전·샌딩 서비스 등이 제공되지 않습니다. 개별일정 진행 중에 발생된 사고에 대하여는 당사에 책임이 없음을 알려드립니다.' },
  { type: 'INFO', title: '차량 안내', text: '공항 ↔ 리조트 이동 시에는 전용차량(벤 또는 버스)으로 진행되며, 일정 중 이동 시에는 현지차량(멀티캡 또는 지프니)으로 진행됩니다.' },
  { type: 'INFO', title: '수하물 보관', text: '필리핀 공항에서 승객들의 짐 도난방지를 위해 수하물 대조 검사 진행됩니다. 수하물표를 꼭 챙겨서 보관 하셔야 합니다.' },
  { type: 'INFO', title: '가이드 미팅', text: '세부공항 오른쪽으로 나오시면 가이드가 피켓을 들고 대기합니다.' },
];

const REMARKS = [
  '여권 유효기간 6개월 이상 필수',
  '이트래블 QR코드(etravel.gov.ph) 직접 발급 (대행 불가)',
  '만 15세 미만 입국 시 영문주민등록등본 또는 필리핀 대사관 공증 필요',
  '개별일정 진행 시 식사·특전·샌딩 미제공',
  '공항 ↔ 리조트 전용차량 / 일정 중 현지차량(멀티캡·지프니)',
  '필리핀 공항 수하물 대조 검사 (수하물표 보관 필수)',
  '화요일 출발(6/2)은 부산 출발 19:50 → 세부 도착 00:50 (다른 출발일은 21:10 → 00:35)',
];

// ── 항공편 ────────────────────────────────────────────────
// 평일 출발 (BX711 21:10 → 00:35) 기준. 화요일 출발은 remarks 로 안내.
const OUTBOUND_FLIGHT = flight(
  '21:10',
  '김해 국제공항 출발 → 세부 공항 도착 00:35',
  'BX711',
);
const INBOUND_FLIGHT = flight(
  '01:30',
  '세부 공항 출발 → 김해 국제공항 도착 07:00',
  'BX712',
);

// ── 일정 빌더 ─────────────────────────────────────────────
function makeDays(hotelObj) {
  return [
    {
      day: 1,
      regions: ['부산', '세부'],
      meals: meal(false, false, false, null, null, null),
      schedule: [
        OUTBOUND_FLIGHT,
        normal(null, '세부공항 도착 후 가이드 미팅 (공항 오른쪽 출구에서 피켓 대기)'),
        normal(null, '리조트 이동 후 체크인 및 휴식'),
      ],
      hotel: hotelObj,
    },
    {
      day: 2,
      regions: ['세부'],
      meals: meal(true, true, true, '리조트식', '현지식', '현지식'),
      schedule: [
        normal(null, '리조트 조식 후 일정 시작'),
        normal(null, '◈ 해양스포츠 체험 — 스쿠버다이빙 강습'),
        normal(null, '▶세부 디스커버리 투어 (재래시장·열대과일 상점방문)'),
        normal(null, '리조트 투숙 및 자유시간'),
      ],
      hotel: hotelObj,
    },
    {
      day: 3,
      regions: ['세부'],
      meals: meal(true, false, false, '리조트식', null, null),
      schedule: [
        normal(null, '리조트 조식 후 자유시간'),
        optional(null, '▶아일랜드 호핑투어 (스노클링 + 바다낚시 + 중식BBQ)'),
        normal(null, '리조트 투숙 및 자유시간'),
      ],
      hotel: hotelObj,
    },
    {
      day: 4,
      regions: ['세부'],
      meals: meal(true, true, false, '리조트식', '현지식', null),
      schedule: [
        normal(null, '리조트 조식 후 리조트 체크아웃'),
        normal(null, '가이드 미팅 후 일정 진행'),
        normal(null, '▶막탄 시내관광 (막탄슈라인·막탄 산토리니 성당)'),
        shopping(null, '필리핀 기념품 및 토산품 관광 (쇼핑 3회)'),
        normal(null, '세부공항으로 이동'),
      ],
      hotel: { name: null, grade: null, note: '오버나잇 플라이트' },
    },
    {
      day: 5,
      regions: ['세부', '부산'],
      meals: meal(false, false, false, null, null, null),
      schedule: [
        INBOUND_FLIGHT,
        normal(null, '김해 국제공항 도착 후 해산 (즐거운 여행 되셨기를 바랍니다)'),
      ],
      hotel: null,
    },
  ];
}

const DEPARTURE_DATES_ALL = [
  '2026-05-02',
  '2026-05-23',
  '2026-06-02',
  '2026-06-03',
  '2026-07-15',
  '2026-07-16',
  '2026-08-13',
  '2026-08-14',
];

// ── 가격 tier 빌더 ────────────────────────────────────────
function makeTiers(p_may, p_jun, p_jul_aug) {
  return [
    {
      period_label: '5/2·5/23 출발 (특가)',
      departure_dates: ['2026-05-02', '2026-05-23'],
      adult_price: p_may, status: 'available', note: '특가',
    },
    {
      period_label: '6/2·6/3 출발 (특가)',
      departure_dates: ['2026-06-02', '2026-06-03'],
      adult_price: p_jun, status: 'available', note: '특가 (6/2 화요일 출발은 19:50 → 00:50)',
    },
    {
      period_label: '7/15·7/16·8/13·8/14 출발',
      departure_dates: ['2026-07-15', '2026-07-16', '2026-08-13', '2026-08-14'],
      adult_price: p_jul_aug, status: 'available', note: '여름 시즌',
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// PKG 1) 알테라 OR 티샤인 (동일 가격)
// ─────────────────────────────────────────────────────────────
const HOTEL_ALT_TIS = { name: '알테라 OR 티샤인', grade: '리조트', note: '두 호텔 중 선택' };

const PKG_ALT_TIS = {
  title: 'BX 부산-세부 슬림팩 5일 (알테라 OR 티샤인)',
  destination: '세부', country: '필리핀', category: 'package',
  product_type: '슬림', trip_style: '3박5일',
  duration: 5, nights: 3,
  departure_airport: '부산(김해)', airline: 'BX(에어부산)',
  departure_days: '화/수/목/금/토',
  min_participants: null, status: 'pending',
  price: 479900,
  guide_tip: null, single_supplement: null, small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  price_tiers: makeTiers(539900, 479900, 729900),
  inclusions: INCLUSIONS,
  excludes: EXCLUDES,
  optional_tours: OPTIONAL_TOURS,
  accommodations: ['알테라 OR 티샤인 (예약호텔/리조트)'],
  product_highlights: [
    '알테라 OR 티샤인 리조트 중 선택 가능',
    '부산 김해 직항 (BX 에어부산)',
    '스쿠버다이빙 강습 + 디스커버리 투어 포함',
  ],
  product_summary: '부산에서 직항으로 세부까지 편하게 가시는 슬림팩 5일이에요. 알테라 또는 티샤인 두 리조트 중 원하시는 곳으로 골라서 묵으실 수 있고, 두 호텔 모두 같은 가격이라 부담이 적습니다. 스쿠버다이빙 강습과 디스커버리 투어가 기본 포함이라 첫 세부 여행으로도 잘 어울립니다.',
  product_tags: ['#세부', '#부산출발', '#직항', '#슬림팩', '#알테라', '#티샤인'],
  notices_parsed: COMMON_NOTICES,
  customer_notes: null,
  internal_notes: '알테라/티샤인 추가 써차지 (참고용 — 현재 출발일 범위 밖):\n- 알테라 소토그란테: HOLY WEEK~GOLDEN WEEK $10 (추후인폼) / SUMMER SEASON~OBON 추후인폼 / 9/23-27, 10/31-11/2, 12/21-1/5 $10 / 갈라디너: 12/24, 12/31 성인$30·소아$15\n- 티샤인: 추후인폼 / 추후인폼 / 9/23-27, 10/31-11/2, 12/21-1/5 $10 / 갈라디너: 12/24, 12/31 성인$30·소아$15\n\n[랜드사: 투어폰 / 마진율 10% / 발권기한: 미설정]',
  itinerary_data: {
    meta: {
      title: 'BX 부산-세부 슬림팩 5일 (알테라 OR 티샤인)',
      product_type: '슬림', destination: '세부', nights: 3, days: 5,
      departure_airport: '부산(김해)', airline: 'BX(에어부산)',
      flight_out: 'BX711', flight_in: 'BX712',
      departure_days: '화/수/목/금/토', min_participants: null, room_type: '2인1실',
      ticketing_deadline: null, hashtags: ['#세부', '#부산출발', '#슬림팩'], brand: '여소남',
    },
    highlights: {
      inclusions: INCLUSIONS,
      excludes: EXCLUDES,
      shopping: SHOPPING_TEXT,
      remarks: REMARKS,
    },
    days: makeDays(HOTEL_ALT_TIS),
    optional_tours: OPTIONAL_TOURS,
  },
  itinerary: [
    '제1일: 김해 21:10 출발(BX711) → 세부 00:35 도착 → 리조트 체크인 및 휴식 (※ 화요일 출발은 19:50→00:50)',
    '제2일: 리조트 조식 후 스쿠버다이빙 강습 + 세부 디스커버리 투어(재래시장·열대과일) → 자유시간',
    '제3일: 리조트 조식 후 자유시간 — 추천 선택관광 아일랜드 호핑투어 ($80 또는 5만원 선포함)',
    '제4일: 리조트 조식 후 체크아웃 → 막탄 시내관광(막탄슈라인·산토리니 성당) → 쇼핑 3회 → 세부공항 이동',
    '제5일: 세부 01:30 출발(BX712) → 김해 07:00 도착',
  ],
  raw_text: RAW_TEXT,
  filename: 'cebu-tourphone-slimpack-raw.txt',
  file_type: 'manual',
  confidence: 0.95,
  agent_audit_report: {
    parser_version: 'register-v2026.04.21-sonnet-4.6',
    ran_at: new Date().toISOString(),
    claims: [
      { id: 'flight_out', field: 'itinerary_data.meta.flight_out', severity: 'HIGH', text: 'BX711', evidence: '원문: "BX711 21:10 - 00:30" 및 Day1 표 "BX711 21:10 00:35"', supported: true },
      { id: 'flight_in', field: 'itinerary_data.meta.flight_in', severity: 'HIGH', text: 'BX712', evidence: '원문: "BX712 01:30 – 06:55" 및 Day5 표 "BX712 01:30 07:00"', supported: true },
      { id: 'tuesday_flight', field: 'remarks', severity: 'HIGH', text: '화요일 출발 시 19:50 → 00:50', evidence: '원문: "(화요일출발: 19:50 - 00:05)" 및 Day1 표 "화출발 19:50 00:50"', supported: true, note: '헤더 00:05 vs Day1 표 00:50 불일치 — 더 상세한 Day1 표 시간(00:50) 채택 (기존 솔레아 product 와도 일관됨)' },
      { id: 'price_may', field: 'price_tiers', severity: 'HIGH', text: '5/2, 5/23 알테라/티샤인 539,900', evidence: '원문 가격표: "5/2, 23 / 539,900 / 539,900 / 779,900" → 알테라/티샤인 539,900', supported: true },
      { id: 'price_jun', field: 'price_tiers', severity: 'HIGH', text: '6/2, 6/3 알테라/티샤인 479,900', evidence: '원문: "6/2, 3 / 479,900 / 479,900 / 699,900"', supported: true },
      { id: 'price_summer', field: 'price_tiers', severity: 'HIGH', text: '7/15-16, 8/13-14 알테라/티샤인 729,900', evidence: '원문: "7/15,16 / 8/13,14 / 729,900 / 749,900 / 949,900"', supported: true },
      { id: 'optional_hopping', field: 'optional_tours', severity: 'HIGH', text: '아일랜드 호핑투어 $80 / 5만원 선포함', evidence: '원문: "아일랜드 호핑투어 : 스노클링 + 바다낚시 + 중식BBQ /1인 $80 / 선포함시 1인 5만원"', supported: true },
      { id: 'shopping_3', field: 'highlights.shopping', severity: 'HIGH', text: '쇼핑 3회', evidence: '원문 Day4: "필리핀 기념품 및 토산품 관광 (쇼핑 3회)"', supported: true },
      { id: 'inclusions_no_insurance', field: 'inclusions', severity: 'CRITICAL', text: '여행자보험·TAX·유류할증료 미포함', evidence: '원문에 포함내역 섹션 없음 — Zero-Hallucination 에 따라 명시되지 않은 항목 추가 안 함', supported: true, note: '솔레아 archived 상품에는 있었으나, 본 원문에는 명시 없음. 운영 표준이 동일하더라도 임의 주입 금지.' },
      { id: 'min_participants_null', field: 'min_participants', severity: 'HIGH', text: 'min_participants=null', evidence: '원문에 "N명 이상" 표기 없음', supported: true },
      { id: 'surcharges_empty', field: 'surcharges', severity: 'HIGH', text: 'surcharges=[]', evidence: '원문 알테라/티샤인 써차지: HOLY WEEK~GOLDEN WEEK 추후인폼 / SUMMER SEASON 추후인폼 / 9-12월 가을·겨울 시즌만 명시', supported: true, note: '본 상품 출발일(5-8월) 범위에 명확히 적용되는 써차지가 없음 (모두 추후인폼). internal_notes 에 보존.' },
    ],
    overall_verdict: 'clean',
    unsupported_critical: 0,
    unsupported_high: 0,
  },
};

// ─────────────────────────────────────────────────────────────
// PKG 2) 솔레아
// ─────────────────────────────────────────────────────────────
const HOTEL_SOLEA = { name: '솔레아', grade: '리조트', note: null };

const PKG_SOLEA = {
  ...PKG_ALT_TIS,
  title: 'BX 부산-세부 슬림팩 5일 (솔레아)',
  price: 479900,
  // 솔레아: 알테라/티샤인과 May/Jun 동일, Jul-Aug 만 +20,000원
  price_tiers: makeTiers(539900, 479900, 749900),
  // 솔레아 써차지: 4/29-5/7 $30 (5/2 출발 적용), 8/12-8/17 $50 (8/13, 8/14 출발 적용)
  surcharges: [
    {
      name: '솔레아 골든위크 추가요금',
      start: '2026-04-29', end: '2026-05-07',
      amount: 30, currency: 'USD', unit: '룸/박',
    },
    {
      name: '솔레아 OBON 추가요금',
      start: '2026-08-12', end: '2026-08-17',
      amount: 50, currency: 'USD', unit: '룸/박',
    },
  ],
  accommodations: ['솔레아 (예약호텔/리조트)'],
  product_highlights: [
    '솔레아 리조트 3박 투숙',
    '부산 김해 직항 (BX 에어부산)',
    '스쿠버다이빙 강습 + 디스커버리 투어 포함',
  ],
  product_summary: '부산-세부 직항으로 솔레아 리조트에 3박 머무시는 슬림팩 5일이에요. 5월·6월은 특가로 부담 없는 가격이고, 7-8월 성수기는 약간 올라가지만 골든위크(4/29~5/7)와 OBON(8/12~8/17) 기간은 추가요금이 있으니 출발일 잡으실 때 한 번 더 챙겨드릴게요.',
  product_tags: ['#세부', '#부산출발', '#직항', '#슬림팩', '#솔레아'],
  internal_notes: '솔레아 추가 써차지 참고:\n- 3/29-4/4 $50 (HOLY WEEK) — 본 상품 출발일 범위 밖\n- 4/29-5/7 $30 (GOLDEN WEEK 추가) → 5/2 출발 적용 (surcharges 반영)\n- 8/12-8/17 $50 (OBON) → 8/13, 8/14 출발 적용 (surcharges 반영)\n- 9/23-27, 11/1-2 $50 (CHUSEOK & HALLOWEEN) — 본 상품 출발일 범위 밖\n- 비리조트 4/2 $20 / 9/25-27 $20 — 별개 객실 카테고리\n\n[랜드사: 투어폰 / 마진율 10% / 발권기한: 미설정]',
  itinerary_data: {
    ...PKG_ALT_TIS.itinerary_data,
    meta: {
      ...PKG_ALT_TIS.itinerary_data.meta,
      title: 'BX 부산-세부 슬림팩 5일 (솔레아)',
    },
    days: makeDays(HOTEL_SOLEA),
  },
  agent_audit_report: {
    parser_version: 'register-v2026.04.21-sonnet-4.6',
    ran_at: new Date().toISOString(),
    claims: [
      { id: 'price_may_solea', field: 'price_tiers', severity: 'HIGH', text: '5/2, 5/23 솔레아 539,900', evidence: '원문: "5/2, 23 / 539,900 / 539,900 / 779,900" — 두 번째 컬럼(솔레아) = 539,900', supported: true },
      { id: 'price_jun_solea', field: 'price_tiers', severity: 'HIGH', text: '6/2, 6/3 솔레아 479,900', evidence: '원문: "6/2, 3 / 479,900 / 479,900 / 699,900" — 두 번째 컬럼 = 479,900', supported: true },
      { id: 'price_summer_solea', field: 'price_tiers', severity: 'HIGH', text: '7-8월 솔레아 749,900', evidence: '원문: "7/15,16 / 8/13,14 / 729,900 / 749,900 / 949,900" — 두 번째 컬럼 = 749,900', supported: true },
      { id: 'surcharge_golden_week', field: 'surcharges', severity: 'HIGH', text: '솔레아 4/29-5/7 $30 골든위크', evidence: '원문 솔레아 행: "4/29-5/7 $30"', supported: true },
      { id: 'surcharge_obon', field: 'surcharges', severity: 'HIGH', text: '솔레아 8/12-8/17 $50 OBON', evidence: '원문 솔레아 행 SUMMER SEASON 컬럼: "8/12-8/17 $50"', supported: true },
      { id: 'surcharge_holyweek_excluded', field: 'surcharges', severity: 'HIGH', text: '3/29-4/4 $50 미반영', evidence: '본 상품 출발일 범위(5-8월) 밖이므로 surcharges 미포함, internal_notes 에 보존', supported: true },
      { id: 'flight_out', field: 'itinerary_data.meta.flight_out', severity: 'HIGH', text: 'BX711', evidence: '원문: "BX711 21:10 - 00:30"', supported: true },
      { id: 'flight_in', field: 'itinerary_data.meta.flight_in', severity: 'HIGH', text: 'BX712', evidence: '원문: "BX712 01:30 – 06:55"', supported: true },
      { id: 'shopping_3', field: 'highlights.shopping', severity: 'HIGH', text: '쇼핑 3회', evidence: '원문 Day4: "쇼핑 3회"', supported: true },
    ],
    overall_verdict: 'clean',
    unsupported_critical: 0,
    unsupported_high: 0,
  },
};

// ─────────────────────────────────────────────────────────────
// PKG 3) 두짓타니
// ─────────────────────────────────────────────────────────────
const HOTEL_DUSIT = { name: '두짓타니', grade: '5성급 리조트', note: null };

const PKG_DUSIT = {
  ...PKG_ALT_TIS,
  title: 'BX 부산-세부 슬림팩 5일 (두짓타니)',
  price: 699900,
  price_tiers: makeTiers(779900, 699900, 949900),
  surcharges: [],
  accommodations: ['두짓타니 (예약호텔/리조트)'],
  product_highlights: [
    '두짓타니 5성급 리조트 3박 투숙',
    '부산 김해 직항 (BX 에어부산)',
    '스쿠버다이빙 강습 + 디스커버리 투어 포함',
  ],
  product_summary: '두짓타니 5성급 리조트에서 묵으시는 부산-세부 직항 슬림팩 5일이에요. 같은 일정이지만 호텔 등급이 한 단계 위라 가족·기념일 여행으로도 만족도가 높습니다. 5-8월 출발 모두 본 가격 그대로 진행되니 편하게 보세요.',
  product_tags: ['#세부', '#부산출발', '#직항', '#슬림팩', '#두짓타니', '#5성급'],
  internal_notes: '두짓타니 추가 써차지 참고 (모두 본 상품 출발일 범위 밖):\n- 12/28~27.01.02 $100\n- 27.02.05~02.07 $100\n- 갈라디너: 12/31 성인 $160 / 소아 $80\n- 12/31 체크인&체크아웃 불가\n\n[랜드사: 투어폰 / 마진율 10% / 발권기한: 미설정]',
  itinerary_data: {
    ...PKG_ALT_TIS.itinerary_data,
    meta: {
      ...PKG_ALT_TIS.itinerary_data.meta,
      title: 'BX 부산-세부 슬림팩 5일 (두짓타니)',
    },
    days: makeDays(HOTEL_DUSIT),
  },
  agent_audit_report: {
    parser_version: 'register-v2026.04.21-sonnet-4.6',
    ran_at: new Date().toISOString(),
    claims: [
      { id: 'price_may_dusit', field: 'price_tiers', severity: 'HIGH', text: '5/2, 5/23 두짓타니 779,900', evidence: '원문 가격표 세 번째 컬럼: "5/2, 23 / 779,900"', supported: true },
      { id: 'price_jun_dusit', field: 'price_tiers', severity: 'HIGH', text: '6/2, 6/3 두짓타니 699,900', evidence: '원문 가격표 세 번째 컬럼: "6/2, 3 / 699,900"', supported: true },
      { id: 'price_summer_dusit', field: 'price_tiers', severity: 'HIGH', text: '7-8월 두짓타니 949,900', evidence: '원문 가격표 세 번째 컬럼: "7/15,16 / 8/13,14 / 949,900"', supported: true },
      { id: 'surcharges_outof_range', field: 'surcharges', severity: 'HIGH', text: 'surcharges=[]', evidence: '두짓타니 써차지는 12/28-1/2, 27.02.05-02.07 — 본 상품 출발일(5-8월) 범위 밖', supported: true, note: '내부 메모에 보존' },
      { id: 'flight_out', field: 'itinerary_data.meta.flight_out', severity: 'HIGH', text: 'BX711', evidence: '원문: "BX711 21:10 - 00:30"', supported: true },
      { id: 'flight_in', field: 'itinerary_data.meta.flight_in', severity: 'HIGH', text: 'BX712', evidence: '원문: "BX712 01:30 – 06:55"', supported: true },
    ],
    overall_verdict: 'clean',
    unsupported_critical: 0,
    unsupported_high: 0,
  },
};

const ALL_PACKAGES = [PKG_ALT_TIS, PKG_SOLEA, PKG_DUSIT];

inserter.run(ALL_PACKAGES).then(result => {
  console.log('\n🎉 등록 완료', JSON.stringify(result, null, 2));
}).catch(err => {
  console.error('❌ 등록 실패:', err);
  process.exit(1);
});
