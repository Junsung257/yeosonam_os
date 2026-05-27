/**
 * ★ 부산-하노이 26년 4~9월 품격팩 [VN] 3개 상품 일괄 등록
 * 1) 관광 품격 - 하노이/옌뜨or닌빈/하롱베이
 * 2) 디너크루즈 품격 - 하노이/메가월드/하롱베이/디너크루즈
 * 3) 사파 품격 - 사파2박+하노이1박 노팁노옵션
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
function meal(b, l, d, bn, ln, dn) {
  return { breakfast: b, lunch: l, dinner: d, breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null };
}

// ── 공통 상수 ──
const COMMON = {
  country: '베트남',
  departure_airport: '부산(김해)',
  airline: 'VN(베트남항공)',
  category: 'package',
  status: 'pending',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
};

const SURCHARGES = [
  { period: '4/30, 5/1, 5/2, 8/31~9/2', amount_krw: null, note: '하노이 5성 미정 (추후 추가가능성O)' },
  { period: '4/30, 5/1, 5/2, 8/31~9/2', amount_krw: null, note: '하롱베이 5성 미정' },
  { period: '4/30, 5/1, 5/2, 8/31~9/2', amount_krw: 40000, note: '사파 5성 (1인/1박)' },
  { period: '4/30, 5/1, 5/2, 8/31~9/2', amount_krw: 50000, note: '사파 의무식사' },
];

// ── 공통 가격 티어 (3개 상품 공통 구조, 금액만 다름) ──
function makePriceTiers(prices) {
  // prices = [p1, p2, p3, p4, p5, p6] for each period
  return [
    { period_label: '4/1~4/29', date_range: { start: '2026-04-01', end: '2026-04-29' }, adult_price: prices[0], status: 'available' },
    { period_label: '4/30', departure_dates: ['2026-04-30'], adult_price: prices[1], status: 'available' },
    { period_label: '5/3~6/30', date_range: { start: '2026-05-03', end: '2026-06-30' }, adult_price: prices[2], status: 'available' },
    { period_label: '8/23~9/17', date_range: { start: '2026-08-23', end: '2026-09-17' }, adult_price: prices[2], status: 'available' },
    { period_label: '9/26~9/30', date_range: { start: '2026-09-26', end: '2026-09-30' }, adult_price: prices[2], status: 'available' },
    { period_label: '7/1~7/16', date_range: { start: '2026-07-01', end: '2026-07-16' }, adult_price: prices[3], status: 'available' },
    { period_label: '8/15~8/22', date_range: { start: '2026-08-15', end: '2026-08-22' }, adult_price: prices[3], status: 'available' },
    { period_label: '9/18~9/22', date_range: { start: '2026-09-18', end: '2026-09-22' }, adult_price: prices[3], status: 'available' },
    { period_label: '7/17~8/14', date_range: { start: '2026-07-17', end: '2026-08-14' }, adult_price: prices[4], status: 'available' },
    { period_label: '9/25', departure_dates: ['2026-09-25'], adult_price: prices[5], status: 'available' },
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
//  1. 관광 품격 - [VN] 하노이/옌뜨or닌빈/하롱베이 품격 3박5일
// ══════════════════════════════════════════════════════════════════════════════
const PKG1 = {
  ...COMMON,
  title: '[VN] 하노이/옌뜨or닌빈/하롱베이 품격 3박5일',
  destination: '하노이/하롱베이',
  product_type: '품격',
  trip_style: '3박5일',
  duration: 5, nights: 3,
  price: 859000,
  min_participants: 6,
  guide_tip: '포함',
  single_supplement: '16만원(전일정)',
  small_group_surcharge: null,
  surcharges: SURCHARGES,
  excluded_dates: [],
  optional_tours: [],
  price_tiers: makePriceTiers([879000, 959000, 859000, 919000, 1059000, 899000]),
  inclusions: [
    '호텔, 차량, 전일정 식사, 한국인가이드&현지인가이드, 관광지 입장료, 가이드/기사팁',
    '하롱베이 선상크루즈+티톱 전망대 + 비경투어(스피드보트+항루언) + 선상식(씨푸드) / 선장팁',
    '하롱베이 시티투어(2층버스): 하롱베이+혼가이 관광',
    '베트남 전통 마사지 120분(팁 별도) 1회',
    '하노이 시내관광(호치민 생가, 바딘 광장, 한기둥 사원 등)',
    '호안끼엠 호수 주변 및 36거리 관광 + 스트릿카 체험(팁별도 $1)',
    '전일정 식사: 한식(샤브샤브,삼겹살,제육쌈밥정식), 현지식(분짜 또는 월남쌈정식), 선상식+해산물, 드마리스뷔페',
    '특전: 마사지1회(60분)+망고도시락(2인/1개)+반미+생과일음료 또는 로컬맥주(1인/1캔)',
  ],
  excludes: [
    '에티켓 팁, 개인 경비',
    '쇼핑: 침향, 커피, LD스토어 잡화 3회',
  ],
  notices_parsed: [
    '계약금 12%',
    '싱글차지 전일정 16만원',
    '여권만료일 6개월',
    '베트남 자국민 보호법으로 공항미팅/관광지 방문 불가, 차량에서 대체',
    '패키지 미참여 패널티 $100/박/인',
    '마사지 팁: 60분-$5, 90분-$6, 120분-$7',
    '미성년자(만14세 미만) 영문 가족관계증명서',
    '부모 미동반 시 영문 부모동의서 공증',
    '조인행사 가능',
    '4/24까지 발권조건',
  ],
  special_notes: '쇼핑: 침향, 커피, LD스토어 잡화 3회\n싱글차지 16만원(전일정)\n계약금 12%\n4/24까지 발권조건\n조인행사 가능',
  product_highlights: [
    '하롱베이 선상크루즈+티톱전망대+비경투어(스피드보트)',
    '하롱베이 2층버스 시티투어',
    '베트남 전통 마사지 120분 포함',
    '호안끼엠 호수+36거리+스트릿카',
    '하노이 시내관광(호치민생가, 바딘광장, 한기둥사원)',
    '옌뜨 국립공원 OR 닌빈 삼판배 택1',
    '특전: 마사지60분+망고도시락+반미+맥주/음료',
  ],
  product_summary: '베트남항공 부산출발 하노이/하롱베이 품격 3박5일. 하롱베이 선상크루즈+비경투어+2층버스 시티투어, 옌뜨 또는 닌빈 택1, 마사지120분+60분 포함. 전일정 5성 호텔.',
  product_tags: ['베트남', '하노이', '하롱베이', '품격', '베트남항공', '선상크루즈', '옌뜨', '닌빈', '5성급'],
  accommodations: ['하노이: 아라벨, 그랜드K, 그랜드플라자 또는 동급 (5성)', '하롱베이: 델라씨, 드리오로, 솔레일 또는 동급 (5성)'],
  itinerary: [
    'DAY1: 부산→하노이 | VN429 08:00집결/11:00출발/13:15도착 | 중식(쌀국수), 시내관광(호치민생가/한기둥사원/바딘광장), 기찻길&맥주거리, 마사지120분 | 석식(한식) | 아라벨/그랜드K/그랜드플라자(5성)',
    'DAY2: 하노이→하롱베이 | 옌뜨OR닌빈 택1 | 중식(현지식) 후 하롱베이이동(1-2h) | 석식(샤브샤브) | 델라씨/드리오로/솔레일(5성)',
    'DAY3: 하롱베이 전일 | 선상크루즈, 석회동굴, 티톱전망대, 항루원스피드보트, 시티투어(2층버스), 마사지60분 | 호텔식/선상식/삼겹살 | 델라씨(5성)',
    'DAY4: 하롱베이→하노이(3h) | 쇼핑, 호안끼엠호수+36거리+스트릿카, 롯데전망대 | 호텔식/현지식/드마리스뷔페 | 공항이동',
    'DAY5: VN428 01:15→07:05 부산',
  ],
  itinerary_data: {
    meta: {
      title: '[VN] 하노이/옌뜨or닌빈/하롱베이 품격 3박5일',
      product_type: '품격', destination: '하노이/하롱베이',
      nights: 3, days: 5, departure_airport: '부산(김해)',
      airline: 'VN(베트남항공)', flight_out: 'VN429', flight_in: 'VN428',
      departure_days: null, min_participants: 6,
      room_type: '2인1실', ticketing_deadline: '4/24',
      hashtags: ['#하노이', '#하롱베이', '#선상크루즈', '#옌뜨', '#닌빈', '#품격', '#5성급'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '호텔, 차량, 전일정 식사, 한국인가이드&현지인가이드, 관광지 입장료, 가이드/기사팁',
        '하롱베이 선상크루즈+티톱 전망대 + 비경투어(스피드보트+항루언) + 선상식(씨푸드) / 선장팁',
        '하롱베이 시티투어(2층버스): 하롱베이+혼가이 관광',
        '베트남 전통 마사지 120분(팁 별도) 1회',
        '하노이 시내관광(호치민 생가, 바딘 광장, 한기둥 사원 등)',
        '호안끼엠 호수 주변 및 36거리 관광 + 스트릿카 체험(팁별도 $1)',
        '전일정 식사: 한식(샤브샤브,삼겹살,제육쌈밥정식), 현지식(분짜 또는 월남쌈정식), 선상식+해산물, 드마리스뷔페',
        '특전! 마사지1회(60분)+망고도시락(2인/1개)+반미+생과일음료 또는 로컬맥주(1인/1캔)',
      ],
      excludes: [
        '에티켓 팁, 개인 경비',
      ],
      shopping: '침향, 커피, LD스토어 잡화 3회',
      remarks: [
        '싱글차지 전일정 16만원',
        '여권만료일 6개월 이상 필수',
        '베트남 자국민 보호법으로 공항미팅/관광지 방문 불가, 차량에서 대체',
        '패키지 미참여 패널티 $100/박/인',
        '마사지 팁 기준: 60분-$5, 90분-$6, 120분-$7',
        '미성년자(만14세 미만) 영문 가족관계증명서 필수',
        '부모 미동반 시 영문 부모동의서 공증 필수',
        '조인행사 가능',
        '4/24까지 발권조건',
      ],
    },
    days: [
      {
        day: 1, regions: ['부산', '하노이'],
        meals: meal(false, true, true, null, '쌀국수', '한식'),
        schedule: [
          flight('08:00', '부산 김해공항 집결', 'VN429'),
          flight('11:00', '부산 출발', 'VN429'),
          flight('13:15', '하노이 노이바이 국제공항 도착, 가이드 미팅', 'VN429'),
          normal(null, '중식(쌀국수) 후 하노이 시내관광'),
          normal(null, '호치민 생가 / 한기둥 사원 / 바딘 광장 (월금 휴관 시 옥산사 대체)'),
          normal(null, '기찻길 & 맥주거리 (맥주 또는 음료 1잔)'),
          normal(null, '베트남 전통 마사지 120분', '팁 별도'),
          normal(null, '석식(한식) 후 호텔 체크인 및 휴식'),
        ],
        hotel: { name: '아라벨/그랜드K/그랜드플라자 또는 동급', grade: '5성', note: null },
      },
      {
        day: 2, regions: ['하노이', '하롱베이'],
        meals: meal(true, true, true, '호텔식', '현지식', '샤브샤브'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃'),
          normal(null, '★옌뜨 OR 닌빈 택1 진행'),
          normal(null, '옌뜨 코스: 옌뜨국립공원(2h이동) 케이블카 탑승'),
          normal(null, '닌빈 코스: 삼판배 기암괴석, 삼동굴, 바이딘사원'),
          normal(null, '중식(현지식) 후 하롱베이 이동 (1~2시간 소요)'),
          normal(null, '석식(샤브샤브) 후 호텔 체크인 및 휴식'),
        ],
        hotel: { name: '델라씨/드리오로/솔레일 또는 동급', grade: '5성', note: null },
      },
      {
        day: 3, regions: ['하롱베이'],
        meals: meal(true, true, true, '호텔식', '선상식(씨푸드)', '삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '하롱베이 선상크루즈 - 3000개 섬 유람'),
          normal(null, '석회동굴 관광'),
          normal(null, '티톱 전망대'),
          normal(null, '항루원 스피드보트 비경투어'),
          normal(null, '중식(선상식 씨푸드)'),
          normal(null, '하롱베이 시티투어(2층버스) - 하롱베이+혼가이 관광'),
          normal(null, '마사지 60분', '팁 별도'),
          normal(null, '석식(삼겹살) 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '델라씨 또는 동급', grade: '5성', note: null },
      },
      {
        day: 4, regions: ['하롱베이', '하노이'],
        meals: meal(true, true, true, '호텔식', '현지식', '드마리스뷔페'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃, 하노이로 이동 (약 3시간 소요)'),
          shopping(null, '쇼핑 (침향, 커피, LD스토어 잡화 3회)'),
          normal(null, '호안끼엠 호수 주변 + 36거리 관광'),
          normal(null, '스트릿카 체험', '팁별도 $1'),
          normal(null, '롯데 전망대'),
          normal(null, '석식(드마리스뷔페) 후 공항으로 이동'),
        ],
        hotel: null,
      },
      {
        day: 5, regions: ['하노이', '부산'],
        meals: meal(false, false, false, null, null, null),
        schedule: [
          flight('01:15', '하노이 출발', 'VN428'),
          flight('07:05', '부산 도착', 'VN428'),
        ],
        hotel: null,
      },
    ],
    optional_tours: [],
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  2. 디너크루즈 품격 - [VN] 하노이/메가월드/하롱베이/디너크루즈 품격 3박5일
// ══════════════════════════════════════════════════════════════════════════════
const PKG2 = {
  ...COMMON,
  title: '[VN] 하노이/메가월드/하롱베이/디너크루즈 품격 3박5일',
  destination: '하노이/하롱베이',
  product_type: '품격',
  trip_style: '3박5일',
  duration: 5, nights: 3,
  price: 959000,
  min_participants: 6,
  guide_tip: '포함',
  single_supplement: '16만원(전일정)',
  small_group_surcharge: null,
  surcharges: SURCHARGES,
  excluded_dates: [],
  optional_tours: [],
  price_tiers: makePriceTiers([979000, 1059000, 959000, 1019000, 1159000, 999000]),
  inclusions: [
    '호텔, 차량, 전일정 식사, 한국인가이드&현지인가이드, 관광지 입장료, 가이드/기사팁',
    '하롱베이 선상크루즈+티톱 전망대 + 비경투어(스피드보트+항루언) + 선상식(씨푸드) / 선장팁',
    '하롱베이 시티투어(2층버스): 하롱베이+혼가이 관광',
    '하롱베이 디너크루즈&메가그랜드월드 관광',
    '베트남 전통 마사지 120분(팁 별도) 1회',
    '하노이 시내관광(호치민 생가, 바딘 광장, 한기둥 사원 등)',
    '호안끼엠 호수 주변 및 36거리 관광 + 스트릿카 체험(팁별도 $1)',
    '전일정 식사: 한식(샤브샤브,삼겹살,제육쌈밥정식), 현지식(분짜 또는 월남쌈정식), 선상식+해산물, 드마리스뷔페, 디너크루즈뷔페',
    '특전: 마사지1회(60분)+망고도시락(2인/1개)+반미+생과일음료 또는 로컬맥주(1인/1캔)',
  ],
  excludes: [
    '에티켓 팁, 개인 경비',
    '쇼핑: 침향, 커피, LD스토어 잡화 3회',
  ],
  notices_parsed: [
    '계약금 12%',
    '싱글차지 전일정 16만원',
    '여권만료일 6개월',
    '베트남 자국민 보호법으로 공항미팅/관광지 방문 불가, 차량에서 대체',
    '패키지 미참여 패널티 $100/박/인',
    '마사지 팁: 60분-$5, 90분-$6, 120분-$7',
    '미성년자(만14세 미만) 영문 가족관계증명서',
    '부모 미동반 시 영문 부모동의서 공증',
    '조인행사 가능',
    '4/24까지 발권조건',
  ],
  special_notes: '쇼핑: 침향, 커피, LD스토어 잡화 3회\n싱글차지 16만원(전일정)\n계약금 12%\n4/24까지 발권조건\n하롱베이 디너크루즈+메가그랜드월드 포함',
  product_highlights: [
    '하롱베이 디너크루즈(앰버서더/옥토퍼스) - 야경+선상쇼+불꽃놀이',
    '메가그랜드월드 곤돌라 탑승 & 포토타임',
    '하롱베이 선상크루즈+티톱전망대+비경투어(스피드보트)',
    '하롱베이 2층버스 시티투어',
    '베트남 전통 마사지 120분 포함',
    '호안끼엠 호수+36거리+스트릿카',
    '특전: 마사지60분+망고도시락+반미+맥주/음료',
  ],
  product_summary: '베트남항공 부산출발 하노이/하롱베이 디너크루즈 품격 3박5일. 하롱베이 디너크루즈(야경+불꽃놀이)+메가그랜드월드, 선상크루즈+비경투어+2층버스 시티투어. 전일정 5성 호텔.',
  product_tags: ['베트남', '하노이', '하롱베이', '품격', '베트남항공', '디너크루즈', '메가월드', '5성급'],
  accommodations: ['하노이: 아라벨, 그랜드K, 그랜드플라자 또는 동급 (5성)', '하롱베이: 델라씨, 드리오로, 솔레일 또는 동급 (5성)'],
  itinerary: [
    'DAY1: 부산→하노이 | VN429 08:00집결/11:00출발/13:15도착 | 중식(쌀국수), 시내관광(호치민생가/한기둥사원/바딘광장), 기찻길&맥주거리, 마사지120분 | 석식(한식) | 아라벨/그랜드K/그랜드플라자(5성)',
    'DAY2: 하노이→하롱베이 | 메가그랜드월드(곤돌라탑승,포토타임), 중식(분짜정식) 후 하롱베이이동 | 디너크루즈(앰버서더/옥토퍼스) 야경+선상쇼+불꽃놀이 | 델라씨(5성)',
    'DAY3: 하롱베이 전일 | 선상크루즈, 석회동굴, 티톱전망대, 항루원스피드보트, 시티투어(2층버스), 마사지60분 | 호텔식/선상식/삼겹살 | 델라씨(5성)',
    'DAY4: 하롱베이→하노이(3h) | 쇼핑, 호안끼엠호수+36거리+스트릿카, 롯데전망대 | 호텔식/현지식/드마리스뷔페 | 공항이동',
    'DAY5: VN428 01:15→07:05 부산',
  ],
  itinerary_data: {
    meta: {
      title: '[VN] 하노이/메가월드/하롱베이/디너크루즈 품격 3박5일',
      product_type: '품격', destination: '하노이/하롱베이',
      nights: 3, days: 5, departure_airport: '부산(김해)',
      airline: 'VN(베트남항공)', flight_out: 'VN429', flight_in: 'VN428',
      departure_days: null, min_participants: 6,
      room_type: '2인1실', ticketing_deadline: '4/24',
      hashtags: ['#하노이', '#하롱베이', '#디너크루즈', '#메가월드', '#품격', '#5성급'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '호텔, 차량, 전일정 식사, 한국인가이드&현지인가이드, 관광지 입장료, 가이드/기사팁',
        '하롱베이 선상크루즈+티톱 전망대 + 비경투어(스피드보트+항루언) + 선상식(씨푸드) / 선장팁',
        '하롱베이 시티투어(2층버스): 하롱베이+혼가이 관광',
        '하롱베이 디너크루즈&메가그랜드월드 관광',
        '베트남 전통 마사지 120분(팁 별도) 1회',
        '하노이 시내관광(호치민 생가, 바딘 광장, 한기둥 사원 등)',
        '호안끼엠 호수 주변 및 36거리 관광 + 스트릿카 체험(팁별도 $1)',
        '전일정 식사: 한식(샤브샤브,삼겹살,제육쌈밥정식), 현지식(분짜정식), 선상식+해산물, 드마리스뷔페, 디너크루즈뷔페',
        '특전! 마사지1회(60분)+망고도시락(2인/1개)+반미+생과일음료 또는 로컬맥주(1인/1캔)',
      ],
      excludes: [
        '에티켓 팁, 개인 경비',
      ],
      shopping: '침향, 커피, LD스토어 잡화 3회',
      remarks: [
        '싱글차지 전일정 16만원',
        '여권만료일 6개월 이상 필수',
        '베트남 자국민 보호법으로 공항미팅/관광지 방문 불가, 차량에서 대체',
        '패키지 미참여 패널티 $100/박/인',
        '마사지 팁 기준: 60분-$5, 90분-$6, 120분-$7',
        '미성년자(만14세 미만) 영문 가족관계증명서 필수',
        '부모 미동반 시 영문 부모동의서 공증 필수',
        '조인행사 가능',
        '4/24까지 발권조건',
      ],
    },
    days: [
      // DAY1: same as PKG1
      {
        day: 1, regions: ['부산', '하노이'],
        meals: meal(false, true, true, null, '쌀국수', '한식'),
        schedule: [
          flight('08:00', '부산 김해공항 집결', 'VN429'),
          flight('11:00', '부산 출발', 'VN429'),
          flight('13:15', '하노이 노이바이 국제공항 도착, 가이드 미팅', 'VN429'),
          normal(null, '중식(쌀국수) 후 하노이 시내관광'),
          normal(null, '호치민 생가 / 한기둥 사원 / 바딘 광장 (월금 휴관 시 옥산사 대체)'),
          normal(null, '기찻길 & 맥주거리 (맥주 또는 음료 1잔)'),
          normal(null, '베트남 전통 마사지 120분', '팁 별도'),
          normal(null, '석식(한식) 후 호텔 체크인 및 휴식'),
        ],
        hotel: { name: '아라벨/그랜드K/그랜드플라자 또는 동급', grade: '5성', note: null },
      },
      // DAY2: 디너크루즈 코스 (다름)
      {
        day: 2, regions: ['하노이', '하롱베이'],
        meals: meal(true, true, true, '호텔식', '분짜정식', '디너크루즈뷔페'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃'),
          normal(null, '메가그랜드월드 관광 (곤돌라 탑승, 포토타임)'),
          normal(null, '중식(분짜정식) 후 하롱베이 이동'),
          normal(null, '하롱베이 디너크루즈(앰버서더 OR 옥토퍼스) - 야경 + 선상쇼 + 불꽃놀이'),
          normal(null, '호텔 체크인 및 휴식'),
        ],
        hotel: { name: '델라씨 또는 동급', grade: '5성', note: null },
      },
      // DAY3: same as PKG1
      {
        day: 3, regions: ['하롱베이'],
        meals: meal(true, true, true, '호텔식', '선상식(씨푸드)', '삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '하롱베이 선상크루즈 - 3000개 섬 유람'),
          normal(null, '석회동굴 관광'),
          normal(null, '티톱 전망대'),
          normal(null, '항루원 스피드보트 비경투어'),
          normal(null, '중식(선상식 씨푸드)'),
          normal(null, '하롱베이 시티투어(2층버스) - 하롱베이+혼가이 관광'),
          normal(null, '마사지 60분', '팁 별도'),
          normal(null, '석식(삼겹살) 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '델라씨 또는 동급', grade: '5성', note: null },
      },
      // DAY4: same as PKG1
      {
        day: 4, regions: ['하롱베이', '하노이'],
        meals: meal(true, true, true, '호텔식', '현지식', '드마리스뷔페'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃, 하노이로 이동 (약 3시간 소요)'),
          shopping(null, '쇼핑 (침향, 커피, LD스토어 잡화 3회)'),
          normal(null, '호안끼엠 호수 주변 + 36거리 관광'),
          normal(null, '스트릿카 체험', '팁별도 $1'),
          normal(null, '롯데 전망대'),
          normal(null, '석식(드마리스뷔페) 후 공항으로 이동'),
        ],
        hotel: null,
      },
      // DAY5
      {
        day: 5, regions: ['하노이', '부산'],
        meals: meal(false, false, false, null, null, null),
        schedule: [
          flight('01:15', '하노이 출발', 'VN428'),
          flight('07:05', '부산 도착', 'VN428'),
        ],
        hotel: null,
      },
    ],
    optional_tours: [],
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  3. 사파 품격 - [VN] 사파2박+하노이1박 노팁노옵션 품격 3박5일
// ══════════════════════════════════════════════════════════════════════════════
const PKG3 = {
  ...COMMON,
  title: '[VN] 사파2박+하노이1박 노팁노옵션 품격 3박5일',
  destination: '사파/하노이',
  product_type: '노팁노옵션',
  trip_style: '3박5일',
  duration: 5, nights: 3,
  price: 1059000,
  min_participants: 8,
  guide_tip: '포함',
  single_supplement: '20만원(전일정)',
  small_group_surcharge: null,
  surcharges: SURCHARGES,
  excluded_dates: [],
  optional_tours: [],
  price_tiers: makePriceTiers([1079000, 1159000, 1059000, 1119000, 1259000, 1099000]),
  inclusions: [
    '호텔, 차량, 전일정 식사, 한국인가이드&현지인가이드, 관광지 입장료, 가이드/기사팁',
    '사파: 케이블카, 모노레일(MOUNG HOA), 사파 여행자의 거리&야시장(맥주 또는 음료 1인/1병)',
    '트래킹 2회: 깟깟민속마을 / 함종산, 사파 전통 마사지 60분(팁별도/$5), 모아나+커피 한잔',
    '하노이: 시내관광, 호안끼엠 스트릿카(팁별도/$1), 전통마사지 60분(팁별도/$7)',
    '전일정 식사: 판시판뷔페, 현지식(러우팃보, 분짜+반쎄오), 한식(삼겹살, 김치전골), 드마리스뷔페',
    '특전: 망고도시락(2인/1개)+반미+생과일음료 또는 로컬맥주(1인/1캔)',
  ],
  excludes: [
    '에티켓 팁, 개인 경비, 써차지발생기간(4/30, 5/1, 9/1)',
    '쇼핑: 침향, 커피 OR 잡화 2회',
  ],
  notices_parsed: [
    '계약금 12%',
    '싱글차지 전일정 20만원',
    '여권만료일 6개월',
    '베트남 자국민 보호법으로 공항미팅/관광지 방문 불가, 차량에서 대체',
    '패키지 미참여 패널티 $100/박/인',
    '마사지 팁: 60분-$5, 90분-$6, 120분-$7',
    '미성년자(만14세 미만) 영문 가족관계증명서',
    '부모 미동반 시 영문 부모동의서 공증',
    '조인행사 가능',
    '4/24까지 발권조건',
    '깟깟마을 등 16인승 또는 스트릿카로 변경 (버스 운행 불가)',
    '트레킹 일정 많아 운동화/등산화 준비 필수',
    '예약 후 계약금 20만원/인 입금 시 예약확정',
  ],
  special_notes: '쇼핑: 침향, 커피 OR 잡화 2회\n싱글차지 20만원(전일정)\n노팁노옵션\n계약금 12%\n4/24까지 발권조건\n트레킹 일정 많아 운동화 필수\n예약 후 계약금 20만원/인 입금 시 예약확정',
  product_highlights: [
    '사파 판시판(3,143m) 정상 - 열차+케이블카+트램',
    '깟깟민속마을 트래킹 (2h)',
    '함롱산 트래킹 (2h)',
    '모아나 인생사진 + 커피',
    '사파 케이블카 + 모노레일(MOUNG HOA)',
    '하노이 시내관광 + 호안끼엠 스트릿카',
    '노팁노옵션 전일정 5성 호텔',
    '특전: 망고도시락+반미+맥주/음료',
  ],
  product_summary: '베트남항공 부산출발 사파2박+하노이1박 노팁노옵션 품격 3박5일. 판시판 정상(3,143m) 케이블카, 깟깟마을+함롱산 트래킹 2회, 사파 야시장. 전일정 5성 호텔 노팁노옵션.',
  product_tags: ['베트남', '사파', '하노이', '노팁노옵션', '품격', '베트남항공', '판시판', '트래킹', '5성급'],
  accommodations: ['사파: 레이디힐, 파오스 사파, KK사파 호텔 (5성)', '하노이: 아라벨, 그랜드K, 그랜드플라자 또는 동급 (5성)'],
  itinerary: [
    'DAY1: 부산→하노이→사파 | VN429 11:00-13:15 | 중식(쌀국수), 라오까이 거쳐 사파이동(5.5h), 석식(현지식), 여행자거리&야시장, 마사지60분 | 레이디힐/파오스사파/KK사파(5성)',
    'DAY2: 사파 전일 | 판시판(3,143m) 열차-케이블카-트램, 중식(판시판뷔페), 깟깟민속마을 트래킹(2h), 모아나+커피 | 호텔식/판시판뷔페/삼겹살 | 레이디힐(5성)',
    'DAY3: 사파→하노이 | 함롱산 트래킹(2h), 중식(현지식) 후 하노이이동(5.5h), 석식(러우팃보), 기찻길&맥주거리, 마사지60분 | 아라벨/그랜드K(5성)',
    'DAY4: 하노이 | 쇼핑2회, 시내관광(호치민생활관+바딘광장), 호안끼엠+여행자거리+스트릿카, 성요셉대성당, 롯데전망대 | 호텔식/분짜&반쎄오/드마리스뷔페 | 공항이동',
    'DAY5: VN428 01:15→07:05 부산',
  ],
  itinerary_data: {
    meta: {
      title: '[VN] 사파2박+하노이1박 노팁노옵션 품격 3박5일',
      product_type: '노팁노옵션', destination: '사파/하노이',
      nights: 3, days: 5, departure_airport: '부산(김해)',
      airline: 'VN(베트남항공)', flight_out: 'VN429', flight_in: 'VN428',
      departure_days: null, min_participants: 8,
      room_type: '2인1실', ticketing_deadline: '4/24',
      hashtags: ['#사파', '#판시판', '#트래킹', '#노팁노옵션', '#하노이', '#5성급'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '호텔, 차량, 전일정 식사, 한국인가이드&현지인가이드, 관광지 입장료, 가이드/기사팁',
        '사파: 케이블카, 모노레일(MOUNG HOA), 사파 여행자의 거리&야시장(맥주 또는 음료 1인/1병)',
        '트래킹 2회: 깟깟민속마을 / 함종산, 사파 전통 마사지 60분(팁별도/$5), 모아나+커피 한잔',
        '하노이: 시내관광, 호안끼엠 스트릿카(팁별도/$1), 전통마사지 60분(팁별도/$7)',
        '전일정 식사: 판시판뷔페, 현지식(러우팃보, 분짜+반쎄오), 한식(삼겹살, 김치전골), 드마리스뷔페',
        '특전! 망고도시락(2인/1개)+반미+생과일음료 또는 로컬맥주(1인/1캔)',
      ],
      excludes: [
        '에티켓 팁, 개인 경비, 써차지발생기간(4/30, 5/1, 9/1)',
      ],
      shopping: '침향, 커피 OR 잡화 2회',
      remarks: [
        '싱글차지 전일정 20만원',
        '여권만료일 6개월 이상 필수',
        '베트남 자국민 보호법으로 공항미팅/관광지 방문 불가, 차량에서 대체',
        '패키지 미참여 패널티 $100/박/인',
        '마사지 팁 기준: 60분-$5, 90분-$6, 120분-$7',
        '미성년자(만14세 미만) 영문 가족관계증명서 필수',
        '부모 미동반 시 영문 부모동의서 공증 필수',
        '조인행사 가능',
        '4/24까지 발권조건',
        '깟깟마을 등 16인승 또는 스트릿카로 변경 (버스 운행 불가)',
        '트레킹 일정 많아 운동화/등산화 준비 필수',
        '예약 후 계약금 20만원/인 입금 시 예약확정',
      ],
    },
    days: [
      {
        day: 1, regions: ['부산', '하노이', '사파'],
        meals: meal(false, true, true, null, '쌀국수', '현지식'),
        schedule: [
          flight('11:00', '부산 출발', 'VN429'),
          flight('13:15', '하노이 노이바이 국제공항 도착, 가이드 미팅', 'VN429'),
          normal(null, '중식(쌀국수) 후 라오까이 거쳐 사파로 이동 (약 5.5시간 소요)'),
          normal(null, '석식(현지식)'),
          normal(null, '사파 여행자의 거리 & 야시장 (맥주 또는 음료 1병)'),
          normal(null, '사파 전통 마사지 60분', '팁별도/$5'),
          normal(null, '호텔 체크인 및 휴식'),
        ],
        hotel: { name: '레이디힐/파오스사파/KK사파 또는 동급', grade: '5성', note: null },
      },
      {
        day: 2, regions: ['사파'],
        meals: meal(true, true, true, '호텔식', '판시판뷔페', '삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '판시판(3,143m) - 열차 + 케이블카 + 트램으로 정상 등정'),
          normal(null, '중식(판시판뷔페)'),
          normal(null, '깟깟민속마을 트래킹 (약 2시간)'),
          normal(null, '모아나 인생사진 + 커피 한잔'),
          normal(null, '석식(삼겹살) 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '레이디힐 또는 동급', grade: '5성', note: null },
      },
      {
        day: 3, regions: ['사파', '하노이'],
        meals: meal(true, true, true, '호텔식', '현지식', '러우팃보'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃'),
          normal(null, '함롱산 트래킹 (약 2시간)'),
          normal(null, '중식(현지식) 후 하노이로 이동 (약 5.5시간 소요)'),
          normal(null, '석식(러우팃보)'),
          normal(null, '기찻길 & 맥주거리 (맥주 또는 음료 1잔)'),
          normal(null, '하노이 전통 마사지 60분', '팁별도/$7'),
          normal(null, '호텔 체크인 및 휴식'),
        ],
        hotel: { name: '아라벨/그랜드K 또는 동급', grade: '5성', note: null },
      },
      {
        day: 4, regions: ['하노이'],
        meals: meal(true, true, true, '호텔식', '분짜&반쎄오', '드마리스뷔페'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃'),
          shopping(null, '쇼핑 (침향, 커피 OR 잡화 2회)'),
          normal(null, '시내관광 (호치민 생활관 + 바딘 광장, 월금 휴관 시 옥산사 대체)'),
          normal(null, '호안끼엠 호수 + 여행자거리 + 스트릿카 체험', '팁별도 $1'),
          normal(null, '성요셉 대성당'),
          normal(null, '롯데 전망대'),
          normal(null, '석식(드마리스뷔페) 후 공항으로 이동'),
        ],
        hotel: null,
      },
      {
        day: 5, regions: ['하노이', '부산'],
        meals: meal(false, false, false, null, null, null),
        schedule: [
          flight('01:15', '하노이 출발', 'VN428'),
          flight('07:05', '부산 도착', 'VN428'),
        ],
        hotel: null,
      },
    ],
    optional_tours: [],
  },
};

// ── 일괄 등록 ──
const ALL_PACKAGES = [PKG1, PKG2, PKG3];

async function main() {
  console.log(`📦 하노이 패키지 ${ALL_PACKAGES.length}개 일괄 등록 시작...\n`);

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
