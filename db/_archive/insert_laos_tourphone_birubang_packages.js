/**
 * ★ 부산-라오스 26년 4~6월 투어폰 비루방/비루방방 4개 상품 일괄 등록
 * 1) 비루방 실속 3박5일 (목)   2) 비루방 노팁풀옵션 3박5일 (목)
 * 3) 비루방방 실속 4박6일 (일)  4) 비루방방 노팁풀옵션 4박6일 (일)
 * 랜드사: 투어폰(TP) / 마진: 9%
 * ★4월 27일(월)까지 선발권조건 상품★
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

const OPTIONAL_TOURS_SILSOK_5D = [
  { name: '전신마사지 2시간', price_usd: 40, price_krw: null, note: '팁별도' },
  { name: '메콩유람선', price_usd: 30, price_krw: null, note: null },
  { name: '버기카', price_usd: 50, price_krw: null, note: null },
  { name: '짚라인', price_usd: 60, price_krw: null, note: null },
  { name: '롱테일보트', price_usd: 30, price_krw: null, note: null },
];

const OPTIONAL_TOURS_SILSOK_6D = [
  { name: '전신마사지 2시간', price_usd: 40, price_krw: null, note: '팁별도' },
  { name: '메콩유람선', price_usd: 30, price_krw: null, note: null },
  { name: '버기카', price_usd: 50, price_krw: null, note: null },
  { name: '짚라인', price_usd: 60, price_krw: null, note: null },
  { name: '롱테일보트', price_usd: 30, price_krw: null, note: null },
];

const OPTIONAL_TOURS_NOPUL_5D = [
  { name: '전신마사지 2시간', price_usd: 40, price_krw: null, note: '팁별도' },
  { name: '메콩유람선', price_usd: 30, price_krw: null, note: null },
  { name: '시크릿라군', price_usd: 20, price_krw: null, note: null },
  { name: '나이트시티투어', price_usd: 30, price_krw: null, note: null },
];

const OPTIONAL_TOURS_NOPUL_6D = [
  { name: '전신마사지 2시간', price_usd: 40, price_krw: null, note: '팁별도' },
  { name: '메콩유람선', price_usd: 30, price_krw: null, note: null },
  { name: '시크릿라군', price_usd: 20, price_krw: null, note: null },
  { name: '나이트시티투어', price_usd: 30, price_krw: null, note: null },
];

// ── 공통 일정 블록 ──
function day1_arrival(hotelName, hotelGrade) {
  return {
    day: 1,
    regions: ['부산', '비엔티엔'],
    meals: meal(false, false, false, null, null, null),
    schedule: [
      flight('21:25', '김해 국제공항 출발', 'BX745'),
      flight('00:15', '비엔티엔 도착 후 입국수속', 'BX745'),
      normal(null, '가이드 미팅 후 호텔이동 후 체크인, 호텔 휴식', '과일도시락 룸당 1개'),
    ],
    hotel: { name: hotelName, grade: hotelGrade, note: null },
  };
}

function dayLast_3n5d() {
  return {
    day: 5,
    regions: ['비엔티엔', '부산'],
    meals: meal(false, false, false, null, null, null),
    schedule: [
      flight('01:15', '비엔티엔 공항 출발', 'BX746'),
      flight('07:55', '김해 국제공항 도착', 'BX746'),
    ],
    hotel: null,
  };
}

function dayLast_4n6d() {
  return {
    day: 6,
    regions: ['비엔티엔', '부산'],
    meals: meal(false, false, false, null, null, null),
    schedule: [
      flight('01:15', '비엔티엔 공항 출발', 'BX746'),
      flight('07:55', '김해 국제공항 도착', 'BX746'),
    ],
    hotel: null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  1. 비루방 실속 - [BX] 비엔티엔/루앙프라방/방비엥 3박5일 (목요일)
// ══════════════════════════════════════════════════════════════════════════════
const PKG1 = {
  ...COMMON,
  title: '[BX] 비엔티엔/루앙프라방/방비엥 실속 3박5일 (투어폰)',
  destination: '비엔티엔/루앙프라방/방비엥',
  product_type: '실속',
  trip_style: '3박5일',
  duration: 5, nights: 3,
  departure_days: '매주 목요일',
  price: 849000,
  guide_tip: '$50/인',
  single_supplement: '12만원',
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  optional_tours: OPTIONAL_TOURS_SILSOK_5D,
  price_tiers: [
    { period_label: '4/1~4/30 목요일[비루방]', date_range: { start: '2026-04-02', end: '2026-04-30' }, departure_day_of_week: '목', adult_price: 899000, status: 'available' },
    { period_label: '5/1~6/25 목요일[비루방]', date_range: { start: '2026-05-07', end: '2026-06-25' }, departure_day_of_week: '목', adult_price: 849000, status: 'available' },
    { period_label: '★특정일★ 4/30, 5/21', departure_dates: ['2026-04-30', '2026-05-21'], adult_price: 1099000, status: 'available', note: '특정일 특별요금' },
  ],
  inclusions: [
    '왕복 항공료 및 텍스, 유류할증료(발권일기준)',
    '호텔, 차량, 가이드, 관광지입장료, 식사, 여행자보험',
    '특전 – 특식 1회, 과일도시락 룸당 1개, 아마존커피 1인 1잔, 방비엥뷰 바(비어라오 or 음료 1잔 제공)',
  ],
  excludes: [
    '기사/가이드경비 $50/인',
    '매너팁 및 개인경비',
    '선택관광비용',
    '유류변동분',
    '싱글발생 시, 싱글차지 12만원',
  ],
  notices_parsed: [
    '라오스 전자담배 반입, 소지 및 사용 금지국가 – 적발시 최소 $50 이상벌금 부과됨',
    '사원 방문 시, 민소매 상의, 짧은 하의 착용 불가 – 무릎 아래 길이의 하의 착용하셔야 합니다',
    '행사 비합류시 1일당 1인 $100 패널티 적용',
    '외국국적자(여권확인) 1인 $50 패널티 적용',
    '라오스 특성상 방비엥 – 쏭태우, 루앙프라방 – 15인승 벤으로 이동합니다',
    '4월 27일(월)까지 선발권조건 상품',
  ],
  special_notes: '쇼핑: 침향, 라텍스, 잡화 3회\n싱글차지 12만원\n2인 1실 기준\n성인 4명 이상 출발 가능\n4월 27일(월)까지 선발권조건 상품',
  product_highlights: [
    '비엔티엔/루앙프라방/방비엥 라오스 완전일주',
    '고속열차 C92/C91 탑승',
    '쾅시폭포, 왓마이사원, 왓씨엥통, 푸씨산',
    '블루라군 천연풀장 + 전신마사지 1시간',
    '탐논/탐쌍 동굴탐험 + 카약트래킹',
    '특전: 특식1회, 과일도시락, 아마존커피, 방비엥뷰바',
  ],
  product_summary: '에어부산 직항 비엔티엔/루앙프라방/방비엥 실속 3박5일. 고속열차로 루앙프라방 이동, 쾅시폭포+왓씨엥통+푸씨산 관광. 방비엥 블루라군+동굴탐험+카약트래킹. 특식1회+과일도시락+아마존커피 특전.',
  product_tags: ['라오스', '루앙프라방', '방비엥', '비엔티엔', '고속열차', '쾅시폭포', '블루라군', '실속', '에어부산', '투어폰'],
  accommodations: ['아론 호텔 또는 동급 (4성급)', '반사나(Vansana LPQ) 또는 동급 (4성급)', '그랜드 리버사이드(Grand riverside) 또는 동급 (4성급)'],
  itinerary: [
    'DAY1: 부산→비엔티엔 | BX745 21:25-00:15 | 호텔체크인(과일도시락) | 아론호텔(4성)',
    'DAY2: 비엔티엔→루앙프라방(C92 09:50-11:42) | 왓마이사원, 왓씨엥통, 쾅시폭포, 푸씨산, 몽족야시장 | 반사나(4성)',
    'DAY3: 루앙프라방→방비엥(C91 14:02-14:59) | 탁밧행렬, 아침시장, 왕궁박물관 | 블루라군, 마사지1h | 그랜드리버사이드(4성)',
    'DAY4: 방비엥→비엔티엔(전용차량) | 탐논동굴, 탐쌍동굴, 카약트래킹 | 탓루앙사원, 빠뚜사이 | 메콩강야시장',
    'DAY5: BX746 01:15-07:55 부산도착',
  ],
  itinerary_data: {
    meta: {
      title: '[BX] 비엔티엔/루앙프라방/방비엥 실속 3박5일 (투어폰)',
      product_type: '실속', destination: '비엔티엔/루앙프라방/방비엥',
      nights: 3, days: 5, departure_airport: '부산(김해)',
      airline: 'BX(에어부산)', flight_out: 'BX745', flight_in: 'BX746',
      departure_days: '매주 목요일', min_participants: 4,
      room_type: '2인 1실', ticketing_deadline: null,
      hashtags: ['#루앙프라방', '#방비엥', '#쾅시폭포', '#고속열차', '#블루라군', '#탁밧'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 항공료 및 텍스, 유류할증료(발권일기준)',
        '호텔, 차량, 가이드, 관광지입장료, 식사, 여행자보험',
        '특전 – 특식 1회, 과일도시락 룸당 1개, 아마존커피 1인 1잔, 방비엥뷰 바(비어라오 or 음료 1잔 제공)',
      ],
      excludes: [
        '기사/가이드경비 $50/인',
        '매너팁 및 개인경비, 선택관광비용, 유류변동분',
        '싱글발생 시, 싱글차지 12만원',
      ],
      shopping: '침향, 라텍스, 잡화 3회',
      remarks: [
        '라오스 전자담배 반입, 소지 및 사용 금지국가 – 적발시 최소 $50 이상벌금 부과됨',
        '사원 방문 시, 민소매 상의, 짧은 하의 착용 불가 – 무릎 아래 길이의 하의 착용하셔야 합니다',
        '행사 비합류시 1일당 1인 $100 패널티 적용 / 외국국적자(여권확인) 1인 $50 패널티 적용',
        '라오스 특성상 방비엥 – 쏭태우, 루앙프라방 – 15인승 벤으로 이동합니다',
      ],
    },
    days: [
      day1_arrival('아론 호텔 또는 동급', '4성급'),
      {
        day: 2, regions: ['비엔티엔', '루앙프라방'],
        meals: meal(true, true, true, '호텔식', '한식', '스테이크'),
        schedule: [
          normal(null, '호텔 조식 후 비엔티엔 기차역으로 이동'),
          train('09:50', '루앙프라방으로 출발', 'C92'),
          normal('11:42', '루앙프라방 도착'),
          normal(null, '부처님의 일생을 금색 벽화로 표현한 왓 마이 사원 관광'),
          normal(null, '"황금도시의 사원" 이란 뜻을 가진 왓 씨엥통'),
          normal(null, '쾅시폭포로 이동하여 아름다운 폭포 관광 및 삼림욕'),
          normal(null, '푸씨산에 올라가 1,000년의 역사도시 루앙프라방 시내조망'),
          normal(null, '석식 후 수공예품 전시장 몽족 야시장 관광'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '반사나(Vansana LPQ) 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 3, regions: ['루앙프라방', '방비엥'],
        meals: meal(true, true, true, '호텔식', '한식', '삼겹살'),
        schedule: [
          normal(null, '조기기상 후 루앙프라방의 승려들을 볼 수 있는 탁밧행렬 참석'),
          normal(null, '루앙프라방 아침시장 관광 후 호텔 조식'),
          normal(null, '마지막 왕조의 생활상을 볼 수 있는 왕궁 박물관 관광'),
          train('14:02', '루앙프라방 기차역에서 방비엥으로 출발', 'C91'),
          normal('14:59', '방비엥 도착'),
          normal(null, '에메랄드빛 천연풀장 블루라군 체험'),
          normal(null, '전신마사지 1시간 체험', '팁별도/아동제외'),
          normal(null, '석식 후 여행자 거리 자유시간 후 호텔투숙 및 휴식'),
        ],
        hotel: { name: '그랜드 리버사이드(Grand riverside) 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 4, regions: ['방비엥', '비엔티엔'],
        meals: meal(true, true, true, '호텔식', '비빔밥', '그린페퍼 레스토랑'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '종유석 자연 수중동굴 튜브타고 동굴탐험 탐논동굴'),
          normal(null, '코끼리 닮은 바위가 있는 탐쌍(코끼리)동굴 체험'),
          normal(null, '쏭강을 내려오며 방비엥의 산수를 감상할 수 있는 카약트래킹 체험', '반바지 또는 수영복과 스포츠 샌들 지참'),
          normal(null, '중식 후 비엔티엔으로 이동(약 1시간 20분 소요)'),
          normal(null, '비엔티엔 도착 후 시내관광'),
          normal(null, '라오스 국가의 상징이며 부처님 사리가 있는 탓루앙 사원'),
          normal(null, '수직 활주로, 승리의 문이라고 불리우는 독립기념문 빠뚜사이'),
          normal(null, '석식 후 메콩강 짜오아누봉 공원 및 야시장 관람'),
          normal(null, '비엔티엔 공항으로 이동'),
        ],
        hotel: null,
      },
      dayLast_3n5d(),
    ],
    optional_tours: OPTIONAL_TOURS_SILSOK_5D,
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  2. 비루방 노팁/풀옵션 - [BX] 비엔티엔/루앙프라방/방비엥 3박5일 (목요일)
// ══════════════════════════════════════════════════════════════════════════════
const PKG2 = {
  ...COMMON,
  title: '[BX] 비엔티엔/루앙프라방/방비엥 노팁풀옵션 3박5일 (투어폰)',
  destination: '비엔티엔/루앙프라방/방비엥',
  product_type: '노팁풀옵션',
  trip_style: '3박5일',
  duration: 5, nights: 3,
  departure_days: '매주 목요일',
  price: 1069000,
  guide_tip: '포함',
  single_supplement: '12만원',
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  optional_tours: OPTIONAL_TOURS_NOPUL_5D,
  price_tiers: [
    { period_label: '4/1~4/30 목요일[비루방]', date_range: { start: '2026-04-02', end: '2026-04-30' }, departure_day_of_week: '목', adult_price: 1119000, status: 'available' },
    { period_label: '5/1~6/25 목요일[비루방]', date_range: { start: '2026-05-07', end: '2026-06-25' }, departure_day_of_week: '목', adult_price: 1069000, status: 'available' },
    { period_label: '★특정일★ 4/30, 5/21', departure_dates: ['2026-04-30', '2026-05-21'], adult_price: 1319000, status: 'available', note: '특정일 특별요금' },
  ],
  inclusions: [
    '왕복 항공료 및 텍스, 유류할증료(발권일기준)',
    '기사/가이드경비 $50/인',
    '호텔, 차량, 가이드, 관광지입장료, 식사, 여행자보험',
    '★롱테일보트+짚라인+전신맛사지 2시간+버기카',
    '특전 – 특식 1회, 과일도시락 룸당 1개, 아마존커피 1인 1잔, 방비엥뷰 바(비어라오 or 음료 1잔 제공)',
  ],
  excludes: [
    '매너팁 및 개인경비',
    '선택관광비용',
    '유류변동분',
    '싱글발생 시, 싱글차지 12만원',
  ],
  notices_parsed: [
    '라오스 전자담배 반입, 소지 및 사용 금지국가 – 적발시 최소 $50 이상벌금 부과됨',
    '사원 방문 시, 민소매 상의, 짧은 하의 착용 불가 – 무릎 아래 길이의 하의 착용하셔야 합니다',
    '행사 비합류시 1일당 1인 $100 패널티 적용',
    '외국국적자(여권확인) 1인 $50 패널티 적용',
    '라오스 특성상 방비엥 – 쏭태우, 루앙프라방 – 15인승 벤으로 이동합니다',
    '4월 27일(월)까지 선발권조건 상품',
  ],
  special_notes: '쇼핑: 침향, 라텍스, 잡화 3회\n싱글차지 12만원\n2인 1실 기준\n성인 4명 이상 출발 가능\n노팁풀옵션: 롱테일보트+짚라인+마사지2시간+버기카 포함\n4월 27일(월)까지 선발권조건 상품',
  product_highlights: [
    '노팁풀옵션 – 기사/가이드경비 포함',
    '롱테일보트+짚라인+전신마사지2시간+버기카 전부 포함',
    '비엔티엔/루앙프라방/방비엥 라오스 완전일주',
    '고속열차 C92/C91 탑승',
    '쾅시폭포, 왓마이사원, 왓씨엥통, 푸씨산',
    '특전: 특식1회, 과일도시락, 아마존커피, 방비엥뷰바',
  ],
  product_summary: '에어부산 직항 비엔티엔/루앙프라방/방비엥 노팁풀옵션 3박5일. 롱테일보트+짚라인+마사지2시간+버기카 전부 포함. 가이드경비 포함. 고속열차로 루앙프라방 이동, 쾅시폭포+왓씨엥통+푸씨산.',
  product_tags: ['라오스', '루앙프라방', '방비엥', '비엔티엔', '노팁풀옵션', '고속열차', '쾅시폭포', '에어부산', '투어폰'],
  accommodations: ['아론 호텔 또는 동급 (4성급)', '반사나(Vansana LPQ) 또는 동급 (4성급)', '그랜드 리버사이드(Grand riverside) 또는 동급 (4성급)'],
  itinerary: [
    'DAY1: 부산→비엔티엔 | BX745 21:25-00:15 | 호텔체크인(과일도시락) | 아론호텔(4성)',
    'DAY2: 비엔티엔→루앙프라방(C92 09:50-11:42) | 왓마이사원, 왓씨엥통, 쾅시폭포, 푸씨산, 몽족야시장 | 반사나(4성)',
    'DAY3: 루앙프라방→방비엥(C91 14:02-14:59) | 탁밧행렬, 아침시장, 왕궁박물관 | 블루라군, 짚라인+버기카, 롱테일보트 | 그랜드리버사이드(4성)',
    'DAY4: 방비엥→비엔티엔(전용차량) | 탐논동굴, 탐쌍동굴, 카약트래킹 | 탓루앙사원, 빠뚜사이 | 마사지2h | 메콩강야시장',
    'DAY5: BX746 01:15-07:55 부산도착',
  ],
  itinerary_data: {
    meta: {
      title: '[BX] 비엔티엔/루앙프라방/방비엥 노팁풀옵션 3박5일 (투어폰)',
      product_type: '노팁풀옵션', destination: '비엔티엔/루앙프라방/방비엥',
      nights: 3, days: 5, departure_airport: '부산(김해)',
      airline: 'BX(에어부산)', flight_out: 'BX745', flight_in: 'BX746',
      departure_days: '매주 목요일', min_participants: 4,
      room_type: '2인 1실', ticketing_deadline: null,
      hashtags: ['#노팁풀옵션', '#루앙프라방', '#방비엥', '#쾅시폭포', '#고속열차', '#짚라인'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 항공료 및 텍스, 유류할증료(발권일기준)',
        '기사/가이드경비 $50/인',
        '호텔, 차량, 가이드, 관광지입장료, 식사, 여행자보험',
        '★롱테일보트+짚라인+전신맛사지 2시간+버기카',
        '특전 – 특식 1회, 과일도시락 룸당 1개, 아마존커피 1인 1잔, 방비엥뷰 바(비어라오 or 음료 1잔 제공)',
      ],
      excludes: [
        '매너팁 및 개인경비, 선택관광비용, 유류변동분',
        '싱글발생 시, 싱글차지 12만원',
      ],
      shopping: '침향, 라텍스, 잡화 3회',
      remarks: [
        '라오스 전자담배 반입, 소지 및 사용 금지국가 – 적발시 최소 $50 이상벌금 부과됨',
        '사원 방문 시, 민소매 상의, 짧은 하의 착용 불가 – 무릎 아래 길이의 하의 착용하셔야 합니다',
        '행사 비합류시 1일당 1인 $100 패널티 적용 / 외국국적자(여권확인) 1인 $50 패널티 적용',
        '라오스 특성상 방비엥 – 쏭태우, 루앙프라방 – 15인승 벤으로 이동합니다',
      ],
    },
    days: [
      day1_arrival('아론 호텔 또는 동급', '4성급'),
      {
        day: 2, regions: ['비엔티엔', '루앙프라방'],
        meals: meal(true, true, true, '호텔식', '한식', '스테이크'),
        schedule: [
          normal(null, '호텔 조식 후 비엔티엔 기차역으로 이동'),
          train('09:50', '루앙프라방으로 출발', 'C92'),
          normal('11:42', '루앙프라방 도착'),
          normal(null, '부처님의 일생을 금색 벽화로 표현한 왓 마이 사원 관광'),
          normal(null, '"황금도시의 사원" 이란 뜻을 가진 왓 씨엥통'),
          normal(null, '쾅시폭포로 이동하여 아름다운 폭포 관광 및 삼림욕'),
          normal(null, '푸씨산에 올라가 1,000년의 역사도시 루앙프라방 시내조망'),
          normal(null, '석식 후 수공예품 전시장 몽족 야시장 관광'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '반사나(Vansana LPQ) 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 3, regions: ['루앙프라방', '방비엥'],
        meals: meal(true, true, true, '호텔식', '한식', '삼겹살'),
        schedule: [
          normal(null, '조기기상 후 루앙프라방의 승려들을 볼 수 있는 탁밧행렬 참석'),
          normal(null, '루앙프라방 아침시장 관광 후 호텔 조식'),
          normal(null, '마지막 왕조의 생활상을 볼 수 있는 왕궁 박물관 관광'),
          train('14:02', '루앙프라방 기차역에서 방비엥으로 출발', 'C91'),
          normal('14:59', '방비엥 도착'),
          normal(null, '에메랄드빛 천연풀장 블루라군 체험'),
          normal(null, '열대우림에서 다이나믹한 짚라인 체험 + 버기카 체험'),
          normal(null, '쏭강 노을 감상 및 롱테일보트 체험'),
          normal(null, '석식 후 여행자 거리 자유시간 후 호텔투숙 및 휴식'),
        ],
        hotel: { name: '그랜드 리버사이드(Grand riverside) 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 4, regions: ['방비엥', '비엔티엔'],
        meals: meal(true, true, true, '호텔식', '비빔밥', '그린페퍼 레스토랑'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '종유석 자연 수중동굴 튜브타고 동굴탐험 탐논동굴'),
          normal(null, '코끼리 닮은 바위가 있는 탐쌍(코끼리)동굴 체험'),
          normal(null, '쏭강을 내려오며 방비엥의 산수를 감상할 수 있는 카약트래킹 체험', '반바지 또는 수영복과 스포츠 샌들 지참'),
          normal(null, '중식 후 비엔티엔으로 이동(약 1시간 20분 소요)'),
          normal(null, '비엔티엔 도착 후 시내관광'),
          normal(null, '라오스 국가의 상징이며 부처님 사리가 있는 탓루앙 사원'),
          normal(null, '수직 활주로, 승리의 문이라고 불리우는 독립기념문 빠뚜사이'),
          normal(null, '석식 후 메콩강 야시장 관람'),
          normal(null, '전신마사지 2시간 체험', '팁별도/아동제외'),
          normal(null, '비엔티엔 공항으로 이동'),
        ],
        hotel: null,
      },
      dayLast_3n5d(),
    ],
    optional_tours: OPTIONAL_TOURS_NOPUL_5D,
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  3. 비루방방 실속 - [BX] 비엔티엔/루앙프라방/방비엥 4박6일 (일요일)
// ══════════════════════════════════════════════════════════════════════════════
const PKG3 = {
  ...COMMON,
  title: '[BX] 비엔티엔/루앙프라방/방비엥 실속 4박6일 (투어폰)',
  destination: '비엔티엔/루앙프라방/방비엥',
  product_type: '실속',
  trip_style: '4박6일',
  duration: 6, nights: 4,
  departure_days: '매주 일요일',
  price: 749000,
  guide_tip: '$60/인',
  single_supplement: '15만원',
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  optional_tours: OPTIONAL_TOURS_SILSOK_6D,
  price_tiers: [
    { period_label: '4/1~4/30 일요일[비루방방]', date_range: { start: '2026-04-05', end: '2026-04-26' }, departure_day_of_week: '일', adult_price: 799000, status: 'available' },
    { period_label: '5/1~6/25 일요일[비루방방]', date_range: { start: '2026-05-03', end: '2026-06-21' }, departure_day_of_week: '일', adult_price: 749000, status: 'available' },
    { period_label: '★특정일★ 4/30, 5/21', departure_dates: ['2026-04-30', '2026-05-21'], adult_price: 1099000, status: 'available', note: '특정일 특별요금' },
  ],
  inclusions: [
    '왕복 항공료 및 텍스, 유류할증료(발권일기준)',
    '호텔, 차량, 가이드, 관광지입장료, 식사, 여행자보험',
    '특전 – 특식 1회, 과일도시락 룸당 1개, 아마존커피 1인 1잔, 방비엥뷰 바(비어라오 or 음료 1잔 제공)',
  ],
  excludes: [
    '기사/가이드경비 $60/인',
    '매너팁 및 개인경비',
    '선택관광비용',
    '유류변동분',
    '싱글발생 시, 싱글차지 15만원',
  ],
  notices_parsed: [
    '라오스 전자담배 반입, 소지 및 사용 금지국가 – 적발시 최소 $50 이상벌금 부과됨',
    '사원 방문 시, 민소매 상의, 짧은 하의 착용 불가 – 무릎 아래 길이의 하의 착용하셔야 합니다',
    '행사 비합류시 1일당 1인 $100 패널티 적용',
    '외국국적자(여권확인) 1인 $50 패널티 적용',
    '라오스 특성상 방비엥 – 쏭태우, 루앙프라방 – 15인승 벤으로 이동합니다',
    '4월 27일(월)까지 선발권조건 상품',
  ],
  special_notes: '쇼핑: 침향, 라텍스, 잡화 3회\n싱글차지 15만원\n2인 1실 기준\n성인 4명 이상 출발 가능\n4월 27일(월)까지 선발권조건 상품',
  product_highlights: [
    '4박6일 여유로운 일정 (일요일 출발)',
    '비엔티엔/루앙프라방/방비엥 라오스 완전일주',
    '방비엥 2박 여유관광',
    '쾅시폭포, 왓마이, 왓씨엥통, 푸씨산, 왕궁박물관',
    '블루라군+탐논동굴+탐쌍동굴+카약트래킹',
    '왓호파깨우+왓씨싸켓+탓루앙+빠뚜사이',
  ],
  product_summary: '에어부산 직항 비엔티엔/루앙프라방/방비엥 실속 4박6일. 일요일 출발 여유로운 일정, 방비엥 2박. 루앙프라방 세계문화유산+방비엥 액티비티+비엔티엔 시내관광. 특식1회+과일도시락 특전.',
  product_tags: ['라오스', '루앙프라방', '방비엥', '비엔티엔', '4박6일', '실속', '에어부산', '투어폰'],
  accommodations: ['아론 호텔 또는 동급 (4성급)', '반사나(Vansana LPQ) 또는 동급 (4성급)', '그랜드 리버사이드(Grand riverside) 또는 동급 (4성급)'],
  itinerary: [
    'DAY1: 부산→비엔티엔 | BX745 21:25-00:15 | 호텔체크인(과일도시락) | 아론호텔(4성)',
    'DAY2: 비엔티엔→루앙프라방(C92 09:50-11:42) | 왓마이, 왓씨엥통, 쾅시폭포, 푸씨산, 몽족야시장 | 반사나(4성)',
    'DAY3: 루앙프라방→방비엥(C91 14:02-14:59) | 탁밧행렬, 아침시장, 왕궁박물관 | 마사지1h | 그랜드리버사이드(4성)',
    'DAY4: 방비엥 전일 | 탐논동굴, 탐쌍동굴, 카약트래킹, 블루라군 | 그랜드리버사이드(4성)',
    'DAY5: 방비엥→비엔티엔 | 왓호파깨우, 왓씨싸켓, 탓루앙, 빠뚜사이, 메콩강야시장',
    'DAY6: BX746 01:15-07:55 부산도착',
  ],
  itinerary_data: {
    meta: {
      title: '[BX] 비엔티엔/루앙프라방/방비엥 실속 4박6일 (투어폰)',
      product_type: '실속', destination: '비엔티엔/루앙프라방/방비엥',
      nights: 4, days: 6, departure_airport: '부산(김해)',
      airline: 'BX(에어부산)', flight_out: 'BX745', flight_in: 'BX746',
      departure_days: '매주 일요일', min_participants: 4,
      room_type: '2인 1실', ticketing_deadline: null,
      hashtags: ['#4박6일', '#루앙프라방', '#방비엥', '#쾅시폭포', '#블루라군', '#탁밧'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 항공료 및 텍스, 유류할증료(발권일기준)',
        '호텔, 차량, 가이드, 관광지입장료, 식사, 여행자보험',
        '특전 – 특식 1회, 과일도시락 룸당 1개, 아마존커피 1인 1잔, 방비엥뷰 바(비어라오 or 음료 1잔 제공)',
      ],
      excludes: [
        '기사/가이드경비 $60/인',
        '매너팁 및 개인경비, 선택관광비용, 유류변동분',
        '싱글발생 시, 싱글차지 15만원',
      ],
      shopping: '침향, 라텍스, 잡화 3회',
      remarks: [
        '라오스 전자담배 반입, 소지 및 사용 금지국가 – 적발시 최소 $50 이상벌금 부과됨',
        '사원 방문 시, 민소매 상의, 짧은 하의 착용 불가 – 무릎 아래 길이의 하의 착용하셔야 합니다',
        '행사 비합류시 1일당 1인 $100 패널티 적용 / 외국국적자(여권확인) 1인 $50 패널티 적용',
        '라오스 특성상 방비엥 – 쏭태우, 루앙프라방 – 15인승 벤으로 이동합니다',
      ],
    },
    days: [
      day1_arrival('아론 호텔 또는 동급', '4성급'),
      {
        day: 2, regions: ['비엔티엔', '루앙프라방'],
        meals: meal(true, true, true, '호텔식', '한식', '스테이크'),
        schedule: [
          normal(null, '호텔 조식 후 비엔티엔 기차역으로 이동'),
          train('09:50', '루앙프라방으로 출발', 'C92'),
          normal('11:42', '루앙프라방 도착'),
          normal(null, '부처님의 일생을 금색 벽화로 표현한 왓 마이 사원 관광'),
          normal(null, '"황금도시의 사원" 이란 뜻을 가진 왓 씨엥통'),
          normal(null, '쾅시폭포로 이동하여 아름다운 폭포 관광 및 삼림욕'),
          normal(null, '푸씨산에 올라가 1,000년의 역사도시 루앙프라방 시내조망'),
          normal(null, '석식 후 수공예품 전시장 몽족 야시장 관광'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '반사나(Vansana LPQ) 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 3, regions: ['루앙프라방', '방비엥'],
        meals: meal(true, true, true, '호텔식', '한식', '삼겹살'),
        schedule: [
          normal(null, '조기기상 후 루앙프라방의 승려들을 볼 수 있는 탁밧행렬 참석'),
          normal(null, '루앙프라방 아침시장 관광 후 호텔 조식'),
          normal(null, '마지막 왕조의 생활상을 볼 수 있는 왕궁 박물관 관광'),
          train('14:02', '루앙프라방 기차역에서 방비엥으로 출발', 'C91'),
          normal('14:59', '방비엥 도착'),
          normal(null, '전신마사지 1시간 체험', '팁별도/아동제외'),
          normal(null, '석식 후 여행자 거리 자유시간'),
          normal(null, '호텔투숙 및 휴식'),
        ],
        hotel: { name: '그랜드 리버사이드(Grand riverside) 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 4, regions: ['방비엥'],
        meals: meal(true, true, true, '호텔식', '비빔밥', '바베큐 또는 오리불고기'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '종유석 자연 수중동굴 튜브타고 동굴탐험 탐논동굴'),
          normal(null, '코끼리 닮은 바위가 있는 탐쌍(코끼리)동굴 체험'),
          normal(null, '쏭강을 내려오며 방비엥의 산수를 감상할 수 있는 카약트래킹 체험', '반바지 또는 수영복과 스포츠 샌들 지참'),
          normal(null, '에메랄드빛 천연풀장 블루라군 체험'),
          normal(null, '석식 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '그랜드 리버사이드(Grand riverside) 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 5, regions: ['방비엥', '비엔티엔'],
        meals: meal(true, true, true, '호텔식', '한식', '그린페퍼 레스토랑'),
        schedule: [
          normal(null, '호텔 조식 후 비엔티엔으로 이동'),
          normal(null, '비엔티엔 도착 후 시내관광'),
          normal(null, '에메랄드 붓다를 모시기 위해 세워진 왕실사원 왓 호파깨우'),
          normal(null, '초기 크메르 왕국의 불상 및 6840개의 부처를 볼 수 있는 왓 씨싸켓'),
          normal(null, '라오스 국가의 상징이며 부처님 사리가 있는 탓루앙 사원'),
          normal(null, '수직 활주로, 승리의 문이라고 불리우는 독립기념문 빠뚜사이'),
          normal(null, '석식 후 메콩강 짜오아누봉 공원 및 야시장 관람'),
          normal(null, '비엔티엔 공항으로 이동'),
        ],
        hotel: null,
      },
      dayLast_4n6d(),
    ],
    optional_tours: OPTIONAL_TOURS_SILSOK_6D,
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  4. 비루방방 노팁/풀옵션 - [BX] 비엔티엔/루앙프라방/방비엥 4박6일 (일요일)
// ══════════════════════════════════════════════════════════════════════════════
const PKG4 = {
  ...COMMON,
  title: '[BX] 비엔티엔/루앙프라방/방비엥 노팁풀옵션 4박6일 (투어폰)',
  destination: '비엔티엔/루앙프라방/방비엥',
  product_type: '노팁풀옵션',
  trip_style: '4박6일',
  duration: 6, nights: 4,
  departure_days: '매주 일요일',
  price: 989000,
  guide_tip: '포함',
  single_supplement: '15만원',
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  optional_tours: OPTIONAL_TOURS_NOPUL_6D,
  price_tiers: [
    { period_label: '4/1~4/30 일요일[비루방방]', date_range: { start: '2026-04-05', end: '2026-04-26' }, departure_day_of_week: '일', adult_price: 1039000, status: 'available' },
    { period_label: '5/1~6/25 일요일[비루방방]', date_range: { start: '2026-05-03', end: '2026-06-21' }, departure_day_of_week: '일', adult_price: 989000, status: 'available' },
    { period_label: '★특정일★ 4/30, 5/21', departure_dates: ['2026-04-30', '2026-05-21'], adult_price: 1319000, status: 'available', note: '특정일 특별요금' },
  ],
  inclusions: [
    '왕복 항공료 및 텍스, 유류할증료(발권일기준)',
    '기사/가이드경비 $60/인',
    '호텔, 차량, 가이드, 관광지입장료, 식사, 여행자보험',
    '★롱테일보트+짚라인+전신맛사지2시간+버기카',
    '특전 – 특식 1회, 과일도시락 룸당 1개, 아마존커피 1인 1잔, 방비엥뷰 바(비어라오 or 음료 1잔 제공)',
  ],
  excludes: [
    '매너팁 및 개인경비',
    '선택관광비용',
    '유류변동분',
    '싱글발생 시, 싱글차지 15만원',
  ],
  notices_parsed: [
    '라오스 전자담배 반입, 소지 및 사용 금지국가 – 적발시 최소 $50 이상벌금 부과됨',
    '사원 방문 시, 민소매 상의, 짧은 하의 착용 불가 – 무릎 아래 길이의 하의 착용하셔야 합니다',
    '행사 비합류시 1일당 1인 $100 패널티 적용',
    '외국국적자(여권확인) 1인 $50 패널티 적용',
    '라오스 특성상 방비엥 – 쏭태우, 루앙프라방 – 15인승 벤으로 이동합니다',
    '4월 27일(월)까지 선발권조건 상품',
  ],
  special_notes: '쇼핑: 침향, 라텍스, 잡화 3회\n싱글차지 15만원\n2인 1실 기준\n성인 4명 이상 출발 가능\n노팁풀옵션: 롱테일보트+짚라인+마사지2시간+버기카 포함\n4월 27일(월)까지 선발권조건 상품',
  product_highlights: [
    '노팁풀옵션 – 기사/가이드경비 포함',
    '롱테일보트+짚라인+전신마사지2시간+버기카 전부 포함',
    '4박6일 여유로운 일정 (일요일 출발)',
    '방비엥 2박 여유관광',
    '왓호파깨우+왓씨싸켓+탓루앙+빠뚜사이',
    '쾅시폭포+왓마이+왓씨엥통+푸씨산',
  ],
  product_summary: '에어부산 직항 비엔티엔/루앙프라방/방비엥 노팁풀옵션 4박6일. 롱테일보트+짚라인+마사지2시간+버기카 전부 포함. 가이드경비 포함. 일요일 출발 여유로운 일정, 방비엥 2박.',
  product_tags: ['라오스', '루앙프라방', '방비엥', '비엔티엔', '노팁풀옵션', '4박6일', '에어부산', '투어폰'],
  accommodations: ['아론 호텔 또는 동급 (4성급)', '반사나(Vansana LPQ) 또는 동급 (4성급)', '그랜드 리버사이드(Grand riverside) 또는 동급 (4성급)'],
  itinerary: [
    'DAY1: 부산→비엔티엔 | BX745 21:25-00:15 | 호텔체크인(과일도시락) | 아론호텔(4성)',
    'DAY2: 비엔티엔→루앙프라방(C92 09:50-11:42) | 왓마이, 왓씨엥통, 쾅시폭포, 푸씨산, 몽족야시장 | 반사나(4성)',
    'DAY3: 루앙프라방→방비엥(C91 14:02-14:59) | 탁밧행렬, 아침시장, 왕궁박물관 | 롱테일보트 | 그랜드리버사이드(4성)',
    'DAY4: 방비엥 전일 | 탐논동굴, 탐쌍동굴, 카약트래킹, 블루라군, 짚라인+버기카 | 그랜드리버사이드(4성)',
    'DAY5: 방비엥→비엔티엔 | 왓호파깨우, 왓씨싸켓, 탓루앙, 빠뚜사이 | 마사지2h | 메콩강야시장',
    'DAY6: BX746 01:15-07:55 부산도착',
  ],
  itinerary_data: {
    meta: {
      title: '[BX] 비엔티엔/루앙프라방/방비엥 노팁풀옵션 4박6일 (투어폰)',
      product_type: '노팁풀옵션', destination: '비엔티엔/루앙프라방/방비엥',
      nights: 4, days: 6, departure_airport: '부산(김해)',
      airline: 'BX(에어부산)', flight_out: 'BX745', flight_in: 'BX746',
      departure_days: '매주 일요일', min_participants: 4,
      room_type: '2인 1실', ticketing_deadline: null,
      hashtags: ['#노팁풀옵션', '#4박6일', '#루앙프라방', '#방비엥', '#쾅시폭포', '#짚라인'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 항공료 및 텍스, 유류할증료(발권일기준)',
        '기사/가이드경비 $60/인',
        '호텔, 차량, 가이드, 관광지입장료, 식사, 여행자보험',
        '★롱테일보트+짚라인+전신맛사지2시간+버기카',
        '특전 – 특식 1회, 과일도시락 룸당 1개, 아마존커피 1인 1잔, 방비엥뷰 바(비어라오 or 음료 1잔 제공)',
      ],
      excludes: [
        '매너팁 및 개인경비, 선택관광비용, 유류변동분',
        '싱글발생 시, 싱글차지 15만원',
      ],
      shopping: '침향, 라텍스, 잡화 3회',
      remarks: [
        '라오스 전자담배 반입, 소지 및 사용 금지국가 – 적발시 최소 $50 이상벌금 부과됨',
        '사원 방문 시, 민소매 상의, 짧은 하의 착용 불가 – 무릎 아래 길이의 하의 착용하셔야 합니다',
        '행사 비합류시 1일당 1인 $100 패널티 적용 / 외국국적자(여권확인) 1인 $50 패널티 적용',
        '라오스 특성상 방비엥 – 쏭태우, 루앙프라방 – 15인승 벤으로 이동합니다',
      ],
    },
    days: [
      day1_arrival('아론 호텔 또는 동급', '4성급'),
      {
        day: 2, regions: ['비엔티엔', '루앙프라방'],
        meals: meal(true, true, true, '호텔식', '한식', '스테이크'),
        schedule: [
          normal(null, '호텔 조식 후 비엔티엔 기차역으로 이동'),
          train('09:50', '루앙프라방으로 출발', 'C92'),
          normal('11:42', '루앙프라방 도착'),
          normal(null, '부처님의 일생을 금색 벽화로 표현한 왓 마이 사원 관광'),
          normal(null, '"황금도시의 사원" 이란 뜻을 가진 왓 씨엥통'),
          normal(null, '쾅시폭포로 이동하여 아름다운 폭포 관광 및 삼림욕'),
          normal(null, '푸씨산에 올라가 1,000년의 역사도시 루앙프라방 시내조망'),
          normal(null, '석식 후 수공예품 전시장 몽족 야시장 관광'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '반사나(Vansana LPQ) 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 3, regions: ['루앙프라방', '방비엥'],
        meals: meal(true, true, true, '호텔식', '한식', '삼겹살'),
        schedule: [
          normal(null, '조기기상 후 루앙프라방의 승려들을 볼 수 있는 탁밧행렬 참석'),
          normal(null, '루앙프라방 아침시장 관광 후 호텔 조식'),
          normal(null, '마지막 왕조의 생활상을 볼 수 있는 왕궁 박물관 관광'),
          train('14:02', '루앙프라방 기차역에서 방비엥으로 출발', 'C91'),
          normal('14:59', '방비엥 도착'),
          normal(null, '쏭강 노을 감상 및 롱테일보트 체험'),
          normal(null, '석식 후 여행자 거리 자유시간'),
          normal(null, '호텔투숙 및 휴식'),
        ],
        hotel: { name: '그랜드 리버사이드(Grand riverside) 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 4, regions: ['방비엥'],
        meals: meal(true, true, true, '호텔식', '비빔밥', '바베큐 또는 오리불고기'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '종유석 자연 수중동굴 튜브타고 동굴탐험 탐논동굴'),
          normal(null, '코끼리 닮은 바위가 있는 탐쌍(코끼리)동굴 체험'),
          normal(null, '쏭강을 내려오며 방비엥의 산수를 감상할 수 있는 카약트래킹 체험', '반바지 또는 수영복과 스포츠 샌들 지참'),
          normal(null, '에메랄드빛 천연풀장 블루라군 체험'),
          normal(null, '열대우림에서 다이나믹한 짚라인 체험 + 버기카 체험'),
          normal(null, '석식 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '그랜드 리버사이드(Grand riverside) 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 5, regions: ['방비엥', '비엔티엔'],
        meals: meal(true, true, true, '호텔식', '한식', '그린페퍼 레스토랑'),
        schedule: [
          normal(null, '호텔 조식 후 비엔티엔으로 이동'),
          normal(null, '비엔티엔 도착 후 시내관광'),
          normal(null, '에메랄드 붓다를 모시기 위해 세워진 왕실사원 왓 호파깨우'),
          normal(null, '초기 크메르 왕국의 불상 및 6840개의 부처를 볼 수 있는 왓 씨싸켓'),
          normal(null, '라오스 국가의 상징이며 부처님 사리가 있는 탓루앙 사원'),
          normal(null, '수직 활주로, 승리의 문이라고 불리우는 독립기념문 빠뚜사이'),
          normal(null, '석식 후 메콩강 야시장 관람'),
          normal(null, '전신마사지 2시간 체험', '팁별도/아동제외'),
          normal(null, '비엔티엔 공항으로 이동'),
        ],
        hotel: null,
      },
      dayLast_4n6d(),
    ],
    optional_tours: OPTIONAL_TOURS_NOPUL_6D,
  },
};

// ── 일괄 등록 ──
const ALL_PACKAGES = [PKG1, PKG2, PKG3, PKG4];

async function main() {
  console.log(`📦 라오스 투어폰 비루방/비루방방 패키지 ${ALL_PACKAGES.length}개 일괄 등록 시작...\n`);

  const rows = ALL_PACKAGES.map(pkg => ({
    title: pkg.title, destination: pkg.destination, country: pkg.country,
    category: pkg.category, product_type: pkg.product_type, trip_style: pkg.trip_style,
    duration: pkg.duration, nights: pkg.nights, departure_airport: pkg.departure_airport,
    airline: pkg.airline, min_participants: pkg.min_participants, status: pkg.status,
    price: pkg.price, guide_tip: pkg.guide_tip, single_supplement: pkg.single_supplement,
    small_group_surcharge: pkg.small_group_surcharge, surcharges: pkg.surcharges,
    excluded_dates: pkg.excluded_dates, optional_tours: pkg.optional_tours,
    price_tiers: pkg.price_tiers, inclusions: pkg.inclusions, excludes: pkg.excludes,
    notices_parsed: pkg.notices_parsed, special_notes: pkg.special_notes,
    product_highlights: pkg.product_highlights, product_summary: pkg.product_summary,
    product_tags: pkg.product_tags, itinerary_data: pkg.itinerary_data,
    itinerary: pkg.itinerary, accommodations: pkg.accommodations,
    raw_text: pkg.raw_text || '', filename: pkg.filename,
    file_type: pkg.file_type, confidence: pkg.confidence,
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
