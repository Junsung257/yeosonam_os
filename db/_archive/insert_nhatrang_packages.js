/**
 * ★ 부산-나트랑 26년 4~10월 노노팩 [BX] 3개 상품 일괄 등록
 * 1) 나달팩 노노 - 나트랑/달랏 5성 3박5일
 * 2) 나판달팩 노노 - 나트랑/판랑/달랏 5성 3박5일
 * 3) 호판팩(나호판) 노노 - 나트랑 호판팩+특식3회 5성 3박5일
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
  airline: 'BX(에어부산)',
  category: 'package',
  status: 'pending',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
  product_type: '노팁노옵션',
  trip_style: '3박5일',
  duration: 5,
  nights: 3,
  departure_days: '매일출발',
  guide_tip: '포함',
  single_supplement: '16만원(전일정)',
  small_group_surcharge: null,
};

const SURCHARGES = [
  { period: '4/26', amount_krw: 13000, note: '나트랑 레갈리아골드 5성 (1인/1박)' },
  { period: '4/30~5/1', amount_krw: 13000, note: '나트랑 레갈리아골드 5성 (1인/1박)' },
  { period: '9/2', amount_krw: 13000, note: '나트랑 레갈리아골드 5성 (1인/1박)' },
  { period: '4/30~5/1', amount_krw: 30000, note: '달랏 멀펄 5성 (1인/1박)' },
  { period: '9/1~9/2', amount_krw: 30000, note: '달랏 멀펄 5성 (1인/1박)' },
  { period: '4/30, 5/1, 9/1, 9/2', amount_krw: 25000, note: '달랏 의무식사 (1회)' },
];

// 노노는 옵션 없음 (노팁노옵션)
const OPTIONAL_TOURS_NONO = [];

const SHOPPING = '침향, 커피, 잡화점, 라텍스 중 3회 방문';

const COMMON_NOTICES = [
  '계약금 12%',
  '싱글차지 전일정 기준 인당 16만원 추가',
  '여권만료일 입국일 기준 6개월 이상 필수',
  '베트남 자국민 보호법으로 공항미팅/관광지 방문 불가, 차량에서 대체 설명',
  '호텔 룸배정 개런티 불가',
  '마사지 팁 기준: 나트랑 60분-$4/90분-$5/120분-$6, 달랏 60분-$4/90분-$5/120분-$7 (변동 가능)',
  '패키지 일정 미참여시 패널티 1인/1박/$100 청구',
  '식당 주차장 부족으로 도보이동 가능',
  '베트남 전자담배 반입 불가 (25년 1월부터)',
  '4/27 이전 선발기준 요금, 추후 변동 가능',
  '미성년자(만14세 미만) 영문 가족관계증명서 지참 필수',
  '부모 미동반 시 영문 부모동의서 공증 필수',
  '에어부산 증편 항공 스케줄 (기본: 월,화 운항, 5/18~6/20: 투데일리)',
];

// ── 공통 일정 블록 ──
function day1_arrival() {
  return {
    day: 1,
    regions: ['부산', '나트랑'],
    meals: meal(false, false, false, null, null, null),
    schedule: [
      flight('16:20', '부산 김해공항 미팅 후 출발', 'BX781'),
      flight('19:30', '경유지 도착', 'BX781'),
      flight('22:40', '나트랑 깜란 국제공항 도착, 한국인 가이드 미팅', 'BX781'),
      normal(null, '호텔 CHECK-IN 및 휴식'),
    ],
    hotel: { name: '레갈리아골드', grade: '5성', note: null },
  };
}

function dayLast() {
  return {
    day: 5,
    regions: ['부산'],
    meals: meal(false, false, false, null, null, null),
    schedule: [
      flight('06:20', '부산 도착', 'BX782'),
    ],
    hotel: null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  나달팩 공통 요금 티어 (Package 1 기준, Package 2/3은 오프셋 적용)
// ══════════════════════════════════════════════════════════════════════════════
function buildPriceTiers(offset) {
  return [
    // 9/13~9/29 (9/22-25 제외) 수목금
    { period_label: '9/13~9/29 수목금 (9/22-25 제외)', date_range: { start: '2026-09-13', end: '2026-09-29' }, departure_day_of_week: '수,목,금', adult_price: 779000 + offset, status: 'available', note: '9/22-25 제외' },
    // 9/13~9/29 (9/22-25 제외) 토일
    { period_label: '9/13~9/29 토일 (9/22-25 제외)', date_range: { start: '2026-09-13', end: '2026-09-29' }, departure_day_of_week: '토,일', adult_price: 739000 + offset, status: 'available', note: '9/22-25 제외' },
    // 5/3~7/14, 8/30~9/12 (6/2 제외) 월화
    { period_label: '5/3~7/14 월화 (6/2 제외)', date_range: { start: '2026-05-03', end: '2026-07-14' }, departure_day_of_week: '월,화', adult_price: 819000 + offset, status: 'available', note: '6/2 제외' },
    { period_label: '8/30~9/12 월화', date_range: { start: '2026-08-30', end: '2026-09-12' }, departure_day_of_week: '월,화', adult_price: 819000 + offset, status: 'available' },
    // 7/18~7/22, 8/16~8/29, 10/4~10/21 수목금
    { period_label: '7/18~7/22 수목금', date_range: { start: '2026-07-18', end: '2026-07-22' }, departure_day_of_week: '수,목,금', adult_price: 859000 + offset, status: 'available' },
    { period_label: '8/16~8/29 수목금', date_range: { start: '2026-08-16', end: '2026-08-29' }, departure_day_of_week: '수,목,금', adult_price: 859000 + offset, status: 'available' },
    { period_label: '10/4~10/21 수목금', date_range: { start: '2026-10-04', end: '2026-10-21' }, departure_day_of_week: '수,목,금', adult_price: 859000 + offset, status: 'available' },
    // 7/18~7/22, 8/16~8/29, 10/4~10/21 토일월화
    { period_label: '7/18~7/22 토일월화', date_range: { start: '2026-07-18', end: '2026-07-22' }, departure_day_of_week: '토,일,월,화', adult_price: 819000 + offset, status: 'available' },
    { period_label: '8/16~8/29 토일월화', date_range: { start: '2026-08-16', end: '2026-08-29' }, departure_day_of_week: '토,일,월,화', adult_price: 819000 + offset, status: 'available' },
    { period_label: '10/4~10/21 토일월화', date_range: { start: '2026-10-04', end: '2026-10-21' }, departure_day_of_week: '토,일,월,화', adult_price: 819000 + offset, status: 'available' },
    // 4/1~4/28, 8/8~8/11 수목금
    { period_label: '4/1~4/28 수목금', date_range: { start: '2026-04-01', end: '2026-04-28' }, departure_day_of_week: '수,목,금', adult_price: 919000 + offset, status: 'available' },
    { period_label: '8/8~8/11 수목금', date_range: { start: '2026-08-08', end: '2026-08-11' }, departure_day_of_week: '수,목,금', adult_price: 919000 + offset, status: 'available' },
    // 4/1~4/28, 8/8~8/11 토일월화
    { period_label: '4/1~4/28 토일월화', date_range: { start: '2026-04-01', end: '2026-04-28' }, departure_day_of_week: '토,일,월,화', adult_price: 859000 + offset, status: 'available' },
    { period_label: '8/8~8/11 토일월화', date_range: { start: '2026-08-08', end: '2026-08-11' }, departure_day_of_week: '토,일,월,화', adult_price: 859000 + offset, status: 'available' },
    // 7/28~8/7 (7/29-8/1 제외) 수목금
    { period_label: '7/28~8/7 수목금 (7/29-8/1 제외)', date_range: { start: '2026-07-28', end: '2026-08-07' }, departure_day_of_week: '수,목,금', adult_price: 999000 + offset, status: 'available', note: '7/29-8/1 제외' },
    // 7/28~8/7 (7/29-8/1 제외) 토일월화
    { period_label: '7/28~8/7 토일월화 (7/29-8/1 제외)', date_range: { start: '2026-07-28', end: '2026-08-07' }, departure_day_of_week: '토,일,월,화', adult_price: 959000 + offset, status: 'available', note: '7/29-8/1 제외' },
    // 7/23~7/28 ALL
    { period_label: '7/23~7/28 전요일', date_range: { start: '2026-07-23', end: '2026-07-28' }, adult_price: 1059000 + offset, status: 'available' },
    // ── 특정 제외일자 특별요금 ──
    { period_label: '4/29, 5/2, 8/1, 8/12, 8/13, 8/15', departure_dates: ['2026-04-29', '2026-05-02', '2026-08-01', '2026-08-12', '2026-08-13', '2026-08-15'], adult_price: 1159000 + offset, status: 'available', note: '제외일자 특별요금' },
    { period_label: '5/21, 5/22, 8/14, 9/22, 10/1, 10/2, 10/8', departure_dates: ['2026-05-21', '2026-05-22', '2026-08-14', '2026-09-22', '2026-10-01', '2026-10-02', '2026-10-08'], adult_price: 1279000 + offset, status: 'available', note: '제외일자 특별요금' },
    { period_label: '5/23, 5/30, 6/2', departure_dates: ['2026-05-23', '2026-05-30', '2026-06-02'], adult_price: 939000 + offset, status: 'available', note: '제외일자 특별요금' },
    { period_label: '5/20, 6/3, 7/17, 9/30, 10/9', departure_dates: ['2026-05-20', '2026-06-03', '2026-07-17', '2026-09-30', '2026-10-09'], adult_price: 979000 + offset, status: 'available', note: '제외일자 특별요금' },
    { period_label: '7/29~7/31, 10/7', departure_dates: ['2026-07-29', '2026-07-30', '2026-07-31', '2026-10-07'], adult_price: 1219000 + offset, status: 'available', note: '제외일자 특별요금' },
    { period_label: '7/15, 7/16, 9/25, 10/3', departure_dates: ['2026-07-15', '2026-07-16', '2026-09-25', '2026-10-03'], adult_price: 1099000 + offset, status: 'available', note: '제외일자 특별요금' },
    { period_label: '4/30, 9/24', departure_dates: ['2026-04-30', '2026-09-24'], adult_price: 1399000 + offset, status: 'available', note: '제외일자 특별요금' },
    { period_label: '5/1', departure_dates: ['2026-05-01'], adult_price: 1719000 + offset, status: 'available', note: '제외일자 특별요금' },
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
//  1. 나달팩 노노 - [BX 오후출발] 나트랑/달랏 5성 3박5일
// ══════════════════════════════════════════════════════════════════════════════
const PKG1 = {
  ...COMMON,
  title: '[BX 오후출발] 나트랑/달랏 노팁노옵션 5성 3박5일',
  destination: '나트랑/달랏',
  min_participants: 4,
  price: 739000,
  surcharges: SURCHARGES,
  excluded_dates: [],
  optional_tours: OPTIONAL_TOURS_NONO,
  price_tiers: buildPriceTiers(0),
  inclusions: [
    '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험, 과일도시락 제공',
    '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료, 가이드/기사 팁',
    '나트랑: 나트랑시내투어(포나가르 사원, 롱선사, 대성당) + 나트랑 야간시티투어',
    '달랏: 바오다이 황제별장, 크레이지 하우스, 쓰엉흐엉 호수, 죽림사, 다딴라 폭포, 달랏역, 린푸억 사원, 달랏 메모리쇼',
    'VIP 럭셔리 스톤마사지 120분',
    '죽림사 케이블카 + 다딴라 레일바이크 + 달랏야시장 + 야경투어/천국의계단',
  ],
  excludes: [
    '에티켓 팁, 개인 경비, 선택관광(손님이 원하실 경우 진행 가능)',
    '침향, 커피, 잡화점, 라텍스 중 3회 방문',
  ],
  notices_parsed: COMMON_NOTICES,
  special_notes: '쇼핑: 침향, 커피, 잡화점, 라텍스 중 3회 방문\n싱글차지 16만원(전일정)\n노팁노옵션 전일정 5성급 호텔\n계약금 12%\n4/27 이전 선발기준 요금',
  product_highlights: [
    '노팁노옵션 전일정 5성급 호텔',
    'VIP 럭셔리 스톤마사지 120분 포함',
    '달랏 메모리쇼 포함',
    '죽림사 케이블카 + 다딴라 레일바이크 포함',
    '나트랑 야간시티투어(야시장+해변바+씨클로+맥주+피자)',
    '달랏 야시장 + 야경투어/천국의계단',
  ],
  product_summary: '에어부산 오후출발 나트랑/달랏 노팁노옵션 5성 3박5일. 전일정 5성급 호텔, VIP스톤마사지120분+달랏메모리쇼+케이블카+레일바이크 모두 포함. 가이드/기사 팁 포함 올인클루시브.',
  product_tags: ['나트랑', '달랏', '베트남', '노팁노옵션', '5성급', '에어부산', '스톤마사지', '메모리쇼'],
  accommodations: ['5성급 레갈리아골드 (나트랑)', '5성급 멀펄 (달랏)'],
  itinerary: [
    'DAY1: 부산→나트랑 | BX781 16:20-19:30(경유)-22:40 | 호텔체크인 | 레갈리아골드(5성)',
    'DAY2: 나트랑→달랏 | 포나가르사원, 담재래시장, 달랏이동(3.5h), VIP스톤마사지120분, 크레이지하우스, 쓰엉흐엉호수, 달랏야시장+야경투어/천국의계단 | 멀펄(5성)',
    'DAY3: 달랏 전일 | 달랏기차역, 린푸억사원, 바오다이황제별장, 죽림사+케이블카, 다딴라폭포+레일바이크, 달랏메모리쇼 | 멀펄(5성)',
    'DAY4: 달랏→나트랑 | 쇼핑, 랑비엥전망대, 나트랑이동(3.5h), 롱선사, 대성당(차창), 야간시티투어 | BX782 23:40',
    'DAY5: 부산 06:20 도착',
  ],
  itinerary_data: {
    meta: {
      title: '[BX 오후출발] 나트랑/달랏 노팁노옵션 5성 3박5일',
      product_type: '노팁노옵션', destination: '나트랑/달랏',
      nights: 3, days: 5, departure_airport: '부산(김해)',
      airline: 'BX(에어부산)', flight_out: 'BX781', flight_in: 'BX782',
      departure_days: '매일출발', min_participants: 4,
      room_type: '2인1실 OR 3인1실', ticketing_deadline: null,
      hashtags: ['#나트랑', '#달랏', '#노팁노옵션', '#5성급', '#스톤마사지', '#메모리쇼', '#레일바이크'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험, 과일도시락 제공',
        '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료, 가이드/기사 팁',
        '나트랑: 시내투어(포나가르 사원, 롱선사, 대성당) + 야간시티투어',
        '달랏: 바오다이 황제별장, 크레이지 하우스, 쓰엉흐엉 호수, 죽림사, 다딴라 폭포, 달랏역, 린푸억 사원, 달랏 메모리쇼',
        'VIP 럭셔리 스톤마사지 120분',
        '죽림사 케이블카 + 다딴라 레일바이크 + 달랏야시장 + 야경투어/천국의계단',
      ],
      excludes: [
        '에티켓 팁, 개인 경비, 선택관광(손님이 원하실 경우 진행 가능)',
        '침향, 커피, 잡화점, 라텍스 중 3회 방문',
      ],
      shopping: '침향, 커피, 잡화점, 라텍스 중 3회 방문',
      remarks: [
        '싱글차지 전일정 기준 인당 16만원 추가',
        '여권만료일은 입국일 기준 6개월 이상 남아있어야 출국 가능합니다.',
        '베트남 자국민 보호법으로 공항미팅/관광지 방문 불가, 차량에서 대체 설명',
        '호텔 룸배정(일행과 같은 층, 옆방 배정, 베드타입) 등은 개런티 불가합니다.',
        '마사지 팁 기준: 나트랑 60분-$4/90분-$5/120분-$6, 달랏 60분-$4/90분-$5/120분-$7 (변동 가능)',
        '패키지 일정 미참여시 패널티 1인/1박/$100 청구',
        '식당 주차장 부족으로 도보이동 가능',
        '베트남 전자담배 반입 불가 (25년 1월부터)',
        '4/27 이전 선발기준 요금, 추후 변동 가능',
        '미성년자(만14세 미만) 영문 가족관계증명서 지참 필수',
        '부모 미동반 시 영문 부모동의서 공증 필수',
        '에어부산 증편 항공 스케줄 (기본: 월,화 운항, 5/18~6/20: 투데일리)',
        '상기 일정은 항공 및 현지 사정에 의하여 변경될 수 있습니다.',
      ],
    },
    days: [
      day1_arrival(),
      {
        day: 2, regions: ['나트랑', '달랏'],
        meals: meal(true, true, true, '호텔식', '현지식(퍼틴)', '닭볶음탕(멀펄투숙시 의무식사)'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃'),
          normal(null, '참파 왕국의 사원 유적 포나가르 사원 관광'),
          normal(null, '담재래시장 관광'),
          normal(null, '달랏으로 이동 (약 3.5시간 소요)'),
          normal(null, 'VIP 럭셔리 스톤마사지 120분'),
          normal(null, '기이하고 독특한 건축물 크레이지 하우스'),
          normal(null, '달랏의 아름다운 호수 쓰엉흐엉 호수'),
          normal(null, '석식 후 달랏야시장 + 야경투어/천국의계단'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '멀펄', grade: '5성', note: null },
      },
      {
        day: 3, regions: ['달랏'],
        meals: meal(true, true, true, '호텔식', '분짜+반세오', '삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '프랑스풍 달랏기차역 관광'),
          normal(null, '49m 높이의 용 형상 린푸억 사원'),
          normal(null, '마지막 황제의 여름 별장 바오다이 황제별장'),
          normal(null, '죽림사 + 케이블카 탑승'),
          normal(null, '다딴라 폭포 + 레일바이크 체험'),
          normal(null, '달랏 메모리쇼 관람'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '멀펄', grade: '5성', note: null },
      },
      {
        day: 4, regions: ['달랏', '나트랑'],
        meals: meal(true, true, true, '호텔식', '베트남가정식', '김치전골'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃'),
          shopping(null, '쇼핑'),
          normal(null, '랑비엥 전망대 (짚차 OR 7인승)'),
          normal(null, '나트랑으로 이동 (약 3.5시간 소요)'),
          shopping(null, '쇼핑'),
          normal(null, '나트랑 최대 사원 롱선사'),
          normal(null, '나트랑 대성당 (차창)'),
          normal(null, '야간시티투어 (야시장 + 해변바 + 씨클로 + 맥주 + 피자)'),
          normal(null, '공항으로 이동'),
        ],
        hotel: null,
      },
      dayLast(),
    ],
    optional_tours: [],
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  2. 나판달팩 노노 - [BX 오후출발] 나트랑/판랑/달랏 5성 3박5일
// ══════════════════════════════════════════════════════════════════════════════
const PKG2 = {
  ...COMMON,
  title: '[BX 오후출발] 나트랑/판랑/달랏 노팁노옵션 5성 3박5일',
  destination: '나트랑/판랑/달랏',
  min_participants: 6,
  price: 799000,
  surcharges: SURCHARGES,
  excluded_dates: [],
  optional_tours: OPTIONAL_TOURS_NONO,
  price_tiers: buildPriceTiers(60000),
  inclusions: [
    '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험, 과일도시락 제공',
    '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료, 가이드/기사 팁',
    '판랑: 오프로드 지프차 투어 A코스 포함, 탄욜리 몽골마을, 염전관광, 4·16광장, 투롱선 사원',
    '달랏: 바오다이 황제별장, 크레이지 하우스, 쓰엉흐엉 호수, 죽림사, 다딴라 폭포, 달랏역, 달랏야시장, 린푸억 사원, 다딴라폭포+레일바이크, 죽림사+케이블카, 달랏메모리쇼',
    '나트랑: 시내투어(포나가르사원, 롱선사, 대성당), 야간시티투어, 베트남식 마사지 90분',
  ],
  excludes: [
    '에티켓 팁, 개인 경비, 선택관광(손님이 원하실 경우 진행 가능)',
    '침향, 커피, 잡화점, 라텍스 중 3회 방문',
  ],
  notices_parsed: [
    ...COMMON_NOTICES,
    '사막투어 시 모래바람이 많이 불고 햇빛이 뜨겁습니다. 선글라스와 여분의 마스크 준비',
  ],
  special_notes: '쇼핑: 침향, 커피, 잡화점, 라텍스 중 3회 방문\n싱글차지 16만원(전일정)\n노팁노옵션 전일정 5성급 호텔\n판랑 사막 지프차 투어 포함\n계약금 12%\n4/27 이전 선발기준 요금',
  product_highlights: [
    '노팁노옵션 전일정 5성급 호텔',
    '판랑 오프로드 지프차 투어 A코스 (화이트+옐로우샌듄)',
    '달랏 메모리쇼 포함',
    '죽림사 케이블카 + 다딴라 레일바이크 포함',
    '나트랑 야간시티투어 + 베트남식 마사지 90분',
    '탄욜리 몽골마을 + 염전관광',
  ],
  product_summary: '에어부산 오후출발 나트랑/판랑/달랏 노팁노옵션 5성 3박5일. 판랑 사막 지프차투어+달랏 메모리쇼+케이블카+레일바이크+마사지90분 모두 포함. 가이드/기사 팁 포함 올인클루시브.',
  product_tags: ['나트랑', '판랑', '달랏', '베트남', '노팁노옵션', '5성급', '에어부산', '지프차', '사막투어'],
  accommodations: ['5성급 레갈리아골드 (나트랑)', '5성급 멀펄 (달랏)'],
  itinerary: [
    'DAY1: 부산→나트랑 | BX781 16:20-19:30(경유)-22:40 | 호텔체크인 | 레갈리아골드(5성)',
    'DAY2: 나트랑→판랑→달랏 | 판랑이동(2.5h), 탄욜리몽골마을, 지프차A코스(화이트+옐로우샌듄), 염전, 4·16광장, 투롱선사원, 달랏이동(3h), 달랏메모리쇼 | 멀펄(5성)',
    'DAY3: 달랏 전일 | 바오다이별장, 크레이지하우스, 쓰엉흐엉호수, 죽림사+케이블카, 다딴라폭포+레일바이크, 달랏기차역, 린푸억사원, 달랏야시장 | 멀펄(5성)',
    'DAY4: 달랏→나트랑 | 쇼핑, 나트랑이동(3.5h), 포나가르사원, 롱선사, 대성당(차창), 야간시티투어, 마사지90분 | BX782 23:40',
    'DAY5: 부산 06:20 도착',
  ],
  itinerary_data: {
    meta: {
      title: '[BX 오후출발] 나트랑/판랑/달랏 노팁노옵션 5성 3박5일',
      product_type: '노팁노옵션', destination: '나트랑/판랑/달랏',
      nights: 3, days: 5, departure_airport: '부산(김해)',
      airline: 'BX(에어부산)', flight_out: 'BX781', flight_in: 'BX782',
      departure_days: '매일출발', min_participants: 6,
      room_type: '2인1실 OR 3인1실', ticketing_deadline: null,
      hashtags: ['#나트랑', '#판랑', '#달랏', '#노팁노옵션', '#5성급', '#지프차', '#사막투어', '#메모리쇼'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험, 과일도시락 제공',
        '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료, 가이드/기사 팁',
        '판랑: 오프로드 지프차 투어 A코스, 탄욜리 몽골마을, 염전관광, 4·16광장, 투롱선 사원',
        '달랏: 바오다이 황제별장, 크레이지 하우스, 쓰엉흐엉 호수, 죽림사+케이블카, 다딴라폭포+레일바이크, 달랏기차역, 린푸억 사원, 달랏야시장, 달랏메모리쇼',
        '나트랑: 시내투어(포나가르사원, 롱선사, 대성당), 야간시티투어, 베트남식 마사지 90분',
      ],
      excludes: [
        '에티켓 팁, 개인 경비, 선택관광(손님이 원하실 경우 진행 가능)',
        '침향, 커피, 잡화점, 라텍스 중 3회 방문',
      ],
      shopping: '침향, 커피, 잡화점, 라텍스 중 3회 방문',
      remarks: [
        '싱글차지 전일정 기준 인당 16만원 추가',
        '여권만료일은 입국일 기준 6개월 이상 남아있어야 출국 가능합니다.',
        '베트남 자국민 보호법으로 공항미팅/관광지 방문 불가, 차량에서 대체 설명',
        '호텔 룸배정(일행과 같은 층, 옆방 배정, 베드타입) 등은 개런티 불가합니다.',
        '마사지 팁 기준: 나트랑 60분-$4/90분-$5/120분-$6, 달랏 60분-$4/90분-$5/120분-$7 (변동 가능)',
        '패키지 일정 미참여시 패널티 1인/1박/$100 청구',
        '식당 주차장 부족으로 도보이동 가능',
        '베트남 전자담배 반입 불가 (25년 1월부터)',
        '4/27 이전 선발기준 요금, 추후 변동 가능',
        '미성년자(만14세 미만) 영문 가족관계증명서 지참 필수',
        '부모 미동반 시 영문 부모동의서 공증 필수',
        '사막투어 시 모래바람이 많이 불고 햇빛이 뜨겁습니다. 선글라스와 여분의 마스크 준비',
        '에어부산 증편 항공 스케줄 (기본: 월,화 운항, 5/18~6/20: 투데일리)',
        '상기 일정은 항공 및 현지 사정에 의하여 변경될 수 있습니다.',
      ],
    },
    days: [
      day1_arrival(),
      {
        day: 2, regions: ['나트랑', '판랑', '달랏'],
        meals: meal(true, true, true, '호텔식', '현지식', '닭볶음탕(멀펄 의무식사)'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃'),
          normal(null, '판랑으로 이동 (약 2.5시간 소요)'),
          normal(null, '탄욜리 몽골마을 관광'),
          normal(null, '오프로드 지프차 투어 A코스 (화이트샌듄 + 옐로우샌듄)'),
          normal(null, '염전 관광'),
          normal(null, '4·16광장 관광'),
          normal(null, '투롱선 사원 관광'),
          normal(null, '달랏으로 이동 (약 3시간 소요)'),
          normal(null, '달랏 메모리쇼 관람'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '멀펄', grade: '5성', note: null },
      },
      {
        day: 3, regions: ['달랏'],
        meals: meal(true, true, true, '호텔식', '분짜+반세오', '삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '마지막 황제의 여름 별장 바오다이 황제별장'),
          normal(null, '기이하고 독특한 건축물 크레이지 하우스'),
          normal(null, '달랏의 아름다운 호수 쓰엉흐엉 호수'),
          normal(null, '죽림사 + 케이블카 탑승'),
          normal(null, '다딴라 폭포 + 레일바이크 체험'),
          normal(null, '프랑스풍 달랏기차역 관광'),
          normal(null, '49m 높이의 용 형상 린푸억 사원'),
          normal(null, '석식 후 달랏야시장 자유시간'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '멀펄', grade: '5성', note: null },
      },
      {
        day: 4, regions: ['달랏', '나트랑'],
        meals: meal(true, true, true, '호텔식', '베트남가정식', '김치전골'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃'),
          shopping(null, '쇼핑'),
          normal(null, '나트랑으로 이동 (약 3.5시간 소요)'),
          normal(null, '참파 왕국의 사원 유적 포나가르 사원 관광'),
          normal(null, '나트랑 최대 사원 롱선사'),
          normal(null, '나트랑 대성당 (차창)'),
          normal(null, '야간시티투어 (야시장 + 해변바 + 씨클로 + 맥주 + 피자)'),
          normal(null, '베트남식 마사지 90분'),
          shopping(null, '쇼핑'),
          normal(null, '공항으로 이동'),
        ],
        hotel: null,
      },
      dayLast(),
    ],
    optional_tours: [],
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  3. 호판팩(나호판) 노노 - [BX 오후출발] 나트랑 호판팩+특식3회 5성 3박5일
// ══════════════════════════════════════════════════════════════════════════════

// 나호판 가격: 나달팩 + 40,000 오프셋
function buildPriceTiersPKG3() {
  return [
    { period_label: '9/13~9/29 수목금 (9/22-25 제외)', date_range: { start: '2026-09-13', end: '2026-09-29' }, departure_day_of_week: '수,목,금', adult_price: 819000, status: 'available', note: '9/22-25 제외' },
    { period_label: '9/13~9/29 토일 (9/22-25 제외)', date_range: { start: '2026-09-13', end: '2026-09-29' }, departure_day_of_week: '토,일', adult_price: 779000, status: 'available', note: '9/22-25 제외' },
    { period_label: '5/3~7/14 월화 (6/2 제외)', date_range: { start: '2026-05-03', end: '2026-07-14' }, departure_day_of_week: '월,화', adult_price: 859000, status: 'available', note: '6/2 제외' },
    { period_label: '8/30~9/12 월화', date_range: { start: '2026-08-30', end: '2026-09-12' }, departure_day_of_week: '월,화', adult_price: 859000, status: 'available' },
    { period_label: '7/18~7/22 수목금', date_range: { start: '2026-07-18', end: '2026-07-22' }, departure_day_of_week: '수,목,금', adult_price: 899000, status: 'available' },
    { period_label: '8/16~8/29 수목금', date_range: { start: '2026-08-16', end: '2026-08-29' }, departure_day_of_week: '수,목,금', adult_price: 899000, status: 'available' },
    { period_label: '10/4~10/21 수목금', date_range: { start: '2026-10-04', end: '2026-10-21' }, departure_day_of_week: '수,목,금', adult_price: 899000, status: 'available' },
    { period_label: '7/18~7/22 토일월화', date_range: { start: '2026-07-18', end: '2026-07-22' }, departure_day_of_week: '토,일,월,화', adult_price: 859000, status: 'available' },
    { period_label: '8/16~8/29 토일월화', date_range: { start: '2026-08-16', end: '2026-08-29' }, departure_day_of_week: '토,일,월,화', adult_price: 859000, status: 'available' },
    { period_label: '10/4~10/21 토일월화', date_range: { start: '2026-10-04', end: '2026-10-21' }, departure_day_of_week: '토,일,월,화', adult_price: 859000, status: 'available' },
    { period_label: '4/1~4/28 수목금', date_range: { start: '2026-04-01', end: '2026-04-28' }, departure_day_of_week: '수,목,금', adult_price: 959000, status: 'available' },
    { period_label: '8/8~8/11 수목금', date_range: { start: '2026-08-08', end: '2026-08-11' }, departure_day_of_week: '수,목,금', adult_price: 959000, status: 'available' },
    { period_label: '4/1~4/28 토일월화', date_range: { start: '2026-04-01', end: '2026-04-28' }, departure_day_of_week: '토,일,월,화', adult_price: 899000, status: 'available' },
    { period_label: '8/8~8/11 토일월화', date_range: { start: '2026-08-08', end: '2026-08-11' }, departure_day_of_week: '토,일,월,화', adult_price: 899000, status: 'available' },
    { period_label: '7/28~8/7 수목금 (7/29-8/1 제외)', date_range: { start: '2026-07-28', end: '2026-08-07' }, departure_day_of_week: '수,목,금', adult_price: 1039000, status: 'available', note: '7/29-8/1 제외' },
    { period_label: '7/28~8/7 토일월화 (7/29-8/1 제외)', date_range: { start: '2026-07-28', end: '2026-08-07' }, departure_day_of_week: '토,일,월,화', adult_price: 999000, status: 'available', note: '7/29-8/1 제외' },
    { period_label: '7/23~7/28 전요일', date_range: { start: '2026-07-23', end: '2026-07-28' }, adult_price: 1099000, status: 'available' },
    // ── 특정 제외일자 특별요금 ──
    { period_label: '4/29, 5/2, 8/1, 8/12, 8/13, 8/15', departure_dates: ['2026-04-29', '2026-05-02', '2026-08-01', '2026-08-12', '2026-08-13', '2026-08-15'], adult_price: 1199000, status: 'available', note: '제외일자 특별요금' },
    { period_label: '5/21, 5/22, 8/14, 9/22, 10/1, 10/2, 10/8', departure_dates: ['2026-05-21', '2026-05-22', '2026-08-14', '2026-09-22', '2026-10-01', '2026-10-02', '2026-10-08'], adult_price: 1319000, status: 'available', note: '제외일자 특별요금' },
    { period_label: '5/23, 5/30, 6/2', departure_dates: ['2026-05-23', '2026-05-30', '2026-06-02'], adult_price: 979000, status: 'available', note: '제외일자 특별요금' },
    { period_label: '5/20, 6/3, 7/17, 9/30, 10/9', departure_dates: ['2026-05-20', '2026-06-03', '2026-07-17', '2026-09-30', '2026-10-09'], adult_price: 1019000, status: 'available', note: '제외일자 특별요금' },
    { period_label: '7/29~7/31, 10/7', departure_dates: ['2026-07-29', '2026-07-30', '2026-07-31', '2026-10-07'], adult_price: 1259000, status: 'available', note: '제외일자 특별요금' },
    { period_label: '7/15, 7/16, 9/25, 10/3', departure_dates: ['2026-07-15', '2026-07-16', '2026-09-25', '2026-10-03'], adult_price: 1139000, status: 'available', note: '제외일자 특별요금' },
    { period_label: '4/30, 9/24', departure_dates: ['2026-04-30', '2026-09-24'], adult_price: 1439000, status: 'available', note: '제외일자 특별요금' },
    { period_label: '5/1', departure_dates: ['2026-05-01'], adult_price: 1759000, status: 'available', note: '제외일자 특별요금' },
  ];
}

const PKG3 = {
  ...COMMON,
  title: '[BX 오후출발] 나트랑 호판팩+특식3회 노팁노옵션 5성 3박5일',
  destination: '나트랑/판랑',
  min_participants: 6,
  price: 779000,
  surcharges: [
    { period: '4/26', amount_krw: 13000, note: '나트랑 레갈리아골드 5성 (1인/1박)' },
    { period: '4/30~5/1', amount_krw: 13000, note: '나트랑 레갈리아골드 5성 (1인/1박)' },
    { period: '9/2', amount_krw: 13000, note: '나트랑 레갈리아골드 5성 (1인/1박)' },
  ],
  excluded_dates: [],
  optional_tours: OPTIONAL_TOURS_NONO,
  price_tiers: buildPriceTiersPKG3(),
  inclusions: [
    '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험, 과일도시락 제공',
    '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료, 가이드/기사 팁',
    '판랑: 오프로드 지프차 투어 A코스 포함, 탄욜리 몽골마을, 염전관광, 4·16광장, 투롱선 사원',
    '나트랑: 시내투어(포나가르사원, 롱선사, 대성당), 야간시티투어, 베트남식 마사지 90분',
    '혼쫑곶 자유시간(음료 한잔 제공) + 나트랑 특식 3회(무제한삼겹살+더요트뷔페+갈랑가특식)',
  ],
  excludes: [
    '에티켓 팁, 개인 경비, 선택관광(손님이 원하실 경우 진행 가능)',
    '침향, 커피, 잡화점, 라텍스 중 3회 방문',
  ],
  notices_parsed: [
    ...COMMON_NOTICES,
    '사막투어 시 모래바람이 많이 불고 햇빛이 뜨겁습니다. 선글라스와 여분의 마스크 준비',
  ],
  special_notes: '쇼핑: 침향, 커피, 잡화점, 라텍스 중 3회 방문\n싱글차지 16만원(전일정)\n노팁노옵션 전일정 5성급 호텔\n특식3회(무제한삼겹살+더요트뷔페+갈랑가)\n판랑 사막 지프차 투어 포함\n계약금 12%',
  product_highlights: [
    '노팁노옵션 전일정 5성급 호텔',
    '나트랑 특식 3회 (무제한삼겹살+더요트BBQ뷔페+갈랑가특식)',
    '판랑 오프로드 지프차 투어 A코스 (화이트+옐로우샌듄)',
    '해적호핑투어 (선상파티, 낚시, 스노클링, 패들보트, 다이빙)',
    '혼쫑곶 자유시간 + 음료 한잔',
    '나트랑 야간시티투어 + 베트남식 마사지 90분',
  ],
  product_summary: '에어부산 오후출발 나트랑 호판팩 노팁노옵션 5성 3박5일. 해적호핑투어+판랑 사막 지프차+특식3회(무제한삼겹살+더요트뷔페+갈랑가)+마사지90분 모두 포함. 가이드/기사 팁 포함 올인클루시브.',
  product_tags: ['나트랑', '판랑', '베트남', '노팁노옵션', '5성급', '에어부산', '호핑투어', '지프차', '특식'],
  accommodations: ['5성급 레갈리아골드 (나트랑)'],
  itinerary: [
    'DAY1: 부산→나트랑 | BX781 16:20-19:30(경유)-22:40 | 호텔체크인 | 레갈리아골드(5성)',
    'DAY2: 나트랑 전일 | 해적호핑투어(선상파티,낚시,스노클링,패들보트,다이빙), 마사지90분 | 레갈리아골드(5성)',
    'DAY3: 나트랑→판랑→나트랑 | 탄욜리몽골마을, 지프차A코스(화이트+옐로우샌듄), 염전(차창), 4·16광장, 투롱선사원 | 레갈리아골드(5성)',
    'DAY4: 나트랑 | 쇼핑3회, 혼총곶자유일정(음료1잔), 담재래시장, 대성당(차창), 포나가르사원, 롱선사, 야간시티투어 | BX782 23:40',
    'DAY5: 부산 06:20 도착',
  ],
  itinerary_data: {
    meta: {
      title: '[BX 오후출발] 나트랑 호판팩+특식3회 노팁노옵션 5성 3박5일',
      product_type: '노팁노옵션', destination: '나트랑/판랑',
      nights: 3, days: 5, departure_airport: '부산(김해)',
      airline: 'BX(에어부산)', flight_out: 'BX781', flight_in: 'BX782',
      departure_days: '매일출발', min_participants: 6,
      room_type: '2인1실 OR 3인1실', ticketing_deadline: null,
      hashtags: ['#나트랑', '#판랑', '#노팁노옵션', '#5성급', '#호핑투어', '#지프차', '#특식3회'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 국제선 항공료 및 텍스, 유류할증료, 여행자보험, 과일도시락 제공',
        '호텔, 차량, 전 일정 식사, 한국인가이드&현지인가이드, 관광지 입장료, 가이드/기사 팁',
        '판랑: 오프로드 지프차 투어 A코스, 탄욜리 몽골마을, 염전관광, 4·16광장, 투롱선 사원',
        '나트랑: 시내투어(포나가르사원, 롱선사, 대성당), 야간시티투어, 베트남식 마사지 90분',
        '혼쫑곶 자유시간(음료 한잔 제공) + 나트랑 특식 3회(무제한삼겹살+더요트뷔페+갈랑가특식)',
      ],
      excludes: [
        '에티켓 팁, 개인 경비, 선택관광(손님이 원하실 경우 진행 가능)',
        '침향, 커피, 잡화점, 라텍스 중 3회 방문',
      ],
      shopping: '침향, 커피, 잡화점, 라텍스 중 3회 방문',
      remarks: [
        '싱글차지 전일정 기준 인당 16만원 추가',
        '여권만료일은 입국일 기준 6개월 이상 남아있어야 출국 가능합니다.',
        '베트남 자국민 보호법으로 공항미팅/관광지 방문 불가, 차량에서 대체 설명',
        '호텔 룸배정(일행과 같은 층, 옆방 배정, 베드타입) 등은 개런티 불가합니다.',
        '마사지 팁 기준: 나트랑 60분-$4/90분-$5/120분-$6, 달랏 60분-$4/90분-$5/120분-$7 (변동 가능)',
        '패키지 일정 미참여시 패널티 1인/1박/$100 청구',
        '식당 주차장 부족으로 도보이동 가능',
        '베트남 전자담배 반입 불가 (25년 1월부터)',
        '4/27 이전 선발기준 요금, 추후 변동 가능',
        '미성년자(만14세 미만) 영문 가족관계증명서 지참 필수',
        '부모 미동반 시 영문 부모동의서 공증 필수',
        '사막투어 시 모래바람이 많이 불고 햇빛이 뜨겁습니다. 선글라스와 여분의 마스크 준비',
        '에어부산 증편 항공 스케줄 (기본: 월,화 운항, 5/18~6/20: 투데일리)',
        '상기 일정은 항공 및 현지 사정에 의하여 변경될 수 있습니다.',
      ],
    },
    days: [
      day1_arrival(),
      {
        day: 2, regions: ['나트랑'],
        meals: meal(true, true, true, '호텔식', '현지식', '현지식특식(갈랑가)'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '해적호핑투어 출발 (선상파티, 낚시, 스노클링, 패들보트, 다이빙, 치킨, 삼각김밥, 꽃게해물라면, 무제한열대과일, 4종커피, BBQ꼬치)', '날씨 불가시 빈원더스 대체'),
          normal(null, '베트남식 마사지 90분'),
          normal(null, '석식 (갈랑가 특식)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '레갈리아골드', grade: '5성', note: null },
      },
      {
        day: 3, regions: ['나트랑', '판랑', '나트랑'],
        meals: meal(true, true, true, '호텔식', '판랑BBQ', '무제한삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '판랑으로 이동 (약 2.5시간 소요)'),
          normal(null, '탄욜리 몽골마을 관광'),
          normal(null, '오프로드 지프차 투어 A코스 (화이트샌듄 + 옐로우샌듄)'),
          normal(null, '염전 관광 (차창)'),
          normal(null, '4·16광장 관광'),
          normal(null, '투롱선 사원 관광'),
          normal(null, '나트랑으로 이동'),
          normal(null, '석식 (무제한삼겹살)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '레갈리아골드', grade: '5성', note: null },
      },
      {
        day: 4, regions: ['나트랑'],
        meals: meal(true, true, true, '호텔식', '베트남가정식', '더요트BBQ'),
        schedule: [
          normal(null, '호텔 조식 후 체크아웃'),
          shopping(null, '쇼핑 (3회)'),
          normal(null, '혼쫑곶 자유일정 (음료 1잔 제공)'),
          normal(null, '담재래시장 관광'),
          normal(null, '나트랑 대성당 (차창)'),
          normal(null, '참파 왕국의 사원 유적 포나가르 사원 관광'),
          normal(null, '나트랑 최대 사원 롱선사'),
          normal(null, '야간시티투어 (야시장 + 해변바 + 씨클로 + 맥주 + 피자)'),
          normal(null, '공항으로 이동'),
        ],
        hotel: null,
      },
      dayLast(),
    ],
    optional_tours: [],
  },
};

// ── 일괄 등록 ──
const ALL_PACKAGES = [PKG1, PKG2, PKG3];

async function main() {
  console.log(`📦 나트랑 패키지 ${ALL_PACKAGES.length}개 일괄 등록 시작...\n`);

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
    departure_days: pkg.departure_days,
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
