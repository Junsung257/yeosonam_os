/**
 * 타이베이 상품 등록 스크립트
 * 랜드사: 투어폰 | 마진율: 9% | 발권기한: 2026-04-23
 * 생성일: 2026-04-18
 *
 * 실행법:
 *   node db/insert_tpe_20260418_packages.js            # dry-run (검증만)
 *   node db/insert_tpe_20260418_packages.js --insert   # DB 등록
 */

const { createInserter, validatePackage } = require('./templates/insert-template');

const inserter = createInserter({
  landOperator: '투어폰',
  commissionRate: 9,
  ticketingDeadline: '2026-04-23',
  destCode: 'TPE',
});

const { helpers: { flight, normal, optional, shopping, meal } } = inserter;

// ── 상품 정의 ─────────────────────────────────────────────────
const PKG1 = {
  title: '타이베이 단수이 3박 4일 — 에어부산 특가',
  destination: '타이베이',
  country: '대만',
  category: 'package',
  product_type: '실속',
  trip_style: '3박4일',
  duration: 4,
  nights: 3,
  departure_airport: '부산(김해)',
  departure_days: null,
  airline: 'BX(에어부산)',
  min_participants: 4,
  status: 'pending',
  price: 599000,
  guide_tip: '$40/인 (현지지불)',
  single_supplement: null,
  small_group_surcharge: null,

  // ── 써차지 ──
  surcharges: [
    { name: '청명절', start: '2026-04-03', end: '2026-04-06', amount: 10, currency: 'USD', unit: '인/박' },
    { name: '노동절', start: '2026-05-01', end: '2026-05-03', amount: 10, currency: 'USD', unit: '인/박' },
    { name: '단오절', start: '2026-06-19', end: '2026-06-21', amount: 10, currency: 'USD', unit: '인/박' },
    { name: '로타리 세계대회', start: '2026-06-10', end: '2026-06-20', amount: 10, currency: 'USD', unit: '인/박' },
  ],
  excluded_dates: [],

  // ── 가격표 (price_tiers 미사용 → price_dates 직접 지정) ──
  // 주의: 5/17, 6/21은 "★단 2회 특가★" 599,000원 우선 적용
  price_tiers: [],
  price_dates: [
    // 599,000원 — 단 2회 특가
    { date: '2026-05-17', price: 599000, confirmed: false },
    { date: '2026-06-21', price: 599000, confirmed: false },

    // 699,000원
    { date: '2026-04-20', price: 699000, confirmed: false },
    { date: '2026-04-21', price: 699000, confirmed: false },
    { date: '2026-04-27', price: 699000, confirmed: false },
    { date: '2026-05-06', price: 699000, confirmed: false },
    { date: '2026-05-10', price: 699000, confirmed: false },
    { date: '2026-05-11', price: 699000, confirmed: false },
    { date: '2026-05-18', price: 699000, confirmed: false },
    { date: '2026-06-08', price: 699000, confirmed: false },
    { date: '2026-06-14', price: 699000, confirmed: false },
    { date: '2026-06-15', price: 699000, confirmed: false },
    { date: '2026-06-22', price: 699000, confirmed: false },

    // 729,000원
    { date: '2026-04-22', price: 729000, confirmed: false },
    { date: '2026-04-28', price: 729000, confirmed: false },
    { date: '2026-04-29', price: 729000, confirmed: false },
    { date: '2026-05-13', price: 729000, confirmed: false },
    { date: '2026-05-20', price: 729000, confirmed: false },
    { date: '2026-05-25', price: 729000, confirmed: false },
    { date: '2026-05-26', price: 729000, confirmed: false },
    { date: '2026-05-27', price: 729000, confirmed: false },
    { date: '2026-06-02', price: 729000, confirmed: false },
    { date: '2026-06-09', price: 729000, confirmed: false },
    { date: '2026-06-10', price: 729000, confirmed: false },
    { date: '2026-06-16', price: 729000, confirmed: false },
    { date: '2026-06-17', price: 729000, confirmed: false },
    { date: '2026-06-23', price: 729000, confirmed: false },
    { date: '2026-06-24', price: 729000, confirmed: false },
    { date: '2026-06-28', price: 729000, confirmed: false },
    { date: '2026-06-29', price: 729000, confirmed: false },
    { date: '2026-06-30', price: 729000, confirmed: false },

    // 779,000원
    { date: '2026-04-25', price: 779000, confirmed: false },
    { date: '2026-05-07', price: 779000, confirmed: false },
    { date: '2026-05-08', price: 779000, confirmed: false },
    { date: '2026-05-09', price: 779000, confirmed: false },
    { date: '2026-05-15', price: 779000, confirmed: false },
    { date: '2026-05-16', price: 779000, confirmed: false },
    { date: '2026-05-28', price: 779000, confirmed: false },
    { date: '2026-05-29', price: 779000, confirmed: false },
    { date: '2026-06-04', price: 779000, confirmed: false },
    { date: '2026-06-05', price: 779000, confirmed: false },
    { date: '2026-06-06', price: 779000, confirmed: false },
    { date: '2026-06-11', price: 779000, confirmed: false },
    { date: '2026-06-12', price: 779000, confirmed: false },
    { date: '2026-06-13', price: 779000, confirmed: false },
    { date: '2026-06-18', price: 779000, confirmed: false },
    { date: '2026-06-19', price: 779000, confirmed: false },
    { date: '2026-06-20', price: 779000, confirmed: false },
    { date: '2026-06-25', price: 779000, confirmed: false },
    { date: '2026-06-26', price: 779000, confirmed: false },
    { date: '2026-06-27', price: 779000, confirmed: false },

    // 799,000원
    { date: '2026-04-23', price: 799000, confirmed: false },
    { date: '2026-07-02', price: 799000, confirmed: false },
    { date: '2026-07-03', price: 799000, confirmed: false },
    { date: '2026-07-04', price: 799000, confirmed: false },
    { date: '2026-07-07', price: 799000, confirmed: false },
    { date: '2026-07-09', price: 799000, confirmed: false },
    { date: '2026-07-10', price: 799000, confirmed: false },
    { date: '2026-07-11', price: 799000, confirmed: false },
    { date: '2026-07-14', price: 799000, confirmed: false },
    { date: '2026-07-18', price: 799000, confirmed: false },

    // 849,000원
    { date: '2026-07-16', price: 849000, confirmed: false },
  ],

  // ── 포함사항 ──
  inclusions: [
    '왕복 항공료 및 텍스',
    '유류할증료(4월 기준)',
    '호텔 (2인1실)',
    '차량, 가이드, 입장료, 식사',
    '여행자보험',
    '서문정거리 망고빙수 2인 1개',
  ],

  // ── 불포함사항 ──
  excludes: [
    '기사/가이드경비 $40/인 (현지지불)',
    '매너팁',
    '개인경비',
    '선택관광비용',
    '유류변동분',
    '써차지 ($10/인/박)',
  ],

  // ── 숙소 ──
  accommodations: ['주도플라자 / 하이원 홀리데이 / 레가리스 호텔 또는 동급 (시외4성급) × 3박'],

  // ── 셀링포인트 (고객 어필용, 운영 정보 금지) ──
  product_highlights: [
    '센과 치히로의 배경 지우펀 + 스펀 천등날리기 포함',
    '야류 해양국립공원 · 단수이 옛거리 핵심 코스',
    '서문정거리 망고빙수 2인 1개 특전 제공',
  ],

  product_summary: '부산에서 에어부산으로 출발하는 3박4일 타이베이 여행. 지우펀, 스펀 천등날리기, 야류, 단수이, 국립고궁박물관 등 대만 핵심 명소를 알차게 담은 실속 패키지.',

  product_tags: ['타이베이', '대만', '지우펀', '스펀', '단수이', '에어부산', '부산출발'],

  // ── 선택관광 ──
  optional_tours: [
    { name: '101빌딩 전망대', price: '$35/인' },
    { name: '발마사지 (30분)', price: '$30/인' },
    { name: '전신마사지 (1시간)', price: '$50/인' },
  ],

  // ── 유의사항 ──
  notices_parsed: [
    { type: 'CRITICAL', title: '필수 확인', text: '• 대만 입국 시 일체의 육류가공품 반입 금지 (위반 시 벌금)\n• 여권 유효기간 출발일 기준 6개월 이상 필요' },
    { type: 'INFO', title: '일정 안내', text: '• 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다\n• 화산 1914 → 싼샤 라오지에, 사림관저 일정 변경 가능' },
  ],

  special_notes: '쇼핑센터 3회 방문 (잡화점, 제과점, 차, 보석 中) / 차량 내 기념품 판매 있음',

  // ── 일정표 ──
  itinerary_data: {
    meta: {
      title: '타이베이 단수이 3박 4일 — 에어부산 특가',
      product_type: '실속',
      destination: '타이베이',
      nights: 3,
      days: 4,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX793',
      flight_in: 'BX792',
      departure_days: null,
      min_participants: 4,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-23',
      hashtags: ['#타이베이', '#단수이', '#에어부산', '#부산출발'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 항공료 및 텍스',
        '유류할증료(4월 기준)',
        '호텔 (2인1실)',
        '차량, 가이드, 입장료, 식사',
        '여행자보험',
        '서문정거리 망고빙수 2인 1개',
      ],
      excludes: [
        '기사/가이드경비 $40/인 (현지지불)',
        '매너팁',
        '개인경비',
        '선택관광비용',
        '유류변동분',
        '써차지 ($10/인/박)',
      ],
      shopping: '쇼핑센터 3회 방문 (잡화점, 제과점, 차, 보석 中)',
      remarks: [
        '아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다',
        '대만 입국 시 일체의 육류가공품 반입 금지 (위반 시 벌금)',
        '여권 유효기간 출발일 기준 6개월 이상 필요',
        '써차지: $10/인/박 (청명절·노동절·단오절·로타리 세계대회 기간)',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '타이베이'],
        meals: meal(false, true, true, null, '차량내 샌드위치+음료수', '샤브샤브'),
        schedule: [
          flight('10:50', 'BX793 부산(김해) 출발 → 타이페이 도착 12:35', 'BX793'),
          normal(null, '가이드 미팅'),
          normal(null, '▶국립고궁박물관 (세계 4대 박물관)'),
          normal(null, '▶자유궁 (도교사찰)'),
          normal(null, '▶라우허지에 야시장'),
          optional(null, '추천옵션: 101빌딩 전망대 $35/인'),
          normal(null, '석식 후 호텔 투숙'),
          { time: null, activity: '주도플라자 / 하이원 홀리데이 / 레가리스 호텔 또는 동급 (시외4성급) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '주도플라자 / 하이원 홀리데이 / 레가리스 호텔 또는 동급', grade: '시외4성급', note: null },
      },
      {
        day: 2,
        regions: ['타이페이', '야류', '지우펀', '스펀'],
        meals: meal(true, true, true, '호텔식', '현지식', '한식'),
        schedule: [
          normal(null, '호텔 조식 후 출발'),
          normal(null, '▶야류 해양국립공원 (기암괴석)'),
          normal(null, '▶지우펀 (센과 치히로의 행방불명 촬영지)'),
          normal(null, '▶스펀 천등날리기 (4인 1개)'),
          normal(null, '석식 후 호텔 투숙'),
          { time: null, activity: '주도플라자 / 하이원 홀리데이 / 레가리스 호텔 또는 동급 (시외4성급) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '주도플라자 / 하이원 홀리데이 / 레가리스 호텔 또는 동급', grade: '시외4성급', note: null },
      },
      {
        day: 3,
        regions: ['타이페이', '단수이'],
        meals: meal(true, true, true, '호텔식', '우육면', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후 출발'),
          normal(null, '▶진리대학 (외부관람, 대만 최초 서양식 대학)'),
          normal(null, '▶홍마오청 (1628년 스페인 건축)'),
          normal(null, '▶단수이 옛거리'),
          normal(null, '▶화산 1914 창의문화원구 (양조장→문화복합공간)'),
          normal(null, '▶서문정거리 (망고빙수 2인1개 포함)'),
          optional(null, '추천옵션: 발마사지 (30분) $30/인'),
          normal(null, '석식 후 호텔 투숙'),
          { time: null, activity: '주도플라자 / 하이원 홀리데이 / 레가리스 호텔 또는 동급 (시외4성급) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '주도플라자 / 하이원 홀리데이 / 레가리스 호텔 또는 동급', grade: '시외4성급', note: null },
      },
      {
        day: 4,
        regions: ['타이페이', '부산'],
        meals: meal(true, true, false, '호텔식', '현지식', null),
        schedule: [
          normal(null, '호텔 조식 후 출발'),
          normal(null, '▶중정기념당'),
          normal(null, '▶사림관저 (장개석 총통 관저)'),
          normal(null, '중식 후 공항 이동'),
          flight('16:40', 'BX792 타이페이 출발 → 부산(김해) 도착 19:55', 'BX792'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [
      { name: '101빌딩 전망대', price: '$35/인', day: 1 },
      { name: '발마사지 (30분)', price: '$30/인', day: 3 },
      { name: '전신마사지 (1시간)', price: '$50/인', day: null },
    ],
  },

  itinerary: [
    '제1일: 부산 → 타이페이 (BX793 10:50) | 국립고궁박물관, 자유궁, 라우허지에 야시장',
    '제2일: 타이페이 - 야류 - 지우펀 - 스펀 - 타이페이 | 야류 해양국립공원, 지우펀, 스펀 천등날리기',
    '제3일: 타이페이 - 단수이 - 타이페이 | 진리대학, 홍마오청, 단수이 옛거리, 화산 1914, 서문정거리',
    '제4일: 타이페이 → 부산 (BX792 16:40) | 중정기념당, 사림관저, 귀국',
  ],

  raw_text: `타이베이 3박 4일 에어부산 특가\n\n포함내역\n왕복 항공료 및 텍스, 유류할증료(4월), 호텔(2인1실), 차량, 가이드, 입장료, 식사, 여행자보험\n특전: 서문정거리 망고빙수 2인 1개\n\n불포함내역\n기사/가이드경비 $40/인(현지지불), 매너팁, 개인경비, 선택관광비용, 유류변동분, 써차지($10/인/박)\n\n선택관광\n101빌딩 전망대 $35/인 / 발마사지(30분) $30/인 / 전신마사지(1시간) $50/인\n\n쇼핑센터 3회: 잡화점, 제과점, 차, 보석 中\n\n유의사항\n* 대만 입국 시 일체의 육류가공품 반입 금지 (위반 시 벌금)\n* 여권 유효기간 6개월 이상\n* 일정은 항공 및 현지사정에 의해 변경 가능`,
  filename: 'manual_input_20260418',
  file_type: 'manual',
  confidence: 1.0,
};

// ── dry-run 검증 ──────────────────────────────────────────────
function dryRun() {
  console.log('\n=== dry-run 검증 ===\n');
  const { errors, warnings } = validatePackage(PKG1);

  if (warnings.length > 0) {
    console.log(`경고 (${PKG1.title}):`);
    warnings.forEach(w => console.log(`   W: ${w}`));
  }

  if (errors.length > 0) {
    console.error(`\n검증 실패 (${errors.length}건):`);
    errors.forEach(e => console.error(`   E: ${e}`));
    console.error('\n→ 위 오류를 수정한 후 --insert를 실행하세요.');
    process.exit(1);
  } else {
    console.log('\n검증 통과 — 모든 필수 필드 정상\n');
    console.log(`title:       ${PKG1.title}`);
    console.log(`destination: ${PKG1.destination}`);
    console.log(`duration:    ${PKG1.nights}박 ${PKG1.duration}일`);
    console.log(`price_dates: ${PKG1.price_dates.length}건`);

    // 가격대별 요약
    const priceGroups = {};
    PKG1.price_dates.forEach(p => {
      if (!priceGroups[p.price]) priceGroups[p.price] = [];
      priceGroups[p.price].push(p.date);
    });
    Object.entries(priceGroups).sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([price, dates]) => {
      console.log(`  ${Number(price).toLocaleString()}원: ${dates.length}개 출발일`);
      dates.forEach(d => console.log(`    - ${d}`));
    });

    console.log(`inclusions:  ${PKG1.inclusions.length}건`);
    console.log(`excludes:    ${PKG1.excludes.length}건`);
    console.log(`highlights:  ${PKG1.product_highlights.join(' / ')}`);
    console.log(`itinerary:   ${PKG1.itinerary_data.days.length}일`);
    console.log(`remarks:     ${PKG1.itinerary_data.highlights.remarks.length}건 (string[])`);
    console.log(`surcharges:  ${PKG1.surcharges.length}건`);
    console.log(`optional:    ${PKG1.optional_tours.length}건`);
    if (warnings.length === 0) console.log('\n경고 없음 — 바로 등록 가능\n');
  }
}

// ── 실행 분기 ────────────────────────────────────────────────
const ALL_PACKAGES = [PKG1];
const doInsert = process.argv.includes('--insert');

if (doInsert) {
  inserter.run(ALL_PACKAGES);
} else {
  dryRun();
  console.log('\n→ 실제 등록하려면:  node db/insert_tpe_20260418_packages.js --insert');
}
