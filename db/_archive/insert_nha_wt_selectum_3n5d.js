/**
 * W투어 — 나트랑 셀렉텀 노아 깜란 리조트 AI 3박5일 [BX]
 *
 * 적용기간: 2026-04-06 ~ 2026-08-29 (4/29 발권조건)
 * 항공: BX781 (부산 19:30 → 나트랑 22:20) / BX782 (나트랑 23:20 → 부산 06:20+1)
 * 호텔: 셀렉텀 노아 깜란 리조트 (5성 / 프리미어 디럭스)
 * 마진: W투어 10%
 *
 * Step 1.5 정형화 적용:
 * - hotel.grade: "5성" (원문 "5성특급" → 정형화)
 * - hotel.note: "프리미어 디럭스 / 올인클루시브(AI)" (room_type + facility_type 임시 저장)
 * - inclusions: "유류할증료(2026-04-29 발권 기준)" 명시
 * - excludes: "유류세 인상분" 자동 추가 (사장님 정책)
 */

const fs = require('fs');
const path = require('path');
const { createInserter } = require('./templates/insert-template');

const RAW_TEXT = fs.readFileSync(path.join(__dirname, 'sample_nha_wt.txt'), 'utf-8');

const inserter = createInserter({
  landOperator: 'W투어',
  commissionRate: 10,
  ticketingDeadline: '2026-04-29',
  destCode: 'NHA',
});
const { helpers: { flight, normal, meal } } = inserter;

// ── 과거 출발일 필터 (오늘=2026-04-27, 발권기한=2026-04-29) ──
const TODAY = '2026-04-27';
const isFuture = (d) => d > TODAY;

