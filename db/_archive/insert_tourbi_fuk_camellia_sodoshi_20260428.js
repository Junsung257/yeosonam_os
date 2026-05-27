/**
 * 투어비 — [카멜리아] 소도시+후쿠오카 3박4일 패키지
 * 등록일: 2026-04-28
 * 랜드사: 투어비 (9% 마진, 5~9월 모두 9% 단일)
 * 교통: 카멜리아 페리 (부산-하카타) 22:30→07:30 / (하카타-부산) 12:30→18:30
 * 일정: 3박4일 (선상 1박 + 후쿠오카 시내 2박 동일 호텔)
 *
 * verbatim 정책 (4차 적용):
 *   ✓ schedule activity = 원문 verbatim (모든 ▶ 항목 그대로)
 *   ✓ regions = 지역 컬럼 verbatim (D2 후쿠오카 두 번 — 원문 그대로)
 *   ✓ inclusions = 단어 추가 금지 (괄호 보강 X)
 *   ✓ "▶결연의 상징으로 오랫동안 사랑받는 이토시마 부부바위, 토리이" 콤마 보존 (W31 자동 보호)
 *
 * 원문 특이점:
 *   - D2/D3 모두 같은 후쿠오카 호텔 2박 (소도시 데이투어 + 시내 숙박)
 *   - D2 호텔 표기 "또는 동급 (트윈" — 닫는 괄호 누락 (원문 typo) → 정상화하여 "(트윈)" 으로 닫음, internal_notes 보존
 *   - D2 D3 같은 호텔이지만 D2 식사 = 조:불포함, D3 식사 = 조:호텔식 (D2 새벽 도착, D3 호텔에서 조식)
 *   - D3 "▶아리타 자기를 만들어 낸 조선인 출신 도공 도조 이삼평을\n   모시고 있는 도잔 신사" 두 줄 → 한 줄 통합 (줄바꿈만 공백 정규화)
 *   - D4 도착시간 18:00 (헤더 18:30) → meta는 헤더 기준
 *   - REMARK 캔슬차지 표기 없음
 */

const fs = require('fs');
const path = require('path');
const { createInserter } = require('./templates/insert-template');

const RAW_TEXT = fs.readFileSync(path.resolve(__dirname, 'sample.txt'), 'utf-8');
const TODAY = '2026-04-28';

