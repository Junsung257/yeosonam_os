/**
 * 7C 부산-보홀 솔레아코스트 슬림/노옵션 패키지 4종 등록
 *   - 슬림패키지 3박5일 / 4박6일
 *   - 노옵션패키지 3박5일 / 4박6일
 * 랜드사: 투어코코넛 (9%)
 */

const fs = require('fs');
const path = require('path');
const { createInserter } = require('./templates/insert-template');

const RAW_TEXT = fs.readFileSync(path.join(__dirname, '..', 'scratch', 'bohol-solea-raw.txt'), 'utf-8');

const inserter = createInserter({
  landOperator: '투어코코넛',
  commissionRate: 9,
  ticketingDeadline: null,
  destCode: 'BHO',
});
const { helpers: { flight, normal, optional, shopping, meal } } = inserter;

const HOTEL_SOLEA = { name: '솔레아 코스트 보홀', grade: '슈페리어룸', note: null };

const COMMON_NOTICES = [
  { type: 'CRITICAL', title: '여권 유효기간', text: '여권만료일은 입국일 기준 6개월 이상 남아있어야 출국 가능합니다. (개인 유효기간 필수 확인)' },
  { type: 'CRITICAL', title: '미성년자 단독 여행', text: '미성년자(만 15세 미만) 부모 미동반으로 여행 시 필리핀 대사관 공증 필요합니다. (부모 동반시 영문등본 지참)' },
  { type: 'INFO', title: 'E-트래블 카드', text: '필리핀 입국 시 E-트래블 카드 작성 필수입니다. (대행해드립니다.)' },
  { type: 'INFO', title: '아동 기준', text: '헤난 아동 기준 만 10세 미만 / 그 외 리조트 아동 기준 만 12세 미만입니다.' },
  { type: 'INFO', title: '객실 기준', text: '1객실 최대 성인3명 OR 성인2명+아동2명 가능하며, 엑스트라베드 가능여부 체크바랍니다. 성인&아동 요금 동일합니다. (특급은 아동 요금有 / 성인 요금의 90%)' },
  { type: 'POLICY', title: '금연 규정', text: '필리핀 전 지역 금연입니다. 지정된 장소에서 흡연 가능합니다. (적발시 벌금)' },
  { type: 'POLICY', title: '호텔 룸배정', text: '호텔 룸배정 (일행과 같은층, 옆방배정, 베드타입) 등은 게런티 불가 합니다.' },
  { type: 'POLICY', title: '일정·식사 변경', text: '전체일정 & 식사 순서는 현지사정에 의해 다소 변경될 수 있습니다.' },
  { type: 'INFO', title: '마사지 팁', text: '마사지 팁 기준 (60분 100페소 / 120분 200페소)입니다. (변동가능)' },
  { type: 'POLICY', title: '일정 미참여 패널티', text: '패키지 일정 미참여시 패널티 1인/1박/$100 청구되며, 가이드 동의없이 개별활동으로 발생하는 사고에 대해서는 어떠한 책임도 지지 않습니다.' },
  { type: 'INFO', title: '외국인·조인 행사', text: '외국인 손님일 경우 또는 현지 거주자 조인 행사의 경우 별도 문의 바랍니다. 동일 일정의 타 항공을 이용하는 패키지 손님과 합류행사 진행될 수 있습니다.' },
  { type: 'INFO', title: '좌석·호텔 리체크', text: '실시간 기준으로 예약 진행 시 좌석 및 호텔 리체크 필수. 4월 선발권 기준 요금입니다. 골든위크 써차지 포함된 요금입니다.' },
];

const SLIM_OPTIONAL_TOURS = [
  { name: '정어리떼 스노클링 나팔링투어', price_usd: 60, price_krw: 50000, price: '$60', note: '선포함 5만원/인', region: '보홀' },
  { name: '반딧불투어', price_usd: 60, price_krw: 50000, price: '$60', note: '선포함 5만원/인', region: '보홀' },
  { name: '아일랜드 호핑투어 (스노클링)', price_usd: 80, price_krw: 50000, price: '$80', note: '선포함 5만원/인', region: '보홀' },
  { name: '발리카삭 호핑투어 (스노클링+거북이왓칭)', price_usd: 110, price_krw: 80000, price: '$110', note: '선포함 8만원/인 · 선포함 시 돌핀왓칭($30) 서비스 제공', region: '보홀' },
  { name: '데이투어 (원숭이+초콜릿힐+멘메이드포레스트)', price_usd: 60, price_krw: 50000, price: '$60', note: '선포함 5만원/인', region: '보홀' },
  { name: '어드벤처 (로복강+원숭이+초콜릿힐+멘메이드포레스트)', price_usd: 80, price_krw: 70000, price: '$80', note: '선포함 7만원/인', region: '보홀' },
  { name: '전신마사지 60분', price_usd: 50, price_krw: 30000, price: '$50', note: '선포함 3만원/인', region: '보홀' },
];

