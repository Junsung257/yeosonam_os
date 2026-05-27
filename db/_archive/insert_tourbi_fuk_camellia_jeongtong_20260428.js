/**
 * 투어비 — [카멜리아] 정통 북큐슈 3박4일 패키지
 * 등록일: 2026-04-28
 * 랜드사: 투어비 (9% 마진, 5~9월 모두 9% 단일)
 * 교통: 카멜리아 페리 (부산-하카타) 22:30→07:30 / (하카타-부산) 12:30→18:30
 * 일정: 3박4일 (선상 1박 + 유후인/뱃부/키츠키 1박 + 후쿠오카 시내 1박)
 *
 * verbatim 정책 (ERR-FUK-camellia-overcorrect@2026-04-28 학습):
 *   ✓ schedule activity = 원문 verbatim ("태재부 천만궁" 그대로, "다자이후" 변환 X)
 *   ✓ regions = 지역 컬럼만 (교통편 카멜리아·전용버스 제외)
 *   ✓ inclusions = 단어 추가 금지 ("(카멜리아)" 보강 X)
 *   ✓ notices_parsed = verbatim
 *   ✓ 콤마는 원문 그대로 (W31 휴리스틱 자동 보호)
 *
 * 원문 특이점 (internal_notes 보존):
 *   - 원문 일정표 "제2일" 라벨 중복 → 4일 일정으로 정상 라벨링
 *   - 헤더 "하카타-부산 18:30" vs 일정표 "18:00" → meta 는 헤더 기준
 *   - D1 집결 2층 (시내 패키지는 3층)
 *   - D2 마지막 "호텔 체크인 및 석식 (♨온천욕)" → W28 룰 따라 "♨온천욕 / 석식" 별도 normal + "호텔 투숙 및 휴식"
 */

const fs = require('fs');
const path = require('path');
const { createInserter } = require('./templates/insert-template');

const RAW_TEXT = fs.readFileSync(path.resolve(__dirname, 'sample.txt'), 'utf-8');
const TODAY = '2026-04-28';

// ─── 가격 매트릭스 (날짜 → 가격, X는 출발 불가) ──────────────────
const PRICING_BY_DATE = {
  // 5월 (10일)
  '2026-05-08': 539000,
  '2026-05-12': 479000, '2026-05-15': 539000,
  '2026-05-17': 479000, '2026-05-20': 489000, '2026-05-21': 539000, '2026-05-23': 579000,
  '2026-05-25': 479000, '2026-05-28': 539000,
  '2026-05-31': 479000,
  // 6월 (24일)
  '2026-06-01': 529000, '2026-06-02': 529000, '2026-06-03': 549000,
  '2026-06-04': 759000, '2026-06-05': 599000, '2026-06-06': 529000,
  '2026-06-07': 529000, '2026-06-08': 529000, '2026-06-09': 529000, '2026-06-10': 549000,
  '2026-06-11': 619000, '2026-06-12': 599000, '2026-06-13': 529000,
  '2026-06-14': 529000, '2026-06-15': 529000, '2026-06-16': 529000, '2026-06-19': 599000,
  '2026-06-21': 529000, '2026-06-22': 529000, '2026-06-23': 529000, '2026-06-26': 599000,
  '2026-06-28': 529000, '2026-06-29': 529000, '2026-06-30': 529000,
  // 7월 (25일)
  '2026-07-03': 629000,
  '2026-07-05': 549000, '2026-07-06': 549000, '2026-07-07': 549000, '2026-07-10': 629000,
  '2026-07-12': 549000, '2026-07-13': 549000, '2026-07-14': 549000, '2026-07-15': 579000,
  '2026-07-16': 769000, '2026-07-17': 769000, '2026-07-18': 589000,
  '2026-07-19': 569000, '2026-07-20': 569000, '2026-07-21': 569000, '2026-07-22': 579000,
  '2026-07-23': 649000, '2026-07-24': 639000, '2026-07-25': 569000,
  '2026-07-26': 589000, '2026-07-27': 589000, '2026-07-28': 589000, '2026-07-29': 599000,
  '2026-07-30': 649000, '2026-07-31': 639000,
  // 8월 (28일)
  '2026-08-01': 599000,
  '2026-08-02': 589000, '2026-08-03': 589000, '2026-08-04': 589000, '2026-08-05': 599000,
  '2026-08-06': 649000, '2026-08-07': 679000, '2026-08-08': 599000,
  '2026-08-09': 569000, '2026-08-10': 569000, '2026-08-11': 549000, '2026-08-12': 599000,
  '2026-08-13': 669000, '2026-08-14': 779000, '2026-08-15': 759000,
  '2026-08-16': 549000, '2026-08-17': 549000, '2026-08-18': 549000, '2026-08-19': 579000,
  '2026-08-20': 639000, '2026-08-21': 629000, '2026-08-22': 559000,
  '2026-08-23': 549000, '2026-08-24': 549000, '2026-08-25': 549000, '2026-08-28': 629000,
  '2026-08-30': 549000, '2026-08-31': 549000,
  // 9월 (24일)
  '2026-09-01': 549000, '2026-09-04': 629000,
  '2026-09-06': 549000, '2026-09-07': 549000, '2026-09-08': 549000, '2026-09-11': 629000,
  '2026-09-13': 549000, '2026-09-14': 549000, '2026-09-15': 549000,
  '2026-09-16': 609000, '2026-09-17': 669000, '2026-09-18': 699000, '2026-09-19': 659000,
  '2026-09-20': 659000, '2026-09-21': 599000, '2026-09-22': 579000,
  '2026-09-23': 899000, '2026-09-24': 899000, '2026-09-25': 899000, '2026-09-26': 559000,
  '2026-09-27': 549000, '2026-09-28': 549000, '2026-09-29': 549000, '2026-09-30': 659000,
};

