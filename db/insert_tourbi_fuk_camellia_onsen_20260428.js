/**
 * 투어비 — [카멜리아] 큐슈 온천 2박3일 패키지
 * 등록일: 2026-04-28
 * 랜드사: 투어비 (8% 마진, 9월 헤더는 9% 표기 — internal_notes 보존)
 * 교통: 카멜리아 페리 (부산-하카타) 22:30→07:30 / (하카타-부산) 12:30→18:30
 * 일정: 2박3일 (선상 1박 + 코코노에 온천 호텔 1박)
 *
 * verbatim 정책 (ERR-FUK-camellia-overcorrect@2026-04-28 학습 — 3차 적용):
 *   ✓ schedule activity = 원문 verbatim ("관광세" 그대로, "출국세" 변환 X)
 *   ✓ regions = 지역 컬럼만 (D2 = 후쿠오카/쿠스/코코노에 — schedule "히타 이동" 과 표기 차이 보존)
 *   ✓ inclusions = 단어 추가 금지
 *   ✓ 호텔명 "유모토아" 그대로 (정통은 "유모토야" — 원문 표기 차이 verbatim)
 *   ✓ "(외관)" 표기 없음 — 시내·정통은 있지만 이번 원문엔 없음 그대로
 *
 * 원문 특이점:
 *   - 시내 패키지(시내숙박)와 다른 코스: 큐슈 온천 (마메다마치·꿈의 현수교·온천 호텔)
 *   - D1 집결 17:30 (시내 18:00, 정통 18:00 보다 30분 빠름)
 *   - 포함 "관광세" (시내·정통은 "출국세")
 *   - REMARK 캔슬차지 표기 없음 (notices_parsed PAYMENT 항목 추가 안 함)
 *   - D2 "꿈의 현수교 / 유메오오츠리바시" 두 줄 표기 → 한 명소 (줄바꿈을 공백으로만 정규화)
 *   - D2 마지막 "호텔 체크인 및 휴식 온천욕♨" → W28 룰 따라 "♨온천욕" + "호텔 투숙 및 휴식" 분리
 */

const fs = require('fs');
const path = require('path');
const { createInserter } = require('./templates/insert-template');

const RAW_TEXT = fs.readFileSync(path.resolve(__dirname, 'sample.txt'), 'utf-8');
const TODAY = '2026-04-28';