const NOOPT_OPTIONAL_TOURS = [
  { name: '로복강투어 추가 (중식 포함)', price_usd: null, price_krw: 20000, price: '+2만원/인', note: 'D2 데이투어 연계', region: '보홀' },
  { name: '고프로 촬영 대여', price_usd: null, price_krw: 30000, price: '+3만원/인', note: '나팔링투어 시 대여+촬영', region: '보홀' },
];

const SLIM_INCLUSIONS = [
  '왕복 국제선 항공료',
  '텍스',
  '유류할증료',
  '여행자보험',
  '호텔',
  '차량(전용차량 또는 현지 교통)',
  '일정상 식사',
  '가이드',
  '관광지',
  '보홀 시내관광(사왕 재래시장+성 어거스틴 성당)',
  '★선착순 룸당 망고 1KG★',
];

const slimExcludes = (nights) => [
  '선택관광 및 개인 비용',
  '매너팁',
  `기사 및 가이드경비 (${nights}박기준 1인 $${nights === 3 ? 50 : 60} // 성인·아동 동일)`,
  '성수기 써차지 및 의무디너(예약 시 반드시 확인요망)',
];

const NOOPT_INCLUSIONS = [
  '왕복 국제선 항공료',
  '텍스',
  '유류할증료',
  '여행자보험',
  '호텔',
  '차량(전용차량 또는 현지 교통)',
  '일정상 식사',
  '가이드',
  '관광지',
  '보홀 시내관광(사왕 재래시장+성 어거스틴 성당)',
  '★선착순 룸당 망고 1KG★',
  '상품특전: 현지옵션 $310 상당의 보홀 필수 투어 포함',
  '호핑투어 3종세트(스노쿨링+발리카삭+돌핀왓칭+호핑중식)',
  '나팔링투어 OR 반딧불투어(택1)',
  '전신마사지 60분(팁별도)',
  '보홀 데이투어(멘메이드포레스트+초콜릿힐+안경원숭이)',
];

const noOptExcludes = (nights) => [
  '개인 비용',
  '매너팁',
  `기사 및 가이드경비 (${nights}박기준 1인 $${nights === 3 ? 50 : 60} // 성인·아동 동일)`,
  '성수기 써차지 및 의무디너(예약 시 반드시 확인요망)',
];

const SHOPPING_TEXT = '토산품·잡화 쇼핑센터 2회 방문';

const ROOM_UPGRADE_NOTE = '※ 룸 업그레이드 (선택): 디럭스 씨가든뷰(파샬오션뷰) +1인 2만원 / 프리미어 씨뷰 +1인 4만원 (기본: 슈페리어 가든뷰)\n※ 쇼핑센터 2회 방문 (토산품+잡화)';

// ── 가격표 tiers ───────────────────────────────────────────
const PRICE_3D5_SLIM = [
  { period_label: '5/20·5/28 특가', departure_dates: ['2026-05-20', '2026-05-28'], adult_price: 399000, status: 'available', note: '출발확정 (성인 2명부터)' },
  { period_label: '4/29 출발',       departure_dates: ['2026-04-29'], adult_price: 479000, status: 'available', note: '출발확정' },
  { period_label: '5/6 출발',        departure_dates: ['2026-05-06'], adult_price: 499000, status: 'available', note: '출발확정' },
  { period_label: '5/21 출발',       departure_dates: ['2026-05-21'], adult_price: 519000, status: 'available', note: '출발확정' },
  { period_label: '4/30 출발 (골든위크)', departure_dates: ['2026-04-30'], adult_price: 659000, status: 'available', note: '출발확정 · 골든위크 써차지 포함' },
];

const PRICE_4D6_SLIM = [
  { period_label: '5/17·5/31 특가', departure_dates: ['2026-05-17', '2026-05-31'], adult_price: 419000, status: 'available', note: '출발확정 (성인 2명부터)' },
  { period_label: '5/23·5/24 출발', departure_dates: ['2026-05-23', '2026-05-24'], adult_price: 439000, status: 'available', note: '출발확정' },
  { period_label: '5/2·5/3 출발',   departure_dates: ['2026-05-02', '2026-05-03'], adult_price: 479000, status: 'available', note: '출발확정' },
];

