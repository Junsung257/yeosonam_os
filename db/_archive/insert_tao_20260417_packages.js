/**
 * 칭다오 상품 등록 스크립트
 * 랜드사: 투어폰 | 마진율: 9% | 발권기한: 2026-04-29
 * 생성일: 2026-04-17
 *
 * 실행법:
 *   node db/insert_tao_20260417_packages.js            # dry-run (검증만)
 *   node db/insert_tao_20260417_packages.js --insert   # DB 등록
 */

const { createInserter, validatePackage } = require('./templates/insert-template');

const inserter = createInserter({
  landOperator: '투어폰',
  commissionRate: 9,
  ticketingDeadline: '2026-04-29',
  destCode: 'TAO',
});

const { helpers: { flight, normal, shopping, meal } } = inserter;

// ── 상품 정의 ─────────────────────────────────────────────────
const PKG1 = {
  title: '칭다오 쉐라톤 2박 3일 — 맥주 + 양꼬치 특가',
  destination: '칭다오',
  country: '중국',
  category: 'package',
  product_type: '실속',
  trip_style: '2박3일',
  duration: 3,
  nights: 2,
  departure_airport: '부산(김해)',
  departure_days: null,
  airline: 'BX(에어부산)',
  min_participants: 4,
  status: 'pending',
  price: 399000,
  guide_tip: '$40/인 (현지지불)',
  single_supplement: null,
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],

  // ── 가격 (price_tiers 미사용 → price_dates 직접 지정) ──
  price_tiers: [],
  price_dates: [
    { date: '2026-05-20', price: 399000, confirmed: false },
    { date: '2026-05-27', price: 399000, confirmed: false },
    { date: '2026-06-15', price: 399000, confirmed: false },
    { date: '2026-06-22', price: 399000, confirmed: false },
  ],

  // ── 포함/불포함 (원문 그대로) ──
  inclusions: [
    '왕복 항공료 및 텍스',
    '유류할증료(4월)',
    '호텔 (2인1실)',
    '전용차량',
    '관광지입장료',
    '식사 (3일)',
    '여행자보험 2억',
    '칭다오 맥주 방당 2캔',
    '방당 전통차 1통 증정',
  ],
  excludes: [
    '매너팁',
    '개인경비',
    '유류변동분',
    '기사/가이드경비 $40/인 (현지지불)',
  ],

  // ── 숙소 ──
  accommodations: ['청도 포포인트 이스트 쉐라톤 호텔 또는 동급 (준5성) × 2박'],

  // ── 셀링포인트 (고객 어필용, 운영 정보 금지) ──
  product_highlights: [
    '칭다오 맥주 2캔 + 전통차 1통 증정',
    '쉐라톤 준5성 숙박',
    '양꼬치 무제한',
  ],

  product_summary: '부산에서 출발하는 2박3일 칭다오 여행. 준5성 쉐라톤 호텔 숙박, 맥주박물관·팔대관·올림픽요트경기장 등 핵심 관광지 포함.',

  product_tags: ['칭다오', '청도', '맥주', '쉐라톤', '양꼬치', '에어부산', '부산출발'],

  optional_tours: [],

  // ── 유의사항 ──
  notices_parsed: [
    { type: 'CRITICAL', title: '필수 확인', text: '• 여권 유효기간 출발일기준 6개월 이상\n• 여권 관련 문제로 인한 입국 불가 시 책임지지 않음' },
    { type: 'INFO', title: '안내', text: '• 선착순 한정인원 행사로 좌석 마감 시 상품가 변동되거나 추가 불가능할 수 있습니다\n• 아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다' },
  ],

  special_notes: '쇼핑센터 2회 방문 (차, 라텍스, 진주, 침향 中)',

  // ── 일정표 ──
  itinerary_data: {
    meta: {
      title: '칭다오 쉐라톤 2박 3일 — 맥주 + 양꼬치 특가',
      product_type: '실속',
      destination: '칭다오',
      nights: 2,
      days: 3,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX321',
      flight_in: 'BX322',
      departure_days: null,
      min_participants: 4,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-29',
      hashtags: ['#칭다오', '#맥주', '#쉐라톤', '#양꼬치', '#부산출발'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복 항공료 및 텍스',
        '유류할증료(4월)',
        '호텔 (2인1실)',
        '전용차량',
        '관광지입장료',
        '식사 (3일)',
        '여행자보험 2억',
        '칭다오 맥주 방당 2캔',
        '방당 전통차 1통 증정',
      ],
      excludes: [
        '매너팁',
        '개인경비',
        '유류변동분',
        '기사/가이드경비 $40/인 (현지지불)',
      ],
      shopping: '쇼핑센터 2회 (차, 라텍스, 진주, 침향 中)',
      remarks: [
        '선착순 한정인원 행사로 좌석 마감 시 상품가 변동되거나 추가 불가능할 수 있습니다',
        '아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다',
        '4/29까지 항공권 발권',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '칭다오'],
        meals: meal(false, true, true, null, '산동요리', '양꼬치(무제한)'),
        schedule: [
          flight(null, 'BX321 부산(김해) 출발', 'BX321'),
          normal(null, '청도 도착 / 가이드 미팅'),
          normal(null, '▶맥주박물관'),
          normal(null, '▶잔교 (차창관광)'),
          normal(null, '▶따보도 문화거리'),
          normal(null, '▶천주교당 (외관)'),
          normal(null, '▶불야성'),
          { time: null, activity: '청도 포포인트 이스트 쉐라톤 호텔 또는 동급 (준5성) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '청도 포포인트 이스트 쉐라톤 호텔 또는 동급', grade: '준5성', note: null },
      },
      {
        day: 2,
        regions: ['칭다오'],
        meals: meal(true, true, true, '호텔식', '현지식', '삼겹살(무제한)'),
        schedule: [
          normal(null, '호텔 조식 후'),
          shopping(null, '쇼핑센터 2회 방문 (차, 라텍스, 진주, 침향 中)'),
          normal(null, '▶해천뷰전망대 (81층-369M)'),
          normal(null, '▶팔대관'),
          normal(null, '▶5.4광장'),
          normal(null, '▶올림픽요트경기장'),
          normal(null, '▶신호산'),
          normal(null, '▶찌모루시장'),
          normal(null, '석식 후 호텔 투숙'),
          { time: null, activity: '청도 포포인트 이스트 쉐라톤 호텔 또는 동급 (준5성) 투숙', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '청도 포포인트 이스트 쉐라톤 호텔 또는 동급', grade: '준5성', note: null },
      },
      {
        day: 3,
        regions: ['칭다오', '부산'],
        meals: meal(true, false, false, '호텔식', null, null),
        schedule: [
          normal(null, '호텔 조식 후 청도 출발'),
          flight(null, 'BX322 청도 출발 → 부산(김해) 도착', 'BX322'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [],
  },

  itinerary: [
    '제1일: 부산 → 청도 (BX321) | 맥주박물관, 잔교(차창), 따보도 문화거리, 천주교당(외관), 불야성',
    '제2일: 청도 전일 | 쇼핑센터 2회, 해천뷰전망대(81층), 팔대관, 5.4광장, 올림픽요트경기장, 신호산, 찌모루시장',
    '제3일: 청도 → 부산 (BX322) | 호텔 조식 후 귀국',
  ],

  raw_text: `#룸당특전 #노옵션 #쉐라톤숙박\n#양꼬치엔 칭다오  #선착순특가\n\n포함내역\n 왕복 항공료 및 텍스, 유류할증료(4월), 호텔, 차량, 관광지입장료, 식사, 2억원여행자보험\n ♥♥칭다오 맥주 방당2캔, 방당 전통차 1통 증정♥♥ \n\n불포함내역\n 매너팁 및 개인경비, 유류변동분, 기사/가이드경비 $40/인-현지지불\n\n선택옵션\n 노옵션 \n쇼핑센터 2회 : 차, 라텍스, 진주, 침향 中\n\n비고\n * 선착순 한정인원 행사로 좌석 마감시 상품가 변동되거나 추가 불가능할 수 있습니다. \n * 아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다.`,
  filename: 'manual_input_20260417',
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
    console.log('검증 통과 — 모든 필수 필드 정상\n');
    console.log(`title:       ${PKG1.title}`);
    console.log(`destination: ${PKG1.destination}`);
    console.log(`duration:    ${PKG1.nights}박 ${PKG1.duration}일`);
    console.log(`price_dates: ${PKG1.price_dates.length}건`);
    PKG1.price_dates.forEach(p => console.log(`  - ${p.date}  ${p.price.toLocaleString()}원  confirmed:${p.confirmed}`));
    console.log(`inclusions:  ${PKG1.inclusions.length}건`);
    console.log(`excludes:    ${PKG1.excludes.length}건`);
    console.log(`highlights:  ${PKG1.product_highlights.join(' / ')}`);
    console.log(`itinerary:   ${PKG1.itinerary_data.days.length}일`);
    console.log(`remarks:     ${PKG1.itinerary_data.highlights.remarks.length}건 (string[])`);
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
  console.log('\n→ 실제 등록하려면:  node db/insert_tao_20260417_packages.js --insert');
}