// ─── 가격 매트릭스 (날짜 → 가격, X는 출발 불가) ──────────────────
const PRICING_BY_DATE = {
  // 5월 (17일)
  '2026-05-02': 679000,
  '2026-05-03': 679000, '2026-05-04': 429000, '2026-05-05': 349000, '2026-05-06': 299000,
  '2026-05-12': 299000, '2026-05-13': 299000,
  '2026-05-17': 299000, '2026-05-18': 299000, '2026-05-19': 299000, '2026-05-20': 299000, '2026-05-21': 299000,
  '2026-05-24': 299000, '2026-05-25': 299000, '2026-05-26': 299000, '2026-05-27': 299000, '2026-05-28': 299000,
  // 6월 (24일)
  '2026-06-01': 379000, '2026-06-02': 379000, '2026-06-03': 379000,
  '2026-06-04': 379000, '2026-06-05': 499000, '2026-06-06': 379000,
  '2026-06-07': 379000, '2026-06-08': 379000, '2026-06-09': 359000, '2026-06-10': 379000,
  '2026-06-11': 379000, '2026-06-12': 439000, '2026-06-13': 379000,
  '2026-06-14': 379000, '2026-06-15': 379000, '2026-06-16': 379000, '2026-06-17': 379000,
  '2026-06-21': 379000, '2026-06-22': 379000, '2026-06-23': 379000, '2026-06-24': 379000,
  '2026-06-28': 379000, '2026-06-29': 379000, '2026-06-30': 359000,
  // 7월 (25일)
  '2026-07-01': 389000,
  '2026-07-05': 389000, '2026-07-06': 389000, '2026-07-07': 389000, '2026-07-08': 389000,
  '2026-07-12': 389000, '2026-07-13': 389000, '2026-07-14': 389000, '2026-07-15': 389000,
  '2026-07-16': 539000, '2026-07-17': 569000, '2026-07-18': 439000,
  '2026-07-19': 429000, '2026-07-20': 389000, '2026-07-21': 389000, '2026-07-22': 389000,
  '2026-07-23': 389000, '2026-07-24': 469000, '2026-07-25': 409000,
  '2026-07-26': 389000, '2026-07-27': 429000, '2026-07-28': 429000, '2026-07-29': 429000,
  '2026-07-30': 429000, '2026-07-31': 469000,
  // 8월 (28일)
  '2026-08-01': 439000,
  '2026-08-02': 429000, '2026-08-03': 429000, '2026-08-04': 429000, '2026-08-05': 429000,
  '2026-08-06': 429000, '2026-08-07': 469000, '2026-08-08': 409000,
  '2026-08-09': 429000, '2026-08-10': 429000, '2026-08-11': 389000, '2026-08-12': 429000,
  '2026-08-13': 429000, '2026-08-14': 579000, '2026-08-15': 559000,
  '2026-08-16': 389000, '2026-08-17': 389000, '2026-08-18': 389000, '2026-08-19': 389000,
  '2026-08-20': 389000, '2026-08-21': 469000, '2026-08-22': 409000,
  '2026-08-23': 389000, '2026-08-24': 389000, '2026-08-25': 389000, '2026-08-26': 389000,
  '2026-08-30': 389000, '2026-08-31': 389000,
  // 9월 (24일)
  '2026-09-01': 399000, '2026-09-02': 399000,
  '2026-09-06': 399000, '2026-09-07': 399000, '2026-09-08': 399000, '2026-09-09': 399000,
  '2026-09-13': 399000, '2026-09-14': 399000, '2026-09-15': 399000, '2026-09-16': 399000,
  '2026-09-17': 399000, '2026-09-18': 489000, '2026-09-19': 449000,
  '2026-09-20': 449000, '2026-09-21': 449000, '2026-09-22': 449000,
  '2026-09-23': 659000, '2026-09-24': 659000, '2026-09-25': 659000, '2026-09-26': 409000,
  '2026-09-27': 399000, '2026-09-28': 399000, '2026-09-29': 399000, '2026-09-30': 399000,
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
    title: '[카멜리아] 큐슈 온천 2박3일 PKG',
    destination: '후쿠오카',
    country: '일본',
    duration: 3,
    nights: 2,
    product_type: '온천',
    airline: '카멜리아 (선박)',
    departure_airport: '부산항 국제여객터미널',
    min_participants: 10,
    raw_text: RAW_TEXT,
    price_dates: buildPriceDates(),
    accommodations: [
      '카멜리아 페리 (다인실 기준) — 선상 1박',
      '우키하 / 유모토아 / 유유테이 호텔 OR 동급 (2~3인실 기준) — 코코노에 온천 1박',
    ],
    product_summary: '카멜리아 페리로 떠나는 큐슈 온천 2박3일! 미야지다케 신사·라라포트·마메다마치·일본 최대 보행자 다리 꿈의 현수교까지 큐슈의 정수와 온천을 알차게 담은 패키지.',
    product_highlights: [
      '카멜리아 페리 왕복 (선상 1박 포함)',
      '코코노에 온천 호텔 (♨온천욕 + 카이세키 석식)',
      '꿈의 현수교 (유메오오츠리바시) — 일본 최대 보행자 다리',
      '미야지다케 신사 · 마메다마치 · 라라포트',
    ],
    inclusions: [
      '왕복 훼리비',
      '부두세 & 유류세',
      '관광세',
      '관광지 입장료',
      '가이드',
      '전용버스',
      '여행자보험',
      '카이세키 1회',
      '호텔식 1회',
    ],
    excludes: [
      '가이드&기사팁 3만원/1인',
      '기타 개인비용',
      '일정표에 기재된 불포함 식사',
      '싱글차지 5만원',
    ],
    surcharges: [],
    optional_tours: [],
    customer_notes:
      '▶ 선실은 다인실 기준이며, 업그레이드는 대기 조건으로 가능합니다.\n' +
      '   업그레이드 비용 (왕복 기준, 인당): 1등실 6만원, 특등실 1인실 20만원 / 2·3인실 16만원\n' +
      '▶ 상기 일정은 선박 및 현지 사정에 의하여 변동될 수 있습니다.',
    internal_notes:
      '[랜드사 투어비 / 마진 8%]\n' +
      '- 9월 가격표 헤더는 (계약금 9%) 만 표기 — 5~8월은 (계약금 8% or 9%). 사장님 입력 8% 일괄 적용\n' +
      '- 출확 인원 10명 (원문 명시)\n' +
      '- 발권기한 명시 없음\n' +
      '- 포함 "관광세" (시내·정통 패키지는 "출국세" — 원문 차이 verbatim 보존)\n' +
      '- REMARK 캔슬차지 표기 없음 — 다른 카멜리아 패키지는 있음. notices_parsed PAYMENT 항목 추가 안 함\n' +
      '- D1 집결 17:30 (시내 패키지 18:00, 정통 18:00 보다 30분 빠름)\n' +
      '- D2 호텔명 "유모토아" verbatim (정통 패키지는 "유모토야" — 같은 호텔 다른 표기 가능)\n' +
      '- D2 "꿈의 현수교 / 유메오오츠리바시" 원문 두 줄 표기 → 한 명소로 통합 (줄바꿈만 공백으로 정규화)\n' +
      '- D2 마지막 "호텔 체크인 및 휴식 온천욕♨" → W28 룰 따라 ♨온천욕 / 호텔 투숙 및 휴식 분리',
    notices_parsed: [
      { type: 'INFO', text: '쇼핑센터 1회' },
      { type: 'POLICY', text: '선실은 다인실 기준 — 업그레이드 대기 조건 (왕복 기준 인당): 1등실 6만원, 특등실 1인실 20만원 / 2·3인실 16만원' },
      { type: 'INFO', text: '상기 일정은 선박 및 현지 사정에 의하여 변동될 수 있습니다' },
    ],
    itinerary_data: {
      meta: META,
      highlights: {
        inclusions: ['왕복 훼리비', '부두세&유류세', '관광세', '관광지 입장료', '가이드', '전용버스', '여행자보험', '카이세키 1회', '호텔식 1회'],
        excludes: ['가이드&기사팁 3만원', '싱글차지 5만원', '개인비용'],
        shopping: '쇼핑센터 1회 (면세점)',
        remarks: [
          '10명부터 출발 확정',
          '선실 다인실 기준 (업그레이드 대기)',
          '코코노에 온천 호텔 (♨ 온천욕 + 카이세키 석식)',
        ],
      },
      days: [
        {
          day: 1,
          regions: ['부산'],
          schedule: [
            normal('17:30', '부산 국제 여객 터미널 2층 집결'),
            normal('19:00', '훼리 수속 후 승선'),
            flight('22:30', '부산항 출항 → 하카타항 22:30 출발 → 익일 07:30 도착 (카멜리아)', '카멜리아 페리'),
            normal(null, '선내 휴식'),
          ],
          meals: meal(false, false, false, null, null, '불포함'),
          hotel: { name: '카멜리아 페리 (다인실 기준)', grade: null, facility_type: 'cabin' },
        },
        {
          day: 2,
          regions: ['후쿠오카', '쿠스', '코코노에'],
          schedule: [
            normal('07:30', '하카타항 하선'),
            normal(null, '▶큐슈 3대 신사 중 하나인 미야지다케 신사 관광'),
            normal(null, '▶라라포트 자유 관광 (쇼핑&자유식사)'),
            normal(null, '히타 이동'),
            normal(null, '▶큐슈 속의 작은 교토 마메다마치 관광'),
            normal(null, '코코노에 이동'),
            normal(null, '▶일본 최대 높이 보행자 다리인 꿈의 현수교 유메오오츠리바시 관광'),
            normal(null, '♨온천욕'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(false, false, true, '불포함', '불포함', '호텔식 (카이세키)'),
          hotel: {
            name: '우키하 / 유모토아 / 유유테이 호텔 OR 동급',
            grade: null,
            facility_type: 'onsen',
            note: '2~3인실 기준 / 코코노에 온천 호텔',
          },
        },
        {
          day: 3,
          regions: ['후쿠오카', '부산'],
          schedule: [
            normal(null, '호텔 조식 후 출발'),
            normal(null, '▶베이사이드플레이스 관광'),
            normal(null, '▶하카타 포트 타워 관광'),
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
        { id: 'duration_3', field: 'duration', severity: 'CRITICAL',
          text: '2박3일 (duration=3, nights=2)',
          evidence: '원문 제목: "[카멜리아] 큐슈 온천 2박3일 PKG"',
          supported: true },
        { id: 'transport_camellia', field: 'meta.airline', severity: 'CRITICAL',
          text: '카멜리아 페리 (부산-하카타 22:30→07:30 / 하카타-부산 12:30→18:30)',
          evidence: '원문 헤더: "선박 스케쥴 부산 – 하카타 22:30 – 07:30 / 하카타 – 부산 12:30 – 18:30"',
          supported: true },
        { id: 'inclusions_kwangwangse', field: 'inclusions[2]', severity: 'CRITICAL',
          text: '"관광세" verbatim (시내·정통은 "출국세" — 원문 차이 보존)',
          evidence: '원문 포함: "▶왕복훼리비, 부두세&유류세, 관광세, 관광지입장료, 가이드, 전용버스, 여행자보험"',
          supported: true,
          note: 'ERR-FUK-camellia-overcorrect 학습 — 원문 표기 차이 그대로 보존 (출국세로 자동 정상화 X)' },
        { id: 'inclusions_no_paren', field: 'inclusions[0]', severity: 'CRITICAL',
          text: '"왕복 훼리비" (괄호 환각 보강 X)',
          evidence: '원문 포함: "▶왕복훼리비"',
          supported: true,
          note: 'ERR-FUK-camellia-overcorrect 학습 — "(카멜리아)" 같은 단어 추가 금지' },
        { id: 'd1_regions_busan_only', field: 'days[0].regions', severity: 'HIGH',
          text: '["부산"] (카멜리아 = 교통편이라 region 제외)',
          evidence: '원문 D1 지역 컬럼: "부산", 교통편 컬럼: "카멜리아"',
          supported: true },
        { id: 'd2_regions_3', field: 'days[1].regions', severity: 'HIGH',
          text: '["후쿠오카","쿠스","코코노에"] verbatim',
          evidence: '원문 D2 지역 컬럼: "후쿠오카 / 쿠스 / 코코노에" — schedule 안 "히타 이동" 표기와 차이 있음 그대로 보존',
          supported: true,
          note: 'regions 는 지역 컬럼만, schedule 의 "히타 이동" 은 verbatim — 표기 차이는 원문 그대로' },
        { id: 'd2_hotel_3_options', field: 'days[1].hotel', severity: 'CRITICAL',
          text: '우키하 / 유모토아 / 유유테이 호텔 OR 동급 (2~3인실)',
          evidence: '원문 D2 HOTEL: "우키하 / 유모토아 / 유유테이 호텔 또는 동급 (2~3인실 기준)"',
          supported: true,
          note: '"유모토아" 그대로 (정통 패키지는 "유모토야" — 표기 차이 verbatim, 같은 호텔일 가능성)' },
        { id: 'd2_yume_bridge_join', field: 'days[1].schedule', severity: 'HIGH',
          text: '"▶일본 최대 높이 보행자 다리인 꿈의 현수교 유메오오츠리바시 관광" 통합',
          evidence: '원문 D2 두 줄 표기: "▶일본 최대 높이 보행자 다리인 꿈의 현수교\\n   유메오오츠리바시 관광" — 한 명소이므로 줄바꿈만 공백으로 정규화',
          supported: true },
        { id: 'd2_onsen_split', field: 'days[1].schedule', severity: 'HIGH',
          text: '"호텔 체크인 및 휴식 온천욕♨" → "♨온천욕" + "호텔 투숙 및 휴식" 분리',
          evidence: '원문 D2 마지막: "호텔 체크인 및 휴식 온천욕♨" — W28 룰 따라 분리',
          supported: true,
          note: 'W28 (ERR-HSN-render-bundle): "호텔 체크인 및 휴식" 같은 앞절 붙이기 금지 → "호텔 투숙 및 휴식" 고정 + 부속 정보 별도 normal' },
        { id: 'd2_meal_kaiseki', field: 'days[1].meals', severity: 'HIGH',
          text: 'D2 석식 = "호텔식 (카이세키)"',
          evidence: '원문 D2 식사: "조:불포함 / 중:불포함 / 석:호텔식 (카이세키)"',
          supported: true },
        { id: 'no_cancel_clause', field: 'notices_parsed', severity: 'HIGH',
          text: 'REMARK 캔슬차지 표기 없음 — notices_parsed PAYMENT 항목 추가 안 함',
          evidence: '원문 REMARK 에 캔슬차지 항목 없음 (시내·정통 패키지에는 있음)',
          supported: true },
        { id: 'd1_dep_time_17_30', field: 'days[0].schedule', severity: 'HIGH',
          text: 'D1 집결 17:30 (시내·정통 18:00 보다 30분 빠름)',
          evidence: '원문 D1: "17:30 부산 국제 여객 터미널 2층 집결"',
          supported: true },
        { id: 'd3_no_exterior_mark', field: 'days[2].schedule', severity: 'MEDIUM',
          text: '"▶하카타 포트 타워 관광" — "(외관)" 표기 없음 verbatim',
          evidence: '원문 D3: "▶하카타 포트 타워 관광" — 시내·정통 패키지는 "(외관)" 표기 있음',
          supported: true },
        { id: 'd3_verbatim_annyeong', field: 'days[2].schedule', severity: 'HIGH',
          text: '"입국 수속 후 안녕히" (의역 X)',
          evidence: '원문 D3: "입국 수속 후 안녕히~ 즐거운 여행 되셨기를 바랍니다:)"',
          supported: true },
        { id: 'price_high_chuseok', field: 'price_dates', severity: 'HIGH',
          text: '9/23~25 659,000원 (추석 연휴)',
          evidence: '원문 9월 가격표 9/23·24·25 = 659,000',
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
    commissionRate: 8,
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