const PRICE_3D5_NOOPT = [
  { period_label: '5/20·5/28 특가', departure_dates: ['2026-05-20', '2026-05-28'], adult_price: 699000, status: 'available', note: '출발확정 (성인 2명부터)' },
  { period_label: '4/29 출발',       departure_dates: ['2026-04-29'], adult_price: 759000, status: 'available', note: '출발확정' },
  { period_label: '5/6 출발',        departure_dates: ['2026-05-06'], adult_price: 779000, status: 'available', note: '출발확정' },
  { period_label: '5/21 출발',       departure_dates: ['2026-05-21'], adult_price: 819000, status: 'available', note: '출발확정' },
  { period_label: '4/30 출발 (골든위크)', departure_dates: ['2026-04-30'], adult_price: 939000, status: 'available', note: '출발확정 · 골든위크 써차지 포함' },
];

const PRICE_4D6_NOOPT = [
  { period_label: '5/17·5/31 특가', departure_dates: ['2026-05-17', '2026-05-31'], adult_price: 779000, status: 'available', note: '출발확정 (성인 2명부터)' },
  { period_label: '5/23·5/24 출발', departure_dates: ['2026-05-23', '2026-05-24'], adult_price: 799000, status: 'available', note: '출발확정' },
  { period_label: '5/2·5/3 출발',   departure_dates: ['2026-05-02', '2026-05-03'], adult_price: 839000, status: 'available', note: '출발확정' },
];

// ── 항공편 스케줄 (공통) ─────────────────────────────────
const OUTBOUND_FLIGHT = flight('17:30', '부산 김해공항 출발 → 보홀(팡라오) 국제공항 도착 20:40', '7C2157');
const INBOUND_FLIGHT  = flight('01:30', '보홀(팡라오) 국제공항 출발 → 부산 김해공항 도착 06:55', '7C2158');

// ── 공통 일정 빌더 ────────────────────────────────────────
function d1Slim() {
  return {
    day: 1, regions: ['부산', '보홀'],
    meals: meal(false, false, false),
    schedule: [
      normal('', '부산 김해공항 미팅'),
      OUTBOUND_FLIGHT,
      normal(null, '가이드 미팅 후 리조트 이동'),
      normal(null, '호텔 투숙 및 휴식'),
    ],
    hotel: HOTEL_SOLEA,
  };
}

// 슬림 D2: 나팔링/반딧불 선택관광 추천
function d2SlimOption() {
  return {
    day: 2, regions: ['보홀'],
    meals: meal(true, true, true, '리조트', '현지식', '리조트식'),
    schedule: [
      normal(null, '리조트 조식 후 자유시간'),
      optional(null, '▶정어리떼 스노클링 나팔링투어 (추천)'),
      optional(null, '▶반딧불투어 (추천)'),
      normal(null, '석식 후 리조트 휴식'),
    ],
    hotel: HOTEL_SOLEA,
  };
}

// 슬림 D3: 아일랜드/발리카삭 호핑 선택관광 추천
function d3SlimOption() {
  return {
    day: 3, regions: ['보홀'],
    meals: meal(true, false, false, '리조트', null, null),
    schedule: [
      normal(null, '리조트 조식 후 자유시간'),
      optional(null, '▶아일랜드 호핑투어 (스노클링)'),
      optional(null, '▶발리카삭 호핑투어 (스노클링+거북이왓칭)'),
      normal(null, '★단독★ 발리카삭 호핑투어 선포함 시 돌핀왓칭($30) 서비스 제공'),
      normal(null, '석식 후 리조트 휴식'),
    ],
    hotel: HOTEL_SOLEA,
  };
}

// 슬림 체크아웃+시내관광+쇼핑+선택관광+공항 (3박5일 D4 또는 4박6일 D5)
function dCheckoutSlim(dayNum) {
  return {
    day: dayNum, regions: ['보홀'],
    meals: meal(true, true, false, '리조트', '현지식', null),
    schedule: [
      normal(null, '조식 후 리조트 CHECK-OUT'),
      normal(null, '▶시내관광 (사왕재래시장·팡라오성당)'),
      shopping(null, '쇼핑센터 2회 방문 (토산품+잡화)'),
      optional(null, '▶데이투어 (원숭이+초콜릿힐+멘메이드포레스트)'),
      optional(null, '▶어드벤처 (로복강+원숭이+초콜릿힐+멘메이드포레스트)'),
      optional(null, '▶전신마사지 60분'),
      normal(null, '공항으로 이동하여 탑승 수속'),
    ],
    hotel: { name: null, grade: null, note: '오버나잇 플라이트' },
  };
}

