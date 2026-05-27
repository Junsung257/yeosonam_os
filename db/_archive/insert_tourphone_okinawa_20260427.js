/**
 * [힐링 리조트팩] 오키나와 4일 PKG (투어폰)
 * 랜드사: 투어폰 | 마진율: 9% | 발권기한: 2026-04-30 (4월 말까지 항공 발권 조건)
 * 항공편: ZE963 (출국) / ZE964 (귀국) — 이스타항공
 * 생성일: 2026-04-27
 *
 * 실행법:
 *   node db/insert_tourphone_okinawa_20260427.js            # dry-run
 *   node db/insert_tourphone_okinawa_20260427.js --insert   # DB 등록
 */

const crypto = require('crypto');
const { createInserter, validatePackage } = require('./templates/insert-template');

const inserter = createInserter({
  landOperator: '투어폰',
  commissionRate: 9,
  ticketingDeadline: '2026-04-30',
  destCode: 'OKA',
});

const { helpers: { flight, normal, optional, shopping, meal } } = inserter;

// ── 원문 보존 (Rule Zero: sha256 동반) ─────────────────────────
const RAW_TEXT = `투어폰 9%

[힐링 리조트팩] 오키나와 4일 PKG
#리조트1박 #시내2박 #철판스테이크포함 #자유일정1일 #츄라우미수족관 #오키나와월드

포 함 사 항
왕복항공료 및 공항이용료, 현지행사비, 전용 버스, 일정상 식사비, 해외여행자보험
불포함 사항
가이드 경비 (4만원 성인/아동 동일), 유류할증료(4월 기준 111,000원) 기타 개인경비
비 고
▶ 최소 출발 인원 8명입니다. 10명 미만 행사 시, 현지 차량 가이드로 진행됩니다.
▶ 싱글 차지 18만 원/인 (1인 1박당 6만 원) 추가됩니다.
▶ 어린이 NO BED 불가 / 유아(24개월 미만) 판매가 10%
▶ 현지 사정에 의해 호텔 순서, 관광 순서 변경될 수도 있습니다.
일 자
지  역
교통편
시 간
주   요   일   정
식 사
1일
부산

오키나와











ZE963
전용차량










06:00
08:00
10:00











 김해 국제공항 미팅 및 수속

 김해 공항 출발

 오키나와 국제 공항 도착

 ▶ 오키나와 핫플 세나카지마 우미카지테라스

 ▶ 오키나와의 테마파크 오키나와 월드

    (일본 3대 종유 동굴, 류큐 왕국촌, 에이샤 공연)

 ▶ 오키나와 전통주 아와모리 공장 마사히로주조

 ▶ 역사와 문화를 상징하는 류큐 왕족의 유적 슈리성 (정전 불포함)

    정전: 화재로 소실되어 재건 중

 호텔 이동 및 체크인 후 휴식
중: 현지식

석: 현지식
(치킨 정식)
 HOTEL 사잔 비치 호텔, 그란메르 호텔, 베셀 레후 호텔 또는 동급 (2인 1실)
2일
오키나와









전용차량









전일









 호텔 조식 후

 ▶ 해양 기념 공원 – 츄라우미 수족관, 돌고래쇼 관광

 ▶ 오키나와 절정 해안 절벽 만좌모 (전망대 입장료 포함)

 ▶ 쇼핑 타운이 밀집된 이국적인 풍경의 아메리칸 빌리지

 ▶ 오키나와 전통 시장 2023년 리뉴얼 재오픈한 마키시 공설 시장 및 국제 거리

 호텔 이동 및 체크인 후 휴식
조: 호텔식

중: 현지식
(도반야키고젠)

석: 현지식
(철판 스테이크)
 HOTEL 루트인 그란티아 호텔, 람브란트 스타일 나하 또는 동급 (2인 1실)
3일
오키나와















 호텔 조식 후
 1일 자유 관광
 -선택관광시-
 중북부 관광코스 100,000원/인 (성인/소아 요금 동일, 중식 포함, 8명 이상 출발)
 **3/29 출발부터 중북부 관광코스 120,000원/인으로 변경됩니다.
 ▶ 동남식물낙원 남국정취가 물씬 풍기는 1,300여종의 다양한 식물
 ▶ 미치노에키 카데나전망대 미공군기지를 볼수있는 전망대
 ▶ 해중도로 / 해중도로 전망대  4.75KM 해중도로 관광
 ▶ 누치마스 소금공장견학 & 카후절경 전망
    아름다운 오키나와의 바다에서 만들어진 생명의 소금
 자유석식 및 휴식
조: 호텔식

중: 현지식
(선택관광시)

석: 불포함
 HOTEL 루트인 그란티아 호텔, 람브란트 스타일 나하 또는 동급 (2인 1실)
4일
오키나와




부산
전용차량


ZE964





11:00
13:00
 호텔 조식 후

 일본 면세점 방문

 오키나와 국제 공항 도착 및 수속

 오키나와 국제 공항 출발

 김해 국제 공항 도착
조: 호텔식



오키나와 힐링 리조트 4일 PKG
[4월 말까지 항공 발권 조건입니다.]
**3/30~5/31 월수금 출발시간 변경 : 부산 09:00 / 오키나와 12:00
5월 특가
11, 19, 25
6월 특가
13, 27
출발일
&
상품가
5월
특가

11, 19
1,129,000
899,000
25
1,129,000
999,000
1
1,619,000
1,499,000
2,3
1,619,000
1,419,000
4
1,299,000
1,239,000
12
1,129,000
1,029,000
28
1,219,000
1,119,000
30
1,159,000
1,039,000
5월
6, 8
1,099,000원

5, 7, 14, 21

1,139,000원
9,16
1,049,000원
10, 13, 17,
18, 20, 26
1,069,000원
22
1,499,000원
23
1,459,000원
24
1,479,000원



오키나와 힐링 리조트 4일 PKG
[4월 말까지 항공 발권 조건입니다.]
**6월 이후 목, 토 운항
출발일
&
상품가
6월
4, 6
1,459,000원
11, 18, 25
1,239,000원
13, 27
999,000원
20
1,179,000원
7월
2, 9, 18, 25
1,259,000원
4, 11
1,199,000원
16
1,279,000원
23
1,319,000원
30
1,339,000원
8월
1
1,299,000원
6, 20
1,359,000원
8, 27
1,319,000원
13
1,379,000원
15
1,599,000원
22, 29
1,259,000원`;