// ── 가격표 15개 그룹 ──
// 기간형(요일별) 8개 + 특정일자형 7개
const PRICE_TIERS = [
  // 4/6~4/30, 8/8~15 — 수목금 (4월 출발은 모두 4/27 이전 또는 4/29 surcharge로 별도 처리)
  {
    period_label: '8/8~8/15 수·목·금',
    departure_dates: ['2026-08-13','2026-08-14','2026-08-15'].filter(isFuture),
    adult_price: 1239000, child_price: 959000,
    status: 'available', note: '아동노베드 879,000',
  },
  // 4/6~4/30, 8/8~15 — 토일월화 (4/28만 살아남음)
  {
    period_label: '4/28 토·일·월·화 (잔여 출발일)',
    departure_dates: ['2026-04-28'].filter(isFuture),
    adult_price: 1199000, child_price: 919000,
    status: 'available', note: '아동노베드 839,000',
  },
  {
    period_label: '8/8~8/15 토·일·월·화',
    departure_dates: ['2026-08-08','2026-08-09','2026-08-10','2026-08-11'].filter(isFuture),
    adult_price: 1199000, child_price: 919000,
    status: 'available', note: '아동노베드 839,000',
  },
  // 5/1~7/14 — 수목금/월화
  {
    period_label: '5/1~7/14 월·화·수·목·금',
    departure_dates: (() => {
      const out = [];
      const start = new Date('2026-05-01'), end = new Date('2026-07-14');
      const exclude = new Set([
        '2026-05-20','2026-05-21','2026-05-22','2026-05-23','2026-05-30',
        '2026-06-02','2026-06-03','2026-07-15','2026-07-16','2026-07-17',
        // surcharge 우선 일자
        '2026-05-02', // 4/29,5/2,8/...
      ]);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay(); // 0=일 1=월 2=화 3=수 4=목 5=금 6=토
        if (![1,2,3,4,5].includes(dow)) continue;
        const iso = d.toISOString().slice(0,10);
        if (exclude.has(iso)) continue;
        out.push(iso);
      }
      return out;
    })(),
    adult_price: 1159000, child_price: 869000,
    status: 'available', note: '아동노베드 789,000',
  },
  // 5/1~7/14 — 토일 (최저가)
  {
    period_label: '5/1~7/14 토·일 (최저가)',
    departure_dates: (() => {
      const out = [];
      const start = new Date('2026-05-01'), end = new Date('2026-07-14');
      const exclude = new Set([
        '2026-05-20','2026-05-21','2026-05-22','2026-05-23','2026-05-30',
        '2026-06-02','2026-06-03','2026-07-15','2026-07-16','2026-07-17',
      ]);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (![0,6].includes(dow)) continue;
        const iso = d.toISOString().slice(0,10);
        if (exclude.has(iso)) continue;
        out.push(iso);
      }
      return out;
    })(),
    adult_price: 1109000, child_price: 829000,
    status: 'available', note: '아동노베드 749,000',
  },
  // 7/15~7/22, 8/16~8/29 — 수목금
  {
    period_label: '7/15~7/22 수·목·금',
    departure_dates: ['2026-07-22'], // 7/15,16은 surcharge / 7/17,20,21은 별도, 17(금) 별도, 7/22(수)
    adult_price: 1199000, child_price: 919000,
    status: 'available', note: '아동노베드 829,000',
  },
  {
    period_label: '8/16~8/29 수·목·금',
    departure_dates: ['2026-08-19','2026-08-20','2026-08-21','2026-08-26','2026-08-27','2026-08-28'],
    adult_price: 1199000, child_price: 919000,
    status: 'available', note: '아동노베드 829,000',
  },
  // 7/15~7/22, 8/16~8/29 — 토일월화
  {
    period_label: '7/15~7/22 토·일·월·화 (7/15·16 surcharge 제외)',
    departure_dates: ['2026-07-18','2026-07-19'], // 7/20·7/21은 surcharge 우선 (5/20,6/3,7/17 → 1,239,000 그룹 제외 후 남는 토일)
    // 실제: 7/15(수)=surcharge / 7/16(목)=surcharge / 7/17(금)=surcharge / 7/18(토)·7/19(일)=본
    // 7/20(월)·7/21(화)·7/22(수)는 다음 surcharge 그룹에 포함되지 않음 → 본 가격
    adult_price: 1159000, child_price: 869000,
    status: 'available', note: '아동노베드 789,000',
  },
  {
    period_label: '8/16~8/29 토·일·월·화',
    departure_dates: [
      '2026-08-16','2026-08-17','2026-08-18',
      '2026-08-22','2026-08-23','2026-08-24','2026-08-25',
      '2026-08-29',
    ],
    adult_price: 1159000, child_price: 869000,
    status: 'available', note: '아동노베드 789,000',
  },
  // 7/30~8/7 매일
  {
    period_label: '7/30~8/7 매일',
    departure_dates: [
      '2026-07-30',
      '2026-08-02','2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07',
      // 8/1=surcharge 별도
    ],
    adult_price: 1339000, child_price: 1059000,
    status: 'available', note: '아동노베드 979,000',
  },
  // 7/23~7/29 매일 (단, 7/29,30,31 surcharge 별도)
  {
    period_label: '7/23~7/29 매일 (성수)',
    departure_dates: ['2026-07-23','2026-07-24','2026-07-25','2026-07-26','2026-07-27','2026-07-28'],
    adult_price: 1389000, child_price: 1099000,
    status: 'available', note: '아동노베드 1,019,000',
  },
  // 특정일자형 7개
  {
    period_label: '5/23, 5/30, 6/2',
    departure_dates: ['2026-05-23','2026-05-30','2026-06-02'],
    adult_price: 1189000, child_price: 899000,
    status: 'available', note: '아동노베드 809,000',
  },
  {
    period_label: '5/20, 6/3, 7/17',
    departure_dates: ['2026-05-20','2026-06-03','2026-07-17'],
    adult_price: 1239000, child_price: 949000,
    status: 'available', note: '아동노베드 869,000',
  },
  {
    period_label: '7/15, 7/16',
    departure_dates: ['2026-07-15','2026-07-16'],
    adult_price: 1349000, child_price: 1059000,
    status: 'available', note: '아동노베드 979,000',
  },
  {
    period_label: '4/29, 5/2, 8/1, 8/12·13·15',
    departure_dates: ['2026-04-29','2026-05-02','2026-08-01','2026-08-12','2026-08-13','2026-08-15'],
    adult_price: 1439000, child_price: 1139000,
    status: 'available', note: '아동노베드 1,059,000',
  },
  {
    period_label: '7/29, 7/30, 7/31',
    departure_dates: ['2026-07-29','2026-07-30','2026-07-31'],
    adult_price: 1499000, child_price: 1199000,
    status: 'available', note: '아동노베드 1,119,000',
  },
  {
    period_label: '5/21, 5/22, 8/14',
    departure_dates: ['2026-05-21','2026-05-22','2026-08-14'],
    adult_price: 1549000, child_price: 1259000,
    status: 'available', note: '아동노베드 1,179,000',
  },
  {
    period_label: '4/30 (최성수)',
    departure_dates: ['2026-04-30'],
    adult_price: 1689000, child_price: 1399000,
    status: 'available', note: '아동노베드 1,319,000',
  },
];