// 4박6일 D4 (추가 리조트 휴식일)
function d4ExtraResortDay() {
  return {
    day: 4, regions: ['보홀'],
    meals: meal(true, false, false, '리조트', null, null),
    schedule: [
      normal(null, '리조트 조식 후 자유시간'),
      normal(null, '※ 선택관광 미참여시 호텔 내 휴식 (가이드 미동반)'),
      normal(null, '석식 후 리조트 휴식'),
    ],
    hotel: HOTEL_SOLEA,
  };
}

// 귀국편 (마지막 일차)
function dLastFlight(dayNum) {
  return {
    day: dayNum, regions: ['부산'],
    meals: meal(false, false, false),
    schedule: [
      INBOUND_FLIGHT,
      normal(null, '부산 도착 후 해산 (즐거운 여행 되셨기를 바랍니다)'),
    ],
    hotel: null,
  };
}

// 노옵션 D2: 나팔링 OR 반딧불 택1 (포함)
function d2NoOpt() {
  return {
    day: 2, regions: ['보홀'],
    meals: meal(true, true, true, '리조트', '현지식', '리조트식'),
    schedule: [
      normal(null, '리조트 조식 후 가이드 미팅'),
      normal(null, '☞ 나팔링 투어 또는 반딧불 투어 (택1, 포함)'),
      normal(null, '▶나팔링투어 — 정어리떼 스노클링 장비·커티지·음료 포함'),
      normal(null, '▶반딧불투어 — 맹그로브 숲 반딧불 관람'),
      normal(null, '석식 후 리조트 휴식'),
    ],
    hotel: HOTEL_SOLEA,
  };
}

// 노옵션 D3: 아일랜드 호핑투어 (포함)
function d3NoOpt() {
  return {
    day: 3, regions: ['보홀'],
    meals: meal(true, true, true, '리조트', '호핑식', '현지식'),
    schedule: [
      normal(null, '리조트 조식 후 가이드 미팅'),
      normal(null, '▶보홀 아일랜드 호핑투어 — 돌핀왓칭·발리카삭 거북이왓칭·푼톳 열대어 스노클링·호핑중식'),
      normal(null, '※ 돌핀왓칭 포함 호핑투어는 오전 7시 이전 출발'),
      normal(null, '※ 버진아일랜드는 진입 가능 시에만 방문'),
      normal(null, '석식 후 자유시간'),
    ],
    hotel: HOTEL_SOLEA,
  };
}

// 노옵션 체크아웃+시내+데이투어(포함)+쇼핑+마사지+공항
function dCheckoutNoOpt(dayNum) {
  return {
    day: dayNum, regions: ['보홀'],
    meals: meal(true, true, true, '리조트', '현지식', '현지식'),
    schedule: [
      normal(null, '조식 후 리조트 CHECK-OUT'),
      normal(null, '▶시내관광 (사왕재래시장·팡라오성당)'),
      normal(null, '▶보홀 데이투어 — 안경원숭이·맨메이드포레스트·초콜릿힐'),
      shopping(null, '쇼핑센터 2회 방문 (토산품+잡화)'),
      normal(null, '☞ 전신 마사지 60분 (팁 별도, 포함)'),
      normal(null, '공항으로 이동하여 탑승 수속'),
    ],
    hotel: { name: null, grade: null, note: '오버나잇 플라이트' },
  };
}

