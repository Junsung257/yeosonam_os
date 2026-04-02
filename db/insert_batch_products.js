/**
 * 상품 19개 일괄 INSERT
 * 시즈오카 골프, 장가계, 코타키나발루, 북큐슈, 토야마, 보홀, 나트랑
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
function golf(time, activity) { return { time, activity, type: 'golf', transport: null, note: null, badge: null }; }
function shopping(time, activity) { return { time, activity, type: 'shopping', transport: null, note: null, badge: null }; }

const PRODUCTS = [];

// ═══════════════════════════════════════════
// 4. 유가시마CC 골프 2박3일 / 3박4일
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: '온천과 골프가 만나는 곳, 유가시마CC 2박3일',
  destination: '시즈오카/이즈', category: '골프', product_type: '전세기|골프텔', trip_style: '골프',
  departure_airport: '김해공항', airline: 'BX', min_participants: 4, status: 'approved', country: '일본', duration: 3, nights: 2,
  price: 1299000,
  product_summary: '이즈 유가시마CC 온천 골프텔 36홀. 카이세키 석식, 온천 대욕장 포함. 2인 출발 가능.',
  price_tiers: [
    { period_label: '월/수 2박3일', adult_price: 1299000, status: 'available', note: '4인 기준' },
    { period_label: '금 3박4일', adult_price: 1799000, status: 'available', note: '4인 기준' },
  ],
  inclusions: ['왕복 항공료+유류+TAX','골프 수하물 23KG','여행자보험','일정상 그린피+카트비','송영차량(일본인)','호텔 2인1실','호텔조식','석식','3박4일 외부라운딩(헤이츠CC+중식1,400엔)'],
  excludes: ['클럽중식','기타개인비용'],
  product_highlights: ['유가시마CC 온천 골프텔','카이세키/샤브샤브 석식','대욕장 온천','2인 출발 가능'],
  special_notes: '2인~3인 출발시 1인/15만원 추가. 싱글차지 주중 5만원/주말 8만원. 가라오케+노미호다이 3시간 1인/3만원UP(사전예약). 우천시 라운드 비용환불 불가.',
  notices_parsed: [
    { type: 'CRITICAL', title: '필수 확인 사항', text: '• 여권 만료일 6개월 이상\n• 전세기 상품 1인/30만원 예약금 필수\n• 연휴기간 별도문의(4/29, 5/1, 5/4, 5/6, 5/8)' },
    { type: 'PAYMENT', title: '추가 요금 및 할증', text: '• 2인~3인 출발시 1인/15만원 추가\n• 싱글차지 주중 5만원/주말 8만원\n• 2/3인 플레이시 주말 추가금 있음' },
    { type: 'POLICY', title: '현지 규정 및 안내', text: '• 우천시 라운드 비용환불 불가, 쇼핑몰 또는 간단한 관광으로 대체\n• 송영차량 일정표상 송영 외 개인용도 불가' },
    { type: 'INFO', title: '여행 정보', text: '• 가라오케+노미호다이 3시간 1인/3만원UP(사전예약 必)' },
  ],
  itinerary_data: {
    meta: { title: '유가시마CC 온천 골프 2박3일', destination: '시즈오카/이즈', nights: 2, days: 3, airline: 'BX', flight_out: 'BX1645', flight_in: 'BX1635', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복 항공료','그린피+카트비','송영차량','호텔 2인1실','호텔조식','석식'], excludes: ['클럽중식','기타개인비용'], remarks: [] },
    days: [
      { day: 1, regions: ['부산','이즈'], meals: { breakfast: false, lunch: false, dinner: true, dinner_note: '카이세키 OR 샤브샤브' },
        schedule: [flight('09:05','부산 김해공항 국제선 출발','BX1645'), normal('10:50','일본 시즈오카 국제공항 도착'), normal(null,'송영차량 미팅 후 골프장 이동(약1시간40분)'), golf(null,'유가시마CC 9홀 라운딩(NO캐디/일몰시까지)'), normal(null,'호텔 체크인 후 석식')],
        hotel: { name: '유가시마 온천호텔', grade: '4', note: '2인1실 · 대욕장 있음' } },
      { day: 2, regions: ['이즈'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: false, dinner: true, dinner_note: '카이세키 OR 샤브샤브' },
        schedule: [normal(null,'호텔 조식 후 골프장 이동'), golf(null,'유가시마CC 27홀 라운딩(NO캐디)'), normal(null,'라운딩 후 호텔 이동 및 휴식')],
        hotel: { name: '유가시마 온천호텔', grade: '4', note: '2인1실' } },
      { day: 3, regions: ['시즈오카','부산'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: false, dinner: false },
        schedule: [normal(null,'호텔 조식 후 공항 이동'), flight('11:50','시즈오카 국제공항 출발','BX1635'), normal('14:00','김해국제공항 도착')],
        hotel: null },
    ],
  },
});

// ═══════════════════════════════════════════
// 5. 후지산 다색 골프 2박3일/3박4일
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: '후지산 다색 골프 품격 2박3일/3박4일',
  destination: '시즈오카', category: '골프', product_type: '품격|다색골프', trip_style: '골프',
  departure_airport: '김해공항', airline: 'BX', min_participants: 4, status: 'approved', country: '일본', duration: 3, nights: 2,
  price: 1149000,
  product_summary: '후지산 다색 골프 랜덤배정(시마다GC/호론CC/리버후지CC/후지노미야CC/니시후지CC/후지치산CC). 온천 대욕장 호텔.',
  price_tiers: [
    { period_label: '3/30 (월)', departure_dates: ['2026-03-30'], adult_price: 1049000, status: 'available' },
    { period_label: '4/6,13,20 (일)', departure_dates: ['2026-04-06','2026-04-13','2026-04-20'], adult_price: 1199000, status: 'available' },
    { period_label: '4/27 (일)', departure_dates: ['2026-04-27'], adult_price: 1349000, status: 'available' },
    { period_label: '5/4 (일)', departure_dates: ['2026-05-04'], adult_price: 1449000, status: 'available' },
    { period_label: '5/11,18,25 (일)', departure_dates: ['2026-05-11','2026-05-18','2026-05-25'], adult_price: 1149000, status: 'available' },
    { period_label: '4/1,8 (수)', departure_dates: ['2026-04-01','2026-04-08'], adult_price: 1149000, status: 'available' },
    { period_label: '4/15,22 (수)', departure_dates: ['2026-04-15','2026-04-22'], adult_price: 1149000, status: 'available' },
    { period_label: '5/13,20,27 (수)', departure_dates: ['2026-05-13','2026-05-20','2026-05-27'], adult_price: 1149000, status: 'available' },
    { period_label: '4/3,10,17 (금) 3박4일', departure_dates: ['2026-04-03','2026-04-10','2026-04-17'], adult_price: 1799000, status: 'available' },
    { period_label: '5/15,22,29 (금) 3박4일', departure_dates: ['2026-05-15','2026-05-22','2026-05-29'], adult_price: 1799000, status: 'available' },
  ],
  inclusions: ['왕복 항공료+유류+TAX','골프 수하물 23KG','여행자보험','일정상 그린피+카트비','송영차량(일본인)','호텔 2인1실','호텔조식'],
  excludes: ['클럽중식','석식','기타개인비용'],
  product_highlights: ['후지산 다색 골프 랜덤배정','천연 온천 대욕장','NO캐디','2박3일/3박4일 선택'],
  special_notes: '[2박3일] 2인 출발 1인/22,000엔, 3인 출발 1인/7,000엔 추가. [3박4일] 2인 출발 1인/25,000엔, 3인 출발 1인/7,000엔 추가.',
  notices_parsed: [
    { type: 'CRITICAL', title: '필수 확인 사항', text: '• 여권 만료일 6개월 이상\n• 전세기 상품 1인/30만원 예약금 필수\n• NO캐디 상품, 골프장에서 본인 골프백 직접 승하차' },
    { type: 'PAYMENT', title: '추가 요금 및 할증', text: '• [2박3일] 2인 출발 1인/22,000엔, 3인 출발 1인/7,000엔 추가\n• [3박4일] 2인 출발 1인/25,000엔, 3인 출발 1인/7,000엔 추가' },
    { type: 'POLICY', title: '현지 규정 및 안내', text: '• 티업시간에따라 조식 불가할수있으며, 도시락으로 대체 될 수 있습니다\n• 송영차량 일정표상 송영 외 개인용도 불가' },
    { type: 'INFO', title: '여행 정보', text: '• 골프장 랜덤배정(시마다GC/호론CC/리버후지CC/후지노미야CC/니시후지CC/후지치산CC)' },
  ],
  itinerary_data: {
    meta: { title: '후지산 다색 골프', destination: '시즈오카', nights: 2, days: 3, airline: 'BX', flight_out: 'BX1645', flight_in: 'BX1635', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복 항공료','그린피+카트비','송영차량','호텔 2인1실','호텔조식'], excludes: ['클럽중식','석식','기타개인비용'], remarks: [] },
    days: [
      { day: 1, regions: ['부산','시즈오카'], meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [flight('09:05','부산 김해공항 국제선 출발','BX1645'), normal('10:50','일본 시즈오카 국제공항 도착'), normal(null,'송영차량 미팅 후 골프장 이동'), golf(null,'예정골프장 중 18홀 라운딩(NO캐디)-시마다OR호론CC'), normal(null,'호텔 체크인 후 휴식')],
        hotel: { name: '올레인 시즈오카', grade: '3', note: '또는 동급 2인1실 · 천연 온천 대욕장' } },
      { day: 2, regions: ['시즈오카'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: false, dinner: false },
        schedule: [normal(null,'호텔 조식 후 골프장 이동'), golf(null,'예정골프장 중 18홀 라운딩(NO캐디)'), normal(null,'라운딩 후 호텔 이동 및 휴식')],
        hotel: { name: '올레인 시즈오카', grade: '3', note: '또는 동급' } },
      { day: 3, regions: ['시즈오카','부산'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: false, dinner: false },
        schedule: [normal(null,'호텔 조식 후 공항 이동'), flight('11:50','시즈오카 국제공항 출발','BX1635'), normal('14:00','김해국제공항 도착')],
        hotel: null },
    ],
  },
});

// ═══════════════════════════════════════════
// 6. 후지노미야 다색 골프 실속 2박3일
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: '후지노미야 다색 골프 실속 2박3일/3박4일',
  destination: '후지노미야', category: '골프', product_type: '실속|다색골프', trip_style: '골프',
  departure_airport: '김해공항', airline: 'BX', min_participants: 4, status: 'approved', country: '일본', duration: 3, nights: 2,
  price: 899000,
  product_summary: '후지노미야 다색 골프 실속 랜덤배정 12개 골프장. 799,000원~.',
  price_tiers: [
    { period_label: '3/30 (월)', departure_dates: ['2026-03-30'], adult_price: 799000, status: 'available' },
    { period_label: '4/6,13,20 (일)', departure_dates: ['2026-04-06','2026-04-13','2026-04-20'], adult_price: 899000, status: 'available' },
    { period_label: '5/11,18,25 (일)', departure_dates: ['2026-05-11','2026-05-18','2026-05-25'], adult_price: 899000, status: 'available' },
    { period_label: '4/1,8 (수)', departure_dates: ['2026-04-01','2026-04-08'], adult_price: 899000, status: 'available' },
    { period_label: '4/3,10,17 (금) 3박4일', departure_dates: ['2026-04-03','2026-04-10','2026-04-17'], adult_price: 1499000, status: 'available' },
    { period_label: '5/15,22,29 (금) 3박4일', departure_dates: ['2026-05-15','2026-05-22','2026-05-29'], adult_price: 1499000, status: 'available' },
  ],
  inclusions: ['왕복 항공료+유류+TAX','골프 수하물 23KG','여행자보험','일정상 그린피+카트비','송영차량(일본인)','호텔 2인1실','호텔조식'],
  excludes: ['클럽중식','석식','기타개인비용'],
  product_highlights: ['후지노미야 실속 골프','12개 골프장 랜덤배정','799,000원~','대욕장 있음'],
  special_notes: '[2박3일] 2인 출발 1인/22,000엔 추가. [3박4일] 2인 출발 1인/25,000엔 추가.',
  notices_parsed: [
    { type: 'CRITICAL', title: '필수 확인 사항', text: '• 여권 만료일 6개월 이상\n• 전세기 상품 1인/30만원 예약금 필수' },
    { type: 'PAYMENT', title: '추가 요금 및 할증', text: '• [2박3일] 2인 출발 1인/22,000엔, 3인 출발 1인/7,000엔 추가\n• [3박4일] 2인 출발 1인/25,000엔, 3인 출발 1인/7,000엔 추가' },
    { type: 'INFO', title: '여행 정보', text: '• 골프장 12개 중 랜덤배정' },
  ],
  itinerary_data: {
    meta: { title: '후지노미야 다색 골프 실속', destination: '후지노미야', nights: 2, days: 3, airline: 'BX', flight_out: 'BX1645', flight_in: 'BX1635', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복 항공료','그린피+카트비','송영차량','호텔 2인1실','호텔조식'], excludes: ['클럽중식','석식'], remarks: [] },
    days: [
      { day: 1, regions: ['부산','후지노미야'], meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [flight('09:05','부산 김해공항 국제선 출발','BX1645'), normal('10:50','일본 시즈오카 국제공항 도착'), normal(null,'송영차량 미팅 후 골프장 이동'), golf(null,'예정골프장 중 18홀 라운딩(NO캐디)'), normal(null,'호텔 체크인 후 휴식')],
        hotel: { name: '구레타케 인 프리미엄 후지노미야', grade: '3', note: '또는 동급 2인1실 · 대욕장 있음' } },
      { day: 2, regions: ['후지노미야'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: false, dinner: false },
        schedule: [normal(null,'호텔 조식 후 골프장 이동'), golf(null,'예정골프장 중 18홀 라운딩(NO캐디)'), normal(null,'라운딩 후 호텔 이동 및 휴식')],
        hotel: { name: '구레타케 인 프리미엄 후지노미야', grade: '3', note: '또는 동급' } },
      { day: 3, regions: ['시즈오카','부산'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: false, dinner: false },
        schedule: [normal(null,'호텔 조식 후 공항 이동'), flight('11:50','시즈오카 국제공항 출발','BX1635'), normal('14:00','김해국제공항 도착')],
        hotel: null },
    ],
  },
});

// ═══════════════════════════════════════════
// 7. 코타키나발루 수트라하버 5일/6일
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: 'BX 코타키나발루 수트라하버 골드카드+노쇼핑 품격 3박5일',
  destination: '코타키나발루', category: '패키지', product_type: '품격|노쇼핑|골드카드', trip_style: '리조트',
  departure_airport: '김해공항', airline: 'BX', min_participants: 2, status: 'approved', country: '말레이시아', duration: 5, nights: 3,
  price: 1479000,
  product_summary: '코타키나발루 수트라하버 5성급 골드카드 노쇼핑 패키지. 아동 반값, 18시 레이트체크아웃, 나이트투어 포함.',
  price_tiers: [
    { period_label: '6/24~6/30 수 3박5일', adult_price: 1479000, status: 'available', note: '아동 730,000' },
    { period_label: '6/24~6/30 토 4박6일', adult_price: 1679000, status: 'available', note: '아동 830,000' },
    { period_label: '7/1~7/14 수,목 3박5일', adult_price: 1529000, status: 'available', note: '아동 760,000' },
    { period_label: '7/1~7/14 토,일 4박6일', adult_price: 1729000, status: 'available', note: '아동 860,000' },
    { period_label: '7/15~22,8/16~23 수,목 3박5일', adult_price: 1579000, status: 'available' },
    { period_label: '7/23~29 수,목 3박5일', adult_price: 1719000, status: 'available' },
    { period_label: '7/30~8/7 수,목 3박5일', adult_price: 1679000, status: 'available' },
  ],
  inclusions: ['항공료+TAX+유류할증료','여행자보험','호텔','차량','입장료','일정상 식사','가이드팁&기사팁','노쇼핑','관광세','골드카드','18시 레이트체크아웃','나이트투어(약식)'],
  excludes: ['개인경비','매너팁','싱글차지','써차지','의무디너'],
  product_highlights: ['수트라하버 5성급','골드카드 베네핏','노쇼핑','아동 반값','18시 레이트체크아웃'],
  special_notes: '써차지 7/20~8/22 $45 R/N. 의무석식 미정. 항공 4/29까지 발권조건.',
  notices_parsed: [
    { type: 'CRITICAL', title: '필수 확인 사항', text: '• 여권 만료일 6개월 이상\n• 말레이시아 디지털 입국 카드(MDAC) 작성 필수(대행불가)\n• 1인당 계약금 30만원 입금 확정' },
    { type: 'PAYMENT', title: '추가 요금 및 할증', text: '• 써차지 7/20~8/22 $45 룸/박당\n• 의무석식 미정\n• 성인 1인 투숙시 성인 2인 비용 지불' },
    { type: 'INFO', title: '여행 정보', text: '• 일정 동일한 경우 현지 합류 인원 추가 가능\n• 객실 호수 및 베드 타입 배정은 호텔 권한' },
  ],
  itinerary_data: {
    meta: { title: '코타키나발루 수트라하버 골드카드', destination: '코타키나발루', nights: 3, days: 5, airline: 'BX', flight_out: 'BX761', flight_in: 'BX762', departure_airport: '김해공항' },
    highlights: { inclusions: ['항공료','호텔','차량','식사','가이드팁','골드카드','나이트투어'], excludes: ['개인경비','매너팁','싱글차지','써차지'], remarks: [] },
    days: [
      { day: 1, regions: ['부산','코타키나발루'], meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [flight('19:25','부산 김해공항 국제선 출발','BX761'), normal('23:25','코타키나발루 공항 도착 후 가이드 미팅'), normal(null,'호텔로 이동하여 체크인 및 휴식')],
        hotel: { name: '수트라하버 퍼시픽', grade: '5', note: '디럭스룸 골프뷰 2인1실' } },
      { day: 2, regions: ['코타키나발루'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '선택식', dinner: true, dinner_note: '호텔식' },
        schedule: [normal(null,'호텔 조식 후'), normal(null,'내마음대로 택1) 전일 자유시간 OR 툰구 압둘라만 해양공원 마누칸섬 호핑투어'), normal(null,'호텔 귀환 후 자유시간 및 휴식')],
        hotel: { name: '수트라하버 퍼시픽', grade: '5', note: '디럭스룸 골프뷰 2인1실' } },
      { day: 3, regions: ['코타키나발루'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '호텔식', dinner: true, dinner_note: '호텔식' },
        schedule: [normal(null,'호텔 조식 후 전일정 자유 및 선택관광'), normal(null,'골드카드 2일차'), normal(null,'호텔 자유시간 또는 추천 선택관광')],
        hotel: { name: '수트라하버 퍼시픽', grade: '5', note: '디럭스룸 골프뷰 2인1실' } },
      { day: 4, regions: ['코타키나발루'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '호텔식', dinner: true, dinner_note: '한식' },
        schedule: [normal(null,'호텔 조식 후 오전 자유일정'), normal('18:00','레이트 체크아웃'), normal(null,'나이트투어 - 신수란 야시장 관광 및 코코넛 음료 시음'), normal(null,'공항으로 이동 / 출국 수속')],
        hotel: null },
      { day: 5, regions: ['코타키나발루','부산'], meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [flight('00:25','코타키나발루 국제공항 출발','BX762'), normal('06:30','부산 김해공항 도착')],
        hotel: null },
    ],
    optional_tours: [
      { name: '패러세일링', price_usd: 35 }, { name: '씨워킹', price_usd: 70 }, { name: '체험다이빙', price_usd: 80 },
      { name: '제트스키(1대당)', price_usd: 35 }, { name: '바나나보트', price_usd: 20 },
      { name: '까왕 반딧불이 투어', price_usd: 60 }, { name: '밤나들이투어', price_usd: 70 },
      { name: '마리마리 컬쳐빌리지', price_usd: 60 }, { name: '바다낚시 체험', price_usd: 80 },
      { name: '전신마사지 1시간', price_usd: 40 }, { name: '발마사지 1시간', price_usd: 30 },
    ],
  },
});

// ═══════════════════════════════════════════
// 8-14. 장가계 7종 (공통 데이터 + 개별 차이만)
// ═══════════════════════════════════════════
const JGJ_COMMON_NOTICES = [
  { type: 'CRITICAL', title: '필수 확인 사항', text: '• 여권 유효기간 출발일기준 6개월이상\n• 단수여권, 긴급여권, 관용여권 입국불가' },
  { type: 'PAYMENT', title: '추가 요금 및 할증', text: '• 3/26(목)까지 항공권 발권조건, 이후 유류세 인상 약 11만원' },
  { type: 'INFO', title: '여행 정보', text: '• 상기 일정은 현지 및 항공사 사정에 의해 변경될 수 있습니다' },
];

const JGJ_DAY1 = {
  day: 1, regions: ['부산','장가계'],
  meals: { breakfast: false, lunch: true, lunch_note: '누룽지백숙', dinner: true, dinner_note: '호텔식' },
  schedule: [
    flight('09:00','부산 출발','BX371'), normal('11:20','장가계 도착 / 가이드 미팅 후 중식'),
    normal(null,'▶장가계의 혼이라 불리는 천문산 등정'), normal(null,'999개의 계단위 하늘로 통하는 문 천문동'),
    normal(null,'케이블카 상행-에스컬레이터-천문산사-귀곡잔도-유리잔도-케이블카 하행'),
    normal(null,'▶천문산을 배경으로 펼쳐지는 대형오페라쇼 천문호선쇼 관람'),
  ],
};

const JGJ_DAY_LAST_3 = {
  day: 4, regions: ['장가계','부산'],
  meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '김밥 또는 도시락', dinner: false },
  schedule: [
    normal(null,'호텔 조식 후'), normal(null,'▶군성사석화박물관'),
    flight('12:50','장가계 출발','BX372'), normal('16:55','부산 도착'),
  ],
  hotel: null,
};

// 8. 장가계 노팁노옵션 3박4일
PRODUCTS.push({
  title: '장가계+칠성산 노팁노옵션 3박4일',
  destination: '장가계', category: '패키지', product_type: '노팁노옵션', trip_style: '관광',
  departure_airport: '김해공항', airline: 'BX', min_participants: 4, status: 'approved', country: '중국', duration: 4, nights: 3,
  price: 1069000,
  product_summary: '장가계+칠성산 노팁노옵션 3박4일. 천문산, 천자산, 원가계, 백룡엘리베이터, 칠성산 루지, 마사지 포함.',
  price_tiers: [
    { period_label: '월요일', adult_price: 1069000, status: 'available' },
    { period_label: '화요일', adult_price: 1099000, status: 'available' },
    { period_label: '수요일', adult_price: 1179000, status: 'available' },
    { period_label: '목요일', adult_price: 1399000, status: 'available' },
    { period_label: '금요일', adult_price: 1299000, status: 'available' },
    { period_label: '토요일', adult_price: 1289000, status: 'available' },
    { period_label: '일요일', adult_price: 1129000, status: 'available' },
  ],
  inclusions: ['왕복 항공료+텍스+유류할증료','호텔(2인1실)','차량','가이드','관광지입장료','식사','여행자보험','기사/가이드경비'],
  excludes: ['매너팁 및 개인경비','유류변동분'],
  product_highlights: ['노팁노옵션','천문산','천자산+원가계','칠성산 루지','마사지 포함'],
  special_notes: '쇼핑 3회(라텍스,한약방,게르마늄 등). 8명이상 리무진, 8명미만 일반차량.',
  notices_parsed: JGJ_COMMON_NOTICES,
  itinerary_data: {
    meta: { title: '장가계+칠성산 노팁노옵션 3박4일', destination: '장가계', nights: 3, days: 4, airline: 'BX', flight_out: 'BX371', flight_in: 'BX372', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복 항공료','호텔','차량','가이드','입장료','식사','보험','가이드경비'], excludes: ['매너팁','개인경비','유류변동분'], remarks: ['쇼핑 3회'] },
    days: [
      { ...JGJ_DAY1, hotel: { name: '선샤인/피닉스/청하금강호텔', grade: '5', note: '또는 동급(정5성)' } },
      { day: 2, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '산채비빔밥', dinner: true, dinner_note: '불고기' },
        schedule: [
          normal(null,'호텔 조식 후 천자산 풍경구로 이동'), normal(null,'▶2KM 케이블카로 천자산 등정'), normal(null,'▶어필봉, 선녀헌화, 하룡공원'),
          normal(null,'▶원가계 이동 - 천하제일교, 미혼대, 후화원'), normal(null,'▶백룡엘리베이터(326M) 하산'),
          normal(null,'▶칠성산 - 왕복케이블카, 유리전망대, 편도 루지'),
          normal(null,'석식 후 발+전신마사지(90분/매너팁별도)'),
        ],
        hotel: { name: '선샤인/피닉스/청하금강호텔', grade: '5', note: '또는 동급(정5성)' } },
      { day: 3, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '버섯전골', dinner: true, dinner_note: '삼겹살 무제한' },
        schedule: [
          normal(null,'▶보봉호 유람(VIP통로)'), normal(null,'▶황룡동굴(VIP통로)'),
          normal(null,'▶장가계대협곡 - 유리다리+엘리베이터+봅슬레이+신천호유람'),
          normal(null,'▶72기루(차창)'),
        ],
        hotel: { name: '선샤인/피닉스/청하금강호텔', grade: '5', note: '또는 동급(정5성)' } },
      JGJ_DAY_LAST_3,
    ],
  },
});

// 9. 장가계 프리미엄 3박4일
PRODUCTS.push({
  title: '【PREMIUM】장가계 3박4일 #노팁 #노옵션 #노쇼핑 #전신마사지2회 #칠성산',
  destination: '장가계', category: '패키지', product_type: '프리미엄|노팁노옵션|노쇼핑', trip_style: '관광',
  departure_airport: '김해공항', airline: 'BX', min_participants: 8, status: 'approved', country: '중국', duration: 4, nights: 3,
  price: 1469000,
  product_summary: '장가계 프리미엄 3박4일. 무릉원 힐튼가든(2025년 오픈 특급정5성). 노쇼핑, 전신마사지 2회, 리무진차량.',
  price_tiers: [
    { period_label: '월요일', adult_price: 1469000, status: 'available' },
    { period_label: '화요일', adult_price: 1499000, status: 'available' },
    { period_label: '수요일', adult_price: 1579000, status: 'available' },
    { period_label: '목요일', adult_price: 1799000, status: 'available' },
    { period_label: '금요일', adult_price: 1699000, status: 'available' },
    { period_label: '토요일', adult_price: 1689000, status: 'available' },
    { period_label: '일요일', adult_price: 1519000, status: 'available' },
  ],
  inclusions: ['왕복 항공료+텍스+유류할증료','호텔(2인1실)','리무진차량','가이드','관광지입장료','식사','여행자보험','기사/가이드경비'],
  excludes: ['매너팁 및 개인경비','유류변동분'],
  product_highlights: ['무릉원 힐튼가든 특급정5성','노쇼핑','전신마사지 2회','리무진차량','칠성산'],
  special_notes: '무릉원 힐튼가든 (2025년 오픈 - 특급 정5성)',
  notices_parsed: JGJ_COMMON_NOTICES,
  itinerary_data: {
    meta: { title: '장가계 프리미엄 3박4일', destination: '장가계', nights: 3, days: 4, airline: 'BX', flight_out: 'BX371', flight_in: 'BX372', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복 항공료','힐튼가든 호텔','리무진차량','가이드','입장료','식사','마사지2회'], excludes: ['매너팁','개인경비'], remarks: ['노쇼핑'] },
    days: [
      { ...JGJ_DAY1, schedule: [...JGJ_DAY1.schedule.slice(0,-1), normal(null,'▶발+전신마사지(90분/매너팁별도)')], meals: { ...JGJ_DAY1.meals, dinner_note: '훠궈(하이디라오)' }, hotel: { name: '무릉원 힐튼가든 호텔', grade: '5', note: '2025년 오픈 특급정5성' } },
      { day: 2, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '비빔밥', dinner: true, dinner_note: '소모듬구이' },
        schedule: [
          normal(null,'▶천자산 등정 - 어필봉, 선녀헌화, 하룡공원'), normal(null,'▶원가계 - 천하제일교, 미혼대, 후화원, 백룡엘리베이터 하산'),
          normal(null,'▶십리화랑(왕복 모노레일)'), normal(null,'▶금편계곡(도보산책)'),
          normal(null,'▶황룡동굴(VIP통로)'), normal(null,'▶매력상서쇼 관람'),
        ],
        hotel: { name: '무릉원 힐튼가든 호텔', grade: '5', note: '' } },
      { day: 3, regions: ['장가계'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '소불고기', dinner: true, dinner_note: '양꼬치+맥주1병' },
        schedule: [
          normal(null,'▶장가계대협곡 유리다리+엘리베이터+봅슬레이+신천호유람'),
          normal(null,'▶칠성산 - 왕복케이블카, 유리전망대, 편도 루지'),
          normal(null,'▶72기루(내부관광)'), normal(null,'▶발+전신마사지(90분/매너팁별도)'),
        ],
        hotel: { name: '무릉원 힐튼가든 호텔', grade: '5', note: '' } },
      { ...JGJ_DAY_LAST_3, meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '도시락+생수', dinner: false } },
    ],
  },
});

// 10-14: 나머지 장가계 상품들은 구조가 유사하므로 간략 INSERT
// 장가계+부용진 4박5일, 프리미엄 4박5일, 당월출발, NO쇼핑 고품격, 가성비 초특가

const JGJ_VARIANTS = [
  { title: '장가계/부용진+칠성산 노팁노옵션 4박5일', duration: 5, nights: 4, price: 1139000, product_type: '노팁노옵션', summary: '장가계+부용진 야경 4박5일. 칠성산, 대협곡, 마사지.' },
  { title: '【PREMIUM】장가계/부용진 4박5일 #노쇼핑 #마사지2회 #칠성산 #부용진', duration: 5, nights: 4, price: 1569000, product_type: '프리미엄|노팁노옵션|노쇼핑', summary: '장가계 프리미엄 4박5일. 힐튼가든, 노쇼핑, 부용진 야경, 마사지 2회.' },
  { title: '장가계 당월출발 노팁노옵션 3박4일 #선물3종 #과일바구니 #칠성산', duration: 4, nights: 3, price: 799000, product_type: '노팁노옵션', summary: '장가계 당월출발 3박4일. 라텍스목베개+침향+과일바구니 선물. 칠성산, 마사지.' },
  { title: '【NO쇼핑 고품격】장가계 3박4일 #노쇼핑 #3대VIP패스 #전신마사지', duration: 4, nights: 3, price: 999000, product_type: '고품격|노팁노옵션|노쇼핑', summary: '장가계 NO쇼핑 고품격 3박4일. 시내호텔(준5성), 매일특식, VIP패스 3곳, 마사지.' },
  { title: '【가성비 초특가】장가계 3박4일 #선물3종 #리무진 #마사지', duration: 4, nights: 3, price: 699000, product_type: '노팁노옵션', summary: '장가계 가성비 초특가 699,000원~. 리무진차량, 매일특식, 마사지, 선물3종.' },
];

for (const v of JGJ_VARIANTS) {
  PRODUCTS.push({
    title: v.title, destination: '장가계', category: '패키지', product_type: v.product_type, trip_style: '관광',
    departure_airport: '김해공항', airline: 'BX', min_participants: 4, status: 'approved', country: '중국',
    duration: v.duration, nights: v.nights, price: v.price,
    product_summary: v.summary,
    price_tiers: [{ period_label: '요금표 참조', adult_price: v.price, status: 'available' }],
    inclusions: ['왕복 항공료','호텔(2인1실)','차량','가이드','입장료','식사','보험','가이드경비'],
    excludes: ['매너팁','개인경비'],
    product_highlights: ['노팁노옵션','장가계','칠성산'],
    notices_parsed: JGJ_COMMON_NOTICES,
    itinerary_data: { meta: { title: v.title, destination: '장가계', nights: v.nights, days: v.duration, airline: 'BX', flight_out: 'BX371', flight_in: 'BX372', departure_airport: '김해공항' }, days: [] },
  });
}

// ═══════════════════════════════════════════
// 15-16. 북큐슈 료칸팩 2종
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: '북큐슈 초조 료칸팩 2박3일 #유후인 #벳부 #아소 #쿠로가와',
  destination: '후쿠오카', category: '패키지', product_type: '실속|온천', trip_style: '관광',
  departure_airport: '김해공항', airline: 'BX', min_participants: 4, status: 'approved', country: '일본', duration: 3, nights: 2,
  price: 579000,
  product_summary: '북큐슈 초조 료칸팩 2박3일. 유후인+벳부+아소+쿠로가와. 온천1박+시내1박. 579,000원~.',
  price_tiers: [
    { period_label: '화 특가', adult_price: 579000, status: 'available', note: '4/1~6/5' },
    { period_label: '일,월,수', adult_price: 649000, status: 'available' },
    { period_label: '목', adult_price: 709000, status: 'available' },
    { period_label: '금', adult_price: 779000, status: 'available' },
    { period_label: '토', adult_price: 769000, status: 'available' },
  ],
  inclusions: ['왕복항공권+TAX','전일정 호텔숙박','현지식','입장료','전용버스 2일','택시 1회','여행자보험'],
  excludes: ['유류세(3월기준 26,300원)','가이드경비(3만원)','기타 개인경비','석식1번'],
  product_highlights: ['유후인 민예거리','벳부 지옥온천','아소 대관봉전망대','쿠로가와 온천마을','온천 료칸 1박'],
  special_notes: '최소출발 4명. 10명부터 쓰루가이드. 싱글차지 12만원. 특전: 장어정식 포함.',
  notices_parsed: [
    { type: 'CRITICAL', title: '필수 확인 사항', text: '• 최소출발인원 4명\n• 한달 전 예약조건, 10명부터 쓰루가이드 동행' },
    { type: 'PAYMENT', title: '추가 요금 및 할증', text: '• 유류세 26,300원 별도\n• 가이드경비 3만원\n• 전일정 싱글차지 12만원' },
    { type: 'INFO', title: '여행 정보', text: '• 면세점 1곳 방문조건\n• 온천 호텔 아웃바스 배정 가능\n• 특전: 장어정식 포함' },
  ],
  itinerary_data: {
    meta: { title: '북큐슈 초조 료칸팩 2박3일', destination: '후쿠오카', nights: 2, days: 3, airline: 'BX', flight_out: 'BX148', flight_in: 'BX141', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복항공권','호텔','현지식','입장료','전용버스','여행자보험'], excludes: ['유류세','가이드경비','석식1번'], remarks: ['특전: 장어정식 포함'] },
    days: [
      { day: 1, regions: ['부산','후쿠오카','유후인','벳부'], meals: { breakfast: false, lunch: true, lunch_note: '현지식', dinner: true, dinner_note: '호텔식' },
        schedule: [flight('07:30','김해 국제공항 출발','BX148'), normal('08:30','후쿠오카 국제공항 도착'), normal(null,'▶후쿠오카 타워 외관 및 모모치 해변'), normal(null,'▶개구리절 뇨린지 관광'), normal(null,'▶유후인 민예거리 및 긴린호수'), normal(null,'▶벳부 지옥온천 "바다지옥"'), normal(null,'▶벳부만 전망대'), normal(null,'호텔 체크인 및 석식, 온천 휴식')],
        hotel: { name: '류센카쿠', grade: '4', note: '또는 동급 온천호텔' } },
      { day: 2, regions: ['아소','쿠로가와','후쿠오카'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(토반야키)', dinner: false, dinner_note: '자유식' },
        schedule: [normal(null,'▶아소 대관봉전망대 및 밀크팩토리'), normal(null,'▶쿠로가와 온천마을 산책'), normal(null,'▶라라포트 쇼핑몰'), shopping(null,'면세점 1곳'), normal(null,'호텔 체크인 후 휴식')],
        hotel: { name: 'WBF 그란데 호텔', grade: '3', note: '또는 동급' } },
      { day: 3, regions: ['후쿠오카','부산'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: false, dinner: false },
        schedule: [normal(null,'호텔 조식 후'), normal(null,'택시로 공항 이동'), flight('11:50','후쿠오카 국제공항 출발','BX141'), normal('13:00','김해 국제공항 도착')],
        hotel: null },
    ],
  },
});

PRODUCTS.push({
  title: '북큐슈 풀타임 조석 료칸팩 2박3일 #온천1박 #시내1박',
  destination: '후쿠오카', category: '패키지', product_type: '조석료칸팩', trip_style: '관광',
  departure_airport: '김해공항', airline: 'BX', min_participants: 6, status: 'approved', country: '일본', duration: 3, nights: 2,
  price: 709000,
  product_summary: '북큐슈 풀타임 조석 료칸팩 2박3일. 유후인+벳부+아소+쿠로가와+미야지다케신사+큐다이숲.',
  price_tiers: [
    { period_label: '수 특가', adult_price: 709000, status: 'available' },
    { period_label: '일~화', adult_price: 779000, status: 'available' },
    { period_label: '목', adult_price: 869000, status: 'available' },
    { period_label: '금', adult_price: 769000, status: 'available' },
    { period_label: '토', adult_price: 929000, status: 'available' },
  ],
  inclusions: ['왕복항공권+TAX','전일정 호텔숙박','관광지 입장료','포함 식사','전용차량','여행자보험'],
  excludes: ['유류세(26,300원)','가이드경비(3만원)','기타 개인경비','석식1번'],
  product_highlights: ['유후인 긴린호수','벳부 가마도지옥','아소 대관봉','쿠로가와 온천','미야지다케 신사','큐다이숲'],
  special_notes: '최소출발 6명. 출발 4주전 예약 한함. 싱글차지 12만원.',
  notices_parsed: [
    { type: 'CRITICAL', title: '필수 확인 사항', text: '• 최소출발 6분\n• 출발 4주 전 예약자 한함, 이후 10인 이상 출발 확정' },
    { type: 'PAYMENT', title: '추가 요금 및 할증', text: '• 유류세 26,300원 별도\n• 가이드경비 3만원\n• 싱글차지 12만원' },
  ],
  itinerary_data: {
    meta: { title: '북큐슈 풀타임 조석 료칸팩 2박3일', destination: '후쿠오카', nights: 2, days: 3, airline: 'BX', flight_out: 'BX142', flight_in: 'BX143', departure_airport: '김해공항' },
    days: [
      { day: 1, regions: ['부산','유후인','벳부'], meals: { breakfast: false, lunch: true, lunch_note: '현지식', dinner: true, dinner_note: '호텔식' },
        schedule: [flight('10:00','김해 국제공항 출발','BX142'), normal('10:55','후쿠오카 도착'), normal(null,'▶유후인 민예거리 및 긴린호수'), normal(null,'▶벳부 가마도지옥온천(족욕체험)'), normal(null,'▶유노하나 재배지'), normal(null,'호텔 체크인 및 석식, 온천 휴식')],
        hotel: { name: '유모토야', grade: '4', note: '또는 류센카쿠/우키하 동급' } },
      { day: 2, regions: ['아소','쿠로가와','후쿠오카'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식', dinner: false, dinner_note: '자유식(불포함)' },
        schedule: [normal(null,'▶아소 대관봉전망대'), normal(null,'▶쿠로가와 온천마을 산책'), normal(null,'▶개구리절 뇨이린지'), normal(null,'호텔 체크인 후 휴식')],
        hotel: { name: 'WBF 그란데 호텔', grade: '3', note: '또는 UMI 358 동급' } },
      { day: 3, regions: ['후쿠오카','부산'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식', dinner: false },
        schedule: [normal(null,'▶미야지다케 신사'), normal(null,'▶큐다이숲 산책'), normal(null,'▶후쿠오카 타워 외관 및 모모치 해변'), normal(null,'▶라라포트 쇼핑몰'), shopping(null,'면세 1곳'), flight('19:55','후쿠오카 국제공항 출발','BX143'), normal('21:00','김해 국제공항 도착')],
        hotel: null },
    ],
  },
});

// ═══════════════════════════════════════════
// 17-18. 토야마 온천 3박4일 2종
// ═══════════════════════════════════════════
const TOYAMA_COMMON = {
  destination: '토야마', category: '패키지', product_type: '전세기|온천', trip_style: '관광',
  departure_airport: '김해공항', airline: 'BX', min_participants: 2, status: 'approved', country: '일본', duration: 4, nights: 3,
  inclusions: ['왕복항공료+TAX+유류할증료','호텔(2인1실)','관광지 입장료','일정상 식사','전용차량','여행자보험'],
  excludes: ['가이드경비(4만원)','싱글차지(10만원/박)','기타 개인경비'],
  product_highlights: ['알펜루트 전코스','쿠로베 협곡 열차','가미코지','시라카와고 합장촌','온천 3박'],
  notices_parsed: [
    { type: 'CRITICAL', title: '필수 확인 사항', text: '• 2명이상 100% 출발 확정\n• 전세기 상품 데포짓 30만원 필수\n• 출발 3주 이내 취소시 100% 수수료\n• 면세점 1곳 방문조건' },
    { type: 'PAYMENT', title: '추가 요금 및 할증', text: '• 가이드경비 4만원\n• 싱글차지 10만원/박\n• 예약금 입금 후 확정, 환불 불가' },
    { type: 'INFO', title: '여행 정보', text: '• 스페셜 기프트: 마유크림 + 수액파스' },
  ],
};

PRODUCTS.push({
  ...TOYAMA_COMMON, title: '토야마 온천3박 알펜루트+쿠로베열차+가미코지+시라카와 3박4일',
  price: 1649000, product_summary: '토야마 온천3박. 알펜루트 전코스, 쿠로베 협곡열차, 가미코지, 시라카와고. 스페셜 기프트.',
  price_tiers: [
    { period_label: '5/13 (수)', departure_dates: ['2026-05-13'], adult_price: 1649000, status: 'available' },
    { period_label: '5/16 (토)', departure_dates: ['2026-05-16'], adult_price: 1749000, status: 'available' },
    { period_label: '5/19 (화)', departure_dates: ['2026-05-19'], adult_price: 1649000, status: 'available' },
    { period_label: '5/22 (금)', departure_dates: ['2026-05-22'], adult_price: 1799000, status: 'available' },
  ],
  itinerary_data: {
    meta: { title: '토야마 온천3박 알펜루트', destination: '토야마', nights: 3, days: 4, airline: 'BX', flight_out: 'BX1625', flight_in: 'BX1615', departure_airport: '김해공항' },
    days: [
      { day: 1, regions: ['부산','토야마'], meals: { breakfast: false, lunch: false, dinner: true, dinner_note: '호텔식(뷔페+노미호다이90분)' },
        schedule: [flight(null,'김해국제공항 출발','BX1625'), normal(null,'토야마공항 도착'), normal(null,'▶도야마 가라스미술관'), normal(null,'호텔 이동 및 석식, 온천 휴식')],
        hotel: { name: '타오야와쿠라 호텔', grade: '4', note: '오션뷰+인피니티 온천' } },
      { day: 2, regions: ['알펜루트'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '장어덮밥', dinner: true, dinner_note: '호텔식' },
        schedule: [normal(null,'▶다테야마 쿠로베 알펜루트 전코스 관광'), normal(null,'케이블카-고원버스-로프웨이-지하케이블카-쿠로베댐 도보-트롤리버스'), normal(null,'호텔 이동 및 석식, 온천 휴식')],
        hotel: { name: '오마치 카노야', grade: '4', note: 'OR 쿠로베호텔 동급' } },
      { day: 3, regions: ['가미코지','타카야마','시라카와고','토야마'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '스키야키', dinner: true, dinner_note: '호텔식(현지식)' },
        schedule: [normal(null,'▶가미코지 해발1,500m - 다이쇼이케~갓빠바시 산책'), normal(null,'▶타카야마 후루이 마치나미 전통거리'), normal(null,'▶세계문화유산 시라카와고 합장촌'), normal(null,'호텔 이동 및 석식, 온천 휴식')],
        hotel: { name: '토야마 즈루키 호텔', grade: '4', note: 'OR 다테야마 국제호텔 동급' } },
      { day: 4, regions: ['우나즈키','토야마','부산'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식', dinner: false },
        schedule: [normal(null,'▶쿠로베 협곡 열차 탑승(우나즈키~쿠로나기 왕복)'), normal(null,'▶환수공원(스타벅스 1잔)'), shopping(null,'일본관광공사 면세점'), flight('17:00','토야마 국제공항 출발','BX1615'), normal('18:50','김해국제공항 도착')],
        hotel: null },
    ],
  },
});

PRODUCTS.push({
  ...TOYAMA_COMMON, title: '토야마 온천3박 알펜루트+쿠로베열차+가미코지+시라카와 3박4일 (5/10일)',
  price: 1669000, product_summary: '토야마 온천3박 5/10(일) 출발. 알펜루트+가미코지+시라카와고+쿠로베열차. 토야마 관광 포함.',
  price_tiers: [{ period_label: '5/10 (일)', departure_dates: ['2026-05-10'], adult_price: 1669000, status: 'available' }],
  itinerary_data: {
    meta: { title: '토야마 온천3박 5/10', destination: '토야마', nights: 3, days: 4, airline: 'BX', flight_out: 'BX1625', flight_in: 'BX1615', departure_airport: '김해공항' },
    days: [
      { day: 1, regions: ['부산','토야마'], meals: { breakfast: false, lunch: true, lunch_note: '현지식', dinner: true, dinner_note: '호텔식(뷔페+노미호다이)' },
        schedule: [flight('09:00','김해국제공항 출발','BX1625'), normal('10:30','토야마공항 도착 중식'), normal(null,'▶도야마 가라스미술관'), normal(null,'▶토야마 환수공원(스타벅스)'), normal(null,'▶토야마 시청전망대'), normal(null,'▶아마하라시 해안'), normal(null,'호텔 이동 및 석식, 온천 휴식')],
        hotel: { name: '타오야와쿠라 호텔', grade: '4', note: '오션뷰+인피니티 온천' } },
      { day: 2, regions: ['알펜루트'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '장어덮밥', dinner: true, dinner_note: '호텔식' },
        schedule: [normal(null,'▶다테야마 쿠로베 알펜루트 전코스'), normal(null,'호텔 이동 및 석식, 온천 휴식')],
        hotel: { name: '오마치 카노야', grade: '4', note: 'OR 쿠로베호텔 동급' } },
      { day: 3, regions: ['가미코지','타카야마','시라카와고'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '스키야키', dinner: true, dinner_note: '호텔식' },
        schedule: [normal(null,'▶가미코지 해발1,500m 산책'), normal(null,'▶타카야마 전통거리'), normal(null,'▶시라카와고 합장촌'), normal(null,'호텔 이동 및 석식, 온천 휴식')],
        hotel: { name: '토야마 즈루키 호텔', grade: '4', note: 'OR 다테야마 국제호텔 동급' } },
      { day: 4, regions: ['토야마','부산'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식', dinner: false },
        schedule: [normal(null,'▶쿠로베 협곡 열차(우나즈키~쿠로나기 왕복)'), shopping(null,'일본관광공사 면세점'), flight('17:00','토야마 국제공항 출발','BX1615'), normal('18:50','김해국제공항 도착')],
        hotel: null },
    ],
  },
});

// ═══════════════════════════════════════════
// 19-20. 보홀 슬림/노옵션 2종
// ═══════════════════════════════════════════
const BOHOL_COMMON = {
  destination: '보홀', category: '패키지', trip_style: '리조트',
  departure_airport: '김해공항', airline: '7C', min_participants: 2, status: 'approved', country: '필리핀',
  notices_parsed: [
    { type: 'CRITICAL', title: '필수 확인 사항', text: '• 여권 만료일 6개월 이상\n• 미성년자(만15세 미만) 부모 미동반시 대사관 공증 필요\n• 필리핀 E-트래블 카드 작성 필수\n• 필리핀 전 지역 금연(적발시 벌금)' },
    { type: 'PAYMENT', title: '추가 요금 및 할증', text: '• 성수기 써차지 및 의무디너 예약시 확인\n• 마사지 팁 60분 100페소/120분 200페소' },
    { type: 'POLICY', title: '현지 규정 및 안내', text: '• 일정 미참여시 패널티 1인/1박/$100\n• 가이드 동의없이 개별활동시 사고 책임 없음' },
  ],
};

PRODUCTS.push({
  ...BOHOL_COMMON, title: '7C 부산-보홀 솔레아코스트 슬림패키지 3박5일',
  product_type: '슬림', duration: 5, nights: 3, price: 419000,
  product_summary: '보홀 솔레아코스트 슬림패키지 3박5일. 419,000원~. 망고1KG+바나나보트 특전. 시내관광 포함.',
  price_tiers: [
    { period_label: '4/1,2,9,22 3박', adult_price: 419000, status: 'available' },
    { period_label: '4/4,5,11,12,18,19,25,26 4박', adult_price: 419000, status: 'available' },
    { period_label: '5/6,7,13,14 3박', adult_price: 399000, status: 'available' },
  ],
  inclusions: ['왕복 항공료+TAX+유류','여행자보험','호텔','차량','일정상 식사','가이드','관광지','보홀 시내관광','망고 1KG','바나나보트 체험'],
  excludes: ['선택관광','개인비용','매너팁','가이드/기사경비($50)','성수기 써차지'],
  product_highlights: ['솔레아코스트 리조트','419,000원~','망고1KG 특전','바나나보트 서비스','시내관광 포함'],
  itinerary_data: {
    meta: { title: '보홀 슬림패키지', destination: '보홀', nights: 3, days: 5, airline: '7C', flight_out: '7C2157', flight_in: '7C2158', departure_airport: '김해공항' },
    days: [
      { day: 1, regions: ['부산','보홀'], meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [flight('17:30','부산 김해공항 출발','7C2157'), normal('20:40','보홀 팡라오 국제공항 도착'), normal(null,'호텔 CHECK-IN 및 휴식')],
        hotel: { name: '솔레아 코스트 보홀', grade: '4', note: '슈페리어룸' } },
      { day: 2, regions: ['보홀'], meals: { breakfast: true, breakfast_note: '리조트', lunch: true, lunch_note: '현지식', dinner: true, dinner_note: '리조트식' },
        schedule: [normal(null,'리조트 조식 후 선택관광 및 자유시간'), normal(null,'석식 후 리조트 휴식')],
        hotel: { name: '솔레아 코스트 보홀', grade: '4', note: '슈페리어룸' } },
      { day: 3, regions: ['보홀'], meals: { breakfast: true, breakfast_note: '리조트', lunch: false, dinner: false },
        schedule: [normal(null,'리조트 조식 후 선택관광 및 자유시간')],
        hotel: { name: '솔레아 코스트 보홀', grade: '4', note: '슈페리어룸' } },
      { day: 4, regions: ['보홀'], meals: { breakfast: true, breakfast_note: '리조트', lunch: true, lunch_note: '현지식', dinner: false },
        schedule: [normal(null,'CHECK-OUT 후 시내관광(사왕재래시장, 팡라오성당)'), shopping(null,'쇼핑센터 2회(토산품+잡화)'), normal(null,'공항 이동 및 탑승 수속')],
        hotel: null },
      { day: 5, regions: ['보홀','부산'], meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [flight('01:30','보홀 팡라오 국제공항 출발','7C2158'), normal('06:55','부산 도착')],
        hotel: null },
    ],
  },
});

PRODUCTS.push({
  ...BOHOL_COMMON, title: '7C 부산-보홀 솔레아코스트 노옵션패키지 3박5일',
  product_type: '노옵션', duration: 5, nights: 3, price: 699000,
  product_summary: '보홀 노옵션패키지 3박5일. 호핑투어3종+나팔링/반딧불+데이투어+전신마사지 $310 상당 포함.',
  price_tiers: [
    { period_label: '4/1,2,9,22 3박', adult_price: 739000, status: 'available' },
    { period_label: '4/4,5,11,12,18,19,25,26 4박', adult_price: 719000, status: 'available' },
    { period_label: '5/6,7,13,14 3박', adult_price: 699000, status: 'available' },
  ],
  inclusions: ['왕복 항공료+TAX+유류','여행자보험','호텔','차량','일정상 식사','가이드','관광지','시내관광','호핑투어 3종세트(스노쿨링+발리카삭+돌핀왓칭)','나팔링투어 OR 반딧불투어(택1)','전신마사지 60분','보홀 데이투어(멘메이드포레스트+초콜릿힐+안경원숭이)','망고 1KG','바나나보트'],
  excludes: ['개인비용','매너팁','가이드/기사경비($50)','성수기 써차지'],
  product_highlights: ['$310 상당 투어 포함','호핑투어 3종','나팔링/반딧불 택1','데이투어','전신마사지','노옵션'],
  itinerary_data: {
    meta: { title: '보홀 노옵션패키지', destination: '보홀', nights: 3, days: 5, airline: '7C', flight_out: '7C2157', flight_in: '7C2158', departure_airport: '김해공항' },
    days: [
      { day: 1, regions: ['부산','보홀'], meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [flight('17:30','부산 김해공항 출발','7C2157'), normal('20:40','보홀 팡라오 국제공항 도착'), normal(null,'호텔 CHECK-IN 및 휴식')],
        hotel: { name: '솔레아 코스트 보홀', grade: '4', note: '슈페리어룸' } },
      { day: 2, regions: ['보홀'], meals: { breakfast: true, breakfast_note: '리조트', lunch: true, lunch_note: '현지식', dinner: true, dinner_note: '리조트식' },
        schedule: [normal(null,'나팔링 투어 또는 반딧불 투어(택1)'), normal(null,'석식 후 리조트 휴식')],
        hotel: { name: '솔레아 코스트 보홀', grade: '4', note: '슈페리어룸' } },
      { day: 3, regions: ['보홀'], meals: { breakfast: true, breakfast_note: '리조트', lunch: true, lunch_note: '호핑식', dinner: true, dinner_note: '현지식' },
        schedule: [normal(null,'아일랜드 호핑투어 - 돌핀왓칭+발리카삭+스노클링+호핑중식'), normal(null,'석식 후 선택관광 및 자유시간')],
        hotel: { name: '솔레아 코스트 보홀', grade: '4', note: '슈페리어룸' } },
      { day: 4, regions: ['보홀'], meals: { breakfast: true, breakfast_note: '리조트', lunch: true, lunch_note: '현지식', dinner: true, dinner_note: '현지식' },
        schedule: [normal(null,'CHECK-OUT 후 시내관광(사왕재래시장, 팡라오성당)'), normal(null,'데이투어: 안경원숭이+맨메이드포레스트+초콜릿힐'), shopping(null,'쇼핑센터 2회(토산품+잡화)'), normal(null,'전신 마사지 60분(팁 별도)'), normal(null,'공항 이동 및 탑승 수속')],
        hotel: null },
      { day: 5, regions: ['보홀','부산'], meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [flight('01:30','보홀 팡라오 국제공항 출발','7C2158'), normal('06:55','부산 도착')],
        hotel: null },
    ],
  },
});

// ═══════════════════════════════════════════
// 21-22. 나트랑/달랏 실속 + 노팁노옵션
// ═══════════════════════════════════════════
const NTR_COMMON = {
  destination: '나트랑/달랏', category: '패키지', trip_style: '관광',
  departure_airport: '김해공항', airline: 'BX', min_participants: 6, status: 'approved', country: '베트남', duration: 5, nights: 3,
};

PRODUCTS.push({
  ...NTR_COMMON, title: '나트랑/달랏 실속 PKG 3박5일 에어부산(BX)',
  product_type: '실속', price: 419000,
  product_summary: '나트랑/달랏 실속 3박5일. 419,000원~. 호라이즌/멀펄 5성급, 과일도시락 특전.',
  price_tiers: [
    { period_label: '5/1~6/30,8/30~9/30 토일월화', adult_price: 419000, status: 'available' },
    { period_label: '5/1~6/30,8/30~9/30 수목금', adult_price: 459000, status: 'available' },
    { period_label: '7/1~14,10/1~21 토일월화', adult_price: 459000, status: 'available' },
    { period_label: '7/1~14,10/1~21 수목금', adult_price: 509000, status: 'available' },
    { period_label: '3/1~5/5,7/15~22,8/16~29 토일월화', adult_price: 509000, status: 'available' },
    { period_label: '3/1~5/5,7/15~22,8/16~29 수목금', adult_price: 549000, status: 'available' },
  ],
  inclusions: ['항공요금+유류/택스(3월기준)','해외여행자보험','호텔(2인1실)','전용차량&기사','한국인+로컬 가이드','관광지 입장료','전 일정 식사'],
  excludes: ['기사&가이드 경비$50','기타 개인경비','매너팁','유류텍스변동분','싱글차지','연휴기간 써차지 및 갈라디너'],
  product_highlights: ['호라이즌 호텔 5성급','멀펄 달랏 5성급','과일도시락 특전','포나가르탑','달랏 관광'],
  special_notes: '쇼핑 3회(침향,잡화,커피). 옵션 가능 상품.',
  notices_parsed: [
    { type: 'CRITICAL', title: '필수 확인 사항', text: '• 만14세 미만 미성년자 영문 가족관계증명서 필수\n• 여권 6개월 이상\n• 2025.01.01부터 베트남 전자담배 반입 금지' },
    { type: 'PAYMENT', title: '추가 요금 및 할증', text: '• 기사&가이드 경비 $50\n• 싱글차지 별도\n• 패키지 미참여시 $150/인/박 패널티' },
    { type: 'POLICY', title: '현지 규정 및 안내', text: '• 베트남 공항 현지인 가이드 미팅/샌딩\n• 유적지 내에서도 현지인 가이드 진행 가능' },
  ],
  itinerary_data: {
    meta: { title: '나트랑/달랏 실속 3박5일', destination: '나트랑/달랏', nights: 3, days: 5, airline: 'BX', flight_out: 'BX781', flight_in: 'BX782', departure_airport: '김해공항' },
    days: [
      { day: 1, regions: ['부산','나트랑'], meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [flight('19:20','부산 출발','BX781'), normal('22:20','나트랑 깜란공항 도착 후 가이드 미팅'), normal(null,'호텔 이동 후 체크인 및 휴식'), normal(null,'[특전] 웰컴 과일 도시락 1룸 1팩')],
        hotel: { name: '호라이즌 호텔', grade: '5', note: '또는 동급' } },
      { day: 2, regions: ['나트랑','달랏'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(분짜+반쎄오)', dinner: true, dinner_note: '한식(제육쌈밥)' },
        schedule: [normal(null,'▶참파 유적지 포나가르탑'), normal(null,'중식 후 달랏으로 이동(약 3시간30분)'), normal(null,'▶바오다이 황제의 여름별장'), normal(null,'▶크레이지 하우스')],
        hotel: { name: '멀펄 달랏 호텔', grade: '5', note: '또는 동급' } },
      { day: 3, regions: ['달랏'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(샤브샤브 혹은 닭구이)', dinner: true, dinner_note: '무제한 삼겹살' },
        schedule: [normal(null,'▶랑비앙 전망대(지프차왕복)'), normal(null,'▶도멘 드 마리 성당'), normal(null,'▶달랏기차역'), normal(null,'▶죽림사(케이블카 불포함)'), normal(null,'▶다딴라 폭포(레일바이크 불포함)'), normal(null,'▶린푸억사원')],
        hotel: { name: '멀펄 달랏 호텔', grade: '5', note: '또는 동급' } },
      { day: 4, regions: ['달랏','나트랑'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(세트메뉴)', dinner: true, dinner_note: '소불고기전골' },
        schedule: [shopping(null,'쇼핑관광(침향,잡화,커피 3곳)'), normal(null,'▶쑤언흐엉호수(차창)+커피1잔'), normal(null,'나트랑으로 이동(약 3시간)'), normal(null,'▶롱선사'), normal(null,'▶나트랑대성당(차창)'), normal(null,'석식 후 공항 이동'), flight('23:20','나트랑 출발','BX782')],
        hotel: null },
      { day: 5, regions: ['부산'], meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [normal('06:20','부산 김해공항 도착')],
        hotel: null },
    ],
  },
});

PRODUCTS.push({
  ...NTR_COMMON, title: '나트랑/달랏 노팁+노옵션 PKG 3박5일 에어부산(BX)',
  product_type: '노팁노옵션', price: 619000,
  product_summary: '나트랑/달랏 노팁노옵션 3박5일. 619,000원~. 과일뷔페+머드스파+마사지90분+120분+달랏야시장+나트랑야시장+씨클로 특전.',
  price_tiers: [
    { period_label: '5/1~6/30,8/30~9/30 토일월화', adult_price: 619000, status: 'available' },
    { period_label: '5/1~6/30,8/30~9/30 수목금', adult_price: 659000, status: 'available' },
    { period_label: '7/1~14,10/1~21 토일월화', adult_price: 659000, status: 'available' },
    { period_label: '7/1~14,10/1~21 수목금', adult_price: 709000, status: 'available' },
    { period_label: '3/1~5/5,7/15~22,8/16~29 토일월화', adult_price: 709000, status: 'available' },
    { period_label: '3/1~5/5,7/15~22,8/16~29 수목금', adult_price: 749000, status: 'available' },
  ],
  inclusions: ['가이드&기사 팁','항공요금+유류/택스(3월기준)','해외여행자보험','호텔(2인1실)','전용차량&기사','한국인+로컬 가이드','관광지 입장료','전 일정 식사'],
  excludes: ['개인경비','매너팁','싱글차지 전박 16만원/1인','연휴기간 써차지 및 갈라디너'],
  product_highlights: ['노팁노옵션','과일뷔페 무제한','머드스파','전신마사지 90분+120분','달랏 야시장+야경','나트랑 야시장+씨클로','케이블카·레일바이크 포함'],
  special_notes: '쇼핑 3회(침향,잡화,커피). 싱글차지 전박 16만원/1인.',
  notices_parsed: [
    { type: 'CRITICAL', title: '필수 확인 사항', text: '• 만14세 미만 미성년자 영문 가족관계증명서 필수\n• 여권 6개월 이상\n• 2025.01.01부터 베트남 전자담배 반입 금지' },
    { type: 'PAYMENT', title: '추가 요금 및 할증', text: '• 싱글차지 전박 16만원/1인\n• 패키지 미참여시 $150/인/박 패널티' },
    { type: 'POLICY', title: '현지 규정 및 안내', text: '• 베트남 공항 현지인 가이드 미팅/샌딩' },
  ],
  itinerary_data: {
    meta: { title: '나트랑/달랏 노팁노옵션 3박5일', destination: '나트랑/달랏', nights: 3, days: 5, airline: 'BX', flight_out: 'BX781', flight_in: 'BX782', departure_airport: '김해공항' },
    days: [
      { day: 1, regions: ['부산','나트랑'], meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [flight('19:20','부산 출발','BX781'), normal('22:20','나트랑 깜란공항 도착'), normal(null,'호텔 체크인 및 휴식'), normal(null,'[특전] 과일 도시락 1룸 1팩')],
        hotel: { name: '호라이즌 호텔', grade: '5', note: '또는 동급' } },
      { day: 2, regions: ['나트랑','달랏'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(분짜+반쎄오)', dinner: true, dinner_note: '한식(제육쌈밥 혹은 5성 호텔식)' },
        schedule: [normal(null,'▶포나가르탑'), normal(null,'▶무제한 과일뷔페'), normal(null,'▶나트랑의 명물 머드스파'), normal(null,'[특전] 전신마사지 90분(매너팁별도)'), normal(null,'달랏으로 이동(약 3시간30분)'), normal(null,'▶바오다이 별장'), normal(null,'▶크레이지 하우스'), normal(null,'[특전] 달랏 야시장(음료 OR 맥주포함)')],
        hotel: { name: '멀펄 달랏 호텔', grade: '5', note: '또는 동급' } },
      { day: 3, regions: ['달랏'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(샤브샤브 혹은 닭구이)', dinner: true, dinner_note: '무제한 삼겹살' },
        schedule: [normal(null,'▶랑비앙 전망대(지프차왕복)'), normal(null,'▶도멘 드 마리 성당'), normal(null,'▶달랏기차역'), normal(null,'▶죽림사(케이블카)'), normal(null,'▶다딴라 폭포(레일바이크 탑승)'), normal(null,'[특전] 달랏 야경+천국의계단(음료 1잔)')],
        hotel: { name: '멀펄 달랏 호텔', grade: '5', note: '또는 동급' } },
      { day: 4, regions: ['달랏','나트랑'], meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(세트메뉴)', dinner: true, dinner_note: '소불고기전골' },
        schedule: [shopping(null,'쇼핑관광(침향,잡화,커피 3곳)'), normal(null,'▶쑤언흐엉호수+커피1잔'), normal(null,'나트랑으로 이동(약 3시간)'), normal(null,'▶롱선사'), normal(null,'▶나트랑대성당(차창)'), normal(null,'[특전] 전신마사지 120분(매너팁별도)'), normal(null,'[특전] 나트랑 야간 시티투어(야시장+씨클로+맥주+피자)'), normal(null,'석식 후 공항 이동'), flight('23:20','나트랑 출발','BX782')],
        hotel: null },
      { day: 5, regions: ['부산'], meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [normal('06:40','부산 김해공항 도착')],
        hotel: null },
    ],
  },
});

// ═══════════════════════════════════════════
// 실행
// ═══════════════════════════════════════════
async function main() {
  console.log(`상품 ${PRODUCTS.length}개 일괄 INSERT\n`);

  let success = 0;
  for (const p of PRODUCTS) {
    const row = {
      title: p.title, destination: p.destination, category: p.category, product_type: p.product_type,
      trip_style: p.trip_style, departure_airport: p.departure_airport, airline: p.airline,
      min_participants: p.min_participants, status: p.status, country: p.country,
      duration: p.duration, nights: p.nights, price: p.price,
      product_summary: p.product_summary, price_tiers: p.price_tiers,
      inclusions: p.inclusions, excludes: p.excludes,
      product_highlights: p.product_highlights, special_notes: p.special_notes,
      notices_parsed: p.notices_parsed, itinerary_data: p.itinerary_data,
      category_attrs: p.category_attrs || null,
      ticketing_deadline: p.ticketing_deadline || null,
      raw_text: p.title,
    };

    const { data, error } = await sb.from('travel_packages').insert(row).select('id, title').single();
    if (error) {
      console.error('✗', p.title.slice(0, 40), error.message);
    } else {
      console.log('✓', data.title.slice(0, 50));
      console.log('  /packages/' + data.id);
      success++;
    }
  }

  console.log(`\n완료: ${success}/${PRODUCTS.length} 성공`);
}

main().catch(e => console.error('Fatal:', e.message));