// ─── 가격 매트릭스 (날짜 → 가격, X는 출발 불가) ──────────────────
const PRICING_BY_DATE = {
  // 5월 (6일)
  '2026-05-08': 489000,
  '2026-05-12': 419000, '2026-05-15': 489000,
  '2026-05-19': 419000,
  '2026-05-25': 419000,
  '2026-05-31': 419000,
  // 6월 (24일)
  '2026-06-01': 459000, '2026-06-02': 459000, '2026-06-03': 479000,
  '2026-06-04': 619000, '2026-06-05': 529000, '2026-06-06': 469000,
  '2026-06-07': 459000, '2026-06-08': 459000, '2026-06-09': 459000, '2026-06-10': 479000,
  '2026-06-11': 549000, '2026-06-12': 529000, '2026-06-13': 469000,
  '2026-06-14': 459000, '2026-06-15': 459000, '2026-06-16': 459000, '2026-06-19': 529000,
  '2026-06-21': 459000, '2026-06-22': 459000, '2026-06-23': 459000, '2026-06-26': 529000,
  '2026-06-28': 459000, '2026-06-29': 459000, '2026-06-30': 459000,
  // 7월 (25일)
  '2026-07-03': 559000,
  '2026-07-05': 479000, '2026-07-06': 479000, '2026-07-07': 479000, '2026-07-10': 559000,
  '2026-07-12': 479000, '2026-07-13': 479000, '2026-07-14': 479000, '2026-07-15': 499000,
  '2026-07-16': 699000, '2026-07-17': 739000, '2026-07-18': 549000,
  '2026-07-19': 539000, '2026-07-20': 499000, '2026-07-21': 499000, '2026-07-22': 509000,
  '2026-07-23': 579000, '2026-07-24': 559000, '2026-07-25': 519000,
  '2026-07-26': 529000, '2026-07-27': 529000, '2026-07-28': 529000, '2026-07-29': 539000,
  '2026-07-30': 579000, '2026-07-31': 579000,
  // 8월 (28일)
  '2026-08-01': 539000,
  '2026-08-02': 529000, '2026-08-03': 529000, '2026-08-04': 529000, '2026-08-05': 539000,
  '2026-08-06': 579000, '2026-08-07': 619000, '2026-08-08': 589000,
  '2026-08-09': 579000, '2026-08-10': 479000, '2026-08-11': 479000, '2026-08-12': 509000,
  '2026-08-13': 569000, '2026-08-14': 699000, '2026-08-15': 659000,
  '2026-08-16': 479000, '2026-08-17': 479000, '2026-08-18': 479000, '2026-08-19': 499000,
  '2026-08-20': 569000, '2026-08-21': 559000, '2026-08-22': 489000,
  '2026-08-23': 479000, '2026-08-24': 479000, '2026-08-25': 479000, '2026-08-28': 559000,
  '2026-08-30': 479000, '2026-08-31': 479000,
  // 9월 (24일)
  '2026-09-01': 479000, '2026-09-04': 559000,
  '2026-09-06': 479000, '2026-09-07': 479000, '2026-09-08': 479000, '2026-09-11': 559000,
  '2026-09-13': 479000, '2026-09-14': 479000, '2026-09-15': 479000,
  '2026-09-16': 529000, '2026-09-17': 639000, '2026-09-18': 669000, '2026-09-19': 659000,
  '2026-09-20': 629000, '2026-09-21': 569000, '2026-09-22': 519000,
  '2026-09-23': 739000, '2026-09-24': 759000, '2026-09-25': 759000, '2026-09-26': 489000,
  '2026-09-27': 479000, '2026-09-28': 479000, '2026-09-29': 479000, '2026-09-30': 499000,
};