// ═══════════════════════════════════════════════════════════
// 1. 슬림 3박5일
// ═══════════════════════════════════════════════════════════
const PKG_SLIM_3D5 = {
  title: '7C 부산-보홀 솔레아코스트 슬림패키지 3박5일',
  destination: '보홀', country: '필리핀', category: 'package',
  product_type: '슬림', trip_style: '3박5일',
  duration: 5, nights: 3,
  departure_airport: '부산(김해)', airline: '7C(제주항공)',
  departure_days: '수/목',
  min_participants: 2, status: 'pending',
  price: 399000,
  guide_tip: 50, single_supplement: null, small_group_surcharge: null,
  surcharges: [], excluded_dates: [],
  price_tiers: PRICE_3D5_SLIM,
  inclusions: SLIM_INCLUSIONS,
  excludes: slimExcludes(3),
  optional_tours: SLIM_OPTIONAL_TOURS,
  accommodations: ['솔레아 코스트 보홀 (슈페리어 가든뷰)'],
  product_highlights: [
    '솔레아 코스트 보홀 3박 투숙 (슈페리어 가든뷰)',
    '보홀 시내관광 + 선착순 룸당 망고 1KG',
    '부산 출발 직항 (7C 제주항공)',
  ],
  product_summary: '부산에서 직항으로 보홀 팡라오까지 편하게 가시는 솔레아 코스트 리조트 3박 슬림패키지예요. 선택관광은 취향대로 골라서 담으실 수 있고, 사왕 재래시장과 팡라오 성당 시내관광까지 기본 포함입니다. 룸 업그레이드로 바다 전망도 가능하니 편하게 문의 주세요.',
  product_tags: ['#보홀', '#솔레아코스트', '#부산출발', '#직항', '#리조트'],
  notices_parsed: COMMON_NOTICES,
  special_notes: ROOM_UPGRADE_NOTE,
  itinerary_data: {
    meta: {
      title: '7C 부산-보홀 솔레아코스트 슬림패키지 3박5일',
      product_type: '슬림', destination: '보홀', nights: 3, days: 5,
      departure_airport: '부산(김해)', airline: '7C(제주항공)',
      flight_out: '7C2157', flight_in: '7C2158',
      departure_days: '수/목', min_participants: 2, room_type: '2인1실 OR 3인1실',
      ticketing_deadline: null, hashtags: ['#보홀', '#솔레아코스트'], brand: '여소남',
    },
    highlights: {
      inclusions: SLIM_INCLUSIONS,
      excludes: slimExcludes(3),
      shopping: SHOPPING_TEXT,
      remarks: [
        '여권 유효기간 6개월 이상 필수',
        '미성년자 단독 여행 시 필리핀 대사관 공증 필요',
        'E-트래블 카드 작성 필수 (대행)',
        '1객실 최대 성인3명 OR 성인2명+아동2명',
        '필리핀 전 지역 금연 (적발 시 벌금)',
        '호텔 룸배정 게런티 불가',
        '전체일정·식사 순서 현지 사정에 따라 변경 가능',
        '마사지 팁 기준 (60분 100페소 / 120분 200페소)',
        '패키지 일정 미참여 시 패널티 1인/1박 $100',
        '동일 일정 타 항공 합류행사 진행 가능',
        '실시간 기준 예약 진행 시 좌석·호텔 리체크 필수',
      ],
    },
    days: [d1Slim(), d2SlimOption(), d3SlimOption(), dCheckoutSlim(4), dLastFlight(5)],
    optional_tours: SLIM_OPTIONAL_TOURS,
  },
  itinerary: [
    '제1일: 부산 김해 17:30 출발 → 보홀 팡라오 20:40 도착 → 솔레아 코스트 투숙',
    '제2일: 리조트 조식 후 자유시간 — 나팔링투어/반딧불투어 선택',
    '제3일: 리조트 조식 후 자유시간 — 아일랜드 호핑/발리카삭 호핑 선택',
    '제4일: 체크아웃 → 시내관광 (사왕재래시장·팡라오성당) → 쇼핑 → 선택관광 → 공항',
    '제5일: 보홀 팡라오 01:30 출발 → 부산 06:55 도착',
  ],
  raw_text: RAW_TEXT,
  filename: 'bohol-solea-raw.txt', file_type: 'manual', confidence: 0.95,
  agent_audit_report: {
    parser_version: 'register-v2026.04.22-opus-4.7',
    ran_at: new Date().toISOString(),
    claims: [
      { id: 'min_participants', field: 'min_participants', severity: 'HIGH', text: '최소 출발인원 2명', evidence: '원문: 성인 2명 부터 출발확정', supported: true },
      { id: 'guide_tip', field: 'guide_tip', severity: 'HIGH', text: '3박 가이드팁 $50', evidence: '원문: 기사 및 가이드경비 (3박기준 1인 $50)', supported: true },
      { id: 'flight_out', field: 'itinerary_data.meta.flight_out', severity: 'HIGH', text: '7C2157', evidence: '원문 1일차 항공편: 7C2157', supported: true },
      { id: 'flight_in', field: 'itinerary_data.meta.flight_in', severity: 'HIGH', text: '7C2158', evidence: '원문 5일차 항공편: 7C2158', supported: true },
      { id: 'hotel', field: 'accommodations', severity: 'HIGH', text: '솔레아 코스트 보홀 슈페리어룸', evidence: '원문: HOTEL : 솔레아 코스트 보홀 슈페리어룸', supported: true },
      { id: 'surcharges', field: 'surcharges', severity: 'HIGH', text: 'surcharges=[]', evidence: '원문: 골든위크 써차지 포함된 요금입니다', supported: true, note: '골든위크 가격이 이미 tier에 반영됨 (4/30 659,000원). 별도 surcharge 배열 금지.' },
      { id: 'optional_tours', field: 'optional_tours', severity: 'MEDIUM', text: '슬림 선택관광 7종 (나팔링·반딧불·아일랜드호핑·발리카삭호핑·데이투어·어드벤처·마사지)', evidence: '원문 ※추천 옵션※ 블록에 7개 선택관광 열거', supported: true },
    ],
    overall_verdict: 'clean',
    unsupported_critical: 0,
    unsupported_high: 0,
  },
};