function buildPriceDates() {
  return Object.entries(PRICING_BY_DATE)
    .filter(([date]) => date > TODAY)
    .map(([date, price]) => ({ date, price, confirmed: false }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── helpers ─────────────────────────────────────────────
const flight = (time, activity, transport) => ({ time, activity, type: 'flight', transport, note: null });
const normal = (time, activity, note) => ({ time: time || null, activity, type: 'normal', transport: null, note: note || null });
const shopping = (time, activity, note) => ({ time: time || null, activity, type: 'shopping', transport: null, note: note || null });
const meal = (b, l, d, bn, ln, dn) => ({
  breakfast: b, lunch: l, dinner: d,
  breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null,
});

// ─── meta ────────────────────────────────────────────────
const META = {
  airline: '카멜리아 (선박)',
  flight_out: '카멜리아',
  flight_in: '카멜리아',
  departure_airport: '부산항 국제여객터미널',
  arrival_airport: '하카타항',
  flight_out_dep_time: '22:30',
  flight_out_arr_time: '07:30',
  flight_in_dep_time: '12:30',
  flight_in_arr_time: '18:30',
};

function buildPackage() {
  return {
    title: '[카멜리아] 정통 북큐슈 3박4일 PKG',
    destination: '후쿠오카',
    country: '일본',
    duration: 4,
    nights: 3,
    product_type: '정통 북큐슈',
    airline: '카멜리아 (선박)',
    departure_airport: '부산항 국제여객터미널',
    min_participants: 10,
    raw_text: RAW_TEXT,
    price_dates: buildPriceDates(),
    accommodations: [
      '카멜리아 페리 (다인실 기준) — 선상 1박',
      '코코노에 유유테이 / 호센지 유모토야 / 우키하 호텔 OR 동급 (2-3인실) — 유후인/뱃부/키츠키 1박',
      '후쿠오카 유벨 / WBF 하카타 그란데 / 크로스라이프하카타 야나기바시 OR 동급 (트윈) — 후쿠오카 시내 1박',
    ],
    product_summary: '카멜리아 페리로 떠나는 정통 북큐슈 3박4일! 유후인 긴린코 호수·뱃부 가마도 지옥온천·키츠키 사무라이 마을·다자이후 천만궁까지 큐슈의 전통과 온천을 알차게 담은 패키지.',
    product_highlights: [
      '카멜리아 페리 왕복 (선상 1박 포함)',
      '유후인 긴린코 호수 · 민예거리',
      '뱃부 가마도 지옥온천 (족욕 체험) · 유노하나',
      '키츠키 사무라이 마을 · 다자이후 천만궁 · 오호리공원',
    ],
    inclusions: [
      '왕복 훼리비',
      '부두세 & 유류세',
      '출국세',
      '관광지 입장료',
      '가이드',
      '전용버스',
      '여행자보험',
      '현지식 2회',
      '호텔식 3회',
    ],
    excludes: [
      '가이드&기사팁 3만원/1인',
      '기타 개인비용',
      '일정표에 기재된 불포함 식사',
      '싱글차지 8만원',
    ],
    surcharges: [],
    optional_tours: [],
    customer_notes:
      '▶ 선실은 다인실 기준이며, 업그레이드는 대기 조건으로 가능합니다.\n' +
      '   업그레이드 비용 (왕복 기준, 인당): 1등실 6만원, 특등실 1인실 20만원 / 2·3인실 16만원\n' +
      '▶ 취소 수수료: 당일 50%, 1주일전~1일전 30% 적용\n' +
      '▶ 상기 일정은 선박 및 현지 사정에 의하여 변동될 수 있습니다.',
    internal_notes:
      '[랜드사 투어비 / 마진 9%]\n' +
      '- 출확 인원 10명 (원문 명시)\n' +
      '- 발권기한 명시 없음\n' +
      '- 원문 일정표 "제2일" 라벨 중복 표기 → 4일 일정 (3박4일) 으로 정상 라벨링\n' +
      '- 도착시간 헤더 "하카타-부산 12:30~18:30" vs 일정표 "18:00" → meta 는 헤더 기준 18:30\n' +
      '- D1 부산 국제 여객 터미널 2층 집결 (시내 패키지는 3층)\n' +
      '- D2 마지막 "호텔 체크인 및 석식 (♨온천욕)" → W28 룰 따라 ♨온천욕+석식 / 호텔 투숙 및 휴식 으로 분리',
    notices_parsed: [
      { type: 'INFO', text: '쇼핑센터 1회' },
      { type: 'POLICY', text: '선실은 다인실 기준 — 업그레이드 대기 조건 (왕복 기준 인당): 1등실 6만원, 특등실 1인실 20만원 / 2·3인실 16만원' },
      { type: 'PAYMENT', text: '취소 수수료 — 당일 50%, 1주일전~1일전 30% 적용' },
      { type: 'INFO', text: '상기 일정은 선박 및 현지 사정에 의하여 변동될 수 있습니다' },
    ],
    itinerary_data: {
      meta: META,
      highlights: {
        inclusions: ['왕복 훼리비', '부두세&유류세', '출국세', '관광지 입장료', '가이드', '전용버스', '여행자보험', '현지식 2회', '호텔식 3회'],
        excludes: ['가이드&기사팁 3만원', '싱글차지 8만원', '개인비용'],
        shopping: '쇼핑센터 1회 (면세점)',
        remarks: [
          '10명부터 출발 확정',
          '선실 다인실 기준 (업그레이드 대기)',
          '온천 호텔 (D2 ♨온천욕 포함)',
        ],
      },
      days: [
        {
          // 원문 "제1일"
          day: 1,
          regions: ['부산'],
          schedule: [
            normal('18:00', '부산 국제 여객 터미널 2층 집결'),
            normal('19:00', '훼리 수속 후 승선'),
            flight('22:30', '부산항 출항 → 하카타항 22:30 출발 → 익일 07:30 도착 (카멜리아)', '카멜리아 페리'),
            normal(null, '선내 휴식'),
          ],
          meals: meal(false, false, false, null, null, '불포함'),
          hotel: { name: '카멜리아 페리 (다인실 기준)', grade: null, facility_type: 'cabin' },
        },
        {
          // 원문 "제2일" 첫 번째 — 실제 D2
          day: 2,
          regions: ['후쿠오카', '유후인', '뱃부', '키츠키'],
          schedule: [
            normal('07:30', '하카타항 하선'),
            normal(null, '유후인 이동'),
            normal(null, '▶유후인 여행의 상징이자 필수 코스 긴린코 호수 관광'),
            normal(null, '▶아기자기한 상점들이 즐비하여 동화마을 같은 민예거리 관광'),
            normal(null, '뱃부 이동'),
            normal(null, '▶신비한 지옥온천인 가마도 지옥온천(족욕 체험) 관광'),
            normal(null, '▶유황재배지인 유노하나 관광'),
            normal(null, '키츠키 이동'),
            normal(null, '▶큐슈 속 작은 교토 일본 사무라이 마을 키츠키 성하 마을 관광'),
            normal(null, '# 스야노사카 관광 # 사무라이 전통 가옥 오하라 저택 관광'),
            normal(null, '♨온천욕 / 석식'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(false, true, true, '불포함', '현지식', '호텔식'),
          hotel: {
            name: '코코노에 유유테이 / 호센지 유모토야 / 우키하 호텔 OR 동급',
            grade: null,
            note: '2-3인실',
          },
        },
        {
          // 원문 "제2일" 두 번째 — 실제 D3
          day: 3,
          regions: ['후쿠오카'],
          schedule: [
            normal(null, '호텔 조식 후 후쿠오카 이동'),
            normal(null, '▶약 3천개의 개구리 석상이 있는 뇨이린지 관광'),
            normal(null, '▶일본의 학문의 신을 모신 태재부 천만궁 관광'),
            normal(null, '▶후쿠오카 시민들의 휴식처 오호리공원 산책'),
            normal(null, '▶라라포트 자유 관광'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(true, true, false, '호텔식', '현지식', '불포함'),
          hotel: {
            name: '후쿠오카 유벨 / WBF 하카타 그란데 / 크로스라이프하카타 야나기바시 OR 동급',
            grade: null,
            note: '트윈',
          },
        },
        {
          // 원문 "제3일" — 실제 D4
          day: 4,
          regions: ['후쿠오카', '부산'],
          schedule: [
            normal(null, '호텔 조식 후 출발'),
            normal(null, '▶베이사이드플레이스 관광'),
            normal(null, '▶하카타 포트 타워 (외관) 관광'),
            shopping(null, '면세점 1회 방문'),
            normal(null, '하카타항으로 이동 / 승선 준비'),
            flight('12:30', '하카타항 → 부산항 12:30 출발 → 18:30 도착 (카멜리아)', '카멜리아 페리'),
            normal('18:30', '부산 국제 여객 터미널 도착 / 입국 수속 후 안녕히'),
          ],
          meals: meal(true, false, false, '호텔식', '불포함', null),
          hotel: null,
        },
      ],
    },
    agent_audit_report: {
      parser_version: 'register-v2026.04.28-sonnet-4.7-camellia-fix',
      ran_at: new Date().toISOString(),
      claims: [
        { id: 'min_participants', field: 'min_participants', severity: 'HIGH',
          text: '10명부터 출발 확정',
          evidence: '원문 인원: "▶10명부터 출발 확정"',
          supported: true },
        { id: 'duration_4', field: 'duration', severity: 'CRITICAL',
          text: '3박4일 (duration=4, nights=3)',
          evidence: '원문 제목: "[카멜리아] 정통 북큐슈 3박4일 PKG"',
          supported: true,
          note: '원문 일정표 "제2일" 라벨 중복 — 4일 일정으로 정상화' },
        { id: 'transport_camellia', field: 'meta.airline', severity: 'CRITICAL',
          text: '카멜리아 페리 (부산-하카타 22:30→07:30 / 하카타-부산 12:30→18:30)',
          evidence: '원문 헤더: "선박 스케쥴 부산 – 하카타 22:30 – 07:30 / 하카타 – 부산 12:30 – 18:30"',
          supported: true },
        { id: 'arrival_time_18_30', field: 'meta.flight_in_arr_time', severity: 'HIGH',
          text: '18:30 (헤더 기준)',
          evidence: '원문 헤더 18:30 vs 일정표 18:00 — 헤더 기준 적용, 일정표 18:00 표기는 raw_text 보존',
          supported: true },
        { id: 'taejaebu_verbatim', field: 'days[2].schedule', severity: 'CRITICAL',
          text: '"태재부 천만궁" verbatim 보존 (다자이후 변환 X)',
          evidence: '원문 D3 (제2일 두 번째): "▶일본의 학문의 신을 모신 태재부 천만궁 관광"',
          supported: true,
          note: 'ERR-FUK-camellia-overcorrect@2026-04-28 학습 — schedule = verbatim, attractions aliases 가 흡수' },
        { id: 'inclusions_no_paren', field: 'inclusions', severity: 'CRITICAL',
          text: '"왕복 훼리비" (괄호 환각 보강 X)',
          evidence: '원문 포함: "▶왕복훼리비, 부두세&유류세, 출국세, 관광지입장료, 가이드, 전용버스, 여행자보험"',
          supported: true,
          note: 'ERR-FUK-camellia-overcorrect 학습 — "(카멜리아)" 같은 단어 추가 금지' },
        { id: 'd1_regions_busan_only', field: 'days[0].regions', severity: 'HIGH',
          text: '["부산"] (카멜리아 = 교통편이라 region 제외)',
          evidence: '원문 D1 지역 컬럼: "부산", 교통편 컬럼: "카멜리아"',
          supported: true,
          note: 'ERR-FUK-camellia-overcorrect 학습 — regions 는 지역 컬럼만' },
        { id: 'd2_regions_4', field: 'days[1].regions', severity: 'HIGH',
          text: '["후쿠오카","유후인","뱃부","키츠키"]',
          evidence: '원문 D2 지역 컬럼: "후쿠오카 / 유후인 / 뱃부 / 키츠키"',
          supported: true },
        { id: 'd2_hotel_3_options', field: 'days[1].hotel', severity: 'CRITICAL',
          text: '코코노에 유유테이 / 호센지 유모토야 / 우키하 호텔 OR 동급 (2-3인실)',
          evidence: '원문 D2 HOTEL: "코코노에 유유테이 / 호센지 유모토야 / 우키하 호텔 또는 동급 (2-3인실)"',
          supported: true,
          note: '호텔 등급 원문 명시 없음 → grade=null, room_type=2-3인실 (note 필드)' },
        { id: 'd3_hotel_3_options', field: 'days[2].hotel', severity: 'CRITICAL',
          text: '후쿠오카 유벨 / WBF 하카타 그란데 / 크로스라이프하카타 야나기바시 OR 동급 (트윈)',
          evidence: '원문 D3 HOTEL: "후쿠오카 유벨 / WBF 하카타 그란데 / 크로스라이프하카타 야나기바시 또는 동급 (트윈)"',
          supported: true },
        { id: 'd2_onsen_split', field: 'days[1].schedule', severity: 'HIGH',
          text: '"호텔 체크인 및 석식 (♨온천욕)" → "♨온천욕 / 석식" + "호텔 투숙 및 휴식" 분리',
          evidence: '원문 D2 마지막: "호텔 체크인 및 석식 (♨온천욕)" — W28 룰 따라 분리',
          supported: true,
          note: 'W28 (ERR-HSN-render-bundle): "호텔 체크인 및 석식" 같은 앞절 붙이기 금지 → "호텔 투숙 및 휴식" 고정 + 부속 정보 별도 normal' },
        { id: 'd2_sub_bullet_verbatim', field: 'days[1].schedule', severity: 'HIGH',
          text: '"# 스야노사카 관광 # 사무라이 전통 가옥 오하라 저택 관광" verbatim',
          evidence: '원문 D2: "# 스야노사카 관광 # 사무라이 전통 가옥 오하라 저택 관광" (▶ 마커 아님 — 키츠키 성하 마을 부속 코스)',
          supported: true,
          note: '▶ 변환 X (verbatim 우선). attractions 미매칭 시 unmatched_activities 자동 적재' },
        { id: 'meals_3_hotel_2_local', field: 'inclusions', severity: 'HIGH',
          text: '현지식 2회 / 호텔식 3회',
          evidence: '원문 포함: "▶현지식2회. 호텔식3회" + 일정표: D2 중:현지식·석:호텔식 / D3 조:호텔식·중:현지식 / D4 조:호텔식 = 호텔3+현지2',
          supported: true },
        { id: 'shopping_1', field: 'highlights.shopping', severity: 'HIGH',
          text: '쇼핑센터 1회',
          evidence: '원문 쇼핑센터 항목: "▶쇼핑센터 1회" + D4 일정표 "면세점 1회 방문"',
          supported: true },
        { id: 'd4_verbatim_annyeong', field: 'days[3].schedule', severity: 'HIGH',
          text: '"입국 수속 후 안녕히" (의역 X)',
          evidence: '원문 D4: "입국 수속 후 안녕히~ 즐거운 여행 되셨기를 바랍니다:)"',
          supported: true },
        { id: 'price_high_chuseok', field: 'price_dates', severity: 'HIGH',
          text: '9/23~25 899,000원 (추석 연휴)',
          evidence: '원문 9월 가격표 9/23·24·25 = 899,000',
          supported: true },
        { id: 'no_room_change_fee', field: 'notices_parsed', severity: 'MEDIUM',
          text: '호텔 룸타입 변경 요금 표기 없음 (시내 패키지와 다름)',
          evidence: '원문 REMARK 에 "호텔 객실 더블 기준 룸타입 변경 요금" 항목 없음 — 정통 패키지는 다인 또는 트윈 기준',
          supported: true },
      ],
      overall_verdict: 'clean',
      unsupported_critical: 0,
      unsupported_high: 0,
    },
  };
}

async function main() {
  const inserter = createInserter({
    landOperator: '투어비',
    commissionRate: 9,
    ticketingDeadline: null,
    destCode: 'FUK',
  });

  const packages = [buildPackage()];

  console.log(`\n📦 등록 대상: ${packages.length}건`);
  packages.forEach((p, i) => {
    const minPrice = Math.min(...p.price_dates.map(d => d.price));
    const maxPrice = Math.max(...p.price_dates.map(d => d.price));
    console.log(`   ${i + 1}. ${p.title} (price_dates: ${p.price_dates.length}건, ${minPrice.toLocaleString()}원 ~ ${maxPrice.toLocaleString()}원)`);
  });

  // ─── Pre-INSERT Self-Check (W26~W31) ─────────────────
  console.log('\n🔍 Pre-INSERT Self-Check 진행...');
  for (const p of packages) {
    for (const inc of (p.inclusions || [])) {
      if (typeof inc === 'string') {
        let depth = 0;
        for (let i = 0; i < inc.length; i++) {
          const ch = inc[i];
          if (ch === '(' || ch === '[' || ch === '{') depth++;
          else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
          else if (ch === ',' && depth === 0) {
            const prev = inc[i - 1];
            const nextRest = inc.slice(i + 1, i + 4);
            if (!(/\d/.test(prev || '') && /^\d{3}/.test(nextRest))) {
              throw new Error(`[W26 self-check] inclusions "${inc}" 콤마 포함 — 분리 필요`);
            }
          }
        }
      }
    }
    if (!p.raw_text || p.raw_text.length < 50) {
      throw new Error(`[RuleZero self-check] ${p.title} raw_text 누락 또는 짧음`);
    }
  }
  console.log('   ✅ self-check 통과 (W26 콤마 / RuleZero raw_text)');

  await inserter.run(packages);
}

main().catch(err => {
  console.error('\n❌ 등록 실패:', err);
  process.exit(1);
});
