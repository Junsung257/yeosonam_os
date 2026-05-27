/**
 * 투어폰 장가계 2026년 여름 6종 일괄 INSERT
 * 실속/품격/고품격 × 3박4일/4박5일
 * 랜드사: 투어폰 | 커미션: 9%
 * 발권마감: 2026-04-29 | 출발확정: 4명(실속/품격), 8명(고품격)
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── 공통 함수 ──
function flight(time, activity, transport) { return { time, activity, type: 'flight', transport, note: null, badge: null }; }
function normal(time, activity) { return { time, activity, type: 'normal', transport: null, note: null, badge: null }; }
function shopping(time, activity) { return { time, activity, type: 'shopping', transport: null, note: null, badge: null }; }

// ═══════════════════════════════════════════
// 공통 데이터
// ═══════════════════════════════════════════
const COMMON_NOTICES = [
  { type: 'CRITICAL', title: '필수 확인 사항', text: '• 여권 유효기간 출발일기준 6개월이상\n• 단수여권, 긴급여권, 관용여권 입국불가\n• 4/29(수)까지 항공권 발권 조건' },
  { type: 'PAYMENT', title: '추가 요금 및 할증', text: '• 유류세 4월기준, 이후 변동 가능\n• 매너팁 및 개인경비 별도' },
  { type: 'INFO', title: '여행 정보', text: '• 상기 일정은 현지 및 항공사 사정에 의해 변경될 수 있습니다' },
];

// ── 호텔 정보 ──
const HOTEL_SILSOK = { name: '블루베이 또는 베스트웨스턴호텔', grade: '4.5', note: '또는 동급(준5성)' };
const HOTEL_PUMGYUK = { name: '선샤인 / 피닉스 / 청하금강호텔', grade: '5', note: '또는 동급(정5성)' };
const HOTEL_GOPUMGYUK = { name: '풀만 / 하워드존슨(구 하얏트) / 힐튼 / 렌조이', grade: '5+', note: '동급 (특5성 확정보장)' };

// ── 공통 일정 블록 ──
// DAY1 공통: 천문산 (실속/품격은 천문호선쇼 포함, 고품격은 마사지 포함)
const DAY1_COMMON_SCHEDULE = [
  flight('09:00', '부산 출발', 'BX371'),
  normal('11:20', '장가계 도착 / 가이드 미팅 후 중식'),
  normal(null, '▶장가계의 혼이라 불리는 천문산 등정'),
  normal(null, '신선이 만든 듯한 기기묘묘한 봉우리들의 절경 감상'),
  normal(null, '999개의 계단위 하늘로 통하는 문 천문동'),
  normal(null, '케이블카 상행-에스컬레이터-천문산사-귀곡잔도-유리잔도-천문산동선-케이블카 하행'),
];

// 마지막날 공통 (3박: day4 / 4박: day5)
function dayLast(dayNum) {
  return {
    day: dayNum, regions: ['장가계', '부산'],
    meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '김밥 또는 도시락', dinner: false },
    schedule: [
      normal(null, '호텔 조식 후'),
      normal(null, '▶돌과 모래로 만든 작품들을 전시하고 있는 군성사석화박물관'),
      flight('12:20', '장가계 출발', 'BX372'),
      normal('16:35', '부산 도착'),
    ],
    hotel: null,
  };
}

// ═══════════════════════════════════════════
// 요금표 (3박 / 4박 공용 — 등급별 컬럼 인덱스로 분리)
// ═══════════════════════════════════════════
// [period_label, date_range/dates, day_of_week, 실속, 품격, 고품격, note]
const PRICE_3N = [
  // 6/28~8/23 주2회 목 3박
  { label: '6/28~8/23 목', range: ['2026-06-28','2026-08-23'], dow: '목', p: [889000, 999000, 1329000], exclude: ['2026-07-16','2026-08-13'] },
  { label: '7/16 목', dates: ['2026-07-16'], p: [1139000, 1249000, 1599000] },
  { label: '8/13 목', dates: ['2026-08-13'], p: [1179000, 1289000, 1629000] },
  // 8/27~9/28 주6회 토일월 3박
  { label: '8/27~9/20 토', range: ['2026-08-27','2026-09-20'], dow: '토', p: [1169000, 1279000, 1619000] },
  { label: '8/27~9/20 일', range: ['2026-08-27','2026-09-20'], dow: '일', p: [1029000, 1129000, 1459000] },
  { label: '8/27~9/20 월', range: ['2026-08-27','2026-09-20'], dow: '월', p: [969000, 1069000, 1399000], exclude: ['2026-09-21'] },
  { label: '9/21 월', dates: ['2026-09-21'], p: [1069000, 1179000, 1499000] },
  // 9/29~10/4 매일운항 3박
  { label: '9/29 화', dates: ['2026-09-29'], p: [1179000, 1279000, 1619000] },
  { label: '9/30 수', dates: ['2026-09-30'], p: [1269000, 1369000, 1719000] },
  { label: '10/1 목', dates: ['2026-10-01'], p: [1379000, 1479000, 1829000] },
  { label: '10/2 금', dates: ['2026-10-02'], p: [1429000, 1529000, 1879000] },
  { label: '10/3 토', dates: ['2026-10-03'], p: [1399000, 1499000, 1859000] },
  { label: '10/4 일', dates: ['2026-10-04'], p: [1229000, 1329000, 1669000] },
  // 10/5~10/21 3박
  { label: '10/7~10/8 수목', dates: ['2026-10-07','2026-10-08'], p: [1569000, 1669000, 1999000] },
  { label: '10/9 금(한글날)', dates: ['2026-10-09'], p: [1849000, 1949000, 2269000] },
  { label: '10/5~10/21 월', range: ['2026-10-05','2026-10-21'], dow: '월', p: [1129000, 1229000, 1549000] },
  { label: '10/5~10/21 화', range: ['2026-10-05','2026-10-21'], dow: '화', p: [1179000, 1279000, 1619000], exclude: ['2026-09-29'] },
  { label: '10/5~10/21 수', range: ['2026-10-05','2026-10-21'], dow: '수', p: [1249000, 1349000, 1669000], exclude: ['2026-09-30','2026-10-07'] },
  { label: '10/5~10/21 목', range: ['2026-10-05','2026-10-21'], dow: '목', p: [1329000, 1429000, 1749000], exclude: ['2026-10-01','2026-10-08'] },
  { label: '10/5~10/21 일', range: ['2026-10-05','2026-10-21'], dow: '일', p: [1189000, 1289000, 1629000], exclude: ['2026-10-04'] },
];

const PRICE_4N = [
  // 6/28~8/23 일 4박
  { label: '6/28~8/15 일', range: ['2026-06-28','2026-08-15'], dow: '일', p: [949000, 999000, 1399000], exclude: ['2026-08-16'] },
  { label: '8/16 일', dates: ['2026-08-16'], p: [1099000, 1149000, 1569000] },
  // 8/27~9/28 화수목 4박
  { label: '8/27~9/21 화', range: ['2026-08-27','2026-09-21'], dow: '화', p: [1149000, 1199000, 1599000], exclude: ['2026-09-22'] },
  { label: '8/27~9/23 수', range: ['2026-08-27','2026-09-23'], dow: '수', p: [1199000, 1249000, 1649000], exclude: ['2026-09-23'] },
  { label: '8/27~9/24 목', range: ['2026-08-27','2026-09-24'], dow: '목', p: [1249000, 1299000, 1699000], exclude: ['2026-09-24'] },
  { label: '9/22 화', dates: ['2026-09-22'], p: [1649000, 1699000, 2099000] },
  { label: '9/23 수', dates: ['2026-09-23'], p: [1649000, 1699000, 2099000] },
  { label: '9/24 목', dates: ['2026-09-24'], p: [1899000, 1949000, 2349000] },
];

// 등급 인덱스: 0=실속, 1=품격, 2=고품격
function buildPriceTiers(priceData, gradeIdx) {
  return priceData.map(row => {
    const tier = {
      period_label: row.label,
      adult_price: row.p[gradeIdx],
      status: 'available',
    };
    if (row.dates) tier.departure_dates = row.dates;
    if (row.range) tier.date_range = { start: row.range[0], end: row.range[1] };
    if (row.dow) tier.departure_day_of_week = row.dow;
    if (row.exclude) tier.note = '제외일: ' + row.exclude.join(', ');
    return tier;
  });
}

const PRODUCTS = [];

// ═══════════════════════════════════════════
// 1. 【실속】장가계 3박4일
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: '【실속】장가계 3박4일 #노팁노옵션 #준5성 #칠성산 #마사지 #특식5회',
  destination: '장가계', category: '패키지', product_type: '실속|노팁노옵션', trip_style: '관광',
  departure_airport: '김해공항', airline: 'BX', min_participants: 4, status: 'approved', country: '중국',
  duration: 4, nights: 3, price: 889000,
  land_operator: '투어폰', commission_rate: 9,
  ticketing_deadline: '2026-04-29',
  product_summary: '장가계 실속 3박4일. 준5성 블루베이/베스트웨스턴. 노팁노옵션, 칠성산 루지, 마사지 90분, 특식 5회. 쇼핑 3회.',
  product_tags: ['노팁', '노옵션', '준5성', '칠성산', '마사지', '실속', '장가계', '중국'],
  product_highlights: ['노팁노옵션', '준5성 블루베이/베스트웨스턴', '칠성산 루지+유리전망대', '전신마사지 90분', '특식 5회'],
  price_tiers: buildPriceTiers(PRICE_3N, 0),
  inclusions: ['왕복 항공료 및 텍스, 유류세(4월기준)', '호텔(2인1실)', '차량', '가이드', '식사', '여행자보험', '기사/가이드경비'],
  excludes: ['매너팁 및 개인경비', '유류변동분'],
  accommodations: ['블루베이 또는 베스트웨스턴호텔 또는 동급(준5성)'],
  special_notes: '8명이상 리무진 (8명미만 일반차량). 쇼핑 3회(라텍스, 한약방, 게르마늄, 죽탄, 침향, 찻집, 동충하초 중 3회+농산물). 4/4/8분부터 출발확정.',
  notices_parsed: [
    ...COMMON_NOTICES,
    { type: 'POLICY', title: '쇼핑 안내', text: '• 라텍스, 한약방, 게르마늄, 죽탄, 침향, 찻집, 동충하초 중 3회(+농산물)' },
  ],
  itinerary_data: {
    meta: { title: '【실속】장가계 3박4일', destination: '장가계', nights: 3, days: 4, airline: 'BX', flight_out: 'BX371', flight_in: 'BX372', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복 항공료', '호텔(준5성)', '차량', '가이드', '식사', '보험'], excludes: ['매너팁', '개인경비', '유류변동분'], remarks: ['쇼핑 3회', '선택관광 없음'] },
    days: [
      { ...structuredClone({ day: 1, regions: ['부산','장가계'], meals: { breakfast: false, lunch: true, lunch_note: '누룽지백숙', dinner: true, dinner_note: '호텔식' },
        schedule: [...DAY1_COMMON_SCHEDULE, normal(null, '▶천문산을 배경으로 펼쳐지는 대형오페라쇼 천문호선쇼 관람')] }),
        hotel: HOTEL_SILSOK },
      { day: 2, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '산채비빔밥', dinner: true, dinner_note: '불고기' },
        schedule: [
          normal(null, '호텔 조식 후 ▶천자산 풍경구로 이동'),
          normal(null, '-2KM의 케이블카로 천자산 등정'),
          normal(null, '-붓을 꽂아놓은 듯한 형상의 어필봉'),
          normal(null, '-봉우리의 모양이 마치 선녀와 같은 선녀헌화'),
          normal(null, '-중국의 10대 원수 하룡장군의 동상이 있는 하룡공원'),
          normal(null, '▶원가계로 이동'),
          normal(null, '-200M의 봉우리 2개가 연결되어 있는 천하제일교'),
          normal(null, '-천태만상의 봉우리들의 향연 미혼대, 후화원'),
          normal(null, '-중국 최장의 백룡엘리베이터(326M)로 하산'),
          normal(null, '석식 후 ▶여행의 피로를 풀어주는 발+전신마사지(90분/매너팁별도)'),
          normal(null, '▶장가계의 떠오르는 야경명소 72기루(차창)'),
        ],
        hotel: HOTEL_SILSOK },
      { day: 3, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '버섯전골', dinner: true, dinner_note: '삼겹살 무제한' },
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '▶반자연, 반인공의 아름다운 보봉호 유람(VIP통로)'),
          normal(null, '▶상하 4층 크기의 대형 석회암동굴 황룡동굴'),
          normal(null, '▶7개의 봉우리가 북두칠성을 가리키는 칠성산'),
          normal(null, '-왕복케이블카, 유리전망대, 편도 루지'),
        ],
        hotel: HOTEL_SILSOK },
      dayLast(4),
    ],
  },
});

// ═══════════════════════════════════════════
// 2. 【품격】장가계 3박4일
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: '【품격】장가계 3박4일 #노팁노옵션 #정5성 #전신마사지 #칠성산+대협곡',
  destination: '장가계', category: '패키지', product_type: '품격|노팁노옵션', trip_style: '관광',
  departure_airport: '김해공항', airline: 'BX', min_participants: 4, status: 'approved', country: '중국',
  duration: 4, nights: 3, price: 999000,
  land_operator: '투어폰', commission_rate: 9,
  ticketing_deadline: '2026-04-29',
  product_summary: '장가계 품격 3박4일. 정5성 선샤인/피닉스/청하금강. 노팁노옵션, 칠성산+대협곡, 마사지 90분. 쇼핑 3회.',
  product_tags: ['노팁', '노옵션', '정5성', '칠성산', '대협곡', '마사지', '품격', '장가계', '중국'],
  product_highlights: ['노팁노옵션', '정5성 선샤인/피닉스/청하금강', '칠성산+대협곡 유리다리', '전신마사지 90분'],
  price_tiers: buildPriceTiers(PRICE_3N, 1),
  inclusions: ['왕복 항공료 및 텍스, 유류세(4월기준)', '호텔(2인1실)', '차량', '가이드', '식사', '여행자보험', '기사/가이드경비'],
  excludes: ['매너팁 및 개인경비', '유류변동분'],
  accommodations: ['선샤인 / 피닉스 / 청하금강호텔 또는 동급(정5성)'],
  special_notes: '8명이상 리무진 (8명미만 일반차량). 쇼핑 3회(라텍스, 한약방, 게르마늄, 죽탄, 침향, 찻집, 동충하초 중 3회+농산물). 4/4/8분부터 출발확정.',
  notices_parsed: [
    ...COMMON_NOTICES,
    { type: 'POLICY', title: '쇼핑 안내', text: '• 라텍스, 한약방, 게르마늄, 죽탄, 침향, 찻집, 동충하초 중 3회(+농산물)' },
  ],
  itinerary_data: {
    meta: { title: '【품격】장가계 3박4일', destination: '장가계', nights: 3, days: 4, airline: 'BX', flight_out: 'BX371', flight_in: 'BX372', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복 항공료', '호텔(정5성)', '차량', '가이드', '식사', '보험'], excludes: ['매너팁', '개인경비', '유류변동분'], remarks: ['쇼핑 3회'] },
    days: [
      { day: 1, regions: ['부산','장가계'],
        meals: { breakfast: false, lunch: true, lunch_note: '누룽지백숙', dinner: true, dinner_note: '호텔식' },
        schedule: [...DAY1_COMMON_SCHEDULE, normal(null, '▶천문산을 배경으로 펼쳐지는 대형오페라쇼 천문호선쇼 관람')],
        hotel: HOTEL_PUMGYUK },
      { day: 2, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '산채비빔밥', dinner: true, dinner_note: '불고기' },
        schedule: [
          normal(null, '호텔 조식 후 ▶천자산 풍경구로 이동'),
          normal(null, '-2KM의 케이블카로 천자산 등정'),
          normal(null, '-어필봉, 선녀헌화, 하룡공원'),
          normal(null, '▶원가계로 이동 - 천하제일교, 미혼대, 후화원'),
          normal(null, '-중국 최장의 백룡엘리베이터(326M)로 하산'),
          normal(null, '▶칠성산 - 왕복케이블카, 유리전망대, 편도 루지'),
          normal(null, '석식 후 ▶발+전신마사지(90분/매너팁별도)'),
        ],
        hotel: HOTEL_PUMGYUK },
      { day: 3, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '버섯전골', dinner: true, dinner_note: '삼겹살 무제한' },
        schedule: [
          normal(null, '▶보봉호 유람(VIP통로)'),
          normal(null, '▶황룡동굴(VIP통로)'),
          normal(null, '▶장가계 대협곡 - 유리다리+엘리베이터+봅슬레이+신천호유람'),
          normal(null, '▶72기루(차창)'),
        ],
        hotel: HOTEL_PUMGYUK },
      dayLast(4),
    ],
  },
});

// ═══════════════════════════════════════════
// 3. 【고품격】장가계 3박4일
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: '【고품격】장가계 3박4일 #노팁노옵션 #노쇼핑 #특5성 #72기루내부 #칠성산+대협곡 #식사UP',
  destination: '장가계', category: '패키지', product_type: '고품격|노팁노옵션|노쇼핑', trip_style: '관광',
  departure_airport: '김해공항', airline: 'BX', min_participants: 8, status: 'approved', country: '중국',
  duration: 4, nights: 3, price: 1329000,
  land_operator: '투어폰', commission_rate: 9,
  ticketing_deadline: '2026-04-29',
  product_summary: '장가계 고품격 3박4일. 특5성 풀만/하얏트/힐튼/렌조이 확정. 노쇼핑, 72기루 내부관광, 하이디라오 훠궈, 양꼬치+맥주.',
  product_tags: ['노팁', '노옵션', '노쇼핑', '특5성', '72기루', '칠성산', '대협곡', '고품격', '장가계', '중국'],
  product_highlights: ['노쇼핑', '특5성 풀만/하얏트/힐튼/렌조이 확정', '72기루 내부관광', '하이디라오 훠궈', '칠성산+대협곡'],
  price_tiers: buildPriceTiers(PRICE_3N, 2),
  inclusions: ['왕복 항공료 및 텍스, 유류세(4월기준)', '호텔(2인1실)', '차량', '가이드', '식사', '여행자보험', '기사/가이드경비'],
  excludes: ['매너팁 및 개인경비', '유류변동분'],
  accommodations: ['풀만 / 하워드존슨(구 하얏트) / 힐튼 / 렌조이 동급(특5성 확정보장)'],
  special_notes: '리무진 차량(인원별배정). 노쇼핑. 8명이상 출발.',
  notices_parsed: COMMON_NOTICES,
  itinerary_data: {
    meta: { title: '【고품격】장가계 3박4일', destination: '장가계', nights: 3, days: 4, airline: 'BX', flight_out: 'BX371', flight_in: 'BX372', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복 항공료', '호텔(특5성 확정)', '리무진차량', '가이드', '식사', '보험'], excludes: ['매너팁', '개인경비'], remarks: ['노쇼핑'] },
    days: [
      { day: 1, regions: ['부산','장가계'],
        meals: { breakfast: false, lunch: true, lunch_note: '누룽지백숙', dinner: true, dinner_note: '훠궈(하이디라오)' },
        schedule: [...DAY1_COMMON_SCHEDULE, normal(null, '▶발+전신마사지(90분/매너팁별도)')],
        hotel: HOTEL_GOPUMGYUK },
      { day: 2, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '산채비빔밥', dinner: true, dinner_note: '소모듬구이' },
        schedule: [
          normal(null, '호텔 조식 후 ▶천자산 풍경구로 이동'),
          normal(null, '-2KM의 케이블카로 천자산 등정'),
          normal(null, '-어필봉, 선녀헌화, 하룡공원'),
          normal(null, '▶원가계로 이동 - 천하제일교, 미혼대, 후화원'),
          normal(null, '-중국 최장의 백룡엘리베이터(326M)로 하산'),
          normal(null, '▶십리화랑(왕복 모노레일)'),
          normal(null, '▶금편계곡(도보산책)'),
          normal(null, '▶황룡동굴(VIP통로)'),
          normal(null, '▶매력상서쇼 관람'),
        ],
        hotel: HOTEL_GOPUMGYUK },
      { day: 3, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '소불고기', dinner: true, dinner_note: '양꼬치+맥주1병' },
        schedule: [
          normal(null, '▶장가계 대협곡 - 유리다리+엘리베이터+봅슬레이+신천호유람'),
          normal(null, '▶칠성산 - 왕복케이블카, 유리전망대, 편도 루지'),
          normal(null, '▶72기루(내부관광)'),
        ],
        hotel: HOTEL_GOPUMGYUK },
      { ...dayLast(4), meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '도시락+생수', dinner: false } },
    ],
  },
});

// ═══════════════════════════════════════════
// 4. 【실속】장가계 4박5일
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: '【실속】장가계 4박5일 #노팁노옵션 #준5성 #칠성산+대협곡 #마사지 #특식6회',
  destination: '장가계', category: '패키지', product_type: '실속|노팁노옵션', trip_style: '관광',
  departure_airport: '김해공항', airline: 'BX', min_participants: 4, status: 'approved', country: '중국',
  duration: 5, nights: 4, price: 949000,
  land_operator: '투어폰', commission_rate: 9,
  ticketing_deadline: '2026-04-29',
  product_summary: '장가계 실속 4박5일. 준5성 블루베이/베스트웨스턴. 노팁노옵션, 칠성산+대협곡, 마사지, 특식 6회. 쇼핑 3회.',
  product_tags: ['노팁', '노옵션', '준5성', '칠성산', '대협곡', '마사지', '실속', '장가계', '중국', '4박5일'],
  product_highlights: ['노팁노옵션', '준5성 블루베이/베스트웨스턴', '칠성산+대협곡', '전신마사지 90분', '특식 6회'],
  price_tiers: buildPriceTiers(PRICE_4N, 0),
  inclusions: ['왕복 항공료 및 텍스, 유류세(4월기준)', '호텔(2인1실)', '차량', '가이드', '식사', '여행자보험', '기사/가이드경비'],
  excludes: ['매너팁 및 개인경비', '유류변동분'],
  accommodations: ['블루베이 또는 베스트웨스턴호텔 또는 동급(준5성)'],
  special_notes: '8명이상 리무진 (8명미만 일반차량). 쇼핑 3회(라텍스, 한약방, 게르마늄, 죽탄, 침향, 찻집, 동충하초 중 3회+농산물).',
  notices_parsed: [
    ...COMMON_NOTICES,
    { type: 'POLICY', title: '쇼핑 안내', text: '• 라텍스, 한약방, 게르마늄, 죽탄, 침향, 찻집, 동충하초 중 3회(+농산물)' },
  ],
  itinerary_data: {
    meta: { title: '【실속】장가계 4박5일', destination: '장가계', nights: 4, days: 5, airline: 'BX', flight_out: 'BX371', flight_in: 'BX372', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복 항공료', '호텔(준5성)', '차량', '가이드', '식사', '보험'], excludes: ['매너팁', '개인경비', '유류변동분'], remarks: ['쇼핑 3회'] },
    days: [
      { day: 1, regions: ['부산','장가계'],
        meals: { breakfast: false, lunch: true, lunch_note: '누룽지백숙', dinner: true, dinner_note: '호텔식' },
        schedule: [...DAY1_COMMON_SCHEDULE, normal(null, '▶천문산을 배경으로 펼쳐지는 대형오페라쇼 천문호선쇼 관람')],
        hotel: HOTEL_SILSOK },
      { day: 2, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '산채비빔밥', dinner: true, dinner_note: '소불고기' },
        schedule: [
          normal(null, '호텔 조식 후 ▶천자산 풍경구로 이동'),
          normal(null, '-2KM의 케이블카로 천자산 등정'),
          normal(null, '-어필봉, 선녀헌화, 하룡공원'),
          normal(null, '▶원가계로 이동 - 천하제일교, 미혼대, 후화원'),
          normal(null, '-중국 최장의 백룡엘리베이터(326M)로 하산'),
          normal(null, '▶십리화랑(왕복 모노레일)'),
          normal(null, '▶금편계곡(도보산책)'),
          normal(null, '▶발+전신마사지(90분/매너팁별도)'),
        ],
        hotel: HOTEL_SILSOK },
      { day: 3, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식', dinner: true, dinner_note: '삼겹살 무제한' },
        schedule: [
          normal(null, '▶보봉호 유람(VIP통로)'),
          normal(null, '▶토가풍정원'),
          normal(null, '▶72기루(차창관광)'),
          normal(null, '▶칠성산 - 왕복케이블카, 유리전망대, 편도 루지'),
        ],
        hotel: HOTEL_SILSOK },
      { day: 4, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '버섯전골', dinner: true, dinner_note: '양꼬치 무제한' },
        schedule: [
          normal(null, '▶황룡동굴'),
          normal(null, '▶장가계 대협곡 - 유리다리+엘리베이터+봅슬레이+신천호유람'),
        ],
        hotel: HOTEL_SILSOK },
      dayLast(5),
    ],
  },
});

// ═══════════════════════════════════════════
// 5. 【품격】장가계+부용진 4박5일
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: '【품격】장가계+부용진 4박5일 #노팁노옵션 #정5성 #전신마사지 #칠성산+대협곡 #부용진',
  destination: '장가계', category: '패키지', product_type: '품격|노팁노옵션', trip_style: '관광',
  departure_airport: '김해공항', airline: 'BX', min_participants: 4, status: 'approved', country: '중국',
  duration: 5, nights: 4, price: 999000,
  land_operator: '투어폰', commission_rate: 9,
  ticketing_deadline: '2026-04-29',
  product_summary: '장가계+부용진 품격 4박5일. 정5성 선샤인/피닉스/청하금강. 부용진 야경, 칠성산+대협곡, 마사지. 쇼핑 3회.',
  product_tags: ['노팁', '노옵션', '정5성', '부용진', '칠성산', '대협곡', '마사지', '품격', '장가계', '중국', '4박5일'],
  product_highlights: ['노팁노옵션', '정5성 선샤인/피닉스/청하금강', '부용진 폭포마을 야경', '칠성산+대협곡', '전신마사지'],
  price_tiers: buildPriceTiers(PRICE_4N, 1),
  inclusions: ['왕복 항공료 및 텍스, 유류세(4월기준)', '호텔(2인1실)', '차량', '가이드', '식사', '여행자보험', '기사/가이드경비'],
  excludes: ['매너팁 및 개인경비', '유류변동분'],
  accommodations: ['선샤인 / 피닉스 / 청하금강호텔 또는 동급(정5성)'],
  special_notes: '8명이상 리무진 (8명미만 일반차량). 쇼핑 3회(라텍스, 한약방, 게르마늄, 죽탄, 침향, 찻집, 동충하초 중 3회+농산물).',
  notices_parsed: [
    ...COMMON_NOTICES,
    { type: 'POLICY', title: '쇼핑 안내', text: '• 라텍스, 한약방, 게르마늄, 죽탄, 침향, 찻집, 동충하초 중 3회(+농산물)' },
  ],
  itinerary_data: {
    meta: { title: '【품격】장가계+부용진 4박5일', destination: '장가계', nights: 4, days: 5, airline: 'BX', flight_out: 'BX371', flight_in: 'BX372', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복 항공료', '호텔(정5성)', '차량', '가이드', '식사', '보험'], excludes: ['매너팁', '개인경비', '유류변동분'], remarks: ['쇼핑 3회'] },
    days: [
      { day: 1, regions: ['부산','장가계'],
        meals: { breakfast: false, lunch: true, lunch_note: '누룽지백숙', dinner: true, dinner_note: '호텔식' },
        schedule: [...DAY1_COMMON_SCHEDULE, normal(null, '▶천문산을 배경으로 펼쳐지는 대형오페라쇼 천문호선쇼 관람')],
        hotel: HOTEL_PUMGYUK },
      { day: 2, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '산채비빔밥', dinner: true, dinner_note: '소불고기' },
        schedule: [
          normal(null, '호텔 조식 후 ▶천자산 풍경구로 이동'),
          normal(null, '-2KM의 케이블카로 천자산 등정'),
          normal(null, '-어필봉, 선녀헌화, 하룡공원'),
          normal(null, '▶원가계로 이동 - 천하제일교, 미혼대, 후화원'),
          normal(null, '-중국 최장의 백룡엘리베이터(326M)로 하산'),
          normal(null, '▶십리화랑(왕복 모노레일)'),
          normal(null, '▶금편계곡(도보산책)'),
          normal(null, '▶발+전신마사지(90분/매너팁별도)'),
        ],
        hotel: HOTEL_PUMGYUK },
      { day: 3, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식', dinner: true, dinner_note: '삼겹살 무제한' },
        schedule: [
          normal(null, '▶보봉호 유람(VIP통로)'),
          normal(null, '▶토가풍정원'),
          normal(null, '▶72기루(차창)'),
          normal(null, '▶칠성산 - 왕복케이블카, 유리전망대, 편도 루지'),
        ],
        hotel: HOTEL_PUMGYUK },
      { day: 4, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '버섯전골', dinner: true, dinner_note: '현지식(부용진 폭포뷰)' },
        schedule: [
          normal(null, '▶황룡동굴(VIP통로)'),
          normal(null, '▶장가계 대협곡 - 유리다리+엘리베이터+봅슬레이+신천호유람'),
          normal(null, '▶폭포마을 부용진 마을 야경관광'),
        ],
        hotel: HOTEL_PUMGYUK },
      dayLast(5),
    ],
  },
});

// ═══════════════════════════════════════════
// 6. 【고품격】장가계+부용진 4박5일
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: '【고품격】장가계+부용진 4박5일 #노팁노옵션 #노쇼핑 #특5성 #마사지 #72기루내부 #칠성산+대협곡 #식사UP',
  destination: '장가계', category: '패키지', product_type: '고품격|노팁노옵션|노쇼핑', trip_style: '관광',
  departure_airport: '김해공항', airline: 'BX', min_participants: 8, status: 'approved', country: '중국',
  duration: 5, nights: 4, price: 1399000,
  land_operator: '투어폰', commission_rate: 9,
  ticketing_deadline: '2026-04-29',
  product_summary: '장가계+부용진 고품격 4박5일. 특5성 풀만/하얏트/힐튼/렌조이. 노쇼핑, 72기루 내부, 부용진 야경, 하이디라오, 양꼬치+맥주.',
  product_tags: ['노팁', '노옵션', '노쇼핑', '특5성', '72기루', '부용진', '칠성산', '대협곡', '고품격', '장가계', '중국', '4박5일'],
  product_highlights: ['노쇼핑', '특5성 풀만/하얏트/힐튼/렌조이 확정', '부용진 폭포 야경', '72기루 내부관광', '하이디라오 훠궈'],
  price_tiers: buildPriceTiers(PRICE_4N, 2),
  inclusions: ['왕복 항공료 및 텍스, 유류세(4월기준)', '호텔(2인1실)', '차량', '가이드', '식사', '여행자보험', '기사/가이드경비'],
  excludes: ['매너팁 및 개인경비', '유류변동분'],
  accommodations: ['풀만 / 하워드존슨(구 하얏트) / 힐튼 / 렌조이 동급(특5성 확정보장)'],
  special_notes: '리무진 차량(인원별배정). 노쇼핑. 8명이상 출발.',
  notices_parsed: COMMON_NOTICES,
  itinerary_data: {
    meta: { title: '【고품격】장가계+부용진 4박5일', destination: '장가계', nights: 4, days: 5, airline: 'BX', flight_out: 'BX371', flight_in: 'BX372', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복 항공료', '호텔(특5성 확정)', '리무진차량', '가이드', '식사', '보험'], excludes: ['매너팁', '개인경비'], remarks: ['노쇼핑'] },
    days: [
      { day: 1, regions: ['부산','장가계'],
        meals: { breakfast: false, lunch: true, lunch_note: '누룽지백숙', dinner: true, dinner_note: '훠궈(하이디라오)' },
        schedule: [...DAY1_COMMON_SCHEDULE, normal(null, '▶발+전신마사지(90분/매너팁별도)')],
        hotel: HOTEL_GOPUMGYUK },
      { day: 2, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '산채비빔밥', dinner: true, dinner_note: '소모듬구이' },
        schedule: [
          normal(null, '호텔 조식 후 ▶천자산 풍경구로 이동'),
          normal(null, '-2KM의 케이블카로 천자산 등정'),
          normal(null, '-어필봉, 선녀헌화, 하룡공원'),
          normal(null, '▶원가계로 이동 - 천하제일교, 미혼대, 후화원'),
          normal(null, '-중국 최장의 백룡엘리베이터(326M)로 하산'),
          normal(null, '▶십리화랑(왕복 모노레일)'),
          normal(null, '▶금편계곡(도보산책)'),
          normal(null, '▶매력상서쇼 관람'),
        ],
        hotel: HOTEL_GOPUMGYUK },
      { day: 3, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '소불고기', dinner: true, dinner_note: '현지식(부용진 폭포뷰)' },
        schedule: [
          normal(null, '▶황룡동굴(VIP통로)'),
          normal(null, '▶보봉호 유람(VIP통로)'),
          normal(null, '▶토가풍정원'),
          normal(null, '▶폭포마을 부용진 마을 야경관광'),
        ],
        hotel: HOTEL_GOPUMGYUK },
      { day: 4, regions: ['장가계'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '버섯전골', dinner: true, dinner_note: '양꼬치+맥주1병' },
        schedule: [
          normal(null, '▶장가계 대협곡 - 유리다리+엘리베이터+봅슬레이+신천호유람'),
          normal(null, '▶칠성산 - 왕복케이블카, 유리전망대, 편도 루지'),
          normal(null, '▶72기루(내부관광)'),
        ],
        hotel: HOTEL_GOPUMGYUK },
      { ...dayLast(5), meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '도시락+생수', dinner: false } },
    ],
  },
});

// ═══════════════════════════════════════════
// 실행부
// ═══════════════════════════════════════════
async function run() {
  console.log(`\n🚀 투어폰 장가계 2026 여름 ${PRODUCTS.length}종 등록 시작...\n`);

  for (const pkg of PRODUCTS) {
    const { data, error } = await sb.from('travel_packages').insert([{
      title: pkg.title,
      destination: pkg.destination,
      category: pkg.category,
      product_type: pkg.product_type,
      trip_style: pkg.trip_style,
      departure_airport: pkg.departure_airport,
      airline: pkg.airline,
      min_participants: pkg.min_participants,
      status: pkg.status,
      country: pkg.country,
      duration: pkg.duration,
      nights: pkg.nights,
      price: pkg.price,
      land_operator: pkg.land_operator,
      commission_rate: pkg.commission_rate,
      ticketing_deadline: pkg.ticketing_deadline,
      product_summary: pkg.product_summary,
      product_tags: pkg.product_tags,
      product_highlights: pkg.product_highlights,
      price_tiers: pkg.price_tiers,
      inclusions: pkg.inclusions,
      excludes: pkg.excludes,
      accommodations: pkg.accommodations,
      special_notes: pkg.special_notes,
      notices_parsed: pkg.notices_parsed,
      itinerary_data: pkg.itinerary_data,
      filename: 'manual-tourphone-zhangjiajie-2026summer',
      file_type: 'manual',
      confidence: 1.0,
    }]).select('id, title');

    if (error) {
      console.error(`❌ ${pkg.title}:`, error.message);
    } else {
      console.log(`✅ ${data[0].title} (${data[0].id})`);
    }
  }

  console.log('\n🏁 완료!\n');
}

run().catch(console.error);