// ═══════════════════════════════════════════════════════════
// 2. 슬림 4박6일
// ═══════════════════════════════════════════════════════════
const PKG_SLIM_4D6 = {
  ...PKG_SLIM_3D5,
  title: '7C 부산-보홀 솔레아코스트 슬림패키지 4박6일',
  trip_style: '4박6일',
  duration: 6, nights: 4,
  departure_days: '토/일',
  price: 419000,
  guide_tip: 60,
  price_tiers: PRICE_4D6_SLIM,
  excludes: slimExcludes(4),
  product_highlights: [
    '솔레아 코스트 보홀 4박 투숙 (슈페리어 가든뷰)',
    '보홀 시내관광 + 선착순 룸당 망고 1KG',
    '부산 출발 직항 (7C 제주항공) · 주말 출발',
  ],
  product_summary: '주말에 편하게 떠나시는 4박6일 보홀 솔레아 슬림패키지예요. 리조트 4박이라 호핑투어·데이투어·마사지까지 여유롭게 즐기실 수 있고, 골든위크 요금도 모두 포함된 실제 판매가로 안내드립니다.',
  itinerary_data: {
    ...PKG_SLIM_3D5.itinerary_data,
    meta: { ...PKG_SLIM_3D5.itinerary_data.meta, title: '7C 부산-보홀 솔레아코스트 슬림패키지 4박6일', nights: 4, days: 6, departure_days: '토/일' },
    highlights: { ...PKG_SLIM_3D5.itinerary_data.highlights, excludes: slimExcludes(4) },
    days: [d1Slim(), d2SlimOption(), d3SlimOption(), d4ExtraResortDay(), dCheckoutSlim(5), dLastFlight(6)],
  },
  itinerary: [
    '제1일: 부산 김해 17:30 출발 → 보홀 팡라오 20:40 도착 → 솔레아 코스트 투숙',
    '제2일: 리조트 조식 후 자유시간 — 나팔링투어/반딧불투어 선택',
    '제3일: 리조트 조식 후 자유시간 — 아일랜드 호핑/발리카삭 호핑 선택',
    '제4일: 리조트 조식 후 자유시간 (휴식 또는 선택관광)',
    '제5일: 체크아웃 → 시내관광 (사왕재래시장·팡라오성당) → 쇼핑 → 선택관광 → 공항',
    '제6일: 보홀 팡라오 01:30 출발 → 부산 06:55 도착',
  ],
  agent_audit_report: {
    ...PKG_SLIM_3D5.agent_audit_report,
    claims: [
      ...PKG_SLIM_3D5.agent_audit_report.claims.filter(c => c.id !== 'guide_tip'),
      { id: 'guide_tip', field: 'guide_tip', severity: 'HIGH', text: '4박 가이드팁 $60', evidence: '원문: 기사 및 가이드경비 (4박기준 1인 $60)', supported: true },
      { id: 'duration', field: 'duration', severity: 'HIGH', text: '6일 4박', evidence: '원문 4박6일 섹션 + 제1~제5+제4박 추가일 (택1 리조트 자유) + 제6일 귀국', supported: true },
    ],
  },
};

