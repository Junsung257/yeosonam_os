/**
 * 랜드부산 / 다낭·호이안 BX 노팁노옵션 3박5일 (다낭 프린스호텔 5성급)
 *   - 랜드사: 랜드부산 (LB) / 마진율: 10% / 발권기한: null (4.15는 배포일이지 발권기한 아님 — ERR-date-confusion)
 *   - 항공: BX 김해 직항 (정규 BX773/774, 증편 BX7315/7325)
 *   - 호텔: 다낭 프린스호텔(구 셀드메르) 5성 또는 동급
 *   - 출발: 매일 / 6명 이상 출발 / 수목금 vs 토일월화 가격 분리
 *   - 출발확정: 4/28(스팟특가), 7/6, 7/13, 8/17, 8/23 (모두 증편)
 *
 * ⚠️ 원문 모순:
 *   - 헤더는 "노팁/노옵션/노쇼핑" 표방
 *   - 비고에는 "쇼핑샵 일정 불참 시 패널티 $150/인" / 불포함에 "매너팁" 명시
 *   - 보수적으로 product_type='노팁노옵션'. raw_text에 원문 모순 그대로 보존.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createInserter } = require('./templates/insert-template');

// ── 원문 (불변 보존, Rule Zero) ───────────────────────────────────
const RAW_TEXT = fs.readFileSync(path.join(__dirname, 'sample.txt'), 'utf-8');
const RAW_TEXT_HASH = crypto.createHash('sha256').update(RAW_TEXT).digest('hex');

const inserter = createInserter({
  landOperator: '랜드부산',
  commissionRate: 10,
  ticketingDeadline: null,
  destCode: 'DAD',
});
const { helpers: { flight, normal, optional, shopping, train, meal }, tiersToDatePrices } = inserter;

// ── 가격표 ────────────────────────────────────────────────────────
// 그룹 A = 수,목,금 / 그룹 B = 토,일,월,화
const PRICING = [
  { start: '2026-04-01', end: '2026-04-30', label: '4/1~4/30',   A: 1309000, B: 1269000 },
  { start: '2026-05-01', end: '2026-06-30', label: '5/1~6/30',   A: 1219000, B: 1179000 },
  { start: '2026-07-01', end: '2026-07-14', label: '7/1~7/14',   A: 1129000, B: 1099000, surge: true },
  { start: '2026-07-15', end: '2026-07-22', label: '7/15~7/22',  A: 1199000, B: 1159000, surge: true },
  { start: '2026-07-23', end: '2026-07-29', label: '7/23~7/29',  A: 1349000, B: 1349000, surge: true },
  { start: '2026-07-30', end: '2026-08-07', label: '7/30~8/7',   A: 1299000, B: 1299000, surge: true },
  { start: '2026-08-08', end: '2026-08-15', label: '8/8~8/15',   A: 1229000, B: 1199000, surge: true },
  { start: '2026-08-16', end: '2026-08-29', label: '8/16~8/29',  A: 1199000, B: 1159000, surge: true },
  { start: '2026-08-30', end: '2026-09-12', label: '8/30~9/12',  A: 1219000, B: 1179000 },
  { start: '2026-09-13', end: '2026-09-30', label: '9/13~9/30',  A: 1179000, B: 1129000 },
  { start: '2026-10-01', end: '2026-10-21', label: '10/1~10/21', A: 1269000, B: 1219000 },
];

const DOW_GROUP_A = ['수', '목', '금'];           // 수목금
const DOW_GROUP_B = ['토', '일', '월', '화'];     // 토일월화

// 항공제외일 (원문 ●항공제외일)
const EXCLUDED_DATES = [
  '2026-04-29','2026-04-30','2026-05-01','2026-05-02',
  '2026-05-20','2026-05-21','2026-05-22','2026-05-23',
  '2026-05-30',
  '2026-06-02','2026-06-03',
  '2026-07-15','2026-07-16','2026-07-17',
  '2026-07-29','2026-07-30','2026-07-31','2026-08-01',
  '2026-08-12','2026-08-13','2026-08-14','2026-08-15',
  '2026-09-22','2026-09-23','2026-09-24','2026-09-25',
  '2026-09-30',
  '2026-10-01','2026-10-02','2026-10-03',
  '2026-10-07','2026-10-08','2026-10-09',
];

// 출발확정 (스팟특가 + 증편 출확)
const CONFIRMED_DATES = new Set([
  '2026-04-28', // 스팟특가 (6명부터, 출발확정)
  '2026-07-06', // 증편 출확
  '2026-07-13', // 증편 출확
  '2026-08-17', // 증편 출확
  '2026-08-23', // 증편 출확
]);

// 4/28 스팟특가는 정규 가격(1,269,000)이 아닌 1,099,000으로 별도 처리 → 정규에서 제외
const SPECIAL_PRICE_OVERRIDE = {
  '2026-04-28': { price: 1099000, note: '스팟특가/출발확정/6명부터' },
};

// ── price_tiers 빌드 ─────────────────────────────────────────────
function buildTiers() {
  const tiers = [];

  // 1) 정규 기간 × 요일 그룹 tier
  for (const period of PRICING) {
    for (const dow of DOW_GROUP_A) {
      tiers.push({
        period_label: `${period.label} ${dow}요일${period.surge ? ' (증편)' : ''}`,
        date_range: { start: period.start, end: period.end },
        departure_day_of_week: dow,
        adult_price: period.A,
        child_price: null,
        status: 'available',
        note: period.surge ? '증편' : null,
      });
    }
    for (const dow of DOW_GROUP_B) {
      tiers.push({
        period_label: `${period.label} ${dow}요일${period.surge ? ' (증편)' : ''}`,
        date_range: { start: period.start, end: period.end },
        departure_day_of_week: dow,
        adult_price: period.B,
        child_price: null,
        status: 'available',
        note: period.surge ? '증편' : null,
      });
    }
  }

  // 2) 스팟특가 단일 날짜 (4/28)
  tiers.push({
    period_label: '4/28 스팟특가 (출발확정/6명부터)',
    departure_dates: ['2026-04-28'],
    adult_price: 1099000,
    child_price: null,
    status: 'confirmed',
    note: '스팟특가/출발확정/6명부터',
  });

  return tiers;
}

// ── price_dates 빌드 (excluded + confirmed + override 처리) ──────
function buildPriceDates(tiers) {
  const DOW_MAP = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
  const excluded = new Set(EXCLUDED_DATES);
  const overrideDates = new Set(Object.keys(SPECIAL_PRICE_OVERRIDE));
  const seen = new Set();
  const result = [];

  for (const tier of tiers) {
    const dates = [];
    if (tier.date_range && tier.departure_day_of_week) {
      const dow = DOW_MAP[tier.departure_day_of_week];
      const [sy, sm, sd] = tier.date_range.start.split('-').map(Number);
      const [ey, em, ed] = tier.date_range.end.split('-').map(Number);
      const c = new Date(sy, sm - 1, sd);
      const end = new Date(ey, em - 1, ed);
      while (c <= end) {
        if (c.getDay() === dow) {
          const iso = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
          // 항공제외일 + 별도 override(4/28 스팟특가) 둘 다 정규에서 제외
          if (!excluded.has(iso) && !overrideDates.has(iso)) {
            dates.push(iso);
          }
        }
        c.setDate(c.getDate() + 1);
      }
    }
    if (tier.departure_dates?.length) {
      for (const d of tier.departure_dates) {
        if (!excluded.has(d)) dates.push(d);
      }
    }
    const isConfirmedTier = tier.status === 'confirmed' || /출확|출발확정/.test(tier.note || '');
    for (const d of dates) {
      if (!d || seen.has(d)) continue;
      seen.add(d);
      result.push({
        date: d,
        price: tier.adult_price,
        confirmed: isConfirmedTier || CONFIRMED_DATES.has(d),
      });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

const TIERS = buildTiers();
const PRICE_DATES = buildPriceDates(TIERS);
const MIN_PRICE = Math.min(...PRICE_DATES.map(p => p.price));

// ── 일정 ──────────────────────────────────────────────────────────
const HOTEL = { name: '다낭 프린스호텔 (구 셀드메르 호텔)', grade: '5성', note: '또는 동급' };

const ITINERARY_DAYS = [
  {
    day: 1,
    regions: ['부산', '다낭'],
    meals: meal(false, false, false, null, null, null),
    schedule: [
      normal(null, '출발 2시간 전 김해공항 국제선 1층에서 미팅 후 수속'),
      flight('20:50', 'BX773 김해국제공항 출발 → 다낭국제공항 23:50 도착 (증편: BX7315 22:05 출발 → 01:10 도착)', 'BX773'),
      normal(null, '다낭 공항 도착 후 현지가이드 미팅하여 호텔로 이동'),
      normal(null, '호텔 투숙 및 휴식'),
    ],
    hotel: HOTEL,
  },
  {
    day: 2,
    regions: ['다낭', '호이안', '다낭'],
    meals: meal(true, true, true, '호텔식', '샤브샤브', '호이안가정식'),
    schedule: [
      normal(null, '호텔 조식 후 오전 자유시간 (11시 내외)'),
      normal(null, '여행의 피로를 풀어주는 핫스톤 마사지 90분', '팁별도/아동제외'),
      normal(null, '▶마블마운틴 (대리석산) 관광'),
      normal(null, '▶베트남 전통 바구니배 \'튄퉁\' 체험', '팁별도'),
      normal(null, '호이안으로 이동 (약 30분)'),
      normal(null, '▶호이안 구시가지 (풍흥의 집, 일본내원교, 떤키의 집, 관운장사당 등) 유네스코 지정 전통거리 관광'),
      normal(null, '호이안 특산 못주스 1잔 제공'),
      normal(null, '▶베트남 전통 인력거 씨클로 체험', '팁별도'),
      normal(null, '▶호이안 야경 감상 + 야시장 자유시간 (빛의 도시)'),
      normal(null, '호텔 투숙 및 휴식'),
    ],
    hotel: HOTEL,
  },
  {
    day: 3,
    regions: ['다낭'],
    meals: meal(true, true, true, '호텔식', '퓨전뷔페 (한식+현지식)', '무제한삼겹살'),
    schedule: [
      normal(null, '호텔 조식 후 이동'),
      normal(null, '▶바나산 국립공원 (케이블카, 골든브릿지, 테마파크 등)'),
      normal(null, '▶세계 6대 비치 중 하나인 미케 비치 산책'),
      normal(null, '베트남 전통 핫스톤 마사지 90분 체험', '팁별도/아동제외'),
      normal(null, '호텔 투숙 및 휴식'),
    ],
    hotel: HOTEL,
  },
  {
    day: 4,
    regions: ['다낭'],
    meals: meal(true, true, true, '호텔식', '분짜+반쎄오', '노니보쌈+우렁된장'),
    schedule: [
      normal(null, '호텔 조식 후 체크아웃'),
      shopping(null, '쇼핑 관광', '쇼핑샵 일정 불참 시 패널티 $150/인'),
      normal(null, '▶영응사 (베트남 최대 불상 해수관음상) 관광'),
      normal(null, '▶APEC 조각공원'),
      normal(null, '▶다낭대성당 (프랑스 식민지배 시설, 다낭 유일 건축)'),
      normal(null, '베트남 전통 커피숍에서 커피 또는 생과일 주스 제공'),
      normal(null, '▶다낭 한강크루즈 체험 (다낭 야경 감상)'),
      normal(null, '다낭 공항으로 이동'),
    ],
    hotel: { name: null, grade: null, note: '기내숙박' },
  },
  {
    day: 5,
    regions: ['다낭', '부산'],
    meals: meal(false, false, false, null, null, null),
    schedule: [
      flight('00:45', 'BX774 다낭국제공항 출발 → 김해국제공항 07:20 도착 (증편: BX7325 02:10 출발 → 09:05 도착)', 'BX774'),
    ],
    hotel: { name: null, grade: null, note: null },
  },
];

// ── 포함/불포함 (원문 그대로) ─────────────────────────────────────
const INCLUSIONS = [
  '왕복 항공료',
  '숙박료',
  '식사',
  '관광지 입장료',
  '전용차량',
  '기사/가이드',
  '여행자보험',
];
const EXCLUDES = [
  '유류할증료 변동분 (4월 발권 기준)',
  '개인경비',
  '매너팁',
  '써차지 및 가라디너',
];

// ── 비고 (원문 보존, 4-type 구조화) ──────────────────────────────
const NOTICES_PARSED = [
  {
    type: 'CRITICAL',
    title: '본 상품 필수 안내',
    text: '• 6명 이상 출발 가능 (4명 이하 시 현지가이드 행사 진행될 수 있음)\n' +
          '• 항공은 GV2 기준이며, 2인 이상 발권 후 GV 깨질 시 전체 인원 취소수수료 발생\n' +
          '• 본 행사는 패키지 행사로 관광지·식사 등 행사에 빠질 경우 환불 불가\n' +
          '• 여권은 출발일 기준 만료일 6개월 이상 남아 있어야 함\n' +
          '• 만 15세 미만 아동은 베트남 입국 시 부모 동반 시에도 가족관계증명서 영문본 지참 필수\n' +
          '• 2025년 1월 1일부터 베트남 전자담배가 금지품목 대상에 포함 (전자담배, 가열담배-아이코스, 힛츠제품)\n' +
          '• 본 행사는 쇼핑샵이 들어가는 패키지 일정으로 쇼핑샵 일정 불참 시 패널티 $150/인 발생',
  },
  {
    type: 'PAYMENT',
    title: '취소 수수료 [특별약관 적용]',
    text: '• 예약 후 취소 시: 1인 200,000원 공제 후 환불\n' +
          '• 출발일 14일 ~ 7일 전까지: 총 금액의 40% 공제 후 환불\n' +
          '• 출발일 7일 ~ 4일 전까지: 총 금액의 60% 공제 후 환불\n' +
          '• 출발일 4일 ~ 2일 전까지: 총 금액의 80% 공제 후 환불\n' +
          '• 출발일 1일 ~ 당일: 100% 환불 불가\n' +
          '• 파이널 후 취소 불가\n' +
          '※ 취소 문의는 평일 09~18시까지 가능 (공휴일·토·일 미처리, 18시 이후는 익일 계산)',
  },
  {
    type: 'POLICY',
    title: '가이드/룸/싱글차지 안내',
    text: '• 베트남 한국인 가이드 단속 강화로 현지인 가이드가 공항 미팅·샌딩 진행\n' +
          '• 한국인 가이드는 현지 사정에 따라 공항 외부 또는 호텔에서 미팅\n' +
          '• 룸타입: 2인 1실 기준\n' +
          '• 2인실 1명 사용 시 싱글차지 $150/인 발생\n' +
          '• 호텔/리조트 예약 시 날짜별 써차지 체크 필요',
  },
  {
    type: 'INFO',
    title: '식사·결제 안내',
    text: '• 특식 6회: 노니보쌈, 호이안가정식, 퓨전뷔페(한식+현지식), 샤브샤브, 반쎄오, 무제한삼겹살\n' +
          '• 예약금 입금 확인 후 확정 진행\n' +
          '• 출발 1주일 전 완납 (특가 상품은 2주 전 완납)\n' +
          '• 파이널 확정 금액은 파이널 확인 날짜까지 100% 입금 필요\n' +
          '• 현금영수증: 항공요금(항공사) + 행사비(랜드사)로 분할 발급 / 행사 완료 후 5일 이내만 발급 가능',
  },
];

// ── 주의사항 (string[], A4 비고 섹션) ────────────────────────────
const REMARKS = [
  '특식 6회 — 노니보쌈, 호이안가정식, 퓨전뷔페(한식+현지식), 샤브샤브, 반쎄오, 무제한삼겹살',
  '2인실 1명 사용 시 싱글차지 $150/인 발생',
  '베트남 한국인 가이드 단속 강화로 현지인 가이드가 공항 미팅 및 샌딩 진행',
  '한국인 가이드는 현지 사정에 따라 공항 외부 또는 호텔에서 미팅',
  '본 행사는 패키지 행사로 관광지·식사 등 행사에 빠질 경우 환불 불가',
  '4명 이하 행사 시 현지가이드 행사 진행될 수 있음',
  '항공은 GV2 기준이며, 2인 이상 발권 후 GV 깨질 시 전체 인원 취소수수료 발생',
  '여권 만료일 출발일 기준 6개월 이상 필수',
  '만 15세 미만 아동 베트남 입국 시 가족관계증명서 영문본 지참 필수 (부모 동반 시에도)',
  '2025년 1월 1일부터 베트남 전자담배 금지 (전자담배, 가열담배-아이코스, 힛츠제품)',
  '쇼핑샵 일정 불참 시 패널티 $150/인 발생',
  '항공 그룹요금은 예약 시 출발일별 인상 가능 (예약 시 날짜별 상품가 재확인 필요)',
];

// ── 패키지 정의 ───────────────────────────────────────────────────
const PKG = {
  title: '[BX] 다낭/호이안 특급호텔 노팁노옵션 + 6대특식 3박5일 (다낭 프린스호텔 5성)',
  destination: '다낭/호이안',
  country: '베트남',
  category: 'package',
  product_type: '노팁노옵션',
  trip_style: '3박5일',
  duration: 5,
  nights: 3,
  departure_airport: '부산(김해)',
  departure_days: '매일',
  airline: 'BX(에어부산)',
  min_participants: 6,
  status: 'pending',
  price: MIN_PRICE,
  guide_tip: null,
  single_supplement: '$150/인',
  small_group_surcharge: null,
  surcharges: [], // 원문 구체 금액/기간 surcharge 없음 (호텔 써차지는 일반 고지만)
  excluded_dates: EXCLUDED_DATES,
  optional_tours: [], // 일정 내 마사지/바구니배/씨클로는 포함 활동 (팁만 별도) — 옵션 아님
  price_tiers: TIERS,
  price_dates: PRICE_DATES,
  inclusions: INCLUSIONS,
  excludes: EXCLUDES,
  notices_parsed: NOTICES_PARSED,
  special_notes: null, // 내부 메모 없음 (FIELD_POLICY 준수)
  product_highlights: [
    'BX 김해 직항 + 다낭 프린스호텔 5성급 3박',
    '특식 6회 (노니보쌈/호이안가정식/샤브샤브/퓨전뷔페/반쎄오/무제한삼겹살)',
    '마블마운틴 + 호이안 + 바나산 + 한강크루즈 풀코스',
  ],
  product_summary: 'BX 에어부산 김해 직항 / 다낭 프린스호텔 5성급 3박 / 호이안+바나산+한강크루즈 / 특식 6회',
  product_tags: ['다낭', '호이안', '바나산', '5성호텔', '노팁노옵션', 'BX직항', '특식6회'],
  accommodations: ['다낭 프린스호텔(구 셀드메르) 5성 또는 동급 (3박)'],
  itinerary_data: {
    meta: {
      title: '[BX] 다낭/호이안 특급호텔 노팁노옵션 + 6대특식 3박5일',
      product_type: '노팁노옵션',
      destination: '다낭/호이안',
      nights: 3,
      days: 5,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX773 김해 20:50 → 다낭 23:50 (증편 BX7315 22:05→01:10)',
      flight_in: 'BX774 다낭 00:45 → 김해 07:20 (증편 BX7325 02:10→09:05)',
      departure_days: '매일',
      min_participants: 6,
      room_type: '2인1실',
      ticketing_deadline: null,
      hashtags: ['#다낭', '#호이안', '#바나산', '#노팁노옵션', '#BX직항'],
      brand: '여소남',
    },
    highlights: {
      inclusions: INCLUSIONS,
      excludes: EXCLUDES,
      shopping: '쇼핑센터 1회 (Day4) — 일정 불참 시 패널티 $150/인',
      remarks: REMARKS,
    },
    days: ITINERARY_DAYS,
    optional_tours: [],
  },
  itinerary: [
    '제1일: 김해 → 다낭 (BX773 20:50→23:50, 증편 BX7315 22:05→01:10) / 현지가이드 미팅 후 호텔 투숙',
    '제2일: 다낭 → 호이안 → 다낭 (마블마운틴 / 튄퉁 바구니배 / 호이안 구시가지 / 씨클로 / 야시장)',
    '제3일: 다낭 (바나산 국립공원 / 미케 비치 / 핫스톤 마사지)',
    '제4일: 다낭 (쇼핑 / 영응사 / APEC조각공원 / 다낭대성당 / 한강크루즈) → 다낭공항',
    '제5일: 다낭 → 김해 (BX774 00:45→07:20, 증편 BX7325 02:10→09:05)',
  ],
  raw_text: RAW_TEXT,
  raw_text_hash: RAW_TEXT_HASH,
  filename: 'sample.txt',
  file_type: 'manual',
  confidence: 1.0,
};

// ── 실행 ──────────────────────────────────────────────────────────
inserter.run([PKG]).then(result => {
  console.log('\n📊 등록 결과:', result);
}).catch(err => {
  console.error('❌ 실행 실패:', err);
  process.exit(1);
});
