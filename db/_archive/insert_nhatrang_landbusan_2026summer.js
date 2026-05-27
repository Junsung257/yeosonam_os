/**
 * 랜드부산 나트랑 2026년 4종 일괄 INSERT
 * 1) 3색골프 노쇼핑 3박5일
 * 2) 다이아몬드베이 골프텔 3박5일
 * 3) 나트랑/판랑 호핑 노팁노옵션 3박5일
 * 4) 나트랑/달랏 품격 노팁노옵션 3박5일
 * 랜드사: 랜드부산 | 커미션: 9%
 * 선발특가: 4/29까지
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

// ═══════════════════════════════════════════
// 공통 데이터
// ═══════════════════════════════════════════

// 베트남 공통 주의사항
const VN_COMMON_NOTICES = [
  { type: 'CRITICAL', title: '필수 확인 사항', text: '• 여권 만료일 출발일 기준 6개월 이상\n• 2025.01.01부터 베트남 전자담배 금지(아이코스, 힛츠 포함)\n• 만15세 미만 아동 부모 동반시에도 가족관계증명서 영문본 필수' },
  { type: 'PAYMENT', title: '항공 안내', text: '• 항공 GV2 기준, 2인 이상 발권 후 GV 깨질시 전체 인원 취소수수료 발생\n• 유류할증료 4월기준, 이후 변동 가능' },
];

// 베트남 골프 취소규정
const VN_GOLF_CANCEL = { type: 'POLICY', title: '취소규정 (특별약관)', text: '• 예약후: 20만원/인\n• 14~7일전: 50%\n• 7~4일전: 70%\n• 4~2일전: 90%\n• 1일~당일: 100%\n• 파이널 확정 후 취소불가' };

// 베트남 관광 취소규정 (동일)
const VN_PKG_CANCEL = VN_GOLF_CANCEL;

// 항공제외일 (골프)
const GOLF_EXCLUDED = '4/29~5/2, 5/21~23, 30, 6/2~3, 7/15~17, 7/29~8/1, 8/13~15, 9/22~25, 10/7~9';
// 항공제외일 (관광)
const PKG_EXCLUDED = '4/29~5/2, 5/20~23, 30, 6/2~3, 7/15~17, 7/29~8/1, 8/12~15, 9/22~25, 30, 10/1~3, 7~9';

const PRODUCTS = [];

// ═══════════════════════════════════════════
// 1. 나트랑 3색골프 노쇼핑 3박5일
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: '나트랑 3색골프 노쇼핑 3박5일 #빈펄CC #다이아몬드CC #KNCC',
  destination: '나트랑', category: '골프', product_type: '노쇼핑|3색골프', trip_style: '골프',
  departure_airport: '김해공항', airline: 'BX', min_participants: 4, status: 'approved', country: '베트남',
  duration: 5, nights: 3, price: 1099000,
  land_operator: '랜드부산', commission_rate: 9,
  ticketing_deadline: '2026-04-29',
  product_summary: '나트랑 3색골프 3박5일. 빈펄CC/다이아몬드CC/KN CC 3곳 라운딩. 퀸터센트럴 5성. 노쇼핑. 시내관광 포함.',
  product_tags: ['노쇼핑', '골프', '3색골프', '빈펄CC', '다이아몬드CC', 'KNCC', '나트랑', '베트남'],
  product_highlights: ['3색골프 빈펄/다이아몬드/KN', '퀸터센트럴 5성', '노쇼핑', '시내관광 포함'],
  price_tiers: [
    // 4/1~4/30, 8/8~8/15
    { period_label: '4/1~4/30,8/8~8/15 수목금', date_range: { start: '2026-04-01', end: '2026-04-30' }, departure_day_of_week: '수,목,금', adult_price: 1259000, status: 'available', note: '8/8~8/15 동일가' },
    { period_label: '4/1~4/30,8/8~8/15 월화', date_range: { start: '2026-04-01', end: '2026-04-30' }, departure_day_of_week: '월,화', adult_price: 1219000, status: 'available', note: '8/8~8/15 동일가' },
    { period_label: '4/1~4/30,8/8~8/15 토일', date_range: { start: '2026-04-01', end: '2026-04-30' }, departure_day_of_week: '토,일', adult_price: 1219000, status: 'available', note: '8/8~8/15 동일가' },
    // 5/1~7/14, 8/30~9/12
    { period_label: '5/1~7/14,8/30~9/12 수목금', date_range: { start: '2026-05-01', end: '2026-07-14' }, departure_day_of_week: '수,목,금', adult_price: 1179000, status: 'available', note: '8/30~9/12 동일가' },
    { period_label: '5/1~7/14,8/30~9/12 월화', date_range: { start: '2026-05-01', end: '2026-07-14' }, departure_day_of_week: '월,화', adult_price: 1179000, status: 'available', note: '8/30~9/12 동일가' },
    { period_label: '5/1~7/14,8/30~9/12 토일', date_range: { start: '2026-05-01', end: '2026-07-14' }, departure_day_of_week: '토,일', adult_price: 1139000, status: 'available', note: '8/30~9/12 동일가' },
    // 7/15~7/22, 8/16~8/29, 10/1~10/21
    { period_label: '7/15~7/22,8/16~8/29,10/1~10/21 수목금', date_range: { start: '2026-07-15', end: '2026-07-22' }, departure_day_of_week: '수,목,금', adult_price: 1219000, status: 'available', note: '8/16~8/29,10/1~10/21 동일가' },
    { period_label: '7/15~7/22,8/16~8/29,10/1~10/21 월화', date_range: { start: '2026-07-15', end: '2026-07-22' }, departure_day_of_week: '월,화', adult_price: 1179000, status: 'available', note: '8/16~8/29,10/1~10/21 동일가' },
    { period_label: '7/15~7/22,8/16~8/29,10/1~10/21 토일', date_range: { start: '2026-07-15', end: '2026-07-22' }, departure_day_of_week: '토,일', adult_price: 1179000, status: 'available', note: '8/16~8/29,10/1~10/21 동일가' },
    // 7/30~8/7
    { period_label: '7/30~8/7 전요일', date_range: { start: '2026-07-30', end: '2026-08-07' }, adult_price: 1339000, status: 'available' },
    // 7/23~7/29
    { period_label: '7/23~7/29 전요일', date_range: { start: '2026-07-23', end: '2026-07-29' }, adult_price: 1379000, status: 'available' },
    // 9/13~9/30
    { period_label: '9/13~9/30 수목금', date_range: { start: '2026-09-13', end: '2026-09-30' }, departure_day_of_week: '수,목,금', adult_price: 1139000, status: 'available' },
    { period_label: '9/13~9/30 월화', date_range: { start: '2026-09-13', end: '2026-09-30' }, departure_day_of_week: '월,화', adult_price: 1139000, status: 'available' },
    { period_label: '9/13~9/30 토일', date_range: { start: '2026-09-13', end: '2026-09-30' }, departure_day_of_week: '토,일', adult_price: 1099000, status: 'available' },
  ],
  excluded_dates: GOLF_EXCLUDED.split(', '),
  inclusions: ['왕복항공료', '숙박료', '식사(호텔조식)', '관광지입장료', '전용차량', '현지로컬가이드', '여행자보험'],
  excludes: ['유류할증료변동분(4월기준)', '개인경비', '매너팁', '미팅/샌딩비 $50/인', '카트피+캐디피 $45/18홀/인', '캐디팁($18~20)', '중식/석식', '주말플레이비용 $30/18홀/인'],
  accommodations: ['퀸터 센트럴 호텔 또는 동급 (5성급)'],
  special_notes: '노쇼핑. 빈펄CC 월요일 휴일. 성수기 3색골프 및 티업시간 개런티 불가. 4인라운딩 조건(2~3인시 조인가능). 3인라운딩시 싱글카트비 $20/인. 싱글차지 $60/인. 골프수하물 15KG 기준(23KG 변경시 5만원/인). 주말/공휴일 $15/인 추가. 예약금 30만원/인.',
  notices_parsed: [
    ...VN_COMMON_NOTICES,
    { type: 'PAYMENT', title: '골프 추가비용', text: '• 카트피+캐디피 $45/18홀/인\n• 캐디팁 $18~20/인\n• 미팅/샌딩비 $50/인\n• 주말/공휴일 $15/인 추가\n• 3인 라운딩시 싱글카트비 $20/인\n• 싱글차지 $60/인\n• 골프수하물 23KG 변경시 5만원/인' },
    { type: 'INFO', title: '골프장 안내', text: '• 빈펄CC / 다이아몬드CC / KN CC 중 3곳 라운딩\n• 빈펄CC 월요일 휴일\n• 성수기 3색골프 보장 불가\n• 티업시간 확정 불가(특정일/성수기)' },
    VN_GOLF_CANCEL,
  ],
  itinerary_data: {
    meta: { title: '나트랑 3색골프 노쇼핑 3박5일', destination: '나트랑', nights: 3, days: 5, airline: 'BX', flight_out: 'BX781', flight_in: 'BX782', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복항공료', '호텔5성', '호텔조식', '전용차량', '가이드', '보험'], excludes: ['카트피+캐디피', '캐디팁', '미팅/샌딩비', '중식/석식', '주말추가'], remarks: ['노쇼핑'] },
    days: [
      { day: 1, regions: ['부산', '나트랑'],
        meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [
          flight('19:30', '김해 국제공항 출발', 'BX781'),
          normal('22:40', '나트랑 깜란 국제공항 도착'),
          normal(null, '현지가이드 미팅 후 호텔 이동'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '퀸터 센트럴 호텔', grade: '5', note: '또는 동급' } },
      { day: 2, regions: ['나트랑'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: false, lunch_note: '불포함', dinner: false, dinner_note: '불포함' },
        schedule: [
          normal(null, '호텔 조식 후'),
          golf(null, '★빈펄CC / 다이아몬드CC / KN CC 중 18홀 라운딩'),
          normal(null, '라운딩 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '퀸터 센트럴 호텔', grade: '5', note: '또는 동급' } },
      { day: 3, regions: ['나트랑'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: false, lunch_note: '불포함', dinner: false, dinner_note: '불포함' },
        schedule: [
          normal(null, '호텔 조식 후'),
          golf(null, '★빈펄CC / 다이아몬드CC / KN CC 중 18홀 라운딩'),
          normal(null, '라운딩 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '퀸터 센트럴 호텔', grade: '5', note: '또는 동급' } },
      { day: 4, regions: ['나트랑'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: false, lunch_note: '불포함', dinner: false, dinner_note: '불포함' },
        schedule: [
          normal(null, '호텔 조식 후 체크아웃'),
          golf(null, '★빈펄CC / 다이아몬드CC / KN CC 중 18홀 라운딩'),
          normal(null, '라운딩 후 나트랑 시내관광'),
          normal(null, '▶나트랑 대성당, 롱선사 관광'),
          normal(null, '나트랑 공항으로 이동'),
          flight('23:40', '나트랑 깜란 국제공항 출발', 'BX782'),
        ],
        hotel: null },
      { day: 5, regions: ['부산'],
        meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [normal('06:20', '김해 국제공항 도착')],
        hotel: null },
    ],
  },
});

// ═══════════════════════════════════════════
// 2. 나트랑 다이아몬드베이 골프텔 3박5일
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: '나트랑 다이아몬드베이 골프텔 3박5일 #레이트체크아웃22시',
  destination: '나트랑', category: '골프', product_type: '골프텔', trip_style: '골프',
  departure_airport: '김해공항', airline: 'BX', min_participants: 2, status: 'approved', country: '베트남',
  duration: 5, nights: 3, price: 1169000,
  land_operator: '랜드부산', commission_rate: 9,
  ticketing_deadline: '2026-04-29',
  product_summary: '나트랑 다이아몬드베이 골프텔 3박5일. 다이아몬드CC 3R. 골프텔 빌라동 숙박. 레이트체크아웃 22시. 그린피+카트비 포함. 2명 출발.',
  product_tags: ['골프텔', '다이아몬드CC', '레이트체크아웃', '2인출발', '나트랑', '베트남'],
  product_highlights: ['다이아몬드CC 3라운드', '골프텔 빌라 숙박', '레이트체크아웃 22시', '그린피+카트비 포함', '2명 출발 가능'],
  price_tiers: [
    { period_label: '4/1~4/30,8/8~8/15 수목금', date_range: { start: '2026-04-01', end: '2026-04-30' }, departure_day_of_week: '수,목,금', adult_price: 1329000, status: 'available', note: '8/8~8/15 동일가' },
    { period_label: '4/1~4/30,8/8~8/15 월화', date_range: { start: '2026-04-01', end: '2026-04-30' }, departure_day_of_week: '월,화', adult_price: 1289000, status: 'available', note: '8/8~8/15 동일가' },
    { period_label: '4/1~4/30,8/8~8/15 토일', date_range: { start: '2026-04-01', end: '2026-04-30' }, departure_day_of_week: '토,일', adult_price: 1289000, status: 'available', note: '8/8~8/15 동일가' },
    { period_label: '5/1~7/14,8/30~9/12 수목금', date_range: { start: '2026-05-01', end: '2026-07-14' }, departure_day_of_week: '수,목,금', adult_price: 1249000, status: 'available', note: '8/30~9/12 동일가' },
    { period_label: '5/1~7/14,8/30~9/12 월화', date_range: { start: '2026-05-01', end: '2026-07-14' }, departure_day_of_week: '월,화', adult_price: 1249000, status: 'available', note: '8/30~9/12 동일가' },
    { period_label: '5/1~7/14,8/30~9/12 토일', date_range: { start: '2026-05-01', end: '2026-07-14' }, departure_day_of_week: '토,일', adult_price: 1209000, status: 'available', note: '8/30~9/12 동일가' },
    { period_label: '7/15~7/22,8/16~8/29,10/1~10/21 수목금', date_range: { start: '2026-07-15', end: '2026-07-22' }, departure_day_of_week: '수,목,금', adult_price: 1289000, status: 'available', note: '8/16~8/29,10/1~10/21 동일가' },
    { period_label: '7/15~7/22,8/16~8/29,10/1~10/21 월화', date_range: { start: '2026-07-15', end: '2026-07-22' }, departure_day_of_week: '월,화', adult_price: 1249000, status: 'available', note: '8/16~8/29,10/1~10/21 동일가' },
    { period_label: '7/15~7/22,8/16~8/29,10/1~10/21 토일', date_range: { start: '2026-07-15', end: '2026-07-22' }, departure_day_of_week: '토,일', adult_price: 1249000, status: 'available', note: '8/16~8/29,10/1~10/21 동일가' },
    { period_label: '7/30~8/7 전요일', date_range: { start: '2026-07-30', end: '2026-08-07' }, adult_price: 1409000, status: 'available' },
    { period_label: '7/23~7/29 전요일', date_range: { start: '2026-07-23', end: '2026-07-29' }, adult_price: 1449000, status: 'available' },
    { period_label: '9/13~9/30 수목금', date_range: { start: '2026-09-13', end: '2026-09-30' }, departure_day_of_week: '수,목,금', adult_price: 1209000, status: 'available' },
    { period_label: '9/13~9/30 월화', date_range: { start: '2026-09-13', end: '2026-09-30' }, departure_day_of_week: '월,화', adult_price: 1209000, status: 'available' },
    { period_label: '9/13~9/30 토일', date_range: { start: '2026-09-13', end: '2026-09-30' }, departure_day_of_week: '토,일', adult_price: 1169000, status: 'available' },
  ],
  excluded_dates: ['4/29~5/2', '5/20~23', '5/30', '6/2~3', '7/15~17', '7/29~8/1', '8/12~15', '9/2', '9/22~25', '9/30', '10/1~3', '10/7~9'],
  inclusions: ['왕복항공료', '숙박료', '식사(호텔조식)', '골프비용(그린피,카트비)', '여행자보험', '레이트체크아웃 22시(비수기)'],
  excludes: ['유류할증료변동분(4월기준)', '개인경비', '매너팁', '공항미팅샌딩($30/인-4인,$50/인-2~3인)', '캐디팁($16/18홀/인)', '중식/석식', '주말플레이비용 $15/18홀/인'],
  accommodations: ['다이아몬드CC 골프텔 빌라동'],
  special_notes: '2명 출발 가능. 한국인 직원 없음(카톡 안내). 다이아몬드베이 휴일추가: 4/26,30,5/1,9/2 주말요금. 싱글차지 $30/박/인. 3인싱글카트비 9홀$12/18홀$24. 추가라운딩 주중$94/주말$110. 체크아웃연장 18시$30/23시$50. 예약금 30만원/인.',
  notices_parsed: [
    ...VN_COMMON_NOTICES,
    { type: 'PAYMENT', title: '골프텔 추가비용', text: '• 공항미팅샌딩 $30~50/인(한국선입금)\n• 캐디팁 $16/18홀/인\n• 주말/공휴일 $15/18홀/인\n• 싱글차지 $30/박/인\n• 3인 싱글카트비 9홀$12/18홀$24\n• 추가라운딩 주중$94/주말$110\n• 체크아웃연장 18시$30/23시$50' },
    { type: 'INFO', title: '골프텔 안내', text: '• 다이아몬드CC 전용 골프텔 빌라형\n• 한국어 상주직원 없음, 카톡 안내\n• 룸타입 지정 불가\n• 비수기 레이트체크아웃 22시 무료' },
    VN_GOLF_CANCEL,
  ],
  itinerary_data: {
    meta: { title: '나트랑 다이아몬드베이 골프텔 3박5일', destination: '나트랑', nights: 3, days: 5, airline: 'BX', flight_out: 'BX781', flight_in: 'BX782', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복항공료', '골프텔 빌라', '호텔조식', '그린피+카트비', '보험', '레이트체크아웃'], excludes: ['캐디팁', '미팅/샌딩비', '중식/석식'], remarks: ['2명 출발 가능'] },
    days: [
      { day: 1, regions: ['부산', '나트랑'],
        meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [
          flight('19:30', '김해 국제공항 출발', 'BX781'),
          normal('22:40', '나트랑 깜란 국제공항 도착'),
          normal(null, '현지기사 미팅 후 호텔 이동'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '다이아몬드CC 골프텔 빌라동', grade: '4', note: '골프텔' } },
      { day: 2, regions: ['나트랑'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: false, dinner: false },
        schedule: [
          normal(null, '호텔 조식 후'),
          golf(null, '★다이아몬드CC 18홀 라운딩'),
          normal(null, '라운딩 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '다이아몬드CC 골프텔 빌라동', grade: '4', note: '골프텔' } },
      { day: 3, regions: ['나트랑'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: false, dinner: false },
        schedule: [
          normal(null, '호텔 조식 후'),
          golf(null, '★다이아몬드CC 18홀 라운딩'),
          normal(null, '라운딩 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '다이아몬드CC 골프텔 빌라동', grade: '4', note: '골프텔' } },
      { day: 4, regions: ['나트랑'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: false, dinner: false },
        schedule: [
          normal(null, '호텔 조식 후'),
          golf(null, '★다이아몬드CC 18홀 라운딩'),
          normal(null, '라운딩 후 레이트 체크아웃'),
          normal('22:00', '호텔 미팅 후 나트랑 공항 이동'),
          flight('23:40', '나트랑 깜란 국제공항 출발', 'BX782'),
        ],
        hotel: null },
      { day: 5, regions: ['부산'],
        meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [normal('06:20', '김해 국제공항 도착')],
        hotel: null },
    ],
  },
});

// ═══════════════════════════════════════════
// 3. 나트랑/판랑 호핑 노팁/노옵션 3박5일
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: '나트랑/판랑 호핑 노팁노옵션 3박5일 #사막투어 #해적호핑 #마사지120분 #야시장 #씨클로',
  destination: '나트랑/판랑', category: '패키지', product_type: '노팁노옵션|호핑', trip_style: '관광',
  departure_airport: '김해공항', airline: 'BX', min_participants: 6, status: 'approved', country: '베트남',
  duration: 5, nights: 3, price: 919000,
  land_operator: '랜드부산', commission_rate: 9,
  ticketing_deadline: '2026-04-29',
  product_summary: '나트랑/판랑 호핑 노팁노옵션 3박5일. 판랑사막투어+해적호핑투어+마사지120분+야간시티투어. 하바나5성. 과일도시락 특전.',
  product_tags: ['노팁', '노옵션', '판랑', '사막투어', '호핑투어', '마사지', '야시장', '씨클로', '나트랑', '베트남'],
  product_highlights: ['노팁노옵션', '판랑 사막투어(지프차)', '해적호핑투어(음료무제한)', '전통마사지 120분', '야간시티투어+씨클로+맥주+피자'],
  price_tiers: [
    // 스팟특가
    { period_label: '스팟특가 5/17,6/14', departure_dates: ['2026-05-17', '2026-06-14'], adult_price: 949000, status: 'available', note: '스팟특가' },
    // 4/1~4/30
    { period_label: '4/1~4/30 수목금', date_range: { start: '2026-04-01', end: '2026-04-30' }, departure_day_of_week: '수,목,금', adult_price: 1059000, status: 'available' },
    { period_label: '4/1~4/30 월화', date_range: { start: '2026-04-01', end: '2026-04-30' }, departure_day_of_week: '월,화', adult_price: 1019000, status: 'available' },
    { period_label: '4/1~4/30 토일', date_range: { start: '2026-04-01', end: '2026-04-30' }, departure_day_of_week: '토,일', adult_price: 1019000, status: 'available' },
    // 5/1~6/30
    { period_label: '5/1~6/30 수목금', date_range: { start: '2026-05-01', end: '2026-06-30' }, departure_day_of_week: '수,목,금', adult_price: 969000, status: 'available' },
    { period_label: '5/1~6/30 월화', date_range: { start: '2026-05-01', end: '2026-06-30' }, departure_day_of_week: '월,화', adult_price: 969000, status: 'available' },
    { period_label: '5/1~6/30 토일', date_range: { start: '2026-05-01', end: '2026-06-30' }, departure_day_of_week: '토,일', adult_price: 929000, status: 'available' },
    // 7/1~7/14, 8/30~9/12
    { period_label: '7/1~7/14,8/30~9/12 수목금', date_range: { start: '2026-07-01', end: '2026-07-14' }, departure_day_of_week: '수,목,금', adult_price: 1009000, status: 'available', note: '8/30~9/12 동일가' },
    { period_label: '7/1~7/14,8/30~9/12 월화', date_range: { start: '2026-07-01', end: '2026-07-14' }, departure_day_of_week: '월,화', adult_price: 1009000, status: 'available', note: '8/30~9/12 동일가' },
    { period_label: '7/1~7/14,8/30~9/12 토일', date_range: { start: '2026-07-01', end: '2026-07-14' }, departure_day_of_week: '토,일', adult_price: 959000, status: 'available', note: '8/30~9/12 동일가' },
    // 8/8~8/15
    { period_label: '8/8~8/15 수목금', date_range: { start: '2026-08-08', end: '2026-08-15' }, departure_day_of_week: '수,목,금', adult_price: 1099000, status: 'available' },
    { period_label: '8/8~8/15 월화', date_range: { start: '2026-08-08', end: '2026-08-15' }, departure_day_of_week: '월,화', adult_price: 1049000, status: 'available' },
    { period_label: '8/8~8/15 토일', date_range: { start: '2026-08-08', end: '2026-08-15' }, departure_day_of_week: '토,일', adult_price: 1049000, status: 'available' },
    // 7/15~7/22, 8/16~8/29, 10/1~10/21
    { period_label: '7/15~7/22,8/16~8/29,10/1~10/21 수목금', date_range: { start: '2026-07-15', end: '2026-07-22' }, departure_day_of_week: '수,목,금', adult_price: 1049000, status: 'available', note: '8/16~8/29,10/1~10/21 동일가' },
    { period_label: '7/15~7/22,8/16~8/29,10/1~10/21 월화', date_range: { start: '2026-07-15', end: '2026-07-22' }, departure_day_of_week: '월,화', adult_price: 1009000, status: 'available', note: '8/16~8/29,10/1~10/21 동일가' },
    { period_label: '7/15~7/22,8/16~8/29,10/1~10/21 토일', date_range: { start: '2026-07-15', end: '2026-07-22' }, departure_day_of_week: '토,일', adult_price: 1009000, status: 'available', note: '8/16~8/29,10/1~10/21 동일가' },
    // 7/30~8/7
    { period_label: '7/30~8/7 전요일', date_range: { start: '2026-07-30', end: '2026-08-07' }, adult_price: 1179000, status: 'available' },
    // 7/23~7/29
    { period_label: '7/23~7/29 전요일', date_range: { start: '2026-07-23', end: '2026-07-29' }, adult_price: 1229000, status: 'available' },
    // 9/13~9/30
    { period_label: '9/13~9/30 수목금', date_range: { start: '2026-09-13', end: '2026-09-30' }, departure_day_of_week: '수,목,금', adult_price: 959000, status: 'available' },
    { period_label: '9/13~9/30 월화', date_range: { start: '2026-09-13', end: '2026-09-30' }, departure_day_of_week: '월,화', adult_price: 959000, status: 'available' },
    { period_label: '9/13~9/30 토일', date_range: { start: '2026-09-13', end: '2026-09-30' }, departure_day_of_week: '토,일', adult_price: 919000, status: 'available' },
  ],
  excluded_dates: PKG_EXCLUDED.split(', '),
  inclusions: ['왕복항공료(유류할증료,공항세)', '숙박료', '식사(호텔조식포함)', '관광지입장료', '전용차량', '기사/가이드', '여행자보험'],
  excludes: ['유류할증료변경분(4월기준)', '개인경비', '매너팁', '호텔써차지 및 갈라디너'],
  accommodations: ['나트랑 하바나 호텔 또는 동급 (5성급)'],
  special_notes: '노팁노옵션. 쇼핑 2회(커피숍,참향/노니,잡화,라텍스 중). 과일도시락 1팩/룸 특전. 사막투어시 선글라스+마스크 준비. 일정미참여시 $150/인 패널티.',
  notices_parsed: [
    ...VN_COMMON_NOTICES,
    { type: 'POLICY', title: '쇼핑/특전', text: '• 쇼핑 2회(커피숍,참향/노니,잡화,라텍스 중)\n• 특전: 과일도시락 1팩/룸\n• 일정미참여시 $150/인 패널티' },
    VN_PKG_CANCEL,
  ],
  itinerary_data: {
    meta: { title: '나트랑/판랑 호핑 노팁노옵션 3박5일', destination: '나트랑/판랑', nights: 3, days: 5, airline: 'BX', flight_out: 'BX781', flight_in: 'BX782', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복항공료', '호텔5성', '식사', '전용차량', '가이드', '보험'], excludes: ['매너팁', '개인경비', '호텔써차지'], remarks: ['노팁노옵션', '쇼핑2회'] },
    days: [
      { day: 1, regions: ['부산', '나트랑'],
        meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [
          flight('19:30', '김해 국제공항 출발', 'BX781'),
          normal('22:40', '나트랑 깜란 국제공항 도착'),
          normal(null, '현지가이드 미팅 후 호텔 이동'),
          normal(null, '호텔 투숙 및 휴식 *과일도시락 1팩/룸 제공'),
        ],
        hotel: { name: '나트랑 하바나 호텔', grade: '5', note: '또는 동급' } },
      { day: 2, regions: ['나트랑', '판랑'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식', dinner: true, dinner_note: '무제한 삼겹살' },
        schedule: [
          normal(null, '호텔 조식 후 판랑으로 이동(약 2시간)'),
          normal(null, '▶탄요리 몽골마을 관광'),
          normal(null, '▶판랑 사막투어 지프차 A코스(화이트샌듄+옐로우샌듄)'),
          normal(null, '중식 후 ▶닌투언성 염전관광'),
          normal(null, '▶416광장'),
          normal(null, '▶투롱선 사원 관광'),
          normal(null, '나트랑 귀환 후 전통 마사지 120분(팁별도)'),
        ],
        hotel: { name: '나트랑 하바나 호텔', grade: '5', note: '또는 동급' } },
      { day: 3, regions: ['나트랑'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '호핑식', dinner: true, dinner_note: '김치전골' },
        schedule: [
          normal(null, '호텔 조식 후 가이드 미팅'),
          normal(null, '▶해적 호핑투어 진행'),
          normal(null, '스피드보트→해적선 이동'),
          normal(null, '스노클링, 워터슬라이드, 다이빙, 낚시 등'),
          normal(null, '음료무제한(커피,맥주,보드카), 선상해물라면, 열대과일'),
          normal(null, '러브아리랜드 도착 후 중식(호핑식)'),
          normal(null, '호핑투어 후 나트랑 귀환'),
        ],
        hotel: { name: '나트랑 하바나 호텔', grade: '5', note: '또는 동급' } },
      { day: 4, regions: ['나트랑'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식', dinner: true, dinner_note: '씨푸드뷔페' },
        schedule: [
          normal(null, '호텔 조식 후 체크아웃'),
          normal(null, '나트랑 시내관광'),
          normal(null, '▶담시장'),
          normal(null, '▶참파 유적지 포나가르 탑'),
          normal(null, '▶롱손사'),
          normal(null, '▶나트랑 대성당(차창관광)'),
          normal(null, '▶나트랑 야간시티투어(야시장+해변바+씨클로+맥주+피자)'),
          shopping(null, '쇼핑센터 방문'),
          normal(null, '나트랑 공항으로 이동'),
        ],
        hotel: null },
      { day: 5, regions: ['나트랑', '부산'],
        meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [
          flight('23:40', '나트랑 깜란 국제공항 출발', 'BX782'),
          normal('06:20', '김해 국제공항 도착'),
        ],
        hotel: null },
    ],
  },
});

// ═══════════════════════════════════════════
// 4. 나트랑/달랏 품격 노팁/노옵션 3박5일
// ═══════════════════════════════════════════
PRODUCTS.push({
  title: '나트랑/달랏 품격 노팁노옵션 3박5일 #케이블카 #레일바이크 #마사지 #달랏야시장 #나트랑야시장',
  destination: '나트랑/달랏', category: '패키지', product_type: '품격|노팁노옵션', trip_style: '관광',
  departure_airport: '김해공항', airline: 'BX', min_participants: 6, status: 'approved', country: '베트남',
  duration: 5, nights: 3, price: 629000,
  land_operator: '랜드부산', commission_rate: 9,
  ticketing_deadline: '2026-04-29',
  product_summary: '나트랑/달랏 품격 노팁노옵션 3박5일. 호라이즌+멀펄5성. 죽림사케이블카+다딴라레일바이크 포함. 마사지60분, 달랏야시장, 나트랑야시장. 과일도시락특전.',
  product_tags: ['노팁', '노옵션', '품격', '달랏', '케이블카', '레일바이크', '마사지', '야시장', '나트랑', '베트남'],
  product_highlights: ['노팁노옵션', '호라이즌+멀펄 5성', '죽림사 케이블카 포함', '다딴라 레일바이크 포함', '마사지 60분', '달랏+나트랑 야시장'],
  price_tiers: [
    { period_label: '스팟특가 5/17,6/14', departure_dates: ['2026-05-17', '2026-06-14'], adult_price: 629000, status: 'available', note: '스팟특가' },
    { period_label: '4/1~4/30 수목금', date_range: { start: '2026-04-01', end: '2026-04-30' }, departure_day_of_week: '수,목,금', adult_price: 779000, status: 'available' },
    { period_label: '4/1~4/30 월화', date_range: { start: '2026-04-01', end: '2026-04-30' }, departure_day_of_week: '월,화', adult_price: 739000, status: 'available' },
    { period_label: '4/1~4/30 토일', date_range: { start: '2026-04-01', end: '2026-04-30' }, departure_day_of_week: '토,일', adult_price: 739000, status: 'available' },
    { period_label: '5/1~6/30 수목금', date_range: { start: '2026-05-01', end: '2026-06-30' }, departure_day_of_week: '수,목,금', adult_price: 699000, status: 'available' },
    { period_label: '5/1~6/30 월화', date_range: { start: '2026-05-01', end: '2026-06-30' }, departure_day_of_week: '월,화', adult_price: 699000, status: 'available' },
    { period_label: '5/1~6/30 토일', date_range: { start: '2026-05-01', end: '2026-06-30' }, departure_day_of_week: '토,일', adult_price: 649000, status: 'available' },
    { period_label: '7/1~7/14,8/30~9/12 수목금', date_range: { start: '2026-07-01', end: '2026-07-14' }, departure_day_of_week: '수,목,금', adult_price: 729000, status: 'available', note: '8/30~9/12 동일가' },
    { period_label: '7/1~7/14,8/30~9/12 월화', date_range: { start: '2026-07-01', end: '2026-07-14' }, departure_day_of_week: '월,화', adult_price: 729000, status: 'available', note: '8/30~9/12 동일가' },
    { period_label: '7/1~7/14,8/30~9/12 토일', date_range: { start: '2026-07-01', end: '2026-07-14' }, departure_day_of_week: '토,일', adult_price: 679000, status: 'available', note: '8/30~9/12 동일가' },
    { period_label: '8/8~8/15 수목금', date_range: { start: '2026-08-08', end: '2026-08-15' }, departure_day_of_week: '수,목,금', adult_price: 819000, status: 'available' },
    { period_label: '8/8~8/15 월화', date_range: { start: '2026-08-08', end: '2026-08-15' }, departure_day_of_week: '월,화', adult_price: 769000, status: 'available' },
    { period_label: '8/8~8/15 토일', date_range: { start: '2026-08-08', end: '2026-08-15' }, departure_day_of_week: '토,일', adult_price: 769000, status: 'available' },
    { period_label: '7/15~7/22,8/16~8/29,10/1~10/21 수목금', date_range: { start: '2026-07-15', end: '2026-07-22' }, departure_day_of_week: '수,목,금', adult_price: 769000, status: 'available', note: '8/16~8/29,10/1~10/21 동일가' },
    { period_label: '7/15~7/22,8/16~8/29,10/1~10/21 월화', date_range: { start: '2026-07-15', end: '2026-07-22' }, departure_day_of_week: '월,화', adult_price: 729000, status: 'available', note: '8/16~8/29,10/1~10/21 동일가' },
    { period_label: '7/15~7/22,8/16~8/29,10/1~10/21 토일', date_range: { start: '2026-07-15', end: '2026-07-22' }, departure_day_of_week: '토,일', adult_price: 729000, status: 'available', note: '8/16~8/29,10/1~10/21 동일가' },
    { period_label: '7/30~8/7 전요일', date_range: { start: '2026-07-30', end: '2026-08-07' }, adult_price: 909000, status: 'available' },
    { period_label: '7/23~7/29 전요일', date_range: { start: '2026-07-23', end: '2026-07-29' }, adult_price: 949000, status: 'available' },
    { period_label: '9/13~9/30 수목금', date_range: { start: '2026-09-13', end: '2026-09-30' }, departure_day_of_week: '수,목,금', adult_price: 679000, status: 'available' },
    { period_label: '9/13~9/30 월화', date_range: { start: '2026-09-13', end: '2026-09-30' }, departure_day_of_week: '월,화', adult_price: 679000, status: 'available' },
    { period_label: '9/13~9/30 토일', date_range: { start: '2026-09-13', end: '2026-09-30' }, departure_day_of_week: '토,일', adult_price: 629000, status: 'available' },
  ],
  excluded_dates: PKG_EXCLUDED.split(', '),
  inclusions: ['왕복항공료(유류할증료,공항세)', '숙박료', '식사(호텔조식포함)', '관광지입장료', '전용차량', '기사/가이드', '여행자보험'],
  excludes: ['유류할증료변경분(4월기준)', '개인경비', '매너팁', '호텔써차지 및 갈라디너'],
  accommodations: ['호라이즌 호텔 또는 동급 (5성급)', '멀펄 달랏 호텔 또는 동급 (5성급)'],
  special_notes: '노팁노옵션. 쇼핑 3회(커피숍,참향/노니,잡화). 과일도시락 1팩/룸 특전. 싱글차지 15만원/인. 마사지팁 60분-$4, 90분-$5, 120분-$7. 공휴일써차지 2만원/인/박(4/24~26,4/30~5/3). 일정미참여시 $150/인 패널티.',
  notices_parsed: [
    ...VN_COMMON_NOTICES,
    { type: 'PAYMENT', title: '추가비용', text: '• 싱글차지 15만원/인\n• 공휴일써차지 2만원/인/박(4/24~26,4/30~5/3)\n• 마사지팁 60분$4/90분$5/120분$7' },
    { type: 'POLICY', title: '쇼핑/특전', text: '• 쇼핑 3회(커피숍,참향/노니,잡화)\n• 특전: 과일도시락 1팩/룸\n• 일정미참여시 $150/인 패널티' },
    VN_PKG_CANCEL,
  ],
  itinerary_data: {
    meta: { title: '나트랑/달랏 품격 노팁노옵션 3박5일', destination: '나트랑/달랏', nights: 3, days: 5, airline: 'BX', flight_out: 'BX781', flight_in: 'BX782', departure_airport: '김해공항' },
    highlights: { inclusions: ['왕복항공료', '호텔5성', '식사', '전용차량', '가이드', '보험'], excludes: ['매너팁', '개인경비', '호텔써차지'], remarks: ['노팁노옵션', '쇼핑3회'] },
    days: [
      { day: 1, regions: ['부산', '나트랑'],
        meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [
          flight('19:30', '김해 국제공항 출발', 'BX781'),
          normal('22:40', '나트랑 깜란 국제공항 도착'),
          normal(null, '현지가이드 미팅 후 호텔 이동'),
          normal(null, '호텔 투숙 및 휴식 *과일도시락 1팩/룸 제공'),
        ],
        hotel: { name: '호라이즌 호텔', grade: '5', note: '또는 동급' } },
      { day: 2, regions: ['나트랑', '달랏'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(분짜+반쎄오)', dinner: true, dinner_note: '한식(제육쌈밥) 혹은 5성호텔식' },
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '▶참파 유적지 포나가르탑'),
          normal(null, '▶침향타워 & 나트랑비치'),
          normal(null, '▶전통마사지 60분(팁별도$3)'),
          normal(null, '달랏으로 이동(약 3시간30분)'),
          normal(null, '▶크레이지 하우스'),
          normal(null, '▶달랏 야시장투어(자유시간)'),
        ],
        hotel: { name: '멀펄 달랏 호텔', grade: '5', note: '또는 동급' } },
      { day: 3, regions: ['달랏'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(샤브샤브/닭구이)', dinner: true, dinner_note: '한식(무제한삼겹살)' },
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '▶랑비앙 전망대(지프차왕복)'),
          normal(null, '▶달랏기차역'),
          normal(null, '▶도멘 드 마리 성당'),
          normal(null, '▶죽림사(케이블카)'),
          normal(null, '▶다딴라 폭포(레일바이크 탑승)'),
        ],
        hotel: { name: '멀펄 달랏 호텔', grade: '5', note: '또는 동급' } },
      { day: 4, regions: ['달랏', '나트랑'],
        meals: { breakfast: true, breakfast_note: '호텔식', lunch: true, lunch_note: '현지식(세트메뉴)', dinner: true, dinner_note: '한식(소불고기전골)' },
        schedule: [
          normal(null, '호텔 조식 후 체크아웃'),
          normal(null, '▶쑤언흐엉호수 ▶커피 1잔(위즐/코코넛)'),
          shopping(null, '쇼핑관광 3회'),
          normal(null, '▶린푸억사원'),
          normal(null, '나트랑으로 이동(약 3시간30분)'),
          normal(null, '▶롱선사'),
          normal(null, '▶나트랑대성당(차창관광)'),
          normal(null, '▶나트랑 야간시티투어(야시장)'),
          normal(null, '나트랑 공항으로 이동'),
        ],
        hotel: null },
      { day: 5, regions: ['나트랑', '부산'],
        meals: { breakfast: false, lunch: false, dinner: false },
        schedule: [
          flight('23:40', '나트랑 깜란 국제공항 출발', 'BX782'),
          normal('06:20', '김해 국제공항 도착'),
        ],
        hotel: null },
    ],
  },
});

// ═══════════════════════════════════════════
// 실행부
// ═══════════════════════════════════════════
async function run() {
  console.log(`\n🚀 랜드부산 나트랑 2026 ${PRODUCTS.length}종 등록 시작...\n`);

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
      excluded_dates: pkg.excluded_dates,
      inclusions: pkg.inclusions,
      excludes: pkg.excludes,
      accommodations: pkg.accommodations,
      special_notes: pkg.special_notes,
      notices_parsed: pkg.notices_parsed,
      itinerary_data: pkg.itinerary_data,
      filename: 'manual-landbusan-nhatrang-2026summer',
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