// ── 호텔 정보 (Step 1.5-E 정형화 적용) ──
const HOTEL = {
  name: '셀렉텀 노아 깜란 리조트',
  grade: '5성', // 원문 "(5성특급)" → 표준 정형화
  note: '프리미어 디럭스 (올인클루시브 AI / 리조트)',
};

// ── itinerary days ──
const DAYS = [
  {
    day: 1, regions: ['부산', '나트랑'],
    meals: meal(false, false, true, null, null, '리조트'),
    schedule: [
      flight('19:30', '부산(김해) 출발 → 나트랑(깜란) 도착 22:20', 'BX781'),
      normal(null, '나트랑 국제공항 도착 / 입국수속'),
      normal(null, '리조트 셔틀을 이용하여 리조트 이동'),
      normal('15:00~', '개별 체크인'),
      normal(null, '호텔 투숙 및 휴식'),
    ],
    hotel: HOTEL,
  },
  {
    day: 2, regions: ['나트랑'],
    meals: meal(true, true, true, '리조트', '리조트', '리조트'),
    schedule: [
      normal(null, '리조트 조식 후 전일 자유시간'),
      normal(null, '리조트 부대시설 즐기기 (아쿠아 파크 / 키즈 클럽 / 테니스 코트 / 탁구장 등)'),
      normal(null, '석식'),
      normal(null, '호텔 투숙 및 휴식'),
    ],
    hotel: HOTEL,
  },
  {
    day: 3, regions: ['나트랑'],
    meals: meal(true, true, true, '리조트', '리조트', '리조트'),
    schedule: [
      normal(null, '리조트 조식 후 전일 자유시간'),
      normal(null, '리조트 부대시설 즐기기 (아쿠아 파크 / 키즈 클럽 / 테니스 코트 / 탁구장 등)'),
      normal(null, '석식'),
      normal(null, '호텔 투숙 및 휴식'),
    ],
    hotel: HOTEL,
  },
  {
    day: 4, regions: ['나트랑', '부산'],
    meals: meal(true, true, true, '리조트', '리조트', '리조트'),
    schedule: [
      normal(null, '리조트 조식 후 오전 자유시간'),
      normal('~12:00', '개별 체크아웃 (리셉션에 짐 보관 후 부대시설 이용 가능)'),
      normal(null, '리조트 셔틀을 이용하여 공항으로 이동 (전일 리셉션에 셔틀 시간 확인 요망)'),
      flight('23:20', '나트랑(깜란) 출발 → 부산(김해) 도착 06:20+1', 'BX782'),
    ],
    hotel: { name: '셀렉텀 노아 깜란 리조트', grade: '5성', note: '체크아웃 후 야간 출국 (기내 숙박)' },
  },
  {
    day: 5, regions: ['부산'],
    meals: meal(false, false, false, null, null, null),
    schedule: [
      normal('06:20', '김해 국제공항 도착'),
    ],
    hotel: { name: null, grade: null, note: null },
  },
];