// ═══════════════════════════════════════════════════════════
// 3. 노옵션 3박5일
// ═══════════════════════════════════════════════════════════
const PKG_NOOPT_3D5 = {
  title: '7C 부산-보홀 솔레아코스트 노옵션패키지 3박5일',
  destination: '보홀', country: '필리핀', category: 'package',
  product_type: '노옵션', trip_style: '3박5일',
  duration: 5, nights: 3,
  departure_airport: '부산(김해)', airline: '7C(제주항공)',
  departure_days: '수/목',
  min_participants: 2, status: 'pending',
  price: 699000,
  guide_tip: 50, single_supplement: null, small_group_surcharge: null,
  surcharges: [], excluded_dates: [],
  price_tiers: PRICE_3D5_NOOPT,
  inclusions: NOOPT_INCLUSIONS,
  excludes: noOptExcludes(3),
  optional_tours: NOOPT_OPTIONAL_TOURS,
  accommodations: ['솔레아 코스트 보홀 (슈페리어 가든뷰)'],
  product_highlights: [
    '현지옵션 $310 상당 보홀 필수 투어 전부 포함',
    '호핑투어 3종세트 (스노클링+발리카삭+돌핀왓칭+중식)',
    '전신마사지 60분 + 데이투어 + 나팔링/반딧불 택1',
  ],
  product_summary: '현지 옵션 $310 상당을 전부 포함한 보홀 노옵션 3박5일 패키지예요. 호핑투어 3종세트, 데이투어, 전신마사지까지 다 들어 있어서 현지에서 추가 지출 걱정 없이 즐기실 수 있고, 가이드·기사 경비만 별도로 챙기시면 됩니다.',
  product_tags: ['#보홀', '#솔레아코스트', '#노옵션', '#부산출발', '#직항'],
  notices_parsed: COMMON_NOTICES,
  special_notes: ROOM_UPGRADE_NOTE,
  itinerary_data: {
    meta: {
      title: '7C 부산-보홀 솔레아코스트 노옵션패키지 3박5일',
      product_type: '노옵션', destination: '보홀', nights: 3, days: 5,
      departure_airport: '부산(김해)', airline: '7C(제주항공)',
      flight_out: '7C2157', flight_in: '7C2158',
      departure_days: '수/목', min_participants: 2, room_type: '2인1실 OR 3인1실',
      ticketing_deadline: null, hashtags: ['#보홀', '#솔레아코스트', '#노옵션'], brand: '여소남',
    },
    highlights: {
      inclusions: NOOPT_INCLUSIONS,
      excludes: noOptExcludes(3),
      shopping: SHOPPING_TEXT,
      remarks: [
        '여권 유효기간 6개월 이상 필수',
        '미성년자 단독 여행 시 필리핀 대사관 공증 필요',
        'E-트래블 카드 작성 필수 (대행)',
        '1객실 최대 성인3명 OR 성인2명+아동2명',
        '필리핀 전 지역 금연 (적발 시 벌금)',
        '호텔 룸배정 게런티 불가',
        '전체일정·식사 순서 현지 사정에 따라 변경 가능',
        '마사지 팁 기준 (60분 100페소 / 120분 200페소)',
        '패키지 일정 미참여 시 패널티 1인/1박 $100',
        '동일 일정 타 항공 합류행사 진행 가능',
        '실시간 기준 예약 진행 시 좌석·호텔 리체크 필수',
        '돌핀왓칭 포함 호핑투어는 오전 7시 이전 출발',
        '버진아일랜드는 진입 가능 시에만 방문',
      ],
    },
    days: [d1Slim(), d2NoOpt(), d3NoOpt(), dCheckoutNoOpt(4), dLastFlight(5)],
    optional_tours: NOOPT_OPTIONAL_TOURS,
  },
  itinerary: [
    '제1일: 부산 김해 17:30 출발 → 보홀 팡라오 20:40 도착 → 솔레아 코스트 투숙',
    '제2일: 나팔링투어 또는 반딧불투어 (택1, 포함)',
    '제3일: 보홀 아일랜드 호핑투어 (돌핀왓칭·발리카삭·푼톳 스노클링·중식 포함)',
    '제4일: 체크아웃 → 시내관광 → 데이투어 → 쇼핑 → 전신마사지 60분 → 공항',
    '제5일: 보홀 팡라오 01:30 출발 → 부산 06:55 도착',
  ],
  raw_text: RAW_TEXT,
  filename: 'bohol-solea-raw.txt', file_type: 'manual', confidence: 0.95,
  agent_audit_report: {
    parser_version: 'register-v2026.04.22-opus-4.7',
    ran_at: new Date().toISOString(),
    claims: [
      { id: 'min_participants', field: 'min_participants', severity: 'HIGH', text: '최소 출발인원 2명', evidence: '원문: 성인 2명 부터 출발확정', supported: true },
      { id: 'guide_tip', field: 'guide_tip', severity: 'HIGH', text: '3박 가이드팁 $50', evidence: '원문: 기사 및 가이드경비 (3박기준 1인 $50)', supported: true },
      { id: 'optional_310', field: 'inclusions', severity: 'CRITICAL', text: '현지옵션 $310 상당 포함', evidence: '원문: 상품특전 : 현지옵션 $310 상당의 보홀 필수 투어 포함', supported: true },
      { id: 'noopt_inclusion_hopping', field: 'inclusions', severity: 'CRITICAL', text: '호핑투어 3종세트 포함', evidence: '원문: 호핑투어 3종세트(스노쿨링+발리카삭+돌핀왓칭+호핑중식)', supported: true },
      { id: 'noopt_inclusion_napaling_firefly', field: 'inclusions', severity: 'HIGH', text: '나팔링 OR 반딧불 택1 포함', evidence: '원문: 나팔링투어 OR 반딧불투어(택1)', supported: true },
      { id: 'noopt_inclusion_massage', field: 'inclusions', severity: 'HIGH', text: '전신마사지 60분 포함', evidence: '원문: 전신마사지 60분(팁별도)', supported: true },
      { id: 'noopt_inclusion_daytour', field: 'inclusions', severity: 'HIGH', text: '보홀 데이투어 포함', evidence: '원문: 보홀 데이투어(멘메이드포레스트+초콜릿힐+안경원숭이)', supported: true },
      { id: 'surcharges', field: 'surcharges', severity: 'HIGH', text: 'surcharges=[]', evidence: '원문: 골든위크 써차지 포함된 요금입니다', supported: true, note: '골든위크 가격이 이미 tier에 반영됨. 별도 surcharge 배열 금지.' },
    ],
    overall_verdict: 'clean',
    unsupported_critical: 0,
    unsupported_high: 0,
  },
};

