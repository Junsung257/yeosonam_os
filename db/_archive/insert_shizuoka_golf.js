/**
 * 시즈오카 골프 상품 3종 DB INSERT
 * 45홀(2박3일) / 72홀(3박4일) / 99홀(4박5일)
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const COMMON = {
  destination: '시즈오카',
  category: '골프',
  product_type: '고품격|2색골프',
  trip_style: '골프',
  departure_airport: '김해공항',
  airline: 'BX',
  min_participants: 2,
  ticketing_deadline: '2026-05-29',
  land_operator: null,
  commission_rate: null,
  status: 'approved',
  country: '일본',
  inclusions: [
    '왕복 항공료+유류+TAX',
    '골프 수하물 23KG',
    '여행자보험',
    '일정상 그린피+카트비',
    '전용 송영 택시',
    '호텔 2인1실',
    '호텔조식',
    '석식',
  ],
  excludes: [
    '클럽중식',
    '기타개인비용',
    '캐디피(선택제, 비용 별도문의)',
  ],
  product_highlights: [
    '명문 회원제 2색 골프',
    '후지산 뷰 전 홀',
    '2인 출발 가능',
    '멤버쉽 골프텔 숙박',
  ],
  notices_parsed: [
    {
      type: 'CRITICAL',
      title: '필수 확인 사항',
      text: '• 여권 만료일 6개월 이상 남아있어야합니다.\n• 본 상품은 전세기 상품으로 1인/30만원 예약금 필수이며, 예약금 입금후 예약 진행됩니다.\n• 없는 날짜는 지상 마감입니다.',
    },
    {
      type: 'PAYMENT',
      title: '추가 요금 및 할증',
      text: '• 4인 출발기준이며, 2인/3인 출발 및 플레이시 추가금 부과됩니다.\n• 2인출발 가능하나 차량 조인 될 수 있으며, 조인 없을 경우 비용 추가됩니다.',
    },
    {
      type: 'POLICY',
      title: '현지 규정 및 안내',
      text: '• 송영택시는 일본인기사님으로 진행되며, 일정표상 송영 외 개인용도 불가합니다.\n• 다른팀과 합류되어 차량 이용 됩니다. 미팅시간 꼭 엄수 바랍니다.',
    },
    {
      type: 'INFO',
      title: '여행 정보',
      text: '• 상기 일정은 현지 및 항공사정에 의해 변경될 수 있습니다.',
    },
  ],
  category_attrs: {
    golf_courses: [
      { name: '시즈오카CC 시마다코스', type: '멤버쉽', holes: 18, par: 72, yards: 6546, note: '클럽하우스 리노베이션 완료' },
      { name: '후가쿠CC', type: '멤버쉽', holes: 18, par: 72, yards: 7504, note: '전 홀 후지산 뷰' },
    ],
  },
};

// DAY 1 공통 (모든 상품 동일)
const DAY1 = {
  day: 1,
  regions: ['부산', '시즈오카'],
  meals: { breakfast: false, lunch: false, dinner: true, dinner_note: '돈까스정식' },
  schedule: [
    { time: '09:05', activity: '부산 김해공항 국제선 출발', type: 'flight', transport: 'BX1645' },
    { time: '10:50', activity: '일본 시즈오카 국제공항 도착', type: 'normal' },
    { time: null, activity: '전용 송영 택시 미팅 후 골프장 이동 (약 10분 소요)', type: 'normal' },
    { time: null, activity: '시마다CC 18홀 라운딩 또는 동급 -일몰시까지', type: 'golf' },
    { time: null, activity: '라운딩 후 골프장 샤워 후 석식 장소 이동', type: 'normal' },
    { time: null, activity: '식사 후 호텔이동 (편의점 경유) (약 1시간소요)', type: 'normal' },
  ],
  hotel: { name: '후가쿠 멤버쉽 골프텔', grade: '4', note: '2인1실 · 대욕장 이용 가능' },
};

// 골프 DAY (후가쿠CC)
function makeGolfDay(dayNum) {
  return {
    day: dayNum,
    regions: ['시즈오카'],
    meals: { breakfast: true, breakfast_note: '클럽식', lunch: false, lunch_note: '불포함', dinner: true, dinner_note: '일식코스' },
    schedule: [
      { time: null, activity: '클럽 조식 후 골프장 이동(도보)', type: 'normal' },
      { time: null, activity: '후가쿠CC 18홀 라운딩(스루플레이)', type: 'golf' },
      { time: null, activity: '중식 후 9홀 서비스 제공', type: 'golf' },
      { time: null, activity: '라운딩 후 석식 및 휴식', type: 'normal' },
    ],
    hotel: { name: '후가쿠 멤버쉽 골프텔', grade: '4', note: '2인1실' },
  };
}

// 마지막 DAY (귀국)
function makeLastDay(dayNum) {
  return {
    day: dayNum,
    regions: ['시즈오카', '부산'],
    meals: { breakfast: true, breakfast_note: '클럽식', lunch: false, dinner: false },
    schedule: [
      { time: null, activity: '클럽 조식 후 공항이동(전용 송영 택시)', type: 'normal' },
      { time: '11:50', activity: '시즈오카 국제공항 출발', type: 'flight', transport: 'BX1635' },
      { time: '14:00', activity: '김해국제공항 도착', type: 'normal' },
    ],
    hotel: null,
  };
}

const PRODUCTS = [
  {
    title: '시즈오카 명문 회원제 후가쿠 2색 골프 45홀 2박3일',
    duration: 3,
    nights: 2,
    price: 1099000,
    product_summary: '시즈오카 명문 회원제 골프장 2색 45홀. 시마다CC + 후가쿠CC(전 홀 후지산 뷰). 2인 출발 가능, 전용 송영 택시, 멤버쉽 골프텔 숙박.',
    price_tiers: [
      { period_label: '4/22 (화)', departure_dates: ['2026-04-22'], adult_price: 1149000, status: 'available' },
      { period_label: '4/27 (일)', departure_dates: ['2026-04-27'], adult_price: 1099000, status: 'available' },
      { period_label: '5/4 (일)', departure_dates: ['2026-05-04'], adult_price: 1499000, status: 'available' },
      { period_label: '5/11 (일)', departure_dates: ['2026-05-11'], adult_price: 1099000, status: 'available' },
      { period_label: '5/18 (일)', departure_dates: ['2026-05-18'], adult_price: 1149000, status: 'available' },
      { period_label: '5/25 (일)', departure_dates: ['2026-05-25'], adult_price: 1099000, status: 'available' },
      { period_label: '5/27 (화)', departure_dates: ['2026-05-27'], adult_price: 1099000, status: 'available' },
    ],
    special_notes: '2인 출발시 1인 180,000원 up / 3인 출발시 1인 50,000원 up / 8인 출발시 1인 –40,000원',
    itinerary_data: {
      meta: { title: '시즈오카 명문 회원제 후가쿠 2색 골프 45홀', product_type: '고품격|2색골프', destination: '시즈오카', nights: 2, days: 3, departure_airport: '김해공항', airline: 'BX', flight_out: 'BX1645', flight_in: 'BX1635' },
      highlights: { inclusions: COMMON.inclusions, excludes: COMMON.excludes, remarks: ['없는 날짜는 지상 마감입니다.', '2인출발 가능하나 차량 조인 될 수 있으며, 조인 없을 경우 비용 추가됩니다.'] },
      days: [DAY1, makeGolfDay(2), makeLastDay(3)],
      optional_tours: [],
    },
  },
  {
    title: '시즈오카 명문 회원제 후가쿠 2색 골프 72홀 3박4일',
    duration: 4,
    nights: 3,
    price: 2099000,
    product_summary: '시즈오카 명문 회원제 골프장 2색 72홀. 시마다CC + 후가쿠CC(전 홀 후지산 뷰). 3박4일 풀라운딩. 2인 출발 가능.',
    price_tiers: [
      { period_label: '5/1 (목)', departure_dates: ['2026-05-01'], adult_price: 2099000, status: 'available' },
    ],
    special_notes: '2인 출발시 1인 200,000원 up / 3인 출발시 1인 80,000원 up / 8인 출발시 1인 –40,000원',
    itinerary_data: {
      meta: { title: '시즈오카 명문 회원제 후가쿠 2색 골프 72홀', product_type: '고품격|2색골프', destination: '시즈오카', nights: 3, days: 4, departure_airport: '김해공항', airline: 'BX', flight_out: 'BX1645', flight_in: 'BX1635' },
      highlights: { inclusions: COMMON.inclusions, excludes: COMMON.excludes, remarks: ['없는 날짜는 지상 마감입니다.'] },
      days: [DAY1, makeGolfDay(2), makeGolfDay(3), makeLastDay(4)],
      optional_tours: [],
    },
  },
  {
    title: '시즈오카 명문 회원제 후가쿠 2색 골프 99홀 4박5일',
    duration: 5,
    nights: 4,
    price: 2299000,
    product_summary: '시즈오카 명문 회원제 골프장 2색 99홀. 시마다CC + 후가쿠CC(전 홀 후지산 뷰). 4박5일 풀라운딩. 2인 출발 가능.',
    price_tiers: [
      { period_label: '5/4 (일)', departure_dates: ['2026-05-04'], adult_price: 2299000, status: 'available' },
    ],
    special_notes: '2인 출발시 1인 230,000원 up / 3인 출발시 1인 100,000원 up / 8인 출발시 1인 –40,000원',
    itinerary_data: {
      meta: { title: '시즈오카 명문 회원제 후가쿠 2색 골프 99홀', product_type: '고품격|2색골프', destination: '시즈오카', nights: 4, days: 5, departure_airport: '김해공항', airline: 'BX', flight_out: 'BX1645', flight_in: 'BX1635' },
      highlights: { inclusions: COMMON.inclusions, excludes: COMMON.excludes, remarks: ['없는 날짜는 지상 마감입니다.'] },
      days: [DAY1, makeGolfDay(2), makeGolfDay(3), makeGolfDay(4), makeLastDay(5)],
      optional_tours: [],
    },
  },
];

async function main() {
  console.log('시즈오카 골프 상품 3종 INSERT\n');

  for (const p of PRODUCTS) {
    const row = {
      ...COMMON,
      title: p.title,
      duration: p.duration,
      nights: p.nights,
      price: p.price,
      product_summary: p.product_summary,
      price_tiers: p.price_tiers,
      special_notes: p.special_notes,
      itinerary_data: p.itinerary_data,
      raw_text: p.title, // 원본 참조용
    };

    const { data, error } = await sb.from('travel_packages').insert(row).select('id, title').single();
    if (error) {
      console.error('INSERT 실패:', p.title, error.message);
    } else {
      console.log('✓', data.title);
      console.log('  ID:', data.id);
      console.log('  랜딩: /packages/' + data.id);
      console.log('');
    }
  }
}

main().catch(e => console.error(e.message));
