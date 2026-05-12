/**
 * 투어비 — [카멜리아] 후쿠오카 시내숙박 2박3일 패키지
 * 등록일: 2026-04-28
 * 랜드사: 투어비 (8% 마진, 9월 헤더는 9% 표기 — internal_notes 보존)
 * 교통: 카멜리아 페리 (부산-하카타) 22:30→07:30 / (하카타-부산) 12:30→18:30
 * 일정: 2박3일 (선상 1박 + 후쿠오카 시내 1박)
 */

const fs = require('fs');
const path = require('path');
const { createInserter } = require('./templates/insert-template');

const RAW_TEXT = fs.readFileSync(path.resolve(__dirname, 'sample.txt'), 'utf-8');
const TODAY = '2026-04-28';

// ─── 가격 매트릭스 (날짜 → 가격, X는 출발 불가) ──────────────────
const PRICING_BY_DATE = {
  // 5월
  '2026-05-01': 549000, '2026-05-02': 549000,
  '2026-05-03': 499000, '2026-05-04': 369000, '2026-05-05': 469000, '2026-05-06': 279000,
  '2026-05-10': 249000, '2026-05-11': 259000, '2026-05-12': 249000, '2026-05-13': 249000,
  '2026-05-17': 249000, '2026-05-18': 249000, '2026-05-19': 259000, '2026-05-20': 249000,
  '2026-05-21': 269000, '2026-05-22': 509000, '2026-05-23': 509000,
  '2026-05-25': 249000, '2026-05-26': 249000, '2026-05-27': 249000,
  '2026-05-29': 309000, '2026-05-30': 299000, '2026-05-31': 249000,
  // 6월
  '2026-06-01': 299000, '2026-06-02': 299000, '2026-06-03': 299000,
  '2026-06-04': 329000, '2026-06-05': 449000, '2026-06-06': 319000,
  '2026-06-07': 279000, '2026-06-08': 299000, '2026-06-09': 299000, '2026-06-10': 299000,
  '2026-06-11': 329000, '2026-06-12': 399000, '2026-06-13': 319000,
  '2026-06-14': 299000, '2026-06-15': 299000, '2026-06-16': 279000, '2026-06-17': 299000,
  '2026-06-21': 299000, '2026-06-22': 299000, '2026-06-23': 279000, '2026-06-24': 299000,
  '2026-06-28': 279000, '2026-06-29': 299000, '2026-06-30': 299000,
  // 7월
  '2026-07-01': 329000,
  '2026-07-05': 329000, '2026-07-06': 329000, '2026-07-07': 299000, '2026-07-08': 329000,
  '2026-07-12': 299000, '2026-07-13': 329000, '2026-07-14': 329000, '2026-07-15': 329000,
  '2026-07-16': 469000, '2026-07-17': 499000, '2026-07-18': 399000,
  '2026-07-19': 349000, '2026-07-20': 349000, '2026-07-21': 349000, '2026-07-22': 349000,
  '2026-07-23': 349000, '2026-07-24': 419000, '2026-07-25': 349000,
  '2026-07-26': 349000, '2026-07-27': 369000, '2026-07-28': 369000, '2026-07-29': 369000,
  '2026-07-30': 379000, '2026-07-31': 419000,
  // 8월
  '2026-08-01': 399000,
  '2026-08-02': 399000, '2026-08-03': 399000, '2026-08-04': 399000, '2026-08-05': 399000,
  '2026-08-06': 379000, '2026-08-07': 429000, '2026-08-08': 399000,
  '2026-08-09': 399000, '2026-08-10': 349000, '2026-08-11': 349000, '2026-08-12': 349000,
  '2026-08-13': 349000, '2026-08-14': 529000, '2026-08-15': 499000,
  '2026-08-16': 299000, '2026-08-17': 329000, '2026-08-18': 299000, '2026-08-19': 329000,
  '2026-08-20': 349000, '2026-08-21': 409000, '2026-08-22': 339000,
  '2026-08-23': 299000, '2026-08-24': 329000, '2026-08-25': 299000, '2026-08-26': 329000,
  '2026-08-30': 299000, '2026-08-31': 329000,
  // 9월
  '2026-09-01': 329000, '2026-09-02': 329000,
  '2026-09-06': 329000, '2026-09-07': 329000, '2026-09-08': 329000, '2026-09-09': 329000,
  '2026-09-13': 329000, '2026-09-14': 329000, '2026-09-15': 329000, '2026-09-16': 329000,
  '2026-09-17': 349000, '2026-09-18': 449000, '2026-09-19': 429000,
  '2026-09-20': 399000, '2026-09-21': 399000, '2026-09-22': 349000,
  '2026-09-23': 709000, '2026-09-24': 709000, '2026-09-25': 709000, '2026-09-26': 339000,
  '2026-09-27': 329000, '2026-09-28': 329000, '2026-09-29': 329000, '2026-09-30': 329000,
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
    title: '[카멜리아] 후쿠오카 시내숙박 2박3일 PKG',
    destination: '후쿠오카',
    country: '일본',
    duration: 3,
    nights: 2,
    product_type: '시내숙박',
    airline: '카멜리아 (선박)',
    departure_airport: '부산항 국제여객터미널',
    min_participants: 10,
    raw_text: RAW_TEXT,
    price_dates: buildPriceDates(),
    accommodations: [
      '카멜리아 페리 (다인실 기준) — 선상 1박',
      '후쿠오카 유벨 / 하카타 나카스 워싱턴 / WBF 그란데 하카타 OR 동급 (2인1실 기준-더블) — 시내 1박',
    ],
    product_summary: '카멜리아 페리로 가볍게 다녀오는 후쿠오카 2박3일! 다자이후 천만궁·후쿠오카 타워·미야지다케 신사·라라포트까지 핵심 명소 알차게 담은 시내숙박 패키지.',
    product_highlights: [
      '카멜리아 페리 왕복 (선상 1박 포함)',
      '후쿠오카 시내 호텔 1박 (2인1실 더블)',
      '다자이후 천만궁·미야지다케 신사·후쿠오카 타워',
      '모모치 해변·마이즈루 공원·라라포트 자유관광',
    ],
    inclusions: [
      '왕복 훼리비 (카멜리아)',
      '부두세 & 유류세',
      '출국세',
      '관광지 입장료',
      '가이드',
      '전용버스',
      '여행자보험',
      '현지식 1회',
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
      '▶ 호텔 객실은 더블 기준이며, 룸타입 변경 요금 (인당): 트리플/트윈 2만원, 싱글 5만원\n' +
      '▶ 취소 수수료: 당일 50%, 1주일전~1일전 30% 적용\n' +
      '▶ 상기 일정은 항공 및 현지 사정에 의하여 변동될 수 있습니다.',
    internal_notes:
      '[랜드사 투어비 / 마진 8%]\n' +
      '- 9월 가격표 헤더는 (계약금 9%) 만 표기 — 5~8월은 (계약금 8% or 9%). 사장님 입력 8% 일괄 적용\n' +
      '- 출확 인원 10명 (원문 명시)\n' +
      '- 발권기한 명시 없음',
    notices_parsed: [
      { type: 'INFO', text: '쇼핑센터 1회 (면세점)' },
      { type: 'POLICY', text: '선실은 다인실 기준 — 업그레이드 대기 조건 (왕복 기준 인당): 1등실 6만원, 특등실 1인실 20만원 / 2·3인실 16만원' },
      { type: 'POLICY', text: '호텔 객실 더블 기준 — 룸타입 변경 요금 (인당): 트리플/트윈 2만원, 싱글 5만원' },
      { type: 'PAYMENT', text: '취소 수수료 — 당일 50%, 1주일전~1일전 30% 적용' },
      { type: 'INFO', text: '상기 일정은 항공 및 현지 사정에 의하여 변동될 수 있습니다' },
    ],
    itinerary_data: {
      meta: META,
      highlights: {
        inclusions: ['왕복 훼리비', '부두세&유류세', '출국세', '관광지 입장료', '가이드', '전용버스', '여행자보험', '현지식 1회', '호텔식 1회'],
        excludes: ['가이드&기사팁 3만원', '싱글차지 5만원', '개인비용'],
        shopping: '쇼핑센터 1회 (면세점)',
        remarks: [
          '10명부터 출발 확정',
          '선실 다인실 기준 (업그레이드 대기)',
          '호텔 더블 기준 (룸타입 변경 시 추가요금)',
        ],
      },
      days: [
        {
          day: 1,
          regions: ['부산', '카멜리아'],
          schedule: [
            normal('18:00', '부산 국제 여객 터미널 3층 집결'),
            normal('19:00', '훼리 수속 후 승선'),
            flight('22:30', '부산항 출항 → 하카타항 22:30 출발 → 익일 07:30 도착 (카멜리아)', '카멜리아 페리'),
            normal(null, '선내 휴식'),
          ],
          meals: meal(false, false, false, null, null, '불포함'),
          hotel: { name: '카멜리아 페리 (다인실 기준)', grade: null, facility_type: 'cabin' },
        },
        {
          day: 2,
          regions: ['후쿠오카'],
          schedule: [
            normal('07:30', '하카타항 하선'),
            normal(null, '▶후쿠오카 인공해변 모모치 해변'),
            normal(null, '▶높이 234M·8000장의 유리로 단장한 후쿠오카 타워 관광'),
            normal(null, '▶큐슈 3대 신사 중 하나인 미야지다케 신사 관광'),
            normal(null, '▶후쿠오카 성터가 남아있는 꽃놀이 명소 마이즈루 공원'),
            normal(null, '▶학문의 신을 모신 다자이후 천만궁'),
            normal(null, '▶라라포트 자유 관광'),
            normal(null, '호텔 투숙 및 휴식'),
          ],
          meals: meal(false, true, false, '불포함', '현지식', '불포함'),
          hotel: {
            name: '후쿠오카 유벨 / 하카타 나카스 워싱턴 / WBF 그란데 하카타 OR 동급',
            grade: null,
            note: '2인1실 기준-더블',
          },
        },
        {
          day: 3,
          regions: ['후쿠오카', '부산'],
          schedule: [
            normal(null, '호텔 조식 후 출발'),
            normal(null, '▶베이사이드플레이스 관광'),
            normal(null, '▶하카타 포트 타워 (외관) 관광'),
            shopping(null, '면세점 1회 방문'),
            normal(null, '하카타항으로 이동 / 승선 준비'),
            flight('12:30', '하카타항 → 부산항 12:30 출발 → 18:30 도착 (카멜리아)', '카멜리아 페리'),
            normal('18:30', '부산 국제 여객 터미널 도착 / 입국 수속 후 해산'),
          ],
          meals: meal(true, false, false, '호텔식', '불포함', null),
          hotel: null,
        },
      ],
    },
    agent_audit_report: {
      parser_version: 'register-v2026.04.21-sonnet-4.6',
      ran_at: new Date().toISOString(),
      claims: [
        { id: 'min_participants', field: 'min_participants', severity: 'HIGH',
          text: '10명부터 출발 확정',
          evidence: '원문 인원: "▶10명부터 출발 확정"',
          supported: true },
        { id: 'ticketing_deadline', field: 'ticketing_deadline', severity: 'HIGH',
          text: '없음 (null)',
          evidence: '원문에 발권기한·예약마감 표기 없음',
          supported: true,
          note: 'null 로 저장 — 환각 금지' },
        { id: 'transport_camellia', field: 'meta.airline', severity: 'CRITICAL',
          text: '카멜리아 페리 (부산-하카타 22:30→07:30 / 하카타-부산 12:30→18:30)',
          evidence: '원문 헤더: "선박 스케쥴 부산 – 하카타 22:30 – 07:30 / 하카타 – 부산 12:30 – 18:30"',
          supported: true },
        { id: 'inclusions_no_amount_injection', field: 'inclusions', severity: 'CRITICAL',
          text: '여행자보험 (금액 없음)',
          evidence: '원문 포함: "여행자보험" 만 명시 — 금액(2억 등) 표기 없음',
          supported: true,
          note: 'ERR-FUK-insurance-injection 방어' },
        { id: 'meal_currentday', field: 'days[0].meals', severity: 'HIGH',
          text: 'D1 석:불포함 / D2 조:불포함, 중:현지식, 석:불포함 / D3 조:호텔식, 중:불포함',
          evidence: '원문 식사 컬럼 그대로',
          supported: true },
        { id: 'shopping_count', field: 'highlights.shopping', severity: 'HIGH',
          text: '쇼핑센터 1회 (면세점)',
          evidence: '원문 쇼핑센터 항목: "▶쇼핑센터 1회" + 일정표 D3 "면세점 1회 방문"',
          supported: true },
        { id: 'cancellation_policy', field: 'notices_parsed', severity: 'HIGH',
          text: '취소 수수료 당일 50%, 1주일전~1일전 30%',
          evidence: '원문 REMARK: "캔슬차지적용 - 당일 50%, 1주일전~1일전 30%적용"',
          supported: true },
        { id: 'hotel_d2', field: 'days[1].hotel', severity: 'CRITICAL',
          text: '후쿠오카 유벨 / 하카타 나카스 워싱턴 / WBF 그란데 하카타 OR 동급 (2인1실 더블)',
          evidence: '원문 D2 HOTEL: "후쿠오카 유벨 / 하카타 나카스 워싱턴 / WBF 그란데 하카타 또는 동급 (2인1실 기준-더블)"',
          supported: true,
          note: '호텔 등급 원문 명시 없음 → grade=null' },
        { id: 'price_high_sept', field: 'price_dates', severity: 'HIGH',
          text: '9/23~25 709,000원 (추석 연휴)',
          evidence: '원문 9월 가격표 9/23·24·25 = 709,000',
          supported: true },
        { id: 'date_excluded_X', field: 'price_dates', severity: 'HIGH',
          text: 'X 표기 날짜는 가격에서 제외 (출발 불가)',
          evidence: '원문 가격표의 X 날짜는 출발 불가로 price_dates 에서 제외',
          supported: true },
        { id: 'd2_attractions_verbatim', field: 'days[1].schedule', severity: 'HIGH',
          text: '모모치 해변·후쿠오카 타워·미야지다케 신사·마이즈루 공원·다자이후 천만궁·라라포트',
          evidence: '원문 D2 일정표 ▶ 항목 6개 verbatim (다자이후 = 원문 "태재부" 의 표준 한글표기 → SSOT 정상화)',
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
    console.log(`   ${i + 1}. ${p.title} (price_dates: ${p.price_dates.length}건, 최저가 ${minPrice.toLocaleString()}원)`);
  });

  // ─── Pre-INSERT Self-Check (W26~W29) ─────────────────
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
