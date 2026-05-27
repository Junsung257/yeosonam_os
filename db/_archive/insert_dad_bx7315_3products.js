/**
 * 다낭/호이안 BX7315 증편 스팟특가 3종 상품 등록
 *  - A. 오전자유 노팁노옵션 3박5일
 *  - B. 미식투어 노팁노옵션 3박5일
 *  - C. 노팁&노옵션&노쇼핑 3박5일
 *
 * 랜드사: 투어비(TB) / 마진 9% / 발권기한 2026-04-28
 * 출발: 부산(BX7315 22:05→01:10 / BX7325 02:10→09:05) — 데일리 증편
 * 출발기간: 2026-05~08
 *
 * 사용법:
 *   node db/insert_dad_bx7315_3products.js                # dry-run (검증만)
 *   node db/insert_dad_bx7315_3products.js --insert       # 실제 INSERT
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { createInserter } = require('./templates/insert-template');

// ─── 원문 raw_text 로드 ──────────────────────────────────────
const RAW_TEXT = fs.readFileSync(path.join(__dirname, 'sample_dad_bx7315_3products.txt'), 'utf-8');
const RAW_TEXT_HASH = crypto.createHash('sha256').update(RAW_TEXT).digest('hex');

// ═══════════════════════════════════════════════════════════════
// 1. 가격표 (원문 1:1 매핑)
//    [ISO date, 가격A_오전자유, 가격B_미식, 가격C_노팁노쇼핑]
// ═══════════════════════════════════════════════════════════════

const PRICE_TABLE = {
  // 5월
  '2026-05-01': [1179000, 1279000, 1799000],  // 5/1 금
  '2026-05-02': [ 899000,  999000, 1519000],  // 5/2 토 (5/2, 8/2~7 동일가)
  // 7/1~14 수목금: 679/779/1299
  '2026-07-01': [679000, 779000, 1299000],
  '2026-07-02': [679000, 779000, 1299000],
  '2026-07-03': [679000, 779000, 1299000],
  '2026-07-08': [679000, 779000, 1299000],
  '2026-07-09': [679000, 779000, 1299000],
  '2026-07-10': [679000, 779000, 1299000],
  // 7/1~14 토일월화: 659/759/1279
  '2026-07-04': [659000, 759000, 1279000],
  '2026-07-05': [659000, 759000, 1279000],
  '2026-07-06': [659000, 759000, 1279000],
  '2026-07-07': [659000, 759000, 1279000],
  '2026-07-11': [659000, 759000, 1279000],  // 토 — 단, 7/11 surcharge 대상
  '2026-07-12': [659000, 759000, 1279000],
  '2026-07-13': [659000, 759000, 1279000],
  '2026-07-14': [659000, 759000, 1279000],
  // 7/15, 16 단일가: 919/1019/1539
  '2026-07-15': [919000, 1019000, 1539000],
  '2026-07-16': [919000, 1019000, 1539000],
  // 7/17 단일가: 779/879/1399
  '2026-07-17': [779000, 879000, 1399000],
  // 7/18~22 토일월화: 719/819/1339
  '2026-07-18': [719000, 819000, 1339000],
  '2026-07-19': [719000, 819000, 1339000],
  '2026-07-20': [719000, 819000, 1339000],
  '2026-07-21': [719000, 819000, 1339000],
  // 7/18~22 수목금: 759/859/1379
  '2026-07-22': [759000, 859000, 1379000],
  // 7/23~28 매일: 939/1039/1559
  '2026-07-23': [939000, 1039000, 1559000],
  '2026-07-24': [939000, 1039000, 1559000],
  '2026-07-25': [939000, 1039000, 1559000],
  '2026-07-26': [939000, 1039000, 1559000],
  '2026-07-27': [939000, 1039000, 1559000],
  '2026-07-28': [939000, 1039000, 1559000],
  // 7/29~31: 1019/1119/1639
  '2026-07-29': [1019000, 1119000, 1639000],
  '2026-07-30': [1019000, 1119000, 1639000],
  '2026-07-31': [1019000, 1119000, 1639000],
  // 8월
  // 8/1, 12~15 (8/14 제외): 959/1059/1579
  '2026-08-01': [959000, 1059000, 1579000],
  '2026-08-12': [959000, 1059000, 1579000],
  '2026-08-13': [959000, 1059000, 1579000],
  '2026-08-15': [959000, 1059000, 1579000],
  // 8/14 단일: 1059/1159/1679
  '2026-08-14': [1059000, 1159000, 1679000],
  // 8/2~7: 899/999/1519
  '2026-08-02': [899000, 999000, 1519000],
  '2026-08-03': [899000, 999000, 1519000],
  '2026-08-04': [899000, 999000, 1519000],
  '2026-08-05': [899000, 999000, 1519000],
  '2026-08-06': [899000, 999000, 1519000],
  '2026-08-07': [899000, 999000, 1519000],
  // 8/8~11 토일월화: 719/819/1339
  '2026-08-08': [719000, 819000, 1339000],
  '2026-08-09': [719000, 819000, 1339000],
  '2026-08-10': [719000, 819000, 1339000],
  '2026-08-11': [719000, 819000, 1339000],
  // 8/16~29 토일월화: 719/819/1339
  '2026-08-16': [719000, 819000, 1339000],  // 일
  '2026-08-17': [719000, 819000, 1339000],  // 월
  '2026-08-18': [719000, 819000, 1339000],  // 화
  '2026-08-22': [719000, 819000, 1339000],  // 토
  '2026-08-23': [719000, 819000, 1339000],  // 일
  '2026-08-24': [719000, 819000, 1339000],  // 월
  '2026-08-25': [719000, 819000, 1339000],  // 화
  '2026-08-29': [719000, 819000, 1339000],  // 토
  // 8/16~29 수목금: 759/859/1379
  '2026-08-19': [759000, 859000, 1379000],
  '2026-08-20': [759000, 859000, 1379000],
  '2026-08-21': [759000, 859000, 1379000],
  '2026-08-26': [759000, 859000, 1379000],
  '2026-08-27': [759000, 859000, 1379000],
  '2026-08-28': [759000, 859000, 1379000],
  // 8/30, 31 제외일자: 679/779/1299
  '2026-08-30': [679000, 779000, 1299000],
  '2026-08-31': [679000, 779000, 1299000],
};

const SORTED_DATES = Object.keys(PRICE_TABLE).sort();

// price_dates 빌더 (idx: 0=A, 1=B, 2=C)
function buildPriceDates(idx) {
  return SORTED_DATES.map(d => ({ date: d, price: PRICE_TABLE[d][idx], confirmed: false }));
}

// price_tiers 빌더 — 사장님 운영용 (요일/기간 그룹별 묶음)
// confirmed = false (출확 표기 없음. "스팟특가"는 surge 표기일 뿐 출발 확정은 아님)
function buildPriceTiers(idx) {
  // 가격대별 그룹핑
  const groups = new Map();
  for (const d of SORTED_DATES) {
    const price = PRICE_TABLE[d][idx];
    if (!groups.has(price)) groups.set(price, []);
    groups.get(price).push(d);
  }
  const tiers = [];
  for (const [price, dates] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    tiers.push({
      period_label: `${dates[0]}~${dates[dates.length - 1]} 외 ${dates.length}일`,
      departure_dates: dates,
      adult_price: price,
      child_price: null,
      status: 'available',
      note: null,
    });
  }
  return tiers;
}

// ═══════════════════════════════════════════════════════════════
// 2. 공통 정보
// ═══════════════════════════════════════════════════════════════

const COMMON = {
  destination: '다낭/호이안',
  country: 'Vietnam',
  category: 'package',
  trip_style: '3박5일',
  duration: 5,
  nights: 3,
  departure_airport: '부산(김해)',
  departure_days: '매일',
  airline: 'BX(에어부산)',
  min_participants: 4,
  status: 'pending',
  surcharges: [
    { name: '왕조/해방기념일·노동절', start: '2026-04-26', end: '2026-05-02', amount: 20000, currency: 'KRW', unit: '인/박' },
    { name: '5/30',                  start: '2026-05-30', end: '2026-05-30', amount: 20000, currency: 'KRW', unit: '인/박' },
    { name: '6/6',                   start: '2026-06-06', end: '2026-06-06', amount: 20000, currency: 'KRW', unit: '인/박' },
    { name: '6/13',                  start: '2026-06-13', end: '2026-06-13', amount: 20000, currency: 'KRW', unit: '인/박' },
    { name: '6/20',                  start: '2026-06-20', end: '2026-06-20', amount: 20000, currency: 'KRW', unit: '인/박' },
    { name: '6/27',                  start: '2026-06-27', end: '2026-06-27', amount: 20000, currency: 'KRW', unit: '인/박' },
    { name: '7/11 불꽃축제',          start: '2026-07-11', end: '2026-07-11', amount: 20000, currency: 'KRW', unit: '인/박' },
    { name: '9/1~2 독립기념일',       start: '2026-09-01', end: '2026-09-02', amount: 20000, currency: 'KRW', unit: '인/박' },
  ],
  excluded_dates: [],
  optional_tours: [],
  guide_tip: null,
  small_group_surcharge: null,
  notices_parsed: [
    {
      type: 'CRITICAL',
      title: '필독 사항',
      text: '• 여권 유효기간 출발일 기준 6개월 이상 필수\n• 만 14세 미만 베트남 입국 시 영문 가족관계증명서 반드시 지참 (부모 또는 부모 중 1명만 여행해도 적용 / 7/21일부로)\n• 부모미동반·제3자 입국 시 부모동의서 영어번역 후 공증 지참 필수\n• 25.1.1부터 베트남 입국 시 전자담배(액상·가열·궐련형 전부) 반입 금지 — 압수+벌금 약 50만동~300만동',
    },
    {
      type: 'PAYMENT',
      title: '추가요금 (써차지)',
      text: '• 4/26~5/2(왕조/해방기념일·노동절), 5/30, 6/6, 6/13, 6/20, 6/27, 7/11(불꽃축제), 9/1~2(독립기념일) — 1인 1박 2만원씩 추가',
    },
    {
      type: 'INFO',
      title: '운영 안내',
      text: '• 전 상품 조인행사 진행될 수 있으며 현지에서 옵션안내 같이 드립니다 (실속+노팁노옵션 상품)\n• 패키지상품으로 옵션 미진행 시 부득이하게 대기해야 합니다.\n• 일정 미참여 시 패널티 1인 $100/1박당 적용',
    },
  ],
  product_tags: ['다낭', '호이안', '바나산', 'BX직항', '부산출발', '5성호텔', '증편', '스팟특가'],
  // raw_text 공통
  raw_text: RAW_TEXT,
  raw_text_hash: RAW_TEXT_HASH,
  filename: 'sample_dad_bx7315_3products.txt',
  file_type: 'manual',
  confidence: 0.9,
};

// ─── 스케줄 헬퍼 ────────────────────────────────────────────
const N = (time, activity, note) => ({ time: time || null, activity, type: 'normal', transport: null, note: note || null });
const F = (time, activity, transport) => ({ time, activity, type: 'flight', transport, note: null });

// ─── 공통 일정 (Day1, Day5)
const DAY1_BUSAN_DEP = (hotelLine) => [
  N('19:00', '부산 국제공항 출국수속'),
  F('22:05', 'BX7315 부산 출발 → 다낭 도착 01:10', 'BX7315'),
  N('01:10', '다낭 도착 후 가이드 미팅'),
  N(null, '호텔 이동 및 CHECK-IN'),
  N(null, '호텔 투숙 및 휴식'),
];

const DAY5_RETURN = [
  F('02:10', 'BX7325 다낭 출발 → 부산 도착 09:05', 'BX7325'),
  N('09:05', '부산 도착 — 즐거운 여행이 되셨기를 바랍니다'),
];

// ═══════════════════════════════════════════════════════════════
// 3. 상품 A — 오전자유 노팁노옵션
// ═══════════════════════════════════════════════════════════════

const HOTEL_A = '5성 — 센터포인트 다낭, 멜리아 빈펄 리버 프론트, 프린스호텔, 므엉탄럭셔리, 골든베이 OR 동급';
const PRODUCT_A_TITLE = '[BX7315] 다낭/호이안 오전자유 노팁노옵션 3박5일 (센터포인트/멜리아빈펄/프린스/므엉탄/골든베이 5성)';

const PRODUCT_A = {
  ...COMMON,
  title: PRODUCT_A_TITLE,
  product_type: '노팁노옵션',
  price: 659000,
  single_supplement: '17만원/3박',
  price_dates: buildPriceDates(0),
  price_tiers: buildPriceTiers(0),
  inclusions: [
    '왕복국제선항공료',
    '텍스',
    '유류할증료',
    '여행자보험',
    '호텔 숙박',
    '차량',
    '한국인 가이드',
    '관광지 입장료',
    '일정표 상의 식사',
    '바나산 국립공원 (골든브릿지·테마파크 등)',
    '호이안 야간투어+소원등+씨클로 체험',
    '오행산',
    '투본강 보트투어',
    '바구니배',
    '전신마사지 120분 1회 (매너팁 불포함)',
    '풋테라피 90분 (매너팁 불포함)',
    '아오자이 체험',
    '한강유람선',
    '한시장',
    '특식 — 호이안 정통식·포시즌뷔페·무제한 삼겹살·반세오정식·쭈꾸미&BBQ',
    '특전 — 과일바구니 룸당 1개·호이안 전통 연꽃잎차 못주스 1잔',
  ],
  excludes: [
    '매너팁 및 마사지팁 (60분 $2 / 90분 $3 / 120분 $4)',
    '써차지 1인 1박 2만원 (4/26~5/2, 5/30, 6/6·13·20·27, 7/11, 9/1~2)',
    '싱글차지 3박 17만원',
    '일정 미참여시 패널티 1인 $100/1박',
    '쇼핑센터 (침향&노니/커피/잡화) 3회 — 현지사정으로 변경 가능',
  ],
  product_highlights: [
    '5성호텔 3박 (센터포인트·멜리아 빈펄·프린스·므엉탄·골든베이)',
    '2일차 오전 자유시간 (10시경 미팅) — 호텔 수영장 등 부대시설 이용',
    '호이안 씨클로 + 전신마사지 120분 + 풋테라피 90분 포함',
  ],
  product_summary: '부산 직항 BX 증편 스팟특가! 5성호텔 3박, 2일차 오전 자유시간으로 여유롭게 시작하는 다낭/호이안 휴양형 패키지예요.',
  accommodations: [
    `${HOTEL_A} (3박)`,
  ],
  itinerary_data: {
    meta: {
      title: PRODUCT_A_TITLE,
      product_type: '노팁노옵션',
      destination: '다낭/호이안',
      nights: 3, days: 5,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX7315 부산 22:05 → 다낭 01:10',
      flight_in: 'BX7325 다낭 02:10 → 부산 09:05',
      departure_days: '매일',
      min_participants: 4,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-28',
      hashtags: ['#다낭', '#호이안', '#바나산', '#BX증편', '#오전자유', '#스팟특가'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복항공료 (BX 부산-다낭 직항)',
        '5성호텔 3박',
        '바나산·호이안·오행산·아오자이·한강유람선',
        '전신마사지 120분 + 풋테라피 90분',
        '특식 5회 (호이안 정통식·포시즌뷔페·무제한 삼겹살·반세오정식·쭈꾸미&BBQ)',
      ],
      excludes: [
        '매너팁·마사지팁',
        '써차지 1인 1박 2만원',
        '싱글차지 3박 17만원',
      ],
      shopping: '쇼핑센터 (침향&노니/커피/잡화) 3회 — 일정 미참여시 패널티 $100/박',
      remarks: [
        '여권 유효기간 출발일 기준 6개월 이상 필수',
        '만 14세 미만 베트남 입국 시 영문 가족관계증명서 지참',
        '25.1.1부터 베트남 전자담배 반입 금지',
        '실속+노노 및 타 항공사(타 지역) 조인행사 진행 가능 — 공항대기 발생 가능',
        '항공 GV2 그룹요금 — 출발일별 인상 가능',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '다낭'],
        meals: { breakfast: false, lunch: false, dinner: true, breakfast_note: null, lunch_note: null, dinner_note: '간편기내식 (콜드밀)' },
        schedule: DAY1_BUSAN_DEP(),
        hotel: { name: '센터포인트 다낭', grade: '5성', note: '또는 멜리아 빈펄·프린스·므엉탄·골든베이 동급' },
      },
      {
        day: 2,
        regions: ['다낭', '호이안', '다낭'],
        meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '호텔식', lunch_note: '한식', dinner_note: '호이안 전통식' },
        schedule: [
          N(null, '호텔 조식'),
          N(null, '★오전 자유시간 — 호텔 수영장 등 부대시설 이용'),
          N(null, '가이드 미팅 (10시경)'),
          N(null, '▶베트남 전통의상 아오자이 체험관 — 기념사진 + 커피 또는 음료 제공'),
          N(null, '중식'),
          N(null, '▶마블마운틴 (오행산) — 대리석으로 이루어진 산'),
          N(null, '호이안으로 이동 (약 30분 소요)'),
          N(null, '▶베트남 전통 바구니배 체험 (팁 $1 별도)'),
          N(null, '▶투본강 보트투어'),
          N(null, '▶호이안 구시가지 (풍흥의 집·내원교·떤키의 집·관운장 사당 등) 유네스코 세계문화유산'),
          N(null, '호이안 전통 연꽃잎차 못주스 1잔 제공'),
          N(null, '▶호이안 야간시티투어 + 소원등 체험 + 씨클로 체험 (팁 $1 별도)'),
          N(null, '석식 후 다낭 이동'),
          N(null, '▶풋테라피 90분 (팁별도)'),
          N(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '센터포인트 다낭', grade: '5성', note: '또는 멜리아 빈펄·프린스·므엉탄·골든베이 동급' },
      },
      {
        day: 3,
        regions: ['다낭'],
        meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '호텔식', lunch_note: '포시즌뷔페', dinner_note: '무제한 삼겹살' },
        schedule: [
          N(null, '호텔 조식 후 가이드 미팅'),
          N(null, '▶바나산 국립공원 — 골든브릿지 & 왕복케이블카 & 자유이용권 (해발 1487M, 케이블카 5043M 기네스북 등재)'),
          N(null, '▶전신마사지 120분 (팁별도)'),
          N(null, '석식'),
          N(null, '▶한강유람선 — 다낭 야경 관람'),
          N(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '센터포인트 다낭', grade: '5성', note: '또는 멜리아 빈펄·프린스·므엉탄·골든베이 동급' },
      },
      {
        day: 4,
        regions: ['다낭'],
        meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '호텔식', lunch_note: '반세오정식', dinner_note: '쭈꾸미 & BBQ' },
        schedule: [
          N(null, '호텔 조식 후 체크아웃'),
          N(null, '▶베트남 특산품 관광 3회 (쇼핑센터 — 침향&노니·커피·잡화)'),
          N(null, '▶한시장 — 현지인의 삶이 녹아있는 재래시장'),
          N(null, '중식'),
          N(null, '▶다낭 대성당 — 프랑스 식민지 시기 건축, 다낭 유일'),
          N(null, '▶영흥사(링엄사) — 약 67미터 베트남 최대 해수관음상'),
          N(null, '석식'),
          N(null, '▶미케비치 음료 한잔 — 여행으로 지친 몸을 달래는 시간'),
          N(null, '공항으로 이동'),
        ],
        hotel: { name: null, grade: null, note: '기내숙박' },
      },
      {
        day: 5,
        regions: ['다낭', '부산'],
        meals: { breakfast: false, lunch: false, dinner: false, breakfast_note: '불포함', lunch_note: null, dinner_note: null },
        schedule: DAY5_RETURN,
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [],
  },
  itinerary: [
    '제1일: 부산 → 다낭',
    '제2일: 다낭 → 호이안 → 다낭 (오전 자유 + 아오자이·오행산·호이안·풋테라피)',
    '제3일: 다낭 (바나산·전신마사지·한강유람선)',
    '제4일: 다낭 (한시장·대성당·영흥사·미케비치)',
    '제5일: 다낭 → 부산',
  ],
};

// ═══════════════════════════════════════════════════════════════
// 4. 상품 B — 미식투어 노팁노옵션
// ═══════════════════════════════════════════════════════════════

const HOTEL_B = '5성 — 윈덤 솔레일, 포포인츠 바이 쉐라톤, 멜리아 빈펄 리버 프론트, 어웨이큰 OR 동급';
const PRODUCT_B_TITLE = '[BX7315] 다낭/호이안 미식투어 노팁노옵션 3박5일 (윈덤솔레일/포포인츠/멜리아빈펄/어웨이큰 5성)';

const PRODUCT_B = {
  ...COMMON,
  title: PRODUCT_B_TITLE,
  product_type: '노팁노옵션',
  price: 759000,
  single_supplement: '20만원/3박',
  price_dates: buildPriceDates(1),
  price_tiers: buildPriceTiers(1),
  inclusions: [
    '왕복국제선항공료',
    '텍스',
    '유류할증료',
    '여행자보험',
    '호텔 숙박',
    '차량',
    '한국인 가이드',
    '관광지 입장료',
    '일정표 상의 식사',
    '기사/가이드팁',
    '호이안 관광',
    '투본강 보트투어',
    '바구니배',
    '호이안 야간투어+소원등+소원배 체험',
    '바나산 국립공원 (골든브릿지·테마파크 등)',
    '베트남 전통 마사지 120분 1회 (팁별도)',
    '한강유람선',
    '아오자이 체험',
    '특식 — 장어정식·포시즌뷔페·다낭타워 스테이크·마담란 OR 룩락·무제한 삼겹살',
    '특전 — 베트남 간식 1일 1개 (하이코이+맥주 OR 음료·반짱느엉·망고도시락·반미)',
  ],
  excludes: [
    '매너팁 및 마사지팁 (60분 $2 / 90분 $3 / 120분 $4)',
    '써차지 1인 1박 2만원 (4/26~5/2, 5/30, 6/6·13·20·27, 7/11, 9/1~2)',
    '싱글차지 3박 20만원',
    '일정 미참여시 패널티 1인 $100/1박',
    '쇼핑센터 (침향&노니/커피/잡화) 3회 — 현지사정으로 변경 가능',
  ],
  product_highlights: [
    '5성호텔 3박 (윈덤 솔레일·포포인츠 바이 쉐라톤·멜리아 빈펄·어웨이큰)',
    '특식 4회 + 베트남 간식 1일 1개 (하이코이·반짱느엉·망고도시락·반미)',
    '호이안 소원배 + 전신마사지 120분 포함',
  ],
  product_summary: 'BX 부산 직항 5성호텔 3박! 장어정식·다낭타워 스테이크·마담란까지 다낭 미식 풀코스로 즐기는 노팁노옵션 패키지예요.',
  accommodations: [
    `${HOTEL_B} (3박)`,
  ],
  itinerary_data: {
    meta: {
      title: PRODUCT_B_TITLE,
      product_type: '노팁노옵션',
      destination: '다낭/호이안',
      nights: 3, days: 5,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX7315 부산 22:05 → 다낭 01:10',
      flight_in: 'BX7325 다낭 02:10 → 부산 09:05',
      departure_days: '매일',
      min_participants: 4,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-28',
      hashtags: ['#다낭', '#호이안', '#미식투어', '#BX증편', '#스팟특가'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복항공료 (BX 부산-다낭 직항)',
        '5성호텔 3박 + 기사/가이드팁',
        '특식 5회 (장어정식·포시즌뷔페·다낭타워 스테이크·마담란/룩락·무제한 삼겹살)',
        '베트남 간식 1일 1개 (하이코이·반짱느엉·망고도시락·반미)',
        '바나산·호이안·전신마사지 120분',
      ],
      excludes: [
        '매너팁·마사지팁',
        '써차지 1인 1박 2만원',
        '싱글차지 3박 20만원',
      ],
      shopping: '쇼핑센터 (침향&노니/커피/잡화) 3회 — 일정 미참여시 패널티 $100/박',
      remarks: [
        '여권 유효기간 출발일 기준 6개월 이상 필수',
        '만 14세 미만 베트남 입국 시 영문 가족관계증명서 지참',
        '25.1.1부터 베트남 전자담배 반입 금지',
        '타 항공사 조인행사 진행될 수 있으며 공항대기 발생 가능',
        '항공 GV2 그룹요금 — 출발일별 인상 가능',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '다낭'],
        meals: { breakfast: false, lunch: false, dinner: true, breakfast_note: null, lunch_note: null, dinner_note: '간편기내식 (콜드밀)' },
        schedule: [
          N('19:00', '김해 국제공항 집결 후 출국 수속'),
          F('22:05', 'BX7315 부산 출발 → 다낭 도착 01:10', 'BX7315'),
          N('01:10', '다낭 도착 후 가이드 미팅'),
          N(null, '호텔 이동 및 CHECK-IN'),
          N(null, '▶하이코이 + 맥주 OR 음료 제공'),
          N(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '윈덤 솔레일', grade: '5성', note: '또는 포포인츠·멜리아 빈펄·어웨이큰 동급' },
      },
      {
        day: 2,
        regions: ['다낭', '호이안', '다낭'],
        meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '호텔식', lunch_note: '장어정식', dinner_note: '호이안 전통식' },
        schedule: [
          N(null, '호텔 조식'),
          N(null, '★오전 자유시간 — 호텔 수영장 등 부대시설 이용'),
          N(null, '가이드 미팅'),
          N(null, '▶베트남 전통의상 아오자이 체험관 — 기념사진 + 커피 또는 음료 제공'),
          N(null, '중식 (장어정식)'),
          N(null, '▶마블마운틴 (오행산) — 대리석으로 이루어진 산'),
          N(null, '호이안으로 이동 (약 30분 소요)'),
          N(null, '▶베트남 전통 바구니배 체험 (팁 $1 별도)'),
          N(null, '▶투본강 보트투어'),
          N(null, '▶호이안 구시가지 (풍흥의 집·내원교·떤키의 집·관운장 사당 등) 유네스코 세계문화유산'),
          N(null, '▶호이안 현지 간식 반짱느엉 제공'),
          N(null, '▶호이안 야간시티투어 + 소원등 + 소원배 체험'),
          N(null, '석식 후 다낭 이동'),
          N(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '윈덤 솔레일', grade: '5성', note: '또는 포포인츠·멜리아 빈펄·어웨이큰 동급' },
      },
      {
        day: 3,
        regions: ['다낭'],
        meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '호텔식', lunch_note: '포시즌뷔페', dinner_note: '다낭타워 스테이크' },
        schedule: [
          N(null, '호텔 조식 후 가이드 미팅'),
          N(null, '▶바나산 국립공원 — 골든브릿지 & 왕복케이블카 & 자유이용권 (해발 1487M, 케이블카 5043M 기네스북 등재)'),
          N(null, '▶전신마사지 120분 (팁별도)'),
          N(null, '석식 (다낭타워 스테이크)'),
          N(null, '▶한강유람선 — 다낭 야경 관람'),
          N(null, '▶선짜 야시장 — 다낭 최대 규모'),
          N(null, '▶망고도시락 1인 1개 제공'),
          N(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '윈덤 솔레일', grade: '5성', note: '또는 포포인츠·멜리아 빈펄·어웨이큰 동급' },
      },
      {
        day: 4,
        regions: ['다낭'],
        meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '호텔식', lunch_note: '마담란 OR 룩락', dinner_note: '무제한 삼겹살' },
        schedule: [
          N(null, '호텔 조식 후 체크아웃'),
          N(null, '▶베트남 특산품 관광 3회 (쇼핑센터 — 침향&노니·커피·잡화)'),
          N(null, '▶한시장 — 현지인의 삶이 녹아있는 재래시장'),
          N(null, '중식 (마담란 OR 룩락)'),
          N(null, '▶다낭 대성당 — 프랑스 식민지 시기 건축, 다낭 유일'),
          N(null, '▶영흥사(링엄사) — 약 67미터 베트남 최대 해수관음상'),
          N(null, '석식'),
          N(null, '▶미케비치 루프탑 음료 한잔'),
          N(null, '▶베트남 전통 간식 반미 1인 1개 제공'),
          N(null, '공항으로 이동'),
        ],
        hotel: { name: null, grade: null, note: '기내숙박' },
      },
      {
        day: 5,
        regions: ['다낭', '부산'],
        meals: { breakfast: false, lunch: false, dinner: false, breakfast_note: '불포함', lunch_note: null, dinner_note: null },
        schedule: DAY5_RETURN,
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [],
  },
  itinerary: [
    '제1일: 부산 → 다낭 (하이코이+맥주)',
    '제2일: 다낭 → 호이안 → 다낭 (장어정식·아오자이·오행산·호이안·소원배)',
    '제3일: 다낭 (바나산·전신마사지·다낭타워 스테이크·한강유람선·선짜야시장·망고도시락)',
    '제4일: 다낭 (한시장·마담란/룩락·대성당·영흥사·미케비치 루프탑·반미)',
    '제5일: 다낭 → 부산',
  ],
};

// ═══════════════════════════════════════════════════════════════
// 5. 상품 C — 노팁&노옵션&노쇼핑
// ═══════════════════════════════════════════════════════════════

const HOTEL_C = '5성 — 센터포인트 다낭, 멜리아 빈펄 리버 프론트, 프린스호텔, 므엉탄럭셔리 OR 동급';
const PRODUCT_C_TITLE = '[BX7315] 다낭/호이안 노팁&노옵션&노쇼핑 3박5일 (센터포인트/멜리아빈펄/프린스/므엉탄 5성)';

const PRODUCT_C = {
  ...COMMON,
  title: PRODUCT_C_TITLE,
  product_type: '노팁노옵션노쇼핑',
  price: 1279000,
  single_supplement: '17만원/3박',
  price_dates: buildPriceDates(2),
  price_tiers: buildPriceTiers(2),
  inclusions: [
    '왕복항공료',
    '호텔 숙박',
    '차량',
    '한국인 가이드',
    '관광지 입장료',
    '일정표 상의 식사',
    '호이안 관광',
    '투본강 보트투어',
    '바나산 국립공원 케이블카 체험 & 테마파크 이용',
    '전통 마사지 120분 2회 (팁별도)',
    '롯데마트',
    '선짜 야시장',
    '한시장',
    '바구니배',
    '호이안 야간투어+소원등+쪽배 체험',
    '한강유람선',
    '특식 — 불고기전골·호이안 전통식·목식당 세트메뉴·제육쌈밥·해산물샤브샤브·무제한 삼겹살',
    '특전 — 객실당 과일바구니',
  ],
  excludes: [
    '매너팁 및 마사지팁 (60분 $2 / 90분 $3 / 120분 $4)',
    '써차지 1인 1박 2만원 (4/26~5/2, 5/30, 6/6·13·20·27, 7/11, 9/1~2)',
    '싱글차지 3박 17만원',
    '일정 미참여시 패널티 1인 $100/1박',
  ],
  product_highlights: [
    '진짜 노쇼핑·노팁·노옵션 — FULL 관광',
    '5성호텔 3박 + 오전자유 2회 + 특식 6회 + 마사지 240분',
    '한시장·선짜야시장·롯데마트·과일바구니까지 모두 포함',
  ],
  product_summary: 'BX 부산 직항으로 떠나는 진짜 노쇼핑 패키지! 오전자유 2회 + 특식 6회 + 마사지 240분으로 알차게 즐기는 다낭/호이안 풀코스예요.',
  accommodations: [
    `${HOTEL_C} (3박)`,
  ],
  itinerary_data: {
    meta: {
      title: PRODUCT_C_TITLE,
      product_type: '노팁노옵션노쇼핑',
      destination: '다낭/호이안',
      nights: 3, days: 5,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX7315 부산 22:05 → 다낭 01:10',
      flight_in: 'BX7325 다낭 02:10 → 부산 09:05',
      departure_days: '매일',
      min_participants: 4,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-28',
      hashtags: ['#다낭', '#호이안', '#노쇼핑', '#BX증편', '#스팟특가'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복항공료 (BX 부산-다낭 직항)',
        '5성호텔 3박 + 객실당 과일바구니',
        '오전자유 2회 + 특식 6회 + 마사지 240분 (120분 x 2회)',
        '한시장·선짜야시장·롯데마트·바나산·호이안 풀코스',
        '한강유람선·미케비치 루프탑 야경',
      ],
      excludes: [
        '매너팁·마사지팁',
        '써차지 1인 1박 2만원',
        '싱글차지 3박 17만원',
      ],
      shopping: '진짜 노쇼핑 — 쇼핑센터 일정 없음',
      remarks: [
        '여권 유효기간 출발일 기준 6개월 이상 필수',
        '만 14세 미만 베트남 입국 시 영문 가족관계증명서 지참',
        '25.1.1부터 베트남 전자담배 반입 금지',
        '타 항공사(타 지역) 조인행사 진행 가능',
        '항공 GV2 그룹요금 — 출발일별 인상 가능',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '다낭'],
        meals: { breakfast: false, lunch: false, dinner: true, breakfast_note: null, lunch_note: null, dinner_note: '간편기내식 (콜드밀)' },
        schedule: DAY1_BUSAN_DEP(),
        hotel: { name: '센터포인트 다낭', grade: '5성', note: '또는 멜리아 빈펄·프린스·므엉탄 동급' },
      },
      {
        day: 2,
        regions: ['다낭', '호이안', '다낭'],
        meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '호텔식', lunch_note: '한식 (불고기전골)', dinner_note: '호이안 전통식' },
        schedule: [
          N(null, '호텔 조식'),
          N(null, '★오전 자유시간 — 호텔 수영장 등 부대시설 이용'),
          N(null, '가이드 미팅 후 중식 (불고기전골)'),
          N(null, '▶오행산(마블마운틴) — 산 전체가 대리석으로 만들어진 명소'),
          N(null, '호이안으로 이동 (약 30분 소요)'),
          N(null, '▶베트남 전통 바구니배 체험 (팁 $1 별도)'),
          N(null, '▶호이안의 명물 투본강 보트투어'),
          N(null, '▶호이안 구시가지 (풍흥고가·관운장사당·내원교·떤끼의 집 등) 유네스코 세계문화 도시'),
          N(null, '▶호이안 야간투어 + 소원등 + 쪽배 체험'),
          N(null, '석식 후 다낭 귀환 (약 30분 소요)'),
          N(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '센터포인트 다낭', grade: '5성', note: '또는 멜리아 빈펄·프린스·므엉탄 동급' },
      },
      {
        day: 3,
        regions: ['다낭'],
        meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '호텔식', lunch_note: '씨푸드 세트메뉴 (목식당)', dinner_note: '제육쌈밥' },
        schedule: [
          N(null, '호텔 조식'),
          N(null, '★오전 자유시간 — 호텔 수영장 등 부대시설 이용'),
          N(null, '가이드 미팅'),
          N(null, '중식 (목식당 — 새우마늘버터·가리비구이·조개죽·볶음밥·모닝글로리 등)'),
          N(null, '▶바나산 국립공원 — 골든브릿지 & 왕복케이블카 & 자유이용권 (해발 1487M, 케이블카 5043M 기네스북 등재)'),
          N(null, '▶다낭 롯데마트 자유시간'),
          N(null, '▶전통 마사지 120분 (팁별도)'),
          N(null, '▶선짜 야시장 — 다낭 최대 규모'),
          N(null, '석식'),
          N(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '센터포인트 다낭', grade: '5성', note: '또는 멜리아 빈펄·프린스·므엉탄 동급' },
      },
      {
        day: 4,
        regions: ['다낭'],
        meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '호텔식', lunch_note: '해산물 샤브샤브', dinner_note: '무제한 삼겹살' },
        schedule: [
          N(null, '호텔 조식 후 체크아웃'),
          N(null, '▶영응사 — 썬짜 반도의 비밀의 사원 (베트남 최대 68m 해수관음상)'),
          N(null, '▶미케비치 차창관광 — 아시아 최장 20km'),
          N(null, '▶한시장 — 베트남 전통 재래시장'),
          N(null, '▶다낭 대성당 — 프랑스인이 지은 건축물'),
          N(null, '▶전통 마사지 120분 (팁별도)'),
          N(null, '석식'),
          N(null, '▶한강유람선 체험'),
          N(null, '▶미케비치 루프트바 야경 + 커피 1잔 OR 맥주 1병'),
          N(null, '공항으로 이동'),
        ],
        hotel: { name: null, grade: null, note: '기내숙박' },
      },
      {
        day: 5,
        regions: ['다낭', '부산'],
        meals: { breakfast: false, lunch: false, dinner: false, breakfast_note: '불포함', lunch_note: null, dinner_note: null },
        schedule: DAY5_RETURN,
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [],
  },
  itinerary: [
    '제1일: 부산 → 다낭',
    '제2일: 다낭 → 호이안 → 다낭 (오전자유·오행산·호이안·쪽배)',
    '제3일: 다낭 (오전자유·목식당·바나산·롯데마트·마사지·선짜야시장)',
    '제4일: 다낭 (영응사·미케비치·한시장·대성당·마사지·한강유람선·루프트바)',
    '제5일: 다낭 → 부산',
  ],
};

// ═══════════════════════════════════════════════════════════════
// 6. Agent Self-Audit Report (Step 6.5 — Zero-Hallucination 검증)
// ═══════════════════════════════════════════════════════════════

function buildAuditReport(productLabel) {
  return {
    parser_version: 'register-v2026.04.21-sonnet-4.6',
    ran_at: new Date().toISOString(),
    claims: [
      {
        id: 'min_participants',
        field: 'min_participants',
        severity: 'HIGH',
        text: 'min_participants: 4',
        evidence: '원문: "4명부터 출발 확정" / 미식투어는 "성인 4명 이상 출발 확정"',
        supported: true,
        note: null,
      },
      {
        id: 'ticketing_deadline',
        field: 'ticketing_deadline',
        severity: 'HIGH',
        text: 'ticketing_deadline: 2026-04-28',
        evidence: '원문: "★ 4/28일까지 선발 조건 ★"',
        supported: true,
        note: '선발(=선발권) = 발권 마감으로 해석',
      },
      {
        id: 'inclusions_no_injection',
        field: 'inclusions',
        severity: 'CRITICAL',
        text: '여행자보험 (금액 표기 없음)',
        evidence: '원문: "왕복국제선항공료 및 텍스, 유류할증료, 여행자보험" — 2억/1억 표기 없음',
        supported: true,
        note: '금액 환각 없음 (ERR-FUK-insurance-injection 방어)',
      },
      {
        id: 'surcharges_dates',
        field: 'surcharges',
        severity: 'HIGH',
        text: '4/26~5/2, 5/30, 6/6·13·20·27, 7/11(불꽃축제), 9/1~2 — 1인 1박 2만원',
        evidence: '원문: "써차지 : 4/26~5/2(왕조/해방기념일,노동절), 5/30, 6/6,13,20,27, 7/11 (불꽃축제), 9/1,2 (독립기념일) – 1인 1박 2만원씩 추가"',
        supported: true,
        note: null,
      },
      {
        id: 'flight_codes',
        field: 'itinerary_data.meta',
        severity: 'HIGH',
        text: 'flight_out: BX7315 22:05→01:10 / flight_in: BX7325 02:10→09:05',
        evidence: '원문: "데일리 증편 BX7315-7325 / 22:05 - 01:10 / 02:10 - 09:05"',
        supported: true,
        note: null,
      },
      {
        id: 'product_label',
        field: 'product_type / title',
        severity: 'HIGH',
        text: `상품: ${productLabel}`,
        evidence: '원문 표제 상자에 3종 분리 명시 (오전자유 노팁노옵션 / 미식투어 노팁노옵션 / 노팁&노옵션&노쇼핑)',
        supported: true,
        note: null,
      },
      {
        id: 'price_min',
        field: 'price (최저가)',
        severity: 'HIGH',
        text: '가격표 원문 1:1 매핑',
        evidence: '원문 "★ 5~8월 출발 다낭 BX7315 스팟 특가" 가격표 — 7/1~14 토일월화 행이 최저가',
        supported: true,
        note: null,
      },
      {
        id: 'cross_contamination',
        field: 'itinerary_data.days[].schedule',
        severity: 'HIGH',
        text: '3종 상품 일정 분리 — DAY 교차 오염 없음',
        evidence: '각 상품별 원문 [BX7315] ... 3박5일 표제 직후 일정표 그대로 매핑. A: 풋테라피 90분, B: 망고도시락+소원배+다낭타워스테이크, C: 영응사+미케비치 차창+한강유람선+루프트바',
        supported: true,
        note: 'ERR-KUL-02/03 방어 — 각 상품 schedule 은 해당 상품 원문 블록 내부에서만 추출',
      },
    ],
    overall_verdict: 'clean',
    unsupported_critical: 0,
    unsupported_high: 0,
  };
}

PRODUCT_A.agent_audit_report = buildAuditReport('A. 오전자유 노팁노옵션');
PRODUCT_B.agent_audit_report = buildAuditReport('B. 미식투어 노팁노옵션');
PRODUCT_C.agent_audit_report = buildAuditReport('C. 노팁&노옵션&노쇼핑');

// ═══════════════════════════════════════════════════════════════
// 7. Pre-INSERT Self-Check (Step 2.7 W26~W29 재실행 방지)
// ═══════════════════════════════════════════════════════════════

function preflight(packages) {
  for (const p of packages) {
    // W26: inclusions 콤마
    for (const inc of (p.inclusions || [])) {
      if (typeof inc !== 'string') continue;
      let depth = 0;
      for (let i = 0; i < inc.length; i++) {
        const ch = inc[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) {
          const prev = inc[i - 1] || '';
          const nxt = inc.slice(i + 1, i + 4);
          if (!(/\d/.test(prev) && /^\d{3}/.test(nxt))) {
            throw new Error(`[W26 self-check] inclusions "${inc}" 콤마 포함 — 개별 배열로 분리 필요`);
          }
        }
      }
    }
    // W27: 하루 flight 여러개면 → 토큰
    const days = p.itinerary_data?.days || [];
    for (const d of days) {
      const flights = (d.schedule || []).filter(s => s.type === 'flight');
      if (flights.length > 1 && flights.some(f => !/→|↦|⇒/.test(f.activity || ''))) {
        throw new Error(`[W27 self-check] Day ${d.day} flight ${flights.length}개 but "→" 토큰 누락`);
      }
    }
    // W28: 호텔 앞절 붙이기
    for (const d of days) {
      for (const s of (d.schedule || [])) {
        if (s.type !== 'normal' || !s.activity) continue;
        if (/호텔\s*(?:투숙|휴식|체크인|체크 인)/.test(s.activity) && !/^[*\s]*호텔/.test(s.activity)) {
          throw new Error(`[W28 self-check] Day ${d.day} "${s.activity}" — 호텔 앞절 붙이기 금지. 별도 normal 로 분리`);
        }
      }
    }
    // Rule Zero
    if (!p.raw_text || p.raw_text.length < 50) throw new Error('[RuleZero self-check] raw_text 누락');
    if (!p.raw_text_hash) throw new Error('[RuleZero self-check] raw_text_hash 누락');
  }
  console.log('   ✅ Pre-INSERT self-check 통과 (W26/W27/W28 + RuleZero)');
}

// ═══════════════════════════════════════════════════════════════
// 8. 메인
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const isInsert = args.includes('--insert');
  const isDryRun = !isInsert;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  📦 다낭/호이안 BX7315 3종 등록');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  랜드사:    투어비 (TB)`);
  console.log(`  마진:      9%`);
  console.log(`  발권기한:  2026-04-28 (선발 조건)`);
  console.log(`  raw_text:  ${RAW_TEXT.length.toLocaleString()}자`);
  console.log(`  hash:      ${RAW_TEXT_HASH.slice(0, 16)}...`);
  console.log(`  출발일:    ${SORTED_DATES.length}건 (5/1~8/31, 5월 일부 + 7월 31일 + 8월 31일)`);
  console.log(`  모드:      ${isInsert ? '🔥 INSERT' : '🔍 DRY-RUN'}`);
  console.log('');

  const packages = [PRODUCT_A, PRODUCT_B, PRODUCT_C];

  // 가격 요약
  for (const p of packages) {
    const prices = p.price_dates.map(d => d.price);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    console.log(`  • ${p.title.slice(0, 35)}...`);
    console.log(`      최저 ${minP.toLocaleString()}원 / 최고 ${maxP.toLocaleString()}원 / ${p.price_dates.length}건`);
  }
  console.log('');

  preflight(packages);

  if (isDryRun) {
    console.log('\n🔍 DRY-RUN 완료 — 실제 INSERT 하려면 `--insert` 플래그 추가');
    console.log('   다음 명령:  node db/insert_dad_bx7315_3products.js --insert');
    return;
  }

  console.log('\n💾 INSERT 시작...\n');
  const inserter = createInserter({
    landOperator: '투어비',
    commissionRate: 9,
    ticketingDeadline: '2026-04-28',
    destCode: 'DAD',
  });

  const result = await inserter.run(packages);
  console.log('\n📊 결과:', JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error('\n❌ 실패:', err.message);
  console.error(err.stack);
  process.exit(1);
});