function buildPriceDates() {
  return Object.entries(PRICING_BY_DATE)
    .filter(([date]) => date > TODAY)
    .map(([date, price]) => ({ date, price, confirmed: false }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const flight = (time, activity, transport) => ({ time, activity, type: 'flight', transport, note: null });
const normal = (time, activity, note) => ({ time: time || null, activity, type: 'normal', transport: null, note: note || null });
const shopping = (time, activity, note) => ({ time: time || null, activity, type: 'shopping', transport: null, note: note || null });
const meal = (b, l, d, bn, ln, dn) => ({
  breakfast: b, lunch: l, dinner: d,
  breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null,
});

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

const FUKUOKA_HOTEL = '후쿠오카 유벨 / WBF 하카타 그란데 / 크로스라이프하카타 야나기바시 OR 동급';

function buildPackage() {
  return {
    title: '[카멜리아] 소도시+후쿠오카 3박4일 PKG',
    destination: '후쿠오카',
    country: '일본',
    duration: 4,
    nights: 3,
    product_type: '소도시+후쿠오카',
    airline: '카멜리아 (선박)',
    departure_airport: '부산항 국제여객터미널',
    min_participants: 10,
    raw_text: RAW_TEXT,
    price_dates: buildPriceDates(),
    accommodations: [
      '카멜리아 페리 (다인실 기준) — 선상 1박',
      `${FUKUOKA_HOTEL} (트윈) — 후쿠오카 시내 2박 (D2/D3 동일)`,
    ],
    product_summary: '카멜리아 페리로 떠나는 큐슈 소도시 7곳 순회 3박4일! 쿠스·히타·우키하·아리타·카라츠·이토시마까지 한 번에, 후쿠오카 시내 호텔 2박으로 편안하게 즐기는 패키지.',
    product_highlights: [
      '카멜리아 페리 왕복 (선상 1박 포함)',
      '큐슈 소도시 7곳 순회 (쿠스·히타·우키하·아리타·카라츠·이토시마)',
      '후쿠오카 시내 동일 호텔 2박 (이동 부담 ↓)',
      '도자기 마을 이마리·아리타 포세린파크·이토시마 부부바위',
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
      '호텔식 2회',
    ],
    excludes: [
      '가이드&기사팁 3만원/1인',
      '기타 개인비용',
      '일정표에 기재된 불포함 식사',
      '싱글차지 10만원',
    ],
    surcharges: [],
    optional_tours: [],
    customer_notes:
      '▶ 선실은 다인실 기준이며, 업그레이드는 대기 조건으로 가능합니다.\n' +
      '   업그레이드 비용 (왕복 기준, 인당): 1등실 6만원, 특등실 1인실 20만원 / 2·3인실 16만원\n' +
      '▶ 상기 일정은 선박 및 현지 사정에 의하여 변동될 수 있습니다.',
    internal_notes:
      '[랜드사 투어비 / 마진 9%]\n' +
      '- 출확 인원 10명 (원문 명시)\n' +
      '- 발권기한 명시 없음\n' +
      '- D2/D3 동일 후쿠오카 호텔 2박 (소도시 데이투어 + 시내 숙박)\n' +
      '- 원문 D2 호텔 표기 "또는 동급 (트윈" 닫는 괄호 누락 — typo 로 판단해 "(트윈)" 으로 닫음 (raw_text 는 verbatim)\n' +
      '- D2 마지막 "호텔 체크인 및 휴식" → W28 룰 따라 "호텔 투숙 및 휴식"\n' +
      '- D3 마지막 "호텔 체크인 및 휴식" → W28 룰 따라 "호텔 투숙 및 휴식"\n' +
      '- D3 "도조 이삼평을 / 모시고 있는 도잔 신사" 원문 두 줄 → 한 줄 통합 (줄바꿈만 공백 정규화)\n' +
      '- D4 도착시간 18:00 (헤더 18:30) → meta는 헤더 기준 18:30\n' +
      '- REMARK 캔슬차지 표기 없음 — notices_parsed PAYMENT 항목 추가 안 함',
    notices_parsed: [
      { type: 'INFO', text: '쇼핑센터 1회' },
      { type: 'POLICY', text: '선실은 다인실 기준 — 업그레이드 대기 조건 (왕복 기준 인당): 1등실 6만원, 특등실 1인실 20만원 / 2·3인실 16만원' },
      { type: 'INFO', text: '상기 일정은 선박 및 현지 사정에 의하여 변동될 수 있습니다' },
    ],
    itinerary_data: {
      meta: META,
      highlights: {
        inclusions: ['왕복 훼리비', '부두세&유류세', '출국세', '관광지 입장료', '가이드', '전용버스', '여행자보험', '현지식 2회', '호텔식 2회'],
        excludes: ['가이드&기사팁 3만원', '싱글차지 10만원', '개인비용'],
        shopping: '쇼핑센터 1회 (면세점)',
        remarks: [
          '10명부터 출발 확정',
          '선실 다인실 기준 (업그레이드 대기)',
          '후쿠오카 시내 동일 호텔 2박 (D2/D3)',
        ],
      },
      days: [
        {
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
          day: 2,
          regions: ['후쿠오카', '쿠스', '히타', '우키하', '후쿠오카'],
          schedule: [
            normal('07:30', '하카타항 하선 후'),
            normal(null, '쿠스 이동'),
            normal(null, '▶일본 폭포 100선 중 하나인 지온노타키 폭포 관광'),
            normal(null, '▶큐슈 속의 작은 교토 마메다마치 관광'),
            normal(null, '▶수백개의 붉은 토리이가 펼쳐진 우키하 이나리 신사 관광'),
            normal(null, '후쿠오카 이동'),
            normal(null, '▶약 3천개의 개구리 석상이 있는 뇨이린지 관광'),
            normal(null, '▶라라포트 자유 관광'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(false, true, false, '불포함', '현지식', '불포함'),
          hotel: { name: FUKUOKA_HOTEL, grade: null, note: '트윈' },
        },
        {
          day: 3,
          regions: ['아리타', '카라츠', '이토시마', '후쿠오카'],
          schedule: [
            normal(null, '호텔 조식 후 아리타 이동'),
            normal(null, '▶일본의 도자기가 처음 만들어진 이마리 도자기 마을 관광'),
            normal(null, '▶아리타 자기를 만들어 낸 조선인 출신 도공 도조 이삼평을 모시고 있는 도잔 신사'),
            normal(null, '▶전세계 도자기를 전시하고 있는 테마파크 아리타 포세린파크'),
            normal(null, '카라츠 이동'),
            normal(null, '▶일본 3대 소나무 숲인 니지노마츠바라 차창관광'),
            normal(null, '▶카라츠의 탁트인 바다와 전경을 내려다보는 카가미야마 전망대'),
            normal(null, '이토시마 이동'),
            normal(null, '▶결연의 상징으로 오랫동안 사랑받는 이토시마 부부바위, 토리이'),
            normal(null, '▶에메랄드 빛 해안을 달리는 드라이브 코스 선셋로드 (차창)'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(true, true, false, '호텔식', '현지식', '불포함'),
          hotel: { name: FUKUOKA_HOTEL, grade: null, note: '트윈' },
        },
        {
          day: 4,
          regions: ['후쿠오카', '부산'],
          schedule: [
            normal(null, '호텔 조식 후 출발'),
            normal(null, '▶베이사이드플레이스 관광'),
            normal(null, '▶하카타 포트 타워 (외관) 관광'),
            shopping(null, '면세점 1회 방문'),
            normal(null, '하카타항으로 이동 / 승선 준비'),
            flight('12:30', '하카타항 → 부산항 12:30 출발 → 18:30 도착 (카멜리아)', '카멜리아 페리'),
            normal('18:30', '부산 국제 여객 터미널 도착 / 즐거운 여행 되셨기를 바랍니다'),
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
          evidence: '원문 제목: "[카멜리아] 소도시+후쿠오카 3박4일 PKG"',
          supported: true },
        { id: 'transport_camellia', field: 'meta.airline', severity: 'CRITICAL',
          text: '카멜리아 페리 (부산-하카타 22:30→07:30 / 하카타-부산 12:30→18:30)',
          evidence: '원문 헤더: "선박 스케쥴 부산 – 하카타 22:30 – 07:30 / 하카타 – 부산 12:30 – 18:30"',
          supported: true },
        { id: 'inclusions_no_paren', field: 'inclusions[0]', severity: 'CRITICAL',
          text: '"왕복 훼리비" (괄호 환각 보강 X)',
          evidence: '원문 포함: "▶왕복훼리비"',
          supported: true,
          note: 'ERR-FUK-camellia-overcorrect 학습' },
        { id: 'd1_regions_busan_only', field: 'days[0].regions', severity: 'HIGH',
          text: '["부산"] (카멜리아 = 교통편이라 region 제외)',
          evidence: '원문 D1 지역 컬럼: "부산", 교통편 컬럼: "카멜리아"',
          supported: true },
        { id: 'd2_regions_5', field: 'days[1].regions', severity: 'HIGH',
          text: '["후쿠오카","쿠스","히타","우키하","후쿠오카"] verbatim',
          evidence: '원문 D2 지역 컬럼: "후쿠오카 / 쿠스 / / 히타 / 우키하 / 후쿠오카" — 후쿠오카 두 번 (시작 하선 + 끝 호텔)',
          supported: true,
          note: '지역 컬럼 verbatim — 시작/끝 후쿠오카 중복 표기 그대로 보존' },
        { id: 'd3_regions_4', field: 'days[2].regions', severity: 'HIGH',
          text: '["아리타","카라츠","이토시마","후쿠오카"]',
          evidence: '원문 D3 지역 컬럼: "아리타 / 카라츠 / 이토시마 / 후쿠오카"',
          supported: true },
        { id: 'd2_d3_same_hotel', field: 'accommodations', severity: 'CRITICAL',
          text: '후쿠오카 유벨 / WBF 하카타 그란데 / 크로스라이프하카타 야나기바시 OR 동급 (트윈) — D2/D3 동일',
          evidence: '원문 D2 HOTEL: "후쿠오카 유벨 / WBF 하카타 그란데 / 크로스라이프하카타 야나기바시 또는 동급 (트윈" + D3 HOTEL: 동일 호텔 (트윈)',
          supported: true,
          note: '원문 D2 닫는 괄호 누락 — typo 로 판단해 정상화' },
        { id: 'd3_dojan_join', field: 'days[2].schedule', severity: 'HIGH',
          text: '"▶아리타 자기를 만들어 낸 조선인 출신 도공 도조 이삼평을 모시고 있는 도잔 신사" 통합',
          evidence: '원문 D3 두 줄: "▶아리타 자기를 만들어 낸 조선인 출신 도공 도조 이삼평을\\n   모시고 있는 도잔 신사" — 한 명소 설명이라 줄바꿈만 공백으로 정규화',
          supported: true },
        { id: 'd3_itoshima_verbatim_comma', field: 'days[2].schedule', severity: 'HIGH',
          text: '"▶결연의 상징으로 오랫동안 사랑받는 이토시마 부부바위, 토리이" 콤마 verbatim',
          evidence: '원문 D3: "▶결연의 상징으로 오랫동안 사랑받는 이토시마 부부바위, 토리이"',
          supported: true,
          note: 'W31 자동 보호 (DESCRIPTIVE_KW "사랑받는" + 서술 어미 "는," 매칭 → 분리 X)' },
        { id: 'd2_meal_2_local', field: 'days[1].meals', severity: 'HIGH',
          text: 'D2 식사: 조:불포함, 중:현지식, 석:불포함',
          evidence: '원문 D2 식사 컬럼: "조:불포함 / 중:현지식 / 석:불포함"',
          supported: true },
        { id: 'd3_meal_hotel_local', field: 'days[2].meals', severity: 'HIGH',
          text: 'D3 식사: 조:호텔식, 중:현지식, 석:불포함',
          evidence: '원문 D3 식사 컬럼: "조:호텔식 / 중:현지식 / 석:불포함"',
          supported: true,
          note: '현지식 2회 + 호텔식 2회 (D2 중 + D3 중 + D3 조 + D4 조) = 원문 포함 "현지식2회. 호텔식2회" 와 일치' },
        { id: 'd3_no_hotel_dinner', field: 'inclusions', severity: 'MEDIUM',
          text: '호텔식 2회 (시내·정통은 호텔식 카운트 다름)',
          evidence: '원문 포함: "▶현지식2회. 호텔식2회" + 식사 매핑: D2조(X)+중(현지)+석(X) / D3조(호텔)+중(현지)+석(X) / D4조(호텔)+중(X) = 현지2 + 호텔2',
          supported: true },
        { id: 'no_cancel_clause', field: 'notices_parsed', severity: 'HIGH',
          text: 'REMARK 캔슬차지 표기 없음 — notices_parsed PAYMENT 추가 안 함',
          evidence: '원문 REMARK 에 캔슬차지 항목 없음 (시내·정통은 있음)',
          supported: true },
        { id: 'd4_arrival_18_30_meta', field: 'meta.flight_in_arr_time', severity: 'HIGH',
          text: '18:30 (헤더 기준)',
          evidence: '원문 헤더 18:30 vs 일정표 18:00 — 헤더 기준 적용',
          supported: true },
        { id: 'd4_no_annyeong', field: 'days[3].schedule', severity: 'MEDIUM',
          text: '"부산 국제 여객 터미널 도착 / 즐거운 여행 되셨기를 바랍니다"',
          evidence: '원문 D4: "부산 국제 여객 터미널 도착    즐거운 여행 되셨기를 바랍니다:)" — "안녕히" 표기 없음 (시내·정통과 다름)',
          supported: true,
          note: '원문에 "안녕히" 단어 없음 — 추가 X' },
        { id: 'price_high_chuseok', field: 'price_dates', severity: 'HIGH',
          text: '9/23·24·25 = 739,000 / 759,000 / 759,000원 (추석 연휴)',
          evidence: '원문 9월 가격표 9/23 739,000 / 9/24 759,000 / 9/25 759,000',
          supported: true },
        { id: 'singlecharge_10', field: 'excludes', severity: 'HIGH',
          text: '싱글차지 10만원 (시내 5만원, 정통 8만원, 큐슈 온천 5만원 보다 비쌈)',
          evidence: '원문 불포함: "▶싱글차지 10만원"',
          supported: true,
          note: '소도시 4박 코스라 싱글차지 가장 높음 (verbatim)' },
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