// ═══════════════════════════════════════════════════════════
// 4. 노옵션 4박6일
// ═══════════════════════════════════════════════════════════
const PKG_NOOPT_4D6 = {
  ...PKG_NOOPT_3D5,
  title: '7C 부산-보홀 솔레아코스트 노옵션패키지 4박6일',
  trip_style: '4박6일',
  duration: 6, nights: 4,
  departure_days: '토/일',
  price: 779000,
  guide_tip: 60,
  price_tiers: PRICE_4D6_NOOPT,
  excludes: noOptExcludes(4),
  product_highlights: [
    '현지옵션 $310 상당 보홀 필수 투어 전부 포함',
    '리조트 4박으로 여유롭게 즐기는 호핑투어·데이투어',
    '주말 출발 (토·일) · 7C 제주항공 직항',
  ],
  product_summary: '주말 출발로 여유롭게 가시는 4박6일 보홀 노옵션 패키지예요. 현지 옵션 $310 상당이 모두 포함돼 있어 호핑투어·데이투어·마사지까지 추가비용 걱정 없이 즐기실 수 있습니다. 리조트 4박이라 자유시간도 충분해요.',
  itinerary_data: {
    ...PKG_NOOPT_3D5.itinerary_data,
    meta: { ...PKG_NOOPT_3D5.itinerary_data.meta, title: '7C 부산-보홀 솔레아코스트 노옵션패키지 4박6일', nights: 4, days: 6, departure_days: '토/일' },
    highlights: { ...PKG_NOOPT_3D5.itinerary_data.highlights, excludes: noOptExcludes(4) },
    days: [d1Slim(), d2NoOpt(), d3NoOpt(), d4ExtraResortDay(), dCheckoutNoOpt(5), dLastFlight(6)],
  },
  itinerary: [
    '제1일: 부산 김해 17:30 출발 → 보홀 팡라오 20:40 도착 → 솔레아 코스트 투숙',
    '제2일: 나팔링투어 또는 반딧불투어 (택1, 포함)',
    '제3일: 보홀 아일랜드 호핑투어 (돌핀왓칭·발리카삭·푼톳 스노클링·중식 포함)',
    '제4일: 리조트 조식 후 자유시간 (휴식 또는 선택관광)',
    '제5일: 체크아웃 → 시내관광 → 데이투어 → 쇼핑 → 전신마사지 60분 → 공항',
    '제6일: 보홀 팡라오 01:30 출발 → 부산 06:55 도착',
  ],
  agent_audit_report: {
    ...PKG_NOOPT_3D5.agent_audit_report,
    claims: [
      ...PKG_NOOPT_3D5.agent_audit_report.claims.filter(c => c.id !== 'guide_tip'),
      { id: 'guide_tip', field: 'guide_tip', severity: 'HIGH', text: '4박 가이드팁 $60', evidence: '원문: 기사 및 가이드경비 (4박기준 1인 $60)', supported: true },
      { id: 'duration', field: 'duration', severity: 'HIGH', text: '6일 4박', evidence: '원문 4박6일 섹션 + 제4일차(4박6일시) 추가일 + 제6일 귀국', supported: true },
    ],
  },
};

const ALL_PACKAGES = [PKG_SLIM_3D5, PKG_SLIM_4D6, PKG_NOOPT_3D5, PKG_NOOPT_4D6];

inserter.run(ALL_PACKAGES).then(result => {
  console.log('\n🎉 등록 완료', result);
});