const RAW_TEXT_HASH = crypto.createHash('sha256').update(RAW_TEXT).digest('hex');

// ── 가격 (원문 1:1 매핑) ──────────────────────────────────────
// 5월 특가일: 11, 19, 25 / 6월 특가일: 13, 27
const SPECIAL_DATES = new Set([
  '2026-05-11', '2026-05-19', '2026-05-25',
  '2026-06-13', '2026-06-27',
]);

function d(month, day, price, opts = {}) {
  const date = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return {
    date,
    price,
    confirmed: false, // 원문에 출확/출발확정 표기 없음
    note: opts.note || (SPECIAL_DATES.has(date) ? '특가' : null),
  };
}

const PRICE_DATES = [
  // 5월 — 특가 블록 (좌측 정가 → 우측 특가, 우측 사용)
  d(5, 1, 1499000),
  d(5, 2, 1419000), d(5, 3, 1419000),
  d(5, 4, 1239000),
  d(5, 11, 899000),  // 특가
  d(5, 12, 1029000),
  d(5, 19, 899000),  // 특가
  d(5, 25, 999000),  // 특가
  d(5, 28, 1119000),
  d(5, 30, 1039000),
  // 5월 — 정가 블록
  d(5, 5, 1139000), d(5, 7, 1139000), d(5, 14, 1139000), d(5, 21, 1139000),
  d(5, 6, 1099000), d(5, 8, 1099000),
  d(5, 9, 1049000), d(5, 16, 1049000),
  d(5, 10, 1069000), d(5, 13, 1069000), d(5, 17, 1069000),
  d(5, 18, 1069000), d(5, 20, 1069000), d(5, 26, 1069000),
  d(5, 22, 1499000),
  d(5, 23, 1459000),
  d(5, 24, 1479000),
  // 6월 (목, 토 운항)
  d(6, 4, 1459000), d(6, 6, 1459000),
  d(6, 11, 1239000), d(6, 18, 1239000), d(6, 25, 1239000),
  d(6, 13, 999000), d(6, 27, 999000),  // 특가
  d(6, 20, 1179000),
  // 7월
  d(7, 2, 1259000), d(7, 9, 1259000), d(7, 18, 1259000), d(7, 25, 1259000),
  d(7, 4, 1199000), d(7, 11, 1199000),
  d(7, 16, 1279000),
  d(7, 23, 1319000),
  d(7, 30, 1339000),
  // 8월
  d(8, 1, 1299000),
  d(8, 6, 1359000), d(8, 20, 1359000),
  d(8, 8, 1319000), d(8, 27, 1319000),
  d(8, 13, 1379000),
  d(8, 15, 1599000),
  d(8, 22, 1259000), d(8, 29, 1259000),
].sort((a, b) => a.date.localeCompare(b.date));