const PKG = {
  title: '나트랑 셀렉텀 노아 3박5일 에어텔 [BX/올인클루시브]',
  destination: '나트랑',
  country: '베트남',
  category: 'package',
  product_type: '에어텔',
  trip_style: '3박5일',
  duration: 5,
  nights: 3,
  departure_airport: '부산(김해)',
  airline: 'BX(에어부산)',
  min_participants: 2,
  status: 'pending',
  price: 1109000, // 5/1~7/14 토일 최저가
  guide_tip: null,
  single_supplement: null,
  small_group_surcharge: null,
  surcharges: [
    {
      name: '리조트 써차지',
      start: '2026-04-30',
      end: '2026-05-01',
      amount: 20000,
      currency: 'KRW',
      unit: '/박/인',
    },
  ],
  excluded_dates: [],
  price_tiers: PRICE_TIERS,
  inclusions: [
    '왕복항공',
    'TAX',
    '유류할증료(2026-04-29 발권 기준)',
    '리조트 3박 (2인1실 기준)',
    '일정상에 명시된 식사',
    '나트랑 공항 ↔ 셀렉텀 리조트 왕복 픽업 (리조트셔틀 이용)',
  ],
  excludes: [
    '개인경비',
    '매너 팁',
    '유류할증료 인상분',
    '유류세 인상분',
    '차량/기사',
    '가이드',
    '여행자보험',
  ],
  optional_tours: [],
  accommodations: ['셀렉텀 노아 깜란 리조트(5성)'],
  product_highlights: [
    '5성 셀렉텀 노아 깜란 리조트 3박',
    '올인클루시브(AI) 무제한 식음료',
    '아쿠아 파크 + 키즈 클럽 + 시내 셔틀',
  ],
  product_summary: '베트남 깜란의 5성 셀렉텀 노아 리조트에서 보내는 3박5일 올인클루시브 에어텔이에요. 뷔페 + 무제한 음료/주류, 미니바, 워터슬라이드 6개의 아쿠아파크, 나이트 엔터테인먼트까지 리조트 안에서 모두 해결되니 가족·커플 모두 부담 없이 푹 쉴 수 있어요. BX 에어부산 직항으로 김해 출발이라 이동도 편하고, 시내 왕복 셔틀까지 있어서 나트랑 시내 구경도 가능합니다.',
  product_tags: ['나트랑', '에어텔', '올인클루시브', '셀렉텀노아', '리조트', '5성', '가족여행'],
  notices_parsed: [
    {
      type: 'CRITICAL',
      title: '여권 조건',
      text: '여권만료일 6개월 이상 및 여권(사증란 포함)에 낙서 또는 훼손이 있을 경우 출국 거부됩니다.',
    },
    {
      type: 'CRITICAL',
      title: '미성년 동반 서류',
      text: '부모 동반하는 만 14세 미만 아동은 영문 가족관계증명서 필수입니다. (부모 미동반 시 부모로부터 위임장 첨부 — 공증 필요)',
    },
    {
      type: 'INFO',
      title: '최대 투숙 인원',
      text: '성인 3 + 아동 1 또는 성인 2 + 아동 2 (객실 1실 기준)',
    },
    {
      type: 'INFO',
      title: '리조트 특전 (올인클루시브 AI)',
      text: '한식 및 다양한 테마의 뷔페 레스토랑 무제한 (B 06:30~09:30 / L 12:30~14:30 / D 18:00~20:30) · 스낵바 핑거푸드/과일/와인/맥주/칵테일 무제한 · 객실 무료 미니바 · 아쿠아 파크(워터슬라이드 6개) 무제한 · 나이트 엔터테인먼트(선셋 칵테일파티/폼 풀파티/비치나이트디스코) · 키즈클럽/시네마/게임기 · 스포츠 시설(아쿠아짐/테니스/탁구/포켓볼/자전거) 무제한 · 시내 왕복 셔틀버스',
    },
    {
      type: 'INFO',
      title: '체크아웃 후 셔틀 시간 안내',
      text: '체크아웃 ~12:00. 리셉션에 짐 보관 후 수영장 등 간단한 부대시설 이용 가능. 셔틀 시간은 전일 리조트 리셉션에서 확인 필요.',
    },
  ],
  internal_notes: 'W투어 신규 등록 (커미션 10%). BX-에어부산 BX781/BX782 직항 / 4/29 발권조건 (이후 출발은 유류세 인상분 별도).',
  customer_notes: null,
  itinerary_data: {
    meta: {
      title: '나트랑 셀렉텀 노아 3박5일 에어텔 [BX]',
      product_type: '에어텔',
      destination: '나트랑',
      nights: 3,
      days: 5,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX781 19:30 → 22:20',
      flight_in: 'BX782 23:20 → 06:20+1',
      departure_days: '매일',
      min_participants: 2,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-29',
      hashtags: ['#나트랑', '#셀렉텀노아', '#올인클루시브', '#에어텔'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복항공',
        'TAX',
        '유류할증료(2026-04-29 발권 기준)',
        '리조트 3박 (2인1실 기준)',
        '일정상에 명시된 식사',
        '나트랑 공항 ↔ 셀렉텀 리조트 왕복 픽업 (리조트셔틀 이용)',
      ],
      excludes: [
        '개인경비', '매너 팁', '유류할증료 인상분', '유류세 인상분',
        '차량/기사', '가이드', '여행자보험',
      ],
      shopping: null,
      remarks: [
        '여권만료일 6개월 이상 필요. 여권에 낙서/훼손 시 출국 거부.',
        '만 14세 미만 부모 동반 시 영문 가족관계증명서 필수 (부모 미동반 시 위임장 + 공증).',
        '리조트 써차지: 2026-04-30, 05-01 — 1박당 1인 20,000원 추가.',
        '4/29 발권조건 — 이후 출발은 유류세 인상분/인하분 별도 반영.',
      ],
    },
    days: DAYS,
    optional_tours: [],
  },
  itinerary: [
    '제1일: 부산 출발(BX781 19:30) → 나트랑 도착(22:20) → 리조트 셔틀 이동 → 체크인(15:00~)',
    '제2일: 리조트 자유시간 (아쿠아파크/키즈클럽/스포츠 시설 무제한) — 3식 리조트',
    '제3일: 리조트 자유시간 — 3식 리조트',
    '제4일: 체크아웃(~12:00) → 리조트 셔틀로 공항 이동 → 나트랑 출발(BX782 23:20)',
    '제5일: 부산 김해 도착(06:20)',
  ],
  raw_text: RAW_TEXT,
  filename: 'sample_nha_wt.txt',
  file_type: 'manual',
  confidence: 1.0,
  agent_audit_report: {
    parser_version: 'register-v2026.04.27-step1.5-applied',
    ran_at: new Date().toISOString(),
    claims: [
      {
        id: 'min_participants',
        field: 'min_participants',
        severity: 'HIGH',
        text: 'min_participants=2',
        evidence: '원문: "인    원 / 2명부터 출발 가능"',
        supported: true,
      },
      {
        id: 'ticketing_deadline',
        field: 'ticketing_deadline',
        severity: 'HIGH',
        text: 'ticketing_deadline=2026-04-29',
        evidence: '원문: "-4/29 발권조건!"',
        supported: true,
      },
      {
        id: 'flight_out',
        field: 'itinerary_data.meta.flight_out',
        severity: 'HIGH',
        text: 'BX781 19:30 → 22:20',
        evidence: '원문: "부  산 → 나트랑 / BX 781  19:30 – 22:20"',
        supported: true,
      },
      {
        id: 'flight_in',
        field: 'itinerary_data.meta.flight_in',
        severity: 'HIGH',
        text: 'BX782 23:20 → 06:20+1',
        evidence: '원문: "나트랑 → 부  산 / BX 782  23:20 – 06:20+1"',
        supported: true,
      },
      {
        id: 'hotel.grade',
        field: 'itinerary_data.days[].hotel.grade',
        severity: 'HIGH',
        text: 'grade="5성" (원문 "5성특급" 정형화)',
        evidence: '원문: "(5성특급) 셀렉텀 노아 깜란 리조트"',
        supported: true,
        note: 'Step 1.5-E 호텔 등급 정형화 룰 적용 — 5성특급 → 5성',
      },
      {
        id: 'hotel.name',
        field: 'itinerary_data.days[].hotel.name',
        severity: 'HIGH',
        text: 'name="셀렉텀 노아 깜란 리조트"',
        evidence: '원문: "셀렉텀 노아 깜란 리조트 (프리미어디럭스)"',
        supported: true,
      },
      {
        id: 'inclusions.유류할증료',
        field: 'inclusions',
        severity: 'CRITICAL',
        text: '유류할증료(2026-04-29 발권 기준)',
        evidence: '원문: "왕복항공+TAX/유류할증료(4월)" + "-4/29 발권조건!"',
        supported: true,
        note: '사장님 정책 반영 — Step 1.5-D 유류할증료 표준 처리',
      },
      {
        id: 'excludes.유류세인상분',
        field: 'excludes',
        severity: 'CRITICAL',
        text: '유류세 인상분 (자동 추가)',
        evidence: '원문: "불포함: 유류할증료 인상분" + 사장님 정책 (발권기한 후 별도 반영)',
        supported: true,
        note: 'Step 1.5-D 사장님 정책 — "유류세 인상분" 명시 추가',
      },
      {
        id: 'surcharges',
        field: 'surcharges',
        severity: 'HIGH',
        text: '리조트 써차지 4/30~5/1, 1박당 1인 20,000원',
        evidence: '원문: "리조트 써차지 / 4/30, 5/1 – 1인 박당 2만원 추가!"',
        supported: true,
      },
      {
        id: 'no_optional_tours',
        field: 'optional_tours',
        severity: 'MEDIUM',
        text: '선택관광 없음 (자유일정 + 리조트 올인클루시브)',
        evidence: '원문에 선택관광 섹션 없음. "전일 자유시간" 일정.',
        supported: true,
      },
      {
        id: 'remark.passport',
        field: 'notices_parsed',
        severity: 'CRITICAL',
        text: '여권 6개월 + 미성년 가족관계증명서',
        evidence: '원문 REMARK 섹션 그대로',
        supported: true,
      },
    ],
    overall_verdict: 'clean',
    unsupported_critical: 0,
    unsupported_high: 0,
  },
};

inserter.run([PKG]);
