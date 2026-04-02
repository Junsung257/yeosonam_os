/**
 * ★ 부산-라오스 26년 4~6월 관광팩 [BX] 6개 상품 일괄 등록
 * 1) 비방방 실속  2) 비방방 노노  3) 비루방 실속  4) 비루방 노노
 * 5) 비루방방 실속  6) 비루방방 노노
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── 헬퍼 ──
function flight(time, activity, transport) { return { time, activity, type: 'flight', transport, note: null }; }
function normal(time, activity, note) { return { time: time || null, activity, type: 'normal', transport: null, note: note || null }; }
function optional(time, activity, note) { return { time: time || null, activity, type: 'optional', transport: null, note: note || null }; }
function shopping(time, activity) { return { time: time || null, activity, type: 'shopping', transport: null, note: null }; }
function train(time, activity, transport) { return { time: time || null, activity, type: 'train', transport: transport || '고속열차', note: null }; }
function meal(b, l, d, bn, ln, dn) {
  return { breakfast: b, lunch: l, dinner: d, breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null };
}

// ── 공통 상수 ──
const COMMON = {
  country: '라오스',
  departure_airport: '부산(김해)',
  airline: 'BX(에어부산)',
  min_participants: 4,
  category: 'package',
  status: 'pending',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
};

const SURCHARGES = [
  { period: '4/14~4/16', amount_krw: 30000, note: '구정 - 티마크, S방비엥 (1인/1박)' },
  { period: '4/14~4/16', amount_krw: 50000, note: '구정 - 므엉탄, 아나린, 루앙뷰, 그랜드루앙 (1인/1박)' },
];

const OPTIONAL_TOURS_SILSOK = [
  { name: '짚라인', price_usd: 60, price_krw: null, note: null },
  { name: '버기카', price_usd: 50, price_krw: null, note: null },
  { name: '롱테일보트', price_usd: 30, price_krw: null, note: null },
  { name: '평양식당', price_usd: 40, price_krw: null, note: null },
  { name: '마사지 1시간', price_usd: 20, price_krw: null, note: null },
  { name: '마사지 2시간', price_usd: 40, price_krw: null, note: null },
  { name: '야간시티투어', price_usd: 30, price_krw: null, note: null },
  { name: '블루라군2(시크릿라군)', price_usd: 20, price_krw: null, note: null },
];

// 노노는 옵션 없음 (노팁노옵션)
const OPTIONAL_TOURS_NONO = [];

const SHOPPING = '침향, 잡화, 흑생강, 커피 중 3회 방문';

// ── 공통 일정 블록 ──
function day1_arrival(hotelName, hotelGrade) {
  return {
    day: 1,
    regions: ['부산', '비엔티안'],
    meals: meal(false, false, false, null, null, null),
    schedule: [
      flight('18:00', '부산 김해공항 미팅 후 출발', 'BX745'),
      flight('21:10', '비엔티안 왓따이 국제공항 도착, 한국인 가이드 미팅', 'BX745'),
      normal('00:35', '호텔 CHECK-IN 및 휴식 (과일도시락 제공)', '익일'),
    ],
    hotel: { name: hotelName, grade: hotelGrade, note: null },
  };
}

function dayLast_3n5d() {
  return {
    day: 5,
    regions: ['비엔티안', '부산'],
    meals: meal(false, false, false, null, null, null),
    schedule: [
      flight('01:35', '비엔티안 출발', 'BX746'),
      flight('07:50', '부산 도착', 'BX746'),
    ],
    hotel: null,
  };
}

function dayLast_4n6d() {
  return {
    day: 6,
    regions: ['비엔티안', '부산'],
    meals: meal(false, false, false, null, null, null),
    schedule: [
      flight('01:35', '비엔티안 출발', 'BX746'),
      flight('07:50', '부산 도착', 'BX746'),
    ],
    hotel: null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  1. 비방방 실속 - [BX 오후출발] 비엔티안/방비엥 3박5일
// ══════════════════════════════════════════════════════════════════════════════
const PKG1 = {
  ...COMMON,
  title: '[BX 오후출발] 비엔티안/방비엥 실속 3박5일',
  destination: '비엔티안/방비엥',
  product_type: '실속',
  trip_style: '3박5일',
  duration: 5, nights: 3,
  departure_days: '매주 목요일',
  price: 679000,
  guide_tip: '$50/인(성인,아동 동일)',
  single_supplement: '10만원(전일정)',
  small_group_surcharge: null,
  surcharges: SURCHARGES,
  excluded_dates: ['2026-05-21'],
  optional_tours: OPTIONAL_TOURS_SILSOK,
  price_tiers: [
    { period_label: '4/1~4/29 목요일', date_range: { start: '2026-04-02', end: '2026-04-23' }, departure_day_of_week: '목', adult_price: 719000, status: 'available' },
    { period_label: '5~6월 목요일 (5/1,5/21 제외)', date_range: { start: '2026-05-07', end: '2026-06-25' }, departure_day_of_week: '목', adult_price: 679000, status: 'available', note: '5/21 제외' },
    { period_label: '4/30, 5/1 제외일자', departure_dates: ['2026-04-30', '2026-05-01'], adult_price: 979000, status: 'available', note: '제외일자 특별요금' },
  ],
  inclusions: [
    '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험',
    '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료',
    '특전: 카약킹, 마사지 1시간, 과일도시락, 열대과일 시식&커피 시음',
  ],
  excludes: [
    '선택관광 및 개인비용, 매너팁',
    '가이드 및 기사 경비 $50/1인(성인,아동 동일)',
  ],
  notices_parsed: [
    '계약금 12%',
    '싱글차지 전 일정 기준 인당 10만원 추가',
    '여권만료일 입국일 기준 6개월 이상 필수',
    '라오스 전자담배 반입 불가',
    '호텔 룸배정(같은 층, 옆방, 베드타입) 개런티 불가',
    '전체일정 & 식사 순서 현지사정에 의해 변경 가능',
    '마사지 팁 기준: 60분-$2, 90분-$3, 120분-$4 (변동 가능)',
    '패키지 일정 미참여시 패널티 1인/1박/$150 청구',
    '가이드 동의 없이 개별활동 사고 책임 불가',
    '미성년자(만13세 미만) 부모 미동반 여행 시 영문동의서 공증 필수',
    '전 일정 5성 호텔 업그레이드 시 11만원 추가 (5성급 싱글차지 21만원)',
    '실시간 기준 예약 시 좌석 및 호텔 리체크 필수',
    '4월 30일 이전 발권 기준, 추후 발권 시 금액 인상',
    '전 상품 조인행사 진행 가능, 현지 옵션안내 동반',
    '패키지 상품으로 옵션 미진행 시 대기 필요',
    '동일 일정 타 항공 패키지 손님과 합류행사 가능',
    '라오스 입국 시 입국신고서 작성 필수',
    '부모 미동반 제3자 입국 시 영문 부모동의서 공증 지참 필수',
  ],
  special_notes: '쇼핑: 침향, 잡화, 흑생강, 커피 중 3회 방문\n싱글차지 10만원\n5성 업그레이드 11만원 (5성 싱글 21만원)\n계약금 12%\n4/30 이전 발권 기준',
  product_highlights: [
    '카약킹+마사지1시간+과일도시락 특전 포함',
    '블루라군 천연수영장 & 다이빙',
    '탐쌍&탐남 동굴 튜빙 체험',
    '쏭강 카약 래프팅',
    '꽃불 카통 체험',
    '왓시사켓+왓호파깨우 사원',
  ],
  product_summary: '에어부산 직항 비엔티안/방비엥 실속 3박5일. 블루라군, 동굴튜빙, 카약래프팅 등 액티비티와 비엔티안 시내 핵심관광. 마사지1시간+카약킹+과일도시락 특전 포함.',
  product_tags: ['라오스', '방비엥', '비엔티안', '블루라군', '카약', '동굴튜빙', '실속', '에어부산'],
  accommodations: ['4성급 라오텔 또는 동급', '4성급 시솜밧 또는 동급'],
  itinerary: [
    'DAY1: 부산→비엔티안 | BX745 18:00-21:10 | 호텔체크인(과일도시락) | 라오텔(4성)',
    'DAY2: 비엔티안→방비엥 | 왓시사켓, 왓호파깨우, 탕원선상식 | 방비엥이동(2h) | 마사지1h | 시솜밧(4성)',
    'DAY3: 방비엥 전일 | 재래시장, 블루라군, 동굴튜빙, 카약래프팅, 카통체험 | 시솜밧(4성)',
    'DAY4: 방비엥→비엔티안 | 열대과일, COPE센터, 조각아트박물관, 빠뚜싸이, 왓탓루앙, 쇼핑3회, 메콩야시장',
    'DAY5: BX746 01:35-07:50 부산도착',
  ],
  itinerary_data: {
    meta: {
      title: '[BX 오후출발] 비엔티안/방비엥 실속 3박5일',
      product_type: '실속', destination: '비엔티안/방비엥',
      nights: 3, days: 5, departure_airport: '부산(김해)',
      airline: 'BX(에어부산)', flight_out: 'BX745', flight_in: 'BX746',
      departure_days: '매주 목요일', min_participants: 4,
      room_type: '2인1실 OR 3인1실', ticketing_deadline: null,
      hashtags: ['#방비엥', '#블루라군', '#카약래프팅', '#동굴튜빙', '#카통체험', '#왓시사켓'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험',
        '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료',
        '특전! 카약킹, 마사지 1시간, 과일도시락, 열대과일 시식&커피 시음',
      ],
      excludes: [
        '선택관광 및 개인비용, 매너팁',
        '가이드 및 기사 경비 ($50/1인/성인,아동 동일)',
      ],
      shopping: '침향, 잡화, 흑생강, 커피 중 3회 방문',
      remarks: [
        '싱글차지 전 일정 기준 인당 10만원 추가',
        '여권만료일은 입국일 기준 6개월 이상 남아있어야 출국 가능합니다.',
        '라오스 전자담배 반입 불가합니다.',
        '호텔 룸배정(일행과 같은 층, 옆방 배정, 베드타입) 등은 개런티 불가합니다.',
        '전체일정 & 식사 순서는 현지사정에 의해 다소 변경될 수 있습니다.',
        '마사지 팁 기준(60분-$2, 90분-$3, 120분-$4)입니다. (변동 가능)',
        '패키지 일정 미참여시 패널티 1인/1박/$150 청구',
        '가이드 동의 없이 개별활동으로 발생하는 사고에 대해서는 어떠한 책임도 지지 않습니다.',
        '미성년자(만 13세 미만) 부모 미동반으로 여행 시 영문동의서에 공증을 받아야 합니다.',
        '전 일정 5성 호텔로 업그레이드 시 11만원 추가 (5성급 싱글차지 21만원 추가)',
        '상기 일정은 항공 및 현지 사정에 의하여 변경될 수 있습니다.',
      ],
    },
    days: [
      day1_arrival('4성급 라오텔 또는 동급', '4성'),
      {
        day: 2, regions: ['비엔티안', '방비엥'],
        meals: meal(true, true, true, '호텔식', '탕원 선상식', '무제한삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃, 가이드 미팅'),
          normal(null, '약 6,840여개의 불상들을 안치해 놓은 왓시사켓'),
          normal(null, '에메랄드 불상을 모시기 위해 지어진 사원 왓호파깨우'),
          normal(null, '중식(탕원 선상식) 후 방비엥으로 이동 (약 2시간 소요)'),
          normal(null, '전신 마사지 1시간 특전 포함', '소아 제외/팁 별도'),
          optional(null, '★추천옵션: 롱테일보트($30)'),
          normal(null, '석식 후 여행자거리&방비엥 야시장 자유시간'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '4성급 시솜밧 또는 동급', grade: '4성', note: null },
      },
      {
        day: 3, regions: ['방비엥'],
        meals: meal(true, true, true, '호텔식', '비빔밥', '오리주물럭'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '몬도가네 아침 재래시장 관광'),
          normal(null, '푸른 물빛을 자랑하는 천연 수영장 블루라군 & 다이빙 체험'),
          normal(null, '중식 후 튜브를 타고 동굴을 탐험하는 이색체험 탐쌍 & 탐남 동굴 튜빙'),
          normal(null, '쏭강을 따라 카약을 타고 내려오는 카약 래프팅 (약 1시간)'),
          normal(null, '소원을 담아 쏭강에 띄워보내는 꽃불 카통 체험 (2인1개)'),
          optional(null, '★추천옵션: 버기카($50), 짚라인($60)'),
          normal(null, '석식 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '4성급 시솜밧 또는 동급', grade: '4성', note: null },
      },
      {
        day: 4, regions: ['방비엥', '비엔티안'],
        meals: meal(true, true, true, '호텔식', '라오수끼', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후 가이드 미팅, 비엔티안으로 이동 (약 2시간 소요)'),
          normal(null, '중식 후 비엔티안 시내관광'),
          normal(null, '망고의 천국 라오스, 열대과일 시식 & 커피 시음'),
          normal(null, '전쟁의 아픔을 간직한 COPE센터'),
          normal(null, '라오스 조각예술의 정수 조각아트 박물관'),
          normal(null, '라오스 독립의 상징 빠뚜싸이 독립기념문'),
          normal(null, '라오스의 불교성지 석가모니 진신사리가 모셔진 왓탓루앙'),
          shopping(null, '비엔티안 쇼핑센터 방문 (3회)'),
          optional(null, '★추천옵션: 전신마사지 2시간($40), 평양식당($40)'),
          normal(null, '석식 후 메콩 야시장 + 짜오아누봉 공원 자유시간'),
          normal(null, '공항으로 이동'),
        ],
        hotel: null,
      },
      dayLast_3n5d(),
    ],
    optional_tours: OPTIONAL_TOURS_SILSOK,
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  2. 비방방 노노 - [BX] 비엔티안/방비엥 전일정 특급 호텔 3박5일
// ══════════════════════════════════════════════════════════════════════════════
const PKG2 = {
  ...COMMON,
  title: '[BX] 비엔티안/방비엥 노팁노옵션 전일정 특급 3박5일',
  destination: '비엔티안/방비엥',
  product_type: '노팁노옵션',
  trip_style: '3박5일',
  duration: 5, nights: 3,
  departure_days: '매주 목요일',
  price: 959000,
  guide_tip: '포함',
  single_supplement: '21만원(전일정)',
  small_group_surcharge: null,
  surcharges: SURCHARGES,
  excluded_dates: ['2026-05-21'],
  optional_tours: OPTIONAL_TOURS_NONO,
  price_tiers: [
    { period_label: '4/1~4/29 목요일', date_range: { start: '2026-04-02', end: '2026-04-23' }, departure_day_of_week: '목', adult_price: 999000, status: 'available' },
    { period_label: '5~6월 목요일 (5/1,5/21 제외)', date_range: { start: '2026-05-07', end: '2026-06-25' }, departure_day_of_week: '목', adult_price: 959000, status: 'available', note: '5/21 제외' },
    { period_label: '4/30, 5/1 제외일자', departure_dates: ['2026-04-30', '2026-05-01'], adult_price: 1259000, status: 'available', note: '제외일자 특별요금' },
  ],
  inclusions: [
    '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험, 기사/가이드경비',
    '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료',
    '특전: 카약킹, 마사지 2시간, 과일도시락, 열대과일 시식&커피 시음',
    '버기카, 짚라인, 카약킹, 롱테일',
  ],
  excludes: ['개인 비용, 매너팁'],
  notices_parsed: [
    '계약금 12%',
    '싱글차지 전일정 기준 인당 21만원 추가',
    '여권만료일 입국일 기준 6개월 이상 필수',
    '라오스 전자담배 반입 불가',
    '호텔 룸배정(같은 층, 옆방, 베드타입) 개런티 불가',
    '전체일정 & 식사 순서 현지사정에 의해 변경 가능',
    '마사지 팁 기준: 60분-$2, 90분-$3, 120분-$4 (변동 가능)',
    '패키지 일정 미참여시 패널티 1인/1박/$150 청구',
    '가이드 동의 없이 개별활동 사고 책임 불가',
    '미성년자(만13세 미만) 부모 미동반 여행 시 영문동의서 공증 필수',
    '실시간 기준 예약 시 좌석 및 호텔 리체크 필수',
    '4월 30일 이전 발권 기준, 추후 발권 시 금액 인상',
  ],
  special_notes: '쇼핑: 침향, 잡화, 흑생강, 커피 중 3회 방문\n싱글차지 21만원\n노팁노옵션 전일정 5성급 호텔\n계약금 12%',
  product_highlights: [
    '노팁노옵션 전일정 5성급 호텔',
    '버기카+짚라인+카약킹+롱테일 전부 포함',
    '마사지 2시간 포함',
    '기사/가이드경비 포함',
    '블루라군+동굴튜빙+카약래프팅',
  ],
  product_summary: '에어부산 직항 비엔티안/방비엥 노팁노옵션 3박5일. 전일정 5성급 호텔, 버기카+짚라인+롱테일+카약킹+마사지2시간 모두 포함. 추가 옵션 부담 없는 올인클루시브.',
  product_tags: ['라오스', '방비엥', '비엔티안', '노팁노옵션', '5성급', '올인클루시브', '에어부산'],
  accommodations: ['5성급 무엉탄 럭셔리 호텔 또는 동급', '5성급 티마크 리조트 방비엥 또는 동급'],
  itinerary: [
    'DAY1: 부산→비엔티안 | BX745 18:00-21:10 | 호텔체크인(과일도시락) | 무엉탄(5성)',
    'DAY2: 비엔티안→방비엥 | 왓시사켓, 왓호파깨우, 탕원선상식 | 방비엥이동(2h) | 마사지2h | 롱테일보트 | 티마크(5성)',
    'DAY3: 방비엥 전일 | 재래시장, 블루라군, 버기카, 짚라인, 동굴튜빙, 카약래프팅, 카통체험 | 티마크(5성)',
    'DAY4: 방비엥→비엔티안 | 열대과일, COPE센터, 빠뚜싸이, 왓탓루앙, 쇼핑3회, 메콩야시장',
    'DAY5: BX746 01:35-07:50 부산도착',
  ],
  itinerary_data: {
    meta: {
      title: '[BX] 비엔티안/방비엥 노팁노옵션 전일정 특급 3박5일',
      product_type: '노팁노옵션', destination: '비엔티안/방비엥',
      nights: 3, days: 5, departure_airport: '부산(김해)',
      airline: 'BX(에어부산)', flight_out: 'BX745', flight_in: 'BX746',
      departure_days: '매주 목요일', min_participants: 4,
      room_type: '2인1실 OR 3인1실', ticketing_deadline: null,
      hashtags: ['#노팁노옵션', '#5성급', '#방비엥', '#블루라군', '#버기카', '#짚라인'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험, 기사/가이드경비',
        '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료',
        '특전! 카약킹, 마사지 2시간, 과일도시락, 열대과일 시식&커피 시음',
        '버기카, 짚라인, 카약킹, 롱테일',
      ],
      excludes: ['개인 비용, 매너팁'],
      shopping: '침향, 잡화, 흑생강, 커피 중 3회 방문',
      remarks: [
        '싱글차지 전일정 기준 인당 21만원 추가',
        '여권만료일은 입국일 기준 6개월 이상 남아있어야 출국 가능합니다.',
        '라오스 전자담배 반입 불가합니다.',
        '호텔 룸배정(일행과 같은 층, 옆방 배정, 베드타입) 등은 개런티 불가합니다.',
        '전체일정 & 식사 순서는 현지사정에 의해 다소 변경될 수 있습니다.',
        '마사지 팁 기준(60분-$2, 90분-$3, 120분-$4)입니다. (변동 가능)',
        '패키지 일정 미참여시 패널티 1인/1박/$150 청구',
        '가이드 동의 없이 개별활동으로 발생하는 사고에 대해서는 어떠한 책임도 지지 않습니다.',
        '미성년자(만 13세 미만) 부모 미동반으로 여행 시 영문동의서에 공증을 받아야 합니다.',
        '상기 일정은 항공 및 현지 사정에 의하여 변경될 수 있습니다.',
      ],
    },
    days: [
      day1_arrival('무엉탄 럭셔리 호텔 또는 동급', '5성'),
      {
        day: 2, regions: ['비엔티안', '방비엥'],
        meals: meal(true, true, true, '호텔식', '탕원 선상식', '무제한삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃, 가이드 미팅'),
          normal(null, '약 6,840여개의 불상들을 안치해 놓은 왓시사켓'),
          normal(null, '에메랄드 불상을 모시기 위해 지어진 사원 왓호파깨우'),
          normal(null, '중식(탕원 선상식) 후 방비엥으로 이동 (약 2시간 소요)'),
          normal(null, '전신 마사지 2시간 특전 포함', '소아 제외/팁 별도'),
          normal(null, '석식 후 쏭강의 노을을 감상하며 롱테일보트 체험'),
          normal(null, '여행자거리&방비엥 야시장 자유시간'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '티마크 리조트 방비엥 또는 동급', grade: '5성', note: null },
      },
      {
        day: 3, regions: ['방비엥'],
        meals: meal(true, true, true, '호텔식', '비빔밥', '오리주물럭'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '몬도가네 아침 재래시장 관광'),
          normal(null, '푸른 물빛을 자랑하는 천연 수영장 블루라군 & 다이빙 체험'),
          normal(null, '오프로드 질주 본능 버기카'),
          normal(null, '중식 후 숲을 가로지르는 짚라인 체험'),
          normal(null, '튜브를 타고 동굴을 탐험하는 이색체험 탐쌍 & 탐남 동굴 튜빙'),
          normal(null, '쏭강을 따라 카약을 타고 내려오는 카약 래프팅 (약 1시간)'),
          normal(null, '석식 후 소원을 담아 쏭강에 띄워보내는 꽃불 카통 체험 (2인1개)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '티마크 리조트 방비엥 또는 동급', grade: '5성', note: null },
      },
      {
        day: 4, regions: ['방비엥', '비엔티안'],
        meals: meal(true, true, true, '호텔식', '라오수끼', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후 가이드 미팅, 비엔티안으로 이동 (약 2시간 소요)'),
          normal(null, '중식 후 비엔티안 시내관광'),
          normal(null, '망고의 천국 라오스, 열대과일 시식 & 커피 시음'),
          normal(null, '라오스의 아픈 근현대사를 볼 수 있는 COPE센터'),
          normal(null, '라오스 독립의 상징 빠뚜싸이 독립기념문'),
          normal(null, '라오스의 불교성지 석가모니 진신사리가 모셔진 왓탓루앙'),
          shopping(null, '비엔티안 쇼핑센터 방문 (3회)'),
          normal(null, '석식 후 메콩 야시장 + 짜오아누봉 공원 자유시간'),
          normal(null, '공항으로 이동'),
        ],
        hotel: null,
      },
      dayLast_3n5d(),
    ],
    optional_tours: [],
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  3. 비루방 실속 - [BX] 비엔티안/루앙프라방/방비엥 3박5일
// ══════════════════════════════════════════════════════════════════════════════
const PKG3 = {
  ...COMMON,
  title: '[BX] 비엔티안/루앙프라방/방비엥 실속 3박5일',
  destination: '비엔티안/루앙프라방/방비엥',
  product_type: '실속',
  trip_style: '3박5일',
  duration: 5, nights: 3,
  departure_days: '매주 목요일',
  price: 799000,
  guide_tip: '$50/인(성인,아동 동일)',
  single_supplement: '12만원(전일정)',
  small_group_surcharge: null,
  surcharges: SURCHARGES,
  excluded_dates: ['2026-05-21'],
  optional_tours: OPTIONAL_TOURS_SILSOK,
  price_tiers: [
    { period_label: '4/1~4/29 목요일', date_range: { start: '2026-04-02', end: '2026-04-23' }, departure_day_of_week: '목', adult_price: 839000, status: 'available' },
    { period_label: '5~6월 목요일 (5/1,5/21 제외)', date_range: { start: '2026-05-07', end: '2026-06-25' }, departure_day_of_week: '목', adult_price: 799000, status: 'available', note: '5/21 제외' },
    { period_label: '4/30, 5/1 제외일자', departure_dates: ['2026-04-30', '2026-05-01'], adult_price: 1099000, status: 'available', note: '제외일자 특별요금' },
  ],
  inclusions: [
    '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험',
    '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료',
    '특전: 카약킹, 마사지 1시간, 과일도시락, 열대과일 시식&커피 시음',
    '라오스 고속철도 탑승',
  ],
  excludes: [
    '선택관광 및 개인비용, 매너팁',
    '가이드 및 기사 경비 $50/1인(성인,아동 동일)',
  ],
  notices_parsed: [
    '계약금 12%',
    '싱글차지 전 일정 기준 인당 12만원 추가',
    '여권만료일 입국일 기준 6개월 이상 필수',
    '라오스 전자담배 반입 불가',
    '고속철도 예약 시 여권 위/아래 앞면사진 깔끔한 스캔본 제출 필수 (빛번짐 및 이미지 잘림 반려)',
    '호텔 룸배정 개런티 불가',
    '마사지 팁 기준: 60분-$2, 90분-$3, 120분-$4 (변동 가능)',
    '패키지 일정 미참여시 패널티 1인/1박/$150 청구',
    '미성년자(만13세 미만) 부모 미동반 여행 시 영문동의서 공증 필수',
    '전 일정 5성 호텔 업그레이드 시 10만원 추가 (5성급 싱글차지 21만원 추가)',
    '루앙프라방 탁발은 사전 신청 시 진행 가능 (추가금액 X)',
    '실시간 기준 예약 시 좌석 및 호텔 리체크 필수',
    '4월 30일 이전 발권 기준, 추후 발권 시 금액 인상',
  ],
  special_notes: '쇼핑: 침향, 잡화, 흑생강, 커피 중 3회\n싱글차지 12만원\n5성 업그레이드 10만원 (5성 싱글 21만원)\n고속철도 여권 스캔본 필수\n루앙프라방 탁발 사전 신청 가능\n계약금 12%',
  product_highlights: [
    '루앙프라방 세계문화유산 + 꽝시폭포',
    '라오스 고속철도 탑승 체험',
    '방비엥 블루라군+동굴튜빙+카약래프팅',
    '꽃불 카통 체험',
    '왕궁박물관+푸씨산+몽족야시장',
    '카약킹+마사지1시간 특전 포함',
  ],
  product_summary: '에어부산 직항 비엔티안/루앙프라방/방비엥 실속 3박5일. 고속철도로 루앙프라방 이동, 꽝시폭포+왕궁박물관+푸씨산 관광 후 방비엥 액티비티까지. 마사지1시간+카약킹 특전.',
  product_tags: ['라오스', '루앙프라방', '방비엥', '비엔티안', '고속철도', '꽝시폭포', '블루라군', '실속', '에어부산'],
  accommodations: ['4성급 라오텔 또는 동급', '4성급 앙통 또는 동급', '4성급 시솜밧 또는 동급'],
  itinerary: [
    'DAY1: 부산→비엔티안 | BX745 18:00-21:10 | 호텔체크인 | 라오텔(4성)',
    'DAY2: 비엔티안→루앙프라방(고속열차) | 왕궁박물관, 꽝시폭포, 푸씨산 | 몽족야시장 | 앙통(4성)',
    'DAY3: 루앙프라방→방비엥(고속열차) | 탁발, 왓마이, 왓시엥통 | 블루라군, 동굴튜빙, 카약, 마사지1h, 카통 | 시솜밧(4성)',
    'DAY4: 방비엥→비엔티안 | 열대과일, 빠뚜싸이, 왓탓루앙, 쇼핑3회, 메콩야시장',
    'DAY5: BX746 01:35-07:50 부산도착',
  ],
  itinerary_data: {
    meta: {
      title: '[BX] 비엔티안/루앙프라방/방비엥 실속 3박5일',
      product_type: '실속', destination: '비엔티안/루앙프라방/방비엥',
      nights: 3, days: 5, departure_airport: '부산(김해)',
      airline: 'BX(에어부산)', flight_out: 'BX745', flight_in: 'BX746',
      departure_days: '매주 목요일', min_participants: 4,
      room_type: '2인1실 OR 3인1실', ticketing_deadline: null,
      hashtags: ['#루앙프라방', '#꽝시폭포', '#고속철도', '#방비엥', '#블루라군', '#탁발'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험',
        '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료',
        '특전! 카약킹, 마사지 1시간, 과일도시락, 열대과일 시식&커피 시음',
        '라오스 고속철도 탑승 – 여권 스캔본 필수 (잘림, 빛번짐X)',
      ],
      excludes: [
        '선택관광 및 개인비용, 매너팁',
        '가이드 및 기사 경비 ($50/1인/성인,아동 동일)',
      ],
      shopping: '침향, 잡화, 흑생강, 커피 중 3회 방문',
      remarks: [
        '싱글차지 전일정 기준 인당 12만원 추가',
        '여권만료일은 입국일 기준 6개월 이상 남아있어야 출국 가능합니다.',
        '라오스 전자담배 반입 불가합니다.',
        '전 일정 5성 호텔로 업그레이드 시 10만원 추가 (5성급 싱글차지 21만원 추가)',
        '루앙프라방 탁발은 사전 신청 시 진행 가능합니다. (추가금액 X)',
        '상기 일정은 항공 및 현지 사정에 의하여 변경될 수 있습니다.',
      ],
    },
    days: [
      day1_arrival('4성급 라오텔 또는 동급', '4성'),
      {
        day: 2, regions: ['비엔티안', '루앙프라방'],
        meals: meal(true, true, true, '호텔식', '현지식', '보쌈정식'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃, 가이드 미팅'),
          train(null, '루앙프라방으로 이동 (약 2시간 소요)', '고속열차'),
          normal(null, '마지막 왕조의 생활상을 볼 수 있는 왕궁박물관 및 황금불상'),
          normal(null, '에메랄드빛 물 웅덩이가 계단처럼 펼쳐진 비경 꽝시 폭포 (삼림욕)'),
          normal(null, '루앙프라방 전경을 한눈에 담을 수 있는 푸씨산'),
          normal(null, '석식 후 루앙프라방의 대표 야시장인 몽족 야시장 관광 및 자유시간'),
          optional(null, '★추천옵션: 루앙 메콩 크루즈($30)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '4성급 앙통 또는 동급', grade: '4성', note: null },
      },
      {
        day: 3, regions: ['루앙프라방', '방비엥'],
        meals: meal(true, true, true, '호텔식', '비빔밥', '무제한삼겹살'),
        schedule: [
          normal(null, '라오스 스님들의 행렬 탁발 참석 및 참관 + 새벽 재래시장 방문'),
          normal(null, '호텔 조식 후 체크아웃'),
          normal(null, '라오스의 새로운 시작을 알리기 위해 만들어진 왕실 사원 왓마이'),
          normal(null, '루앙프라방 대표사원, 모자이크 벽화를 볼 수 있는 왓시엥통'),
          train(null, '방비엥으로 이동 (약 1시간 소요)', '고속열차'),
          normal(null, '중식 후 푸른 물빛을 자랑하는 천연 수영장 블루라군 & 다이빙 체험'),
          normal(null, '튜브를 타고 동굴을 탐험하는 이색체험 탐쌍 & 탐남 동굴 튜빙'),
          normal(null, '쏭강을 따라 카약을 타고 내려오는 카약 래프팅 (약 1시간)'),
          normal(null, '전신 마사지 1시간 특전 포함', '소아 제외/팁 별도'),
          normal(null, '석식 후 소원을 담아 쏭강에 띄워보내는 꽃불 카통 체험 (2인1개)'),
          normal(null, '여행자거리&방비엥 야시장 자유시간'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '4성급 시솜밧 또는 동급', grade: '4성', note: null },
      },
      {
        day: 4, regions: ['방비엥', '비엔티안'],
        meals: meal(true, true, true, '호텔식', '라오수끼', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후 가이드 미팅, 비엔티안으로 이동 (약 2시간 소요)'),
          normal(null, '중식 후 비엔티안 시내관광'),
          normal(null, '망고의 천국 라오스, 열대과일 시식 & 커피 시음'),
          normal(null, '라오스 독립의 상징 빠뚜싸이 독립기념문'),
          normal(null, '라오스의 불교성지 석가모니 진신사리가 모셔진 왓탓루앙'),
          shopping(null, '비엔티안 쇼핑센터 방문 (3회)'),
          optional(null, '★추천옵션: 버기카($50), 짚라인($60), 롱테일보트($30), 전신마사지 2시간($40), 평양식당($40)'),
          normal(null, '석식 후 메콩 야시장 + 짜오아누봉 공원 자유시간'),
          normal(null, '공항으로 이동'),
        ],
        hotel: null,
      },
      dayLast_3n5d(),
    ],
    optional_tours: [...OPTIONAL_TOURS_SILSOK, { name: '루앙 메콩 크루즈', price_usd: 30, price_krw: null, note: null }],
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  4. 비루방 노노 - [BX] 비엔티안/루앙프라방/방비엥 전일정 특급 3박5일
// ══════════════════════════════════════════════════════════════════════════════
const PKG4 = {
  ...COMMON,
  title: '[BX] 비엔티안/루앙프라방/방비엥 노팁노옵션 전일정 특급 3박5일',
  destination: '비엔티안/루앙프라방/방비엥',
  product_type: '노팁노옵션',
  trip_style: '3박5일',
  duration: 5, nights: 3,
  departure_days: '매주 목요일',
  price: 1079000,
  guide_tip: '포함',
  single_supplement: '21만원(전일정)',
  small_group_surcharge: null,
  surcharges: SURCHARGES,
  excluded_dates: ['2026-05-21'],
  optional_tours: OPTIONAL_TOURS_NONO,
  price_tiers: [
    { period_label: '4/1~4/29 목요일', date_range: { start: '2026-04-02', end: '2026-04-23' }, departure_day_of_week: '목', adult_price: 1119000, status: 'available' },
    { period_label: '5~6월 목요일 (5/1,5/21 제외)', date_range: { start: '2026-05-07', end: '2026-06-25' }, departure_day_of_week: '목', adult_price: 1079000, status: 'available', note: '5/21 제외' },
    { period_label: '4/30, 5/1 제외일자', departure_dates: ['2026-04-30', '2026-05-01'], adult_price: 1359000, status: 'available', note: '제외일자 특별요금' },
  ],
  inclusions: [
    '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험, 기사/가이드경비',
    '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료',
    '특전: 카약킹, 마사지 2시간, 과일도시락, 열대과일 시식&커피 시음',
    '버기카, 짚라인, 카약킹, 롱테일',
  ],
  excludes: ['개인 비용, 매너팁'],
  notices_parsed: [
    '계약금 12%',
    '싱글차지 전일정 기준 인당 21만원 추가',
    '여권만료일 입국일 기준 6개월 이상 필수',
    '라오스 전자담배 반입 불가',
    '호텔 룸배정 개런티 불가',
    '마사지 팁 기준: 60분-$2, 90분-$3, 120분-$4 (변동 가능)',
    '패키지 일정 미참여시 패널티 1인/1박/$150 청구',
    '미성년자(만13세 미만) 부모 미동반 여행 시 영문동의서 공증 필수',
    '루앙프라방 탁발은 사전 신청 시 진행 가능 (추가금액 X)',
    '실시간 기준 예약 시 좌석 및 호텔 리체크 필수',
    '4월 30일 이전 발권 기준, 추후 발권 시 금액 인상',
  ],
  special_notes: '쇼핑: 침향, 잡화, 흑생강, 커피 중 3회\n싱글차지 21만원\n노팁노옵션 전일정 5성급\n루앙프라방 탁발 사전 신청 가능\n계약금 12%',
  product_highlights: [
    '노팁노옵션 전일정 5성급 호텔',
    '루앙프라방 꽝시폭포+왕궁박물관+푸씨산',
    '버기카+짚라인+카약킹+롱테일 전부 포함',
    '마사지 2시간 포함',
    '라오스 고속철도 탑승',
  ],
  product_summary: '에어부산 직항 비엔티안/루앙프라방/방비엥 노팁노옵션 3박5일. 전일정 5성급 호텔, 버기카+짚라인+롱테일+카약킹+마사지2시간 모두 포함. 고속철도로 루앙프라방 이동.',
  product_tags: ['라오스', '루앙프라방', '방비엥', '비엔티안', '노팁노옵션', '5성급', '고속철도', '에어부산'],
  accommodations: ['5성급 무엉탄 럭셔리 호텔 또는 동급', '5성급 루앙프라방뷰 호텔 또는 동급', '5성급 티마크 리조트 방비엥 또는 동급'],
  itinerary: [
    'DAY1: 부산→비엔티안 | BX745 18:00-21:10 | 호텔체크인 | 무엉탄(5성)',
    'DAY2: 비엔티안→루앙프라방(고속열차) | 왕궁박물관, 꽝시폭포, 푸씨산, 몽족야시장 | 루앙프라방뷰(5성)',
    'DAY3: 루앙프라방→방비엥(고속열차) | 탁발, 왓마이, 왓시엥통 | 블루라군, 버기카, 짚라인, 동굴튜빙, 카약, 마사지2h, 카통 | 티마크(5성)',
    'DAY4: 방비엥→비엔티안 | 롱테일보트, 열대과일, 빠뚜싸이, 왓탓루앙, 쇼핑3회, 메콩야시장',
    'DAY5: BX746 01:35-07:50 부산도착',
  ],
  itinerary_data: {
    meta: {
      title: '[BX] 비엔티안/루앙프라방/방비엥 노팁노옵션 전일정 특급 3박5일',
      product_type: '노팁노옵션', destination: '비엔티안/루앙프라방/방비엥',
      nights: 3, days: 5, departure_airport: '부산(김해)',
      airline: 'BX(에어부산)', flight_out: 'BX745', flight_in: 'BX746',
      departure_days: '매주 목요일', min_participants: 4,
      room_type: '2인1실 OR 3인1실', ticketing_deadline: null,
      hashtags: ['#노팁노옵션', '#5성급', '#루앙프라방', '#꽝시폭포', '#고속철도', '#방비엥'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험, 기사/가이드경비',
        '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료',
        '특전! 카약킹, 마사지 2시간, 과일도시락, 열대과일 시식&커피 시음',
        '버기카, 짚라인, 카약킹, 롱테일',
      ],
      excludes: ['개인 비용, 매너팁'],
      shopping: '침향, 잡화, 흑생강, 커피 중 3회 방문',
      remarks: [
        '싱글차지 전일정 기준 인당 21만원 추가',
        '여권만료일은 입국일 기준 6개월 이상 남아있어야 출국 가능합니다.',
        '라오스 전자담배 반입 불가합니다.',
        '루앙프라방 탁발은 사전 신청 시 진행 가능합니다. (추가금액 X)',
        '상기 일정은 항공 및 현지 사정에 의하여 변경될 수 있습니다.',
      ],
    },
    days: [
      day1_arrival('무엉탄 럭셔리 호텔 또는 동급', '5성'),
      {
        day: 2, regions: ['비엔티안', '루앙프라방'],
        meals: meal(true, true, true, '호텔식', '현지식', '보쌈정식'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃, 가이드 미팅'),
          train(null, '루앙프라방으로 이동 (약 2시간 소요)', '고속열차'),
          normal(null, '마지막 왕조의 생활상을 볼 수 있는 왕궁박물관 및 황금불상'),
          normal(null, '에메랄드빛 물 웅덩이가 계단처럼 펼쳐진 비경 꽝시 폭포 (삼림욕)'),
          normal(null, '루앙프라방 전경을 한눈에 담을 수 있는 푸씨산'),
          normal(null, '석식 후 루앙프라방의 대표 야시장인 몽족 야시장 관광 및 자유시간'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '루앙프라방뷰 호텔 또는 동급', grade: '5성', note: null },
      },
      {
        day: 3, regions: ['루앙프라방', '방비엥'],
        meals: meal(true, true, true, '호텔식', '비빔밥', '무제한삼겹살'),
        schedule: [
          normal(null, '라오스 스님들의 행렬 탁발 참석 및 참관 + 새벽 재래시장 방문'),
          normal(null, '호텔 조식 후 체크아웃'),
          normal(null, '라오스의 새로운 시작을 알리기 위해 만들어진 왕실 사원 왓마이'),
          normal(null, '루앙프라방 대표사원, 모자이크 벽화를 볼 수 있는 왓시엥통'),
          train(null, '방비엥으로 이동 (약 1시간 소요)', '고속열차'),
          normal(null, '중식 후 푸른 물빛을 자랑하는 천연 수영장 블루라군 & 다이빙 체험'),
          normal(null, '오프로드 질주 본능 버기카 & 숲을 가로지르는 짚라인 체험'),
          normal(null, '튜브를 타고 동굴을 탐험하는 이색체험 탐쌍 & 탐남 동굴 튜빙'),
          normal(null, '쏭강을 따라 카약을 타고 내려오는 카약 래프팅 (약 1시간)'),
          normal(null, '전신 마사지 2시간 특전 포함', '소아 제외/팁 별도'),
          normal(null, '석식 후 소원을 담아 쏭강에 띄워보내는 꽃불 카통 체험 (2인1개)'),
          normal(null, '여행자거리&방비엥 야시장 자유시간'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '티마크 리조트 방비엥 또는 동급', grade: '5성', note: null },
      },
      {
        day: 4, regions: ['방비엥', '비엔티안'],
        meals: meal(true, true, true, '호텔식', '라오수끼', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃, 가이드 미팅'),
          normal(null, '쏭강의 노을을 감상하며 롱테일보트 체험'),
          normal(null, '비엔티안으로 이동 (약 2시간 소요)'),
          normal(null, '중식 후 비엔티안 시내관광'),
          normal(null, '망고의 천국 라오스, 열대과일 시식 & 커피 시음'),
          normal(null, '라오스 독립의 상징 빠뚜싸이 독립기념문'),
          normal(null, '라오스의 불교성지 석가모니 진신사리가 모셔진 왓탓루앙'),
          shopping(null, '비엔티안 쇼핑센터 방문 (3회)'),
          normal(null, '석식 후 메콩 야시장 + 짜오아누봉 공원 자유시간'),
          normal(null, '공항으로 이동'),
        ],
        hotel: null,
      },
      dayLast_3n5d(),
    ],
    optional_tours: [],
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  5. 비루방방 실속 - [BX] 비엔티안/루앙프라방/방비엥 4박6일
// ══════════════════════════════════════════════════════════════════════════════
const PKG5 = {
  ...COMMON,
  title: '[BX] 비엔티안/루앙프라방/방비엥 실속 4박6일',
  destination: '비엔티안/루앙프라방/방비엥',
  product_type: '실속',
  trip_style: '4박6일',
  duration: 6, nights: 4,
  departure_days: '매주 일요일',
  price: 739000,
  guide_tip: '$60/인(성인,아동 동일)',
  single_supplement: '15만원(전일정)',
  small_group_surcharge: null,
  surcharges: SURCHARGES,
  excluded_dates: [],
  optional_tours: OPTIONAL_TOURS_SILSOK,
  price_tiers: [
    { period_label: '4/1~4/30 일요일', date_range: { start: '2026-04-05', end: '2026-04-26' }, departure_day_of_week: '일', adult_price: 739000, status: 'available' },
    { period_label: '5/1~6/25 일요일', date_range: { start: '2026-05-03', end: '2026-06-21' }, departure_day_of_week: '일', adult_price: 879000, status: 'available' },
  ],
  inclusions: [
    '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험',
    '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료',
    '특전: 카약킹, 마사지 1시간, 과일도시락, 열대과일 시식&커피 시음',
    '라오스 고속철도 탑승',
  ],
  excludes: [
    '선택관광 및 개인비용, 매너팁',
    '가이드 및 기사 경비 $60/1인(성인,아동 동일)',
  ],
  notices_parsed: [
    '계약금 12%',
    '싱글차지 전 일정 기준 인당 15만원 추가',
    '여권만료일 입국일 기준 6개월 이상 필수',
    '라오스 전자담배 반입 불가',
    '고속철도 예약 시 여권 스캔본 필수 (잘림, 빛번짐 반려)',
    '호텔 룸배정 개런티 불가',
    '마사지 팁 기준: 60분-$2, 90분-$3, 120분-$4 (변동 가능)',
    '패키지 일정 미참여시 패널티 1인/1박/$150 청구',
    '미성년자(만13세 미만) 부모 미동반 여행 시 영문동의서 공증 필수',
    '전 일정 5성 호텔 업그레이드 시 13만원 추가 (5성급 싱글차지 27만원 추가)',
    '루앙프라방 탁발은 사전 신청 시 진행 가능 (추가금액 X)',
    '실시간 기준 예약 시 좌석 및 호텔 리체크 필수',
    '4월 30일 이전 발권 기준, 추후 발권 시 금액 인상',
  ],
  special_notes: '쇼핑: 침향, 잡화, 흑생강, 커피 중 3회\n싱글차지 15만원\n5성 업그레이드 13만원 (5성 싱글 27만원)\n고속철도 여권 스캔본 필수\n루앙프라방 탁발 사전 신청 가능\n계약금 12%',
  product_highlights: [
    '4박6일 여유로운 일정 (일요일 출발)',
    '루앙프라방+방비엥 2박 여유관광',
    '라오스 고속철도 탑승 체험',
    '꽝시폭포+왕궁박물관+푸씨산+왓시엥통',
    '방비엥 블루라군+동굴튜빙+카약래프팅',
    '카약킹+마사지1시간 특전 포함',
  ],
  product_summary: '에어부산 직항 비엔티안/루앙프라방/방비엥 실속 4박6일 (일요일 출발). 여유로운 일정으로 루앙프라방과 방비엥을 깊이 있게 탐방. 고속철도 탑승 포함.',
  product_tags: ['라오스', '루앙프라방', '방비엥', '비엔티안', '고속철도', '4박6일', '실속', '에어부산'],
  accommodations: ['4성급 라오텔 또는 동급', '4성급 앙통 또는 동급', '4성급 시솜밧 또는 동급'],
  itinerary: [
    'DAY1: 부산→비엔티안 | BX745 18:00-21:10 | 호텔체크인 | 라오텔(4성)',
    'DAY2: 비엔티안→루앙프라방(고속열차) | 꽝시폭포, 푸씨산, 몽족야시장 | 앙통(4성)',
    'DAY3: 루앙프라방→방비엥(고속열차) | 탁발, 왓마이, 왓시엥통, 왕궁박물관 | 마사지1h | 시솜밧(4성)',
    'DAY4: 방비엥 전일 | 재래시장, 블루라군, 동굴튜빙, 카약래프팅, 카통 | 시솜밧(4성)',
    'DAY5: 방비엥→비엔티안(고속열차) | 열대과일, 빠뚜싸이, 왓탓루앙, 쇼핑3회, 메콩야시장',
    'DAY6: BX746 01:35-07:50 부산도착',
  ],
  itinerary_data: {
    meta: {
      title: '[BX] 비엔티안/루앙프라방/방비엥 실속 4박6일',
      product_type: '실속', destination: '비엔티안/루앙프라방/방비엥',
      nights: 4, days: 6, departure_airport: '부산(김해)',
      airline: 'BX(에어부산)', flight_out: 'BX745', flight_in: 'BX746',
      departure_days: '매주 일요일', min_participants: 4,
      room_type: '2인1실 OR 3인1실', ticketing_deadline: null,
      hashtags: ['#4박6일', '#루앙프라방', '#방비엥', '#고속철도', '#꽝시폭포', '#블루라군'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험',
        '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료',
        '특전! 카약킹, 마사지 1시간, 과일도시락, 열대과일 시식&커피 시음',
        '라오스 고속철도 탑승 – 여권 스캔본 필수',
      ],
      excludes: [
        '선택관광 및 개인비용, 매너팁',
        '가이드 및 기사 경비 ($60/1인/성인,아동 동일)',
      ],
      shopping: '침향, 잡화, 흑생강, 커피 중 3회 방문',
      remarks: [
        '싱글차지 전일정 기준 인당 15만원 추가',
        '전 일정 5성 호텔로 업그레이드 시 13만원 추가 (5성급 싱글차지 27만원 추가)',
        '루앙프라방 탁발은 사전 신청 시 진행 가능합니다. (추가금액 X)',
        '상기 일정은 항공 및 현지 사정에 의하여 변경될 수 있습니다.',
      ],
    },
    days: [
      day1_arrival('4성급 라오텔 또는 동급', '4성'),
      {
        day: 2, regions: ['비엔티안', '루앙프라방'],
        meals: meal(true, true, true, '호텔식', '현지식', '보쌈정식'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃, 가이드 미팅'),
          train(null, '루앙프라방으로 이동 (약 2시간 소요)', '고속열차'),
          normal(null, '에메랄드빛 물 웅덩이가 계단처럼 펼쳐진 비경 꽝시 폭포 (삼림욕)'),
          normal(null, '루앙프라방 전경을 한눈에 담을 수 있는 푸씨산'),
          normal(null, '석식 후 루앙프라방의 대표 야시장인 몽족 야시장 관광 및 자유시간'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '4성급 앙통 또는 동급', grade: '4성', note: null },
      },
      {
        day: 3, regions: ['루앙프라방', '방비엥'],
        meals: meal(true, true, true, '호텔식', '한식', '오리주물럭'),
        schedule: [
          normal(null, '루앙프라방 새벽 탁발 & 새벽시장 관광'),
          normal(null, '호텔 조식 후 체크아웃'),
          normal(null, '라오스의 새로운 시작을 알리기 위해 만들어진 왕실 사원 왓마이'),
          normal(null, '루앙프라방 대표사원, 모자이크 벽화를 볼 수 있는 왓시엥통'),
          normal(null, '마지막 왕조의 생활상을 볼 수 있는 왕궁박물관 및 황금불상'),
          train(null, '방비엥으로 이동 (약 1시간 소요)', '고속열차'),
          normal(null, '전신 마사지 1시간 특전 포함', '소아 제외/팁 별도'),
          optional(null, '★추천옵션: 롱테일보트($30)'),
          normal(null, '석식 후 여행자거리&방비엥 야시장 자유시간'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '4성급 시솜밧 또는 동급', grade: '4성', note: null },
      },
      {
        day: 4, regions: ['방비엥'],
        meals: meal(true, true, true, '호텔식', 'BBQ도시락', '무제한삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '몬도가네 아침 재래시장 관광'),
          normal(null, '푸른 물빛을 자랑하는 천연 수영장 블루라군 & 다이빙 체험'),
          normal(null, '중식 후 튜브를 타고 동굴을 탐험하는 이색체험 탐쌍 & 탐남 동굴 튜빙'),
          normal(null, '쏭강을 따라 카약을 타고 내려오는 카약 래프팅 (약 1시간)'),
          normal(null, '석식 후 소원을 담아 쏭강에 띄워보내는 꽃불 카통 체험 (2인1개)'),
          optional(null, '★추천옵션: 버기카($50), 짚라인($60)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '4성급 시솜밧 또는 동급', grade: '4성', note: null },
      },
      {
        day: 5, regions: ['방비엥', '비엔티안'],
        meals: meal(true, true, true, '호텔식', '라오수끼', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후 가이드 미팅, 비엔티안으로 이동 (약 2시간 소요)'),
          normal(null, '중식 후 비엔티안 시내관광'),
          normal(null, '망고의 천국 라오스, 열대과일 시식 & 커피 시음'),
          normal(null, '라오스 독립의 상징 빠뚜싸이 독립기념문'),
          normal(null, '라오스의 불교성지 석가모니 진신사리가 모셔진 왓탓루앙'),
          shopping(null, '비엔티안 쇼핑센터 방문 (3회)'),
          normal(null, '석식 후 메콩 야시장 + 짜오아누봉 공원 자유시간'),
          normal(null, '공항으로 이동'),
        ],
        hotel: null,
      },
      dayLast_4n6d(),
    ],
    optional_tours: [...OPTIONAL_TOURS_SILSOK, { name: '루앙 메콩 크루즈', price_usd: 30, price_krw: null, note: null }],
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  6. 비루방방 노노 - [BX] 비엔티안/루앙프라방/방비엥 전일정 특급 4박6일
// ══════════════════════════════════════════════════════════════════════════════
const PKG6 = {
  ...COMMON,
  title: '[BX] 비엔티안/루앙프라방/방비엥 노팁노옵션 전일정 특급 4박6일',
  destination: '비엔티안/루앙프라방/방비엥',
  product_type: '노팁노옵션',
  trip_style: '4박6일',
  duration: 6, nights: 4,
  departure_days: '매주 일요일',
  price: 1079000,
  guide_tip: '포함',
  single_supplement: '27만원(전일정)',
  small_group_surcharge: null,
  surcharges: SURCHARGES,
  excluded_dates: [],
  optional_tours: OPTIONAL_TOURS_NONO,
  price_tiers: [
    { period_label: '4/1~4/30 일요일', date_range: { start: '2026-04-05', end: '2026-04-26' }, departure_day_of_week: '일', adult_price: 1079000, status: 'available' },
    { period_label: '5/1~6/25 일요일', date_range: { start: '2026-05-03', end: '2026-06-21' }, departure_day_of_week: '일', adult_price: 1219000, status: 'available' },
  ],
  inclusions: [
    '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험, 기사/가이드 경비',
    '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료',
    '특전: 카약킹, 마사지 2시간, 과일도시락, 열대과일 시식&커피 시음',
    '버기카, 짚라인, 카약킹, 롱테일',
    '라오스 고속철도 탑승',
  ],
  excludes: ['개인 비용, 매너팁'],
  notices_parsed: [
    '계약금 12%',
    '싱글차지 전일정 기준 인당 27만원 추가',
    '여권만료일 입국일 기준 6개월 이상 필수',
    '라오스 전자담배 반입 불가',
    '호텔 룸배정 개런티 불가',
    '마사지 팁 기준: 60분-$2, 90분-$3, 120분-$4 (변동 가능)',
    '패키지 일정 미참여시 패널티 1인/1박/$150 청구',
    '미성년자(만13세 미만) 부모 미동반 여행 시 영문동의서 공증 필수',
    '루앙프라방 탁발은 사전 신청 시 진행 가능 (추가금액 X)',
    '실시간 기준 예약 시 좌석 및 호텔 리체크 필수',
    '4월 30일 이전 발권 기준, 추후 발권 시 금액 인상',
  ],
  special_notes: '쇼핑: 침향, 잡화, 흑생강, 커피 중 3회\n싱글차지 27만원\n노팁노옵션 전일정 5성급\n고속철도 여권 스캔본 필수\n루앙프라방 탁발 사전 신청 가능\n계약금 12%',
  product_highlights: [
    '4박6일 여유로운 일정 (일요일 출발)',
    '노팁노옵션 전일정 5성급 호텔',
    '버기카+짚라인+카약킹+롱테일 전부 포함',
    '마사지 2시간 포함',
    '루앙프라방+방비엥 2박 깊이 있는 여행',
    '라오스 고속철도 탑승',
  ],
  product_summary: '에어부산 직항 비엔티안/루앙프라방/방비엥 노팁노옵션 4박6일 (일요일 출발). 전일정 5성급 호텔, 모든 옵션+팁 포함 올인클루시브. 여유로운 일정으로 루앙프라방과 방비엥을 깊이 탐방.',
  product_tags: ['라오스', '루앙프라방', '방비엥', '비엔티안', '노팁노옵션', '5성급', '4박6일', '고속철도', '에어부산'],
  accommodations: ['5성급 무엉탄 럭셔리 호텔 또는 동급', '5성급 루앙프라방뷰 호텔 또는 동급', '5성급 티마크 리조트 방비엥 또는 동급'],
  itinerary: [
    'DAY1: 부산→비엔티안 | BX745 18:00-21:10 | 호텔체크인 | 무엉탄(5성)',
    'DAY2: 비엔티안→루앙프라방(고속열차) | 꽝시폭포, 푸씨산, 몽족야시장 | 루앙프라방뷰(5성)',
    'DAY3: 루앙프라방→방비엥(고속열차) | 탁발, 왓마이, 왓시엥통, 왕궁박물관 | 롱테일보트, 마사지2h | 티마크(5성)',
    'DAY4: 방비엥 전일 | 재래시장, 블루라군, 버기카, 짚라인, 동굴튜빙, 카약래프팅, 카통 | 티마크(5성)',
    'DAY5: 방비엥→비엔티안 | 열대과일, 빠뚜싸이, 왓탓루앙, 쇼핑3회, 메콩야시장',
    'DAY6: BX746 01:35-07:50 부산도착',
  ],
  itinerary_data: {
    meta: {
      title: '[BX] 비엔티안/루앙프라방/방비엥 노팁노옵션 전일정 특급 4박6일',
      product_type: '노팁노옵션', destination: '비엔티안/루앙프라방/방비엥',
      nights: 4, days: 6, departure_airport: '부산(김해)',
      airline: 'BX(에어부산)', flight_out: 'BX745', flight_in: 'BX746',
      departure_days: '매주 일요일', min_participants: 4,
      room_type: '2인1실 OR 3인1실', ticketing_deadline: null,
      hashtags: ['#노팁노옵션', '#5성급', '#4박6일', '#루앙프라방', '#방비엥', '#고속철도'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험, 기사/가이드 경비',
        '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료',
        '특전! 카약킹, 마사지 2시간, 과일도시락, 열대과일 시식&커피 시음',
        '버기카, 짚라인, 카약킹, 롱테일',
        '라오스 고속철도 탑승 – 여권 스캔본 필수',
      ],
      excludes: ['개인 비용, 매너팁'],
      shopping: '침향, 잡화, 흑생강, 커피 중 3회 방문',
      remarks: [
        '싱글차지 전일정 기준 인당 27만원 추가',
        '여권만료일은 입국일 기준 6개월 이상 남아있어야 출국 가능합니다.',
        '라오스 전자담배 반입 불가합니다.',
        '루앙프라방 탁발은 사전 신청 시 진행 가능합니다. (추가금액 X)',
        '상기 일정은 항공 및 현지 사정에 의하여 변경될 수 있습니다.',
      ],
    },
    days: [
      day1_arrival('무엉탄 럭셔리 호텔 또는 동급', '5성'),
      {
        day: 2, regions: ['비엔티안', '루앙프라방'],
        meals: meal(true, true, true, '호텔식', '현지식', '보쌈정식'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃, 가이드 미팅'),
          train(null, '루앙프라방으로 이동 (약 2시간 소요)', '고속열차'),
          normal(null, '에메랄드빛 물 웅덩이가 계단처럼 펼쳐진 비경 꽝시 폭포 (삼림욕)'),
          normal(null, '루앙프라방 전경을 한눈에 담을 수 있는 푸씨산'),
          normal(null, '석식 후 루앙프라방의 대표 야시장인 몽족 야시장 관광 및 자유시간'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '루앙프라방뷰 호텔 또는 동급', grade: '5성', note: null },
      },
      {
        day: 3, regions: ['루앙프라방', '방비엥'],
        meals: meal(true, true, true, '호텔식', '한식', '오리주물럭'),
        schedule: [
          normal(null, '루앙프라방 새벽 탁발 & 새벽시장 관광'),
          normal(null, '호텔 조식 후 체크아웃'),
          normal(null, '라오스의 새로운 시작을 알리기 위해 만들어진 왕실 사원 왓마이'),
          normal(null, '루앙프라방 대표사원, 모자이크 벽화를 볼 수 있는 왓시엥통'),
          normal(null, '마지막 왕조의 생활상을 볼 수 있는 왕궁박물관 및 황금불상'),
          train(null, '방비엥으로 이동 (약 1시간 소요)', '고속열차'),
          normal(null, '쏭강의 노을 감상하며 롱테일보트 체험'),
          normal(null, '전신 마사지 2시간 특전 포함', '소아 제외/팁 별도'),
          normal(null, '석식 후 여행자거리&방비엥 야시장 자유시간'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '티마크 리조트 방비엥 또는 동급', grade: '5성', note: null },
      },
      {
        day: 4, regions: ['방비엥'],
        meals: meal(true, true, true, '호텔식', 'BBQ도시락', '무제한삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '몬도가네 아침 재래시장 관광'),
          normal(null, '푸른 물빛을 자랑하는 천연 수영장 블루라군 & 다이빙 체험'),
          normal(null, '오프로드 질주 본능 버기카'),
          normal(null, '중식 후 숲을 가로지르는 짚라인 체험'),
          normal(null, '튜브를 타고 동굴을 탐험하는 이색체험 탐쌍 & 탐남 동굴 튜빙'),
          normal(null, '쏭강을 따라 카약을 타고 내려오는 카약 래프팅 (약 1시간)'),
          normal(null, '석식 후 소원을 담아 쏭강에 띄워보내는 꽃불 카통 체험 (2인1개)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '티마크 리조트 방비엥 또는 동급', grade: '5성', note: null },
      },
      {
        day: 5, regions: ['방비엥', '비엔티안'],
        meals: meal(true, true, true, '호텔식', '라오수끼', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃, 가이드 미팅'),
          normal(null, '비엔티안으로 이동 (약 2시간 소요)'),
          normal(null, '중식 후 비엔티안 시내관광'),
          normal(null, '망고의 천국 라오스, 열대과일 시식 & 커피 시음'),
          normal(null, '라오스 독립의 상징 빠뚜싸이 독립기념문'),
          normal(null, '라오스의 불교성지 석가모니 진신사리가 모셔진 왓탓루앙'),
          shopping(null, '비엔티안 쇼핑센터 방문 (3회)'),
          normal(null, '석식 후 메콩 야시장 + 짜오아누봉 공원 자유시간'),
          normal(null, '공항으로 이동'),
        ],
        hotel: null,
      },
      dayLast_4n6d(),
    ],
    optional_tours: [],
  },
};

// ── 일괄 등록 ──
const ALL_PACKAGES = [PKG1, PKG2, PKG3, PKG4, PKG5, PKG6];

async function main() {
  console.log(`📦 라오스 패키지 ${ALL_PACKAGES.length}개 일괄 등록 시작...\n`);

  const rows = ALL_PACKAGES.map(pkg => ({
    title: pkg.title,
    destination: pkg.destination,
    country: pkg.country,
    category: pkg.category,
    product_type: pkg.product_type,
    trip_style: pkg.trip_style,
    duration: pkg.duration,
    nights: pkg.nights,
    departure_airport: pkg.departure_airport,
    airline: pkg.airline,
    min_participants: pkg.min_participants,
    status: pkg.status,
    price: pkg.price,
    guide_tip: pkg.guide_tip,
    single_supplement: pkg.single_supplement,
    small_group_surcharge: pkg.small_group_surcharge,
    surcharges: pkg.surcharges,
    excluded_dates: pkg.excluded_dates,
    optional_tours: pkg.optional_tours,
    price_tiers: pkg.price_tiers,
    inclusions: pkg.inclusions,
    excludes: pkg.excludes,
    notices_parsed: pkg.notices_parsed,
    special_notes: pkg.special_notes,
    product_highlights: pkg.product_highlights,
    product_summary: pkg.product_summary,
    product_tags: pkg.product_tags,
    itinerary_data: pkg.itinerary_data,
    itinerary: pkg.itinerary,
    accommodations: pkg.accommodations,
    raw_text: pkg.raw_text || '',
    filename: pkg.filename,
    file_type: pkg.file_type,
    confidence: pkg.confidence,
  }));

  const { data, error } = await sb
    .from('travel_packages')
    .insert(rows)
    .select('id, title, status, price');

  if (error) {
    console.error('❌ 등록 실패:', error.message);
    process.exit(1);
  }

  console.log(`✅ ${data.length}개 상품 등록 완료!\n`);
  data.forEach((r, i) => {
    console.log(`  ${i + 1}. [${r.status}] ${r.title}`);
    console.log(`     ID: ${r.id} | 기준가: ₩${r.price?.toLocaleString()}`);
  });
}

main();