const MIN_PRICE = Math.min(...PRICE_DATES.map(p => p.price));
const MAX_PRICE = Math.max(...PRICE_DATES.map(p => p.price));

// ── 패키지 정의 ─────────────────────────────────────────────
const PKG1 = {
  title: '[힐링 리조트팩] 오키나와 4일 PKG',
  destination: '오키나와',
  country: '일본',
  category: 'package',
  product_type: '실속',
  trip_style: '3박4일',
  duration: 4,
  nights: 3,
  departure_airport: '부산(김해)',
  departure_days: null, // 5월은 자유, 6월 이후 목/토 (price_dates 로 표현)
  airline: 'ZE(이스타항공)',
  min_participants: 8, // 원문 verbatim "최소 출발 인원 8명"
  status: 'pending',
  price: MIN_PRICE,

  // 가이드경비 — 원문 "4만원 성인/아동 동일"
  guide_tip: '4만원/인 (성인/아동 동일, 현지지불)',

  // 싱글차지 — 원문 "18만 원/인 (1인 1박당 6만 원)"
  single_supplement: '18만원/인 (1인 1박당 6만원)',
  small_group_surcharge: null,

  // 날짜 기반 추가요금 없음 (특가/정가는 price_dates 로 차등 표현)
  surcharges: [],
  excluded_dates: [],

  price_tiers: [],
  price_dates: PRICE_DATES,

  // ── 포함/불포함 (원문 그대로 — W26 분리 적용) ──
  inclusions: [
    '왕복항공료',
    '공항이용료',
    '현지행사비',
    '전용 버스',
    '일정상 식사비',
    '해외여행자보험',
  ],
  excludes: [
    '가이드 경비 (4만원 성인/아동 동일)',
    '유류할증료 (4월 기준 111,000원)',
    '기타 개인경비',
  ],

  // ── 숙소 ──
  accommodations: [
    '사잔 비치 호텔, 그란메르 호텔, 베셀 레후 호텔 또는 동급 (2인 1실) × 1박',
    '루트인 그란티아 호텔, 람브란트 스타일 나하 또는 동급 (2인 1실) × 2박',
  ],

  // ── 셀링포인트 (해시태그 + 핵심 체험) ──
  product_highlights: [
    '리조트 1박 + 시내 2박 (전 일정 호텔)',
    '츄라우미 수족관 + 돌고래쇼 관람',
    '철판 스테이크 + 도반야키고젠 만찬',
    '3일차 1일 자유 관광 + 중북부 선택관광',
  ],

  product_summary: '부산에서 출발해 오키나와 리조트 1박과 시내 2박을 즐기는 3박4일 힐링 패키지예요. 1일차에 오키나와 월드와 슈리성을 거치고, 2일차에는 츄라우미 수족관과 만좌모 절벽까지 핵심만 짚어줘요. 3일차는 1일 자유라 휴식이나 중북부 선택관광 어느 쪽이든 편하게 고를 수 있어요.',

  product_tags: ['오키나와', '나하', '리조트1박', '시내2박', '철판스테이크', '자유일정1일', '츄라우미수족관', '오키나와월드', '부산출발', '이스타항공', '힐링'],

  // ── 선택관광 (3/29 이후 출발 = 120,000원/인) ──
  optional_tours: [
    {
      name: '중북부 관광코스',
      price_usd: null,
      price_krw: 120000,
      currency: 'KRW',
      region: '오키나와 중북부',
      note: '성인/소아 요금 동일, 중식 포함, 8명 이상 출발 / 동남식물낙원·미치노에키 카데나전망대·해중도로 및 전망대·누치마스 소금공장견학 & 카후절경',
    },
  ],

  // ── 유의사항 (원문 비고 verbatim, 축약 금지) ──
  notices_parsed: [
    {
      type: 'CRITICAL',
      title: '최소 출발 인원',
      text: '최소 출발 인원 8명입니다. 10명 미만 행사 시, 현지 차량 가이드로 진행됩니다.',
    },
    {
      type: 'PAYMENT',
      title: '싱글 차지',
      text: '싱글 차지 18만 원/인 (1인 1박당 6만 원) 추가됩니다.',
    },
    {
      type: 'PAYMENT',
      title: '어린이 / 유아 요금',
      text: '어린이 NO BED 불가 / 유아(24개월 미만) 판매가 10%.',
    },
    {
      type: 'INFO',
      title: '일정 변경 안내',
      text: '현지 사정에 의해 호텔 순서, 관광 순서 변경될 수도 있습니다.',
    },
    {
      type: 'INFO',
      title: '출발 시간 변경 (3/30~5/31)',
      text: '3/30~5/31 월·수·금 출발시간 변경: 부산 09:00 / 오키나와 12:00.',
    },
    {
      type: 'INFO',
      title: '6월 이후 운항 안내',
      text: '6월 이후 목·토 운항.',
    },
    {
      type: 'OPTIONAL',
      title: '슈리성 관광',
      text: '슈리성 정전은 화재로 소실되어 재건 중이며 관람 불포함입니다.',
    },
  ],

  // 내부 메모/고객 노출 자유 텍스트 모두 불필요 (P0~P1 정책)
  customer_notes: null,
  internal_notes: null,

  // ── 일정표 ──
  itinerary_data: {
    meta: {
      title: '[힐링 리조트팩] 오키나와 4일 PKG',
      product_type: '실속',
      destination: '오키나와',
      nights: 3,
      days: 4,
      departure_airport: '부산(김해)',
      airline: 'ZE(이스타항공)',
      flight_out: 'ZE963',
      flight_in: 'ZE964',
      departure_days: null,
      min_participants: 8,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-30',
      hashtags: ['#리조트1박', '#시내2박', '#철판스테이크포함', '#자유일정1일', '#츄라우미수족관', '#오키나와월드', '#부산출발'],
      brand: '여소남',
    },
    highlights: {
      inclusions: [
        '왕복항공료',
        '공항이용료',
        '현지행사비',
        '전용 버스',
        '일정상 식사비',
        '해외여행자보험',
      ],
      excludes: [
        '가이드 경비 (4만원 성인/아동 동일)',
        '유류할증료 (4월 기준 111,000원)',
        '기타 개인경비',
      ],
      shopping: '일본 면세점 1곳 방문 (4일차)',
      remarks: [
        '최소 출발 인원 8명 (10명 미만 시 현지 차량 가이드로 진행)',
        '싱글 차지 18만원/인 (1인 1박당 6만원)',
        '어린이 NO BED 불가 / 유아(24개월 미만) 판매가 10%',
        '3/30~5/31 월·수·금 출발시간 변경: 부산 09:00 / 오키나와 12:00',
        '6월 이후 목·토 운항',
        '슈리성 정전은 화재로 소실되어 재건 중 (불포함)',
        '현지 사정에 의해 호텔 순서, 관광 순서 변경 가능',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '오키나와'],
        meals: meal(false, true, true, null, '현지식', '현지식 (치킨 정식)'),
        schedule: [
          normal('06:00', '김해 국제공항 미팅 및 수속'),
          flight('08:00', 'ZE963 부산(김해) 출발 → 오키나와 10:00 도착', 'ZE963'),
          normal(null, '▶세나카지마 우미카지테라스 (오키나와 핫플)'),
          normal(null, '▶오키나와 월드 (일본 3대 종유 동굴·류큐 왕국촌·에이샤 공연)'),
          normal(null, '▶마사히로주조 (오키나와 전통주 아와모리 공장)'),
          normal(null, '▶슈리성 (정전 불포함, 화재로 소실되어 재건 중)'),
          normal(null, '호텔 이동 및 체크인'),
          { time: null, activity: '사잔 비치 호텔, 그란메르 호텔, 베셀 레후 호텔 또는 동급 (2인 1실) 호텔 투숙 및 휴식', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '사잔 비치 호텔, 그란메르 호텔, 베셀 레후 호텔 또는 동급 (2인 1실)', grade: null, note: null },
      },
      {
        day: 2,
        regions: ['오키나와'],
        meals: meal(true, true, true, '호텔식', '현지식 (도반야키고젠)', '현지식 (철판 스테이크)'),
        schedule: [
          normal(null, '호텔 조식 후 출발'),
          normal(null, '▶해양 기념 공원 – 츄라우미 수족관, 돌고래쇼 관광'),
          normal(null, '▶만좌모 (오키나와 절정 해안 절벽 / 전망대 입장료 포함)'),
          normal(null, '▶아메리칸 빌리지 (쇼핑 타운이 밀집된 이국적인 풍경)'),
          normal(null, '▶마키시 공설 시장 및 국제 거리 (2023년 리뉴얼 재오픈한 오키나와 전통 시장)'),
          normal(null, '호텔 이동 및 체크인'),
          { time: null, activity: '루트인 그란티아 호텔, 람브란트 스타일 나하 또는 동급 (2인 1실) 호텔 투숙 및 휴식', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '루트인 그란티아 호텔, 람브란트 스타일 나하 또는 동급 (2인 1실)', grade: null, note: null },
      },
      {
        day: 3,
        regions: ['오키나와'],
        meals: meal(true, true, false, '호텔식', '현지식 (선택관광시)', null),
        schedule: [
          normal(null, '호텔 조식 후 1일 자유 관광'),
          optional(null, '중북부 관광코스 (선택관광 / 120,000원·성인소아 동일·중식 포함·8명 이상 출발)', '동남식물낙원·미치노에키 카데나전망대·해중도로 및 전망대·누치마스 소금공장견학 & 카후절경'),
          normal(null, '자유 석식 및 휴식'),
          { time: null, activity: '루트인 그란티아 호텔, 람브란트 스타일 나하 또는 동급 (2인 1실) 호텔 투숙 및 휴식', type: 'hotel', transport: null, note: null },
        ],
        hotel: { name: '루트인 그란티아 호텔, 람브란트 스타일 나하 또는 동급 (2인 1실)', grade: null, note: null },
      },
      {
        day: 4,
        regions: ['오키나와', '부산'],
        meals: meal(true, false, false, '호텔식', null, null),
        schedule: [
          normal(null, '호텔 조식 후 출발'),
          shopping(null, '▶일본 면세점 방문'),
          normal(null, '오키나와 국제 공항 이동 및 수속'),
          flight('11:00', 'ZE964 오키나와 출발 → 부산(김해) 13:00 도착', 'ZE964'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [
      {
        name: '중북부 관광코스',
        price_usd: null,
        price_krw: 120000,
        currency: 'KRW',
        region: '오키나와 중북부',
        note: '성인/소아 동일·중식 포함·8명 이상 출발 / 동남식물낙원·미치노에키 카데나전망대·해중도로 및 전망대·누치마스 소금공장견학 & 카후절경',
      },
    ],
  },

  itinerary: [
    '제1일: 부산(ZE963 08:00) → 오키나와(10:00) → 우미카지테라스 → 오키나와 월드 → 마사히로주조 → 슈리성 → 리조트 호텔 (1박)',
    '제2일: 츄라우미 수족관 + 돌고래쇼 → 만좌모 → 아메리칸 빌리지 → 마키시 공설 시장 & 국제 거리 → 시내 호텔 (도반야키고젠 / 철판 스테이크)',
    '제3일: 1일 자유 관광 (선택관광 — 중북부 관광코스 120,000원/인) → 자유 석식 → 시내 호텔',
    '제4일: 호텔 조식 → 일본 면세점 → 오키나와(ZE964 11:00) → 부산(13:00)',
  ],

  raw_text: RAW_TEXT,
  raw_text_hash: RAW_TEXT_HASH,
  filename: 'manual_input_20260427_okinawa',
  file_type: 'manual',
  confidence: 1.0,

  // ── Agent self-audit (Step 6.5, 제로-코스트) ──
  agent_audit_report: {
    parser_version: 'register-v2026.04.27-opus-4.7',
    ran_at: new Date().toISOString(),
    claims: [
      { id: 'min_participants', field: 'min_participants', severity: 'HIGH',
        text: 'min_participants: 8',
        evidence: '"▶ 최소 출발 인원 8명입니다."',
        supported: true, note: null },
      { id: 'ticketing_deadline', field: 'ticketing_deadline', severity: 'HIGH',
        text: 'ticketing_deadline: 2026-04-30',
        evidence: '"[4월 말까지 항공 발권 조건입니다.]" → 4월 말 = 4/30',
        supported: true, note: null },
      { id: 'inclusions:no_amount', field: 'inclusions', severity: 'CRITICAL',
        text: 'inclusions에 금액 토큰 주입 없음',
        evidence: '원문 verbatim: "왕복항공료 및 공항이용료, 현지행사비, 전용 버스, 일정상 식사비, 해외여행자보험"',
        supported: true, note: '"2억 여행자보험" 같은 환각 없음' },
      { id: 'excludes:fuel', field: 'excludes', severity: 'HIGH',
        text: 'excludes 유류할증료 4월 111,000원',
        evidence: '"유류할증료(4월 기준 111,000원)"',
        supported: true, note: null },
      { id: 'optional:120k', field: 'optional_tours', severity: 'MEDIUM',
        text: '중북부 관광코스 120,000원/인',
        evidence: '"**3/29 출발부터 중북부 관광코스 120,000원/인으로 변경됩니다." + 본 상품 5월~ 출발',
        supported: true, note: null },
      { id: 'flights:single', field: 'meta.flight_out/in', severity: 'HIGH',
        text: 'flight_out=ZE963, flight_in=ZE964',
        evidence: '원문 1일자 교통편 컬럼: ZE963 / 4일자: ZE964',
        supported: true, note: null },
      { id: 'day1:regions', field: 'days[0].regions', severity: 'HIGH',
        text: 'Day1 regions: [부산, 오키나와]',
        evidence: '원문 1일자 지역 컬럼: "부산 / 오키나와"',
        supported: true, note: null },
      { id: 'day4:regions', field: 'days[3].regions', severity: 'HIGH',
        text: 'Day4 regions: [오키나와, 부산]',
        evidence: '원문 4일자 지역 컬럼: "오키나와 / 부산"',
        supported: true, note: null },
      { id: 'surcharges:none', field: 'surcharges', severity: 'HIGH',
        text: 'surcharges: []',
        evidence: '원문에 날짜별 추가요금 표기 없음 (특가/정가 차등은 price_dates 로 표현)',
        supported: true, note: null },
    ],
    overall_verdict: 'clean',
    unsupported_critical: 0,
    unsupported_high: 0,
  },
};

// ── Pre-INSERT self-check (W26~W28) ──────────────────────────
function preflightCheck(packages) {
  for (const p of packages) {
    // W26: inclusions 콤마 포함 단일 문자열 금지
    for (const inc of (p.inclusions || [])) {
      if (typeof inc === 'string' && inc.split(/,(?=\s*\D)/).length > 1)
        throw new Error(`[W26 self-check] inclusions "${inc}" 콤마 포함 — 분리 필요`);
    }
    // W27: 하루 flight 여러개면 "→" 토큰 필수
    const days = Array.isArray(p.itinerary_data) ? p.itinerary_data : (p.itinerary_data?.days || []);
    for (const dy of days) {
      const flights = (dy.schedule || []).filter(s => s.type === 'flight');
      if (flights.length > 1 && flights.some(f => !/→|↦|⇒/.test(f.activity || '')))
        throw new Error(`[W27 self-check] Day ${dy.day} flight ${flights.length}개 but "→" 토큰 누락`);
    }
    // W28: "호텔 투숙/휴식" 앞절 붙이기 금지 (normal 타입에서)
    for (const dy of days) {
      for (const s of (dy.schedule || [])) {
        if (s.type !== 'normal' || !s.activity) continue;
        if (/호텔\s*(?:투숙|휴식|체크인|체크 인)/.test(s.activity) && !/^[*\s]*호텔/.test(s.activity))
          throw new Error(`[W28 self-check] Day ${dy.day} "${s.activity}" — 앞절 붙이기 금지`);
      }
    }
    // raw_text + hash
    if (!p.raw_text || p.raw_text.length < 50)
      throw new Error('[RuleZero self-check] raw_text 누락 또는 짧음');
    if (!p.raw_text_hash || p.raw_text_hash.length !== 64)
      throw new Error('[RuleZero self-check] raw_text_hash 누락 또는 형식 오류');
  }
}

// ── dry-run ──────────────────────────────────────────────────
function dryRun() {
  console.log('\n=== dry-run 검증 ===\n');
  preflightCheck([PKG1]);
  console.log('Pre-INSERT self-check 통과 (W26/W27/W28/RuleZero)\n');

  const { errors, warnings } = validatePackage(PKG1);
  if (warnings.length > 0) {
    console.log(`경고 (${PKG1.title}):`);
    warnings.forEach(w => console.log(`   W: ${w}`));
  }
  if (errors.length > 0) {
    console.error(`\n검증 실패 (${errors.length}건):`);
    errors.forEach(e => console.error(`   E: ${e}`));
    process.exit(1);
  }
  console.log('validatePackage 통과\n');
  console.log(`title:           ${PKG1.title}`);
  console.log(`destination:     ${PKG1.destination}`);
  console.log(`duration:        ${PKG1.nights}박 ${PKG1.duration}일`);
  console.log(`airline:         ${PKG1.airline}`);
  console.log(`flights:         ${PKG1.itinerary_data.meta.flight_out} / ${PKG1.itinerary_data.meta.flight_in}`);
  console.log(`min_participants:${PKG1.min_participants}`);
  console.log(`price_dates:     ${PKG1.price_dates.length}건 (${MIN_PRICE.toLocaleString()}원 ~ ${MAX_PRICE.toLocaleString()}원)`);
  console.log(`특가일:          ${PKG1.price_dates.filter(p => p.note === '특가').length}건`);
  console.log(`inclusions:      ${PKG1.inclusions.length}건`);
  console.log(`excludes:        ${PKG1.excludes.length}건`);
  console.log(`optional_tours:  ${PKG1.optional_tours.length}건`);
  console.log(`itinerary:       ${PKG1.itinerary_data.days.length}일`);
  console.log(`notices_parsed:  ${PKG1.notices_parsed.length}건`);
  console.log(`raw_text_hash:   ${RAW_TEXT_HASH.slice(0, 16)}... (${RAW_TEXT.length}자)`);
}

// ── 실행 분기 ─────────────────────────────────────────────────
const ALL_PACKAGES = [PKG1];
const doInsert = process.argv.includes('--insert');

if (doInsert) {
  preflightCheck(ALL_PACKAGES);
  inserter.run(ALL_PACKAGES);
} else {
  dryRun();
  console.log('\n→ 실제 등록:  node db/insert_tourphone_okinawa_20260427.js --insert\n');
}
