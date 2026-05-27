/**
 * ★ 부산(김해)-서안 2026년 4월~10월 4개 상품 일괄 등록
 *   랜드사: 랜드부산 / 마진 9% / 발권기한 2026-04-27
 *
 *   1) BX 서안/구채구 + 전일정 리무진버스 3박5일 (수요일 출발)
 *   2) BX 서안/구채구 + 전일정 리무진버스 4박6일 (토요일 출발)
 *   3) 노쇼핑 BX 서안/난주/황하석림/바단지린사막+칠재산 3박5일 (수요일 출발)
 *   4) 노쇼핑 BX 서안/난주/황하석림/바단지린사막+칠재산 4박6일 (토요일 출발)
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── 헬퍼 ──
function flight(time, activity, transport) { return { time, activity, type: 'flight', transport, note: null }; }
function normal(time, activity, note) { return { time: time || null, activity, type: 'normal', transport: null, note: note || null }; }
function train(time, activity, transport, note) { return { time: time || null, activity, type: 'train', transport: transport || '고속열차', note: note || null }; }
function bus(time, activity, note) { return { time: time || null, activity, type: 'transport', transport: '전용차량', note: note || null }; }
function meal(b, l, d, bn, ln, dn) {
  return { breakfast: b, lunch: l, dinner: d, breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null };
}

// ── display_title 자동생성 ──
function generateDisplayTitle(pkg) {
  const type = (pkg.product_type || '').toLowerCase();
  let prefix = '';
  if (type.includes('노쇼핑') && type.includes('노팁') && type.includes('노옵션')) prefix = '추가비용 없는';
  else if (type.includes('노팁') && type.includes('노옵션')) prefix = '팁·옵션 걱정없는';
  else if (type.includes('노쇼핑')) prefix = '쇼핑 걱정없는';
  else if (type.includes('고품격')) prefix = '프리미엄';
  else if (type.includes('품격')) prefix = '5성급 검증된';
  else if (type.includes('실속')) prefix = '핵심만 담은';

  const skipWords = ['노쇼핑', '노팁', '노옵션', '노팁노옵션'];
  const points = (pkg.product_highlights || [])
    .filter(h => !skipWords.some(w => h.includes(w)))
    .slice(0, 3);

  const base = [prefix, pkg.destination, `${pkg.nights}박${pkg.duration}일`].filter(Boolean).join(' ');
  return points.length ? `${base} — ${points.join(' + ')}` : base;
}

// ── price_tiers → price_dates 자동변환 ──
const DOW_MAP = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
function tiersToDatePrices(tiers) {
  const seen = new Set();
  const result = [];
  for (const tier of tiers) {
    if (tier.status === 'soldout') continue;
    const dates = [];
    if (tier.date_range?.start && tier.date_range?.end && tier.departure_day_of_week != null) {
      const dow = DOW_MAP[tier.departure_day_of_week];
      const [sy, sm, sd] = tier.date_range.start.split('-').map(Number);
      const [ey, em, ed] = tier.date_range.end.split('-').map(Number);
      const c = new Date(sy, sm - 1, sd);
      const end = new Date(ey, em - 1, ed);
      while (c <= end) {
        if (c.getDay() === dow) {
          dates.push(`${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`);
        }
        c.setDate(c.getDate() + 1);
      }
    }
    if (tier.departure_dates?.length) dates.push(...tier.departure_dates);
    for (const date of dates) {
      if (!date || seen.has(date)) continue;
      seen.add(date);
      result.push({ date, price: tier.adult_price || 0, confirmed: false });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

// ══════════════════════════════════════════════════════════════
//  공통 랜드사/코드/마진
// ══════════════════════════════════════════════════════════════
const LAND_OPERATOR_ID = 'de5cd166-9f84-41f5-9124-e9b6b1081ffe'; // 랜드부산
const COMMISSION_RATE = 9;
const TICKETING_DEADLINE = '2026-04-27';
const SUPPLIER_CODE = 'LB';
const DEST_CODE = 'XIY';

// ── 공통 구채구 price_tiers 빌더 (수요일/토요일별) ──
function buildXianPriceTiers(dow, prices) {
  // prices: [apr, may, jun, julAug, sep, oct]
  return [
    { period_label: `4/1~4/30 ${dow}요일`, date_range: { start: '2026-04-01', end: '2026-04-30' }, departure_day_of_week: dow, adult_price: prices[0], child_price: null, status: 'available', note: null },
    { period_label: `5/1~5/31 ${dow}요일`, date_range: { start: '2026-05-01', end: '2026-05-31' }, departure_day_of_week: dow, adult_price: prices[1], child_price: null, status: 'available', note: '중국 노동절(4/29~5/5) 요금 별도 문의' },
    { period_label: `6/1~6/30 ${dow}요일`, date_range: { start: '2026-06-01', end: '2026-06-30' }, departure_day_of_week: dow, adult_price: prices[2], child_price: null, status: 'available', note: null },
    { period_label: `7/1~8/31 ${dow}요일`, date_range: { start: '2026-07-01', end: '2026-08-31' }, departure_day_of_week: dow, adult_price: prices[3], child_price: null, status: 'available', note: null },
    { period_label: `9/1~9/30 ${dow}요일`, date_range: { start: '2026-09-01', end: '2026-09-30' }, departure_day_of_week: dow, adult_price: prices[4], child_price: null, status: 'available', note: null },
    { period_label: `10/1~10/17 ${dow}요일`, date_range: { start: '2026-10-01', end: '2026-10-17' }, departure_day_of_week: dow, adult_price: prices[5], child_price: null, status: 'available', note: null },
  ];
}

// ══════════════════════════════════════════════════════════════
//  PKG1: 서안/구채구 3박5일 (수요일 출발)
// ══════════════════════════════════════════════════════════════
const PKG1 = {
  title: 'BX 서안/구채구 + 전일정 리무진버스 패키지 3박5일',
  destination: '서안/구채구',
  country: '중국',
  category: 'package',
  product_type: null,
  trip_style: '3박5일',
  duration: 5,
  nights: 3,
  departure_airport: '부산(김해)',
  airline: 'BX(에어부산)',
  min_participants: 10,
  status: 'pending',
  price: 1249000,
  guide_tip: 50,
  single_supplement: 70,
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  optional_tours: [
    { name: '구채구송성가무쇼', price_usd: 50, price_krw: null, note: null },
    { name: '발맛사지(60분)', price_usd: 40, price_krw: null, note: null },
    { name: '야크불고기', price_usd: 30, price_krw: null, note: null },
    { name: '서안실크로드쇼', price_usd: 50, price_krw: null, note: null },
  ],
  price_tiers: buildXianPriceTiers('수', [1429000, 1309000, 1249000, 1269000, 1319000, 1429000]),
  inclusions: ['왕복항공료, 호텔(2인1실), 식사, 차량(리무진버스), 관광지입장료, 고속열차(2등석), 한국어가이드, 여행자보험'],
  excludes: ['유류변동분(4월기준), 개인경비, 매너팁, 기사/가이드팁($50/인)'],
  notices_parsed: [
    '단독행사 요청시 추가 요금 발생합니다.',
    '2인실 1명이 쓰시는 경우 싱글차지 $70/인(4/20~6/25) 발생합니다.',
    '구채구 지역은 해발 3,000미터가 넘어서 음주 금지이고, 고산증이 올 수 있으니 비상약 준비 해주시길 바랍니다.',
    '기본 식사는 중,석식 $6/인 기준입니다. 특식 추가는 별도 문의 부탁드립니다.',
    '개별일정 조절 불가하며 현지에서 행사 조인이 불가합니다.',
    '중국 명절 기간(4/29-5/5) 요금별도 문의 부탁드립니다.',
    '본 행사는 패키지 행사로 관광지, 식사 등 행사에 빠질 경우 환불이 되지 않습니다.',
    '여권은 출발일 기준, 만료일 6개월 이상 남아 있어야 합니다.',
    '취소수수료 규정 안내서 참고 하셔서 꼭 안내 부탁드립니다.',
    '구채구 입장권 실명제 예약으로 취소시 대체가 불가능하며 100% 위약금이 나옵니다. *명단,아피스 정확해야함',
  ],
  special_notes: null,
  product_highlights: [
    '유네스코 세계자연유산 구채구 전 구간 관광 (수정구·일촉구·측사와구)',
    '신선지 비경 관광 (해발 2,200M~3,200M 붐비지 않는 힐링 풍경구)',
    '서안성벽 + 서원문거리 관광',
    '전 일정 리무진버스 + 고속열차 2등석 편안한 이동',
  ],
  product_summary: null,
  product_tags: ['구채구', '서안', '중국', '리무진버스'],
  accommodations: [
    '유어코브 바이 하얏트호텔 또는 동급 (준5성급) × 1박',
    '코트야드 메리어트 호텔 또는 동급 (준5성급) × 1박',
    '천학 리젠호텔 또는 동급 (준5성급) × 1박',
  ],
  itinerary: [],
  raw_text: '',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
  itinerary_data: {
    meta: {
      title: 'BX 서안/구채구 + 전일정 리무진버스 패키지 3박5일',
      product_type: null,
      destination: '서안/구채구',
      nights: 3,
      days: 5,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX341',
      flight_in: 'BX342',
      departure_days: '매주 수요일',
      min_participants: 10,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-27',
      hashtags: ['#구채구', '#서안', '#리무진버스', '#준5성호텔'],
      brand: '여소남',
    },
    highlights: {
      inclusions: ['왕복항공료, 호텔(2인1실), 식사, 차량(리무진버스), 관광지입장료, 고속열차(2등석), 한국어가이드, 여행자보험'],
      excludes: ['유류변동분(4월기준), 개인경비, 매너팁, 기사/가이드팁($50/인)'],
      shopping: null,
      remarks: [
        '단독행사 요청시 추가 요금 발생합니다.',
        '2인실 1명이 쓰시는 경우 싱글차지 $70/인(4/20~6/25) 발생합니다.',
        '구채구 지역은 해발 3,000미터가 넘어서 음주 금지이고, 고산증이 올 수 있으니 비상약 준비 해주시길 바랍니다.',
        '기본 식사는 중,석식 $6/인 기준입니다. 특식 추가는 별도 문의 부탁드립니다.',
        '개별일정 조절 불가하며 현지에서 행사 조인이 불가합니다.',
        '중국 명절 기간(4/29-5/5) 요금별도 문의 부탁드립니다.',
        '본 행사는 패키지 행사로 관광지, 식사 등 행사에 빠질 경우 환불이 되지 않습니다.',
        '여권은 출발일 기준, 만료일 6개월 이상 남아 있어야 합니다.',
        '취소수수료 규정 안내서 참고 하셔서 꼭 안내 부탁드립니다.',
        '구채구 입장권 실명제 예약으로 취소시 대체가 불가능하며 100% 위약금이 나옵니다. *명단,아피스 정확해야함',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '서안'],
        meals: meal(false, false, false),
        schedule: [
          normal(null, '출발2시간전 김해공항 국제선 2층에서 미팅 후 수속'),
          flight('22:00', '김해 국제공항 출발', 'BX341'),
          flight('00:35', '서안 국제공항 도착 가이드 미팅후 호텔로 이동', 'BX341'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '유어코브 바이 하얏트호텔 또는 동급', grade: '준5성급', note: null },
      },
      {
        day: 2,
        regions: ['서안', '광원', '구채구'],
        meals: meal(true, true, true, '호텔식', '한식', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '중국 보존건축물중 가장 완전한 고성 서안성벽'),
          normal(null, '서안의 인사동 – 서원문 거리 관광'),
          normal(null, '*이른 중식 후 기차 탑승 ( 또는 한식 도시락으로 기차 식사 가능합니다)'),
          train('12:35', '서안역 출발', 'D1931', '*변경가능'),
          train('14:45', '광원역 도착', null),
          bus(null, '리무진 차량 환승하여 구채구현으로 이동 (약 4시간 30분소요)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '코트야드 메리어트 호텔 또는 동급', grade: '준5성급', note: null },
      },
      {
        day: 3,
        regions: ['구채구'],
        meals: meal(true, true, true, '호텔식', '낙일랑식당', '호텔식'),
        schedule: [
          normal(null, '호텔 조식 후'),
          bus(null, '구채구 풍경구로 이동 (약 50분 소요)'),
          normal(null, '5km구간의 호수가 펼쳐진 수정구구간 (수정폭포 등)'),
          normal(null, '맑고 깨끗한 각양각색의 호수가 펼쳐지는 일촉구 (오화해, 진주탄폭포 등)'),
          normal(null, '가장 해발이 높고 거리가 긴 측사와구 (장해, 오채지, 낙일랑폭포 등)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '천학 리젠호텔 또는 동급', grade: '준5성급', note: null },
      },
      {
        day: 4,
        regions: ['구채구', '신선지', '광원', '서안'],
        meals: meal(true, true, true, '호텔식', '한식', '사천요리'),
        schedule: [
          normal(null, '호텔 조식 후'),
          bus(null, '신선지로 이동 (약 1시간 30분소요)'),
          normal(null, '구채구 풍경구와 황용풍경구가 합쳐진 느낌을 주는 신선지 풍경 (해발 2,200M-3,200M 붐비지 않고 편안하게 즐길 수 있는 풍경구)'),
          normal(null, '구채구현 도착 (약 2시간 소요)'),
          bus(null, '광원으로 이동 (약 4시간 30분)'),
          train('20:55', '광원역 출발', 'D1960', '*변경가능'),
          train('23:03', '서안역 도착', null),
          normal(null, '서안 공항으로 이동'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
      {
        day: 5,
        regions: ['서안', '부산'],
        meals: meal(false, false, false),
        schedule: [
          flight('02:10', '서안 국제공항 출발', 'BX342'),
          flight('06:30', '김해 국제공항 도착', 'BX342'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [
      { name: '구채구송성가무쇼', price_usd: 50, price_krw: null, note: null },
      { name: '발맛사지(60분)', price_usd: 40, price_krw: null, note: null },
      { name: '야크불고기', price_usd: 30, price_krw: null, note: null },
      { name: '서안실크로드쇼', price_usd: 50, price_krw: null, note: null },
    ],
  },
};

// ══════════════════════════════════════════════════════════════
//  PKG2: 서안/구채구 4박6일 (토요일 출발)
// ══════════════════════════════════════════════════════════════
const PKG2 = {
  title: 'BX 서안/구채구 + 전일정 리무진버스 패키지 4박6일',
  destination: '서안/구채구',
  country: '중국',
  category: 'package',
  product_type: null,
  trip_style: '4박6일',
  duration: 6,
  nights: 4,
  departure_airport: '부산(김해)',
  airline: 'BX(에어부산)',
  min_participants: 10,
  status: 'pending',
  price: 1259000,
  guide_tip: 60,
  single_supplement: 90,
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  optional_tours: [
    { name: '구채구송성가무쇼', price_usd: 50, price_krw: null, note: null },
    { name: '발맛사지(60분)', price_usd: 40, price_krw: null, note: null },
    { name: '야크불고기', price_usd: 30, price_krw: null, note: null },
    { name: '서안실크로드쇼', price_usd: 50, price_krw: null, note: null },
  ],
  price_tiers: buildXianPriceTiers('토', [1419000, 1329000, 1259000, 1289000, 1329000, 1429000]),
  inclusions: ['왕복항공료, 호텔(2인1실), 식사, 차량(리무진버스), 관광지입장료, 고속열차(2등석), 한국어가이드, 여행자보험'],
  excludes: ['유류변동분(4월기준), 개인경비, 매너팁, 기사/가이드팁($60/인)'],
  notices_parsed: [
    '단독행사 요청시 추가 요금 발생합니다.',
    '2인실 1명이 쓰시는 경우 싱글차지 $90/인(4/20~6/25) 발생합니다.',
    '구채구 지역은 해발 3,000미터가 넘어서 음주 금지이고, 고산증이 올 수 있으니 비상약 준비 해주시길 바랍니다.',
    '기본 식사는 중,석식 $6/인 기준입니다. 특식 추가는 별도 문의 부탁드립니다.',
    '개별일정 조절 불가하며 현지에서 행사 조인이 불가합니다.',
    '중국 명절 기간(4/29-5/5) 요금별도 문의 부탁드립니다.',
    '본 행사는 패키지 행사로 관광지, 식사 등 행사에 빠질 경우 환불이 되지 않습니다.',
    '여권은 출발일 기준, 만료일 6개월 이상 남아 있어야 합니다.',
    '취소수수료 규정 안내서 참고 하셔서 꼭 안내 부탁드립니다.',
    '구채구 입장권 실명제 예약으로 취소시 대체가 불가능하며 100% 위약금이 나옵니다. *명단,아피스 정확해야함',
  ],
  special_notes: null,
  product_highlights: [
    '유네스코 세계자연유산 구채구 전 구간 관광 (수정구·일촉구·측사와구)',
    '검각국제 온천호텔 1박 (23시까지 온천체험 가능)',
    '세계 8대 불가사의 병마용박물원 + 진시황릉',
    '신선지 비경 + 서안 회족거리 야시장 + 종고루광장 야경',
  ],
  product_summary: null,
  product_tags: ['구채구', '서안', '중국', '리무진버스', '온천'],
  accommodations: [
    '유어코브 바이 하얏트호텔 또는 동급 (준5성급) × 1박',
    '코트야드 메리어트 호텔 또는 동급 (준5성급) × 1박',
    '천학 리젠호텔 또는 동급 (준5성급) × 1박',
    '검각국제 온천호텔♨ 또는 동급 (준5성급) × 1박',
  ],
  itinerary: [],
  raw_text: '',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
  itinerary_data: {
    meta: {
      title: 'BX 서안/구채구 + 전일정 리무진버스 패키지 4박6일',
      product_type: null,
      destination: '서안/구채구',
      nights: 4,
      days: 6,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX341',
      flight_in: 'BX342',
      departure_days: '매주 토요일',
      min_participants: 10,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-27',
      hashtags: ['#구채구', '#서안', '#병마용', '#온천호텔'],
      brand: '여소남',
    },
    highlights: {
      inclusions: ['왕복항공료, 호텔(2인1실), 식사, 차량(리무진버스), 관광지입장료, 고속열차(2등석), 한국어가이드, 여행자보험'],
      excludes: ['유류변동분(4월기준), 개인경비, 매너팁, 기사/가이드팁($60/인)'],
      shopping: null,
      remarks: [
        '단독행사 요청시 추가 요금 발생합니다.',
        '2인실 1명이 쓰시는 경우 싱글차지 $90/인(4/20~6/25) 발생합니다.',
        '구채구 지역은 해발 3,000미터가 넘어서 음주 금지이고, 고산증이 올 수 있으니 비상약 준비 해주시길 바랍니다.',
        '기본 식사는 중,석식 $6/인 기준입니다. 특식 추가는 별도 문의 부탁드립니다.',
        '개별일정 조절 불가하며 현지에서 행사 조인이 불가합니다.',
        '중국 명절 기간(4/29-5/5) 요금별도 문의 부탁드립니다.',
        '본 행사는 패키지 행사로 관광지, 식사 등 행사에 빠질 경우 환불이 되지 않습니다.',
        '여권은 출발일 기준, 만료일 6개월 이상 남아 있어야 합니다.',
        '취소수수료 규정 안내서 참고 하셔서 꼭 안내 부탁드립니다.',
        '구채구 입장권 실명제 예약으로 취소시 대체가 불가능하며 100% 위약금이 나옵니다. *명단,아피스 정확해야함',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '서안'],
        meals: meal(false, false, false),
        schedule: [
          normal(null, '출발2시간전 김해공항 국제선 2층에서 미팅 후 수속'),
          flight('22:00', '김해 국제공항 출발', 'BX341'),
          flight('00:35', '서안 국제공항 도착 가이드 미팅후 호텔로 이동', 'BX341'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '유어코브 바이 하얏트호텔 또는 동급', grade: '준5성급', note: null },
      },
      {
        day: 2,
        regions: ['서안', '광원', '구채구'],
        meals: meal(true, true, true, '호텔식', '한식', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '중국 보존건축물중 가장 완전한 고성 서안성벽'),
          normal(null, '서안의 인사동 – 서원문 거리 관광'),
          normal(null, '*이른 중식 후 기차 탑승 ( 또는 한식 도시락으로 기차 식사 가능합니다)'),
          train('12:45', '서안역 출발', 'D1931', '*변경가능'),
          train('14:24', '광원역 도착', null),
          bus(null, '리무진 차량 환승하여 구채구현으로 이동 (약4시간30분소요)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '코트야드 메리어트 호텔 또는 동급', grade: '준5성급', note: null },
      },
      {
        day: 3,
        regions: ['구채구'],
        meals: meal(true, true, true, '호텔식', '낙일랑식당', '호텔식'),
        schedule: [
          normal(null, '호텔 조식 후'),
          bus(null, '구채구 풍경구로 이동 (약 50분 소요)'),
          normal(null, '5km구간의 호수가 펼쳐진 수정구구간 (수정폭포 등)'),
          normal(null, '맑고 깨끗한 각양각색의 호수가 펼쳐지는 일촉구 (오화해, 진주탄폭포 등)'),
          normal(null, '가장 해발이 높고 거리가 긴 측사와구 (장해, 오채지, 낙일랑폭포 등)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '천학 리젠호텔 또는 동급', grade: '준5성급', note: null },
      },
      {
        day: 4,
        regions: ['구채구', '신선지', '광원'],
        meals: meal(true, true, true, '호텔식', '한식', '사천요리'),
        schedule: [
          normal(null, '호텔 조식 후'),
          bus(null, '신선지로 이동 (약 1시간 30분 소요)'),
          normal(null, '구채구 풍경구와 황용풍경구가 합쳐진 느낌을 주는 신선지 풍경 (해발 2,200M-3,200M 붐비지 않고 편안하게 즐길 수 있는 풍경구)'),
          normal(null, '구채구현 도착 (약 2시간 소요)'),
          bus(null, '광원으로 이동 (약 4시간 30분)'),
          normal(null, '호텔 투숙 및 휴식 *온천체험 가능 (23시까지 영업 – 수영복준비)'),
        ],
        hotel: { name: '검각국제 온천호텔♨ 또는 동급', grade: '준5성급', note: null },
      },
      {
        day: 5,
        regions: ['광원', '서안'],
        meals: meal(true, true, true, '호텔식', '한식', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후 광원역으로 이동 (약 30분 소요)'),
          train('08:50', '광원역 출발', 'D1046', '*변경가능'),
          train('11:13', '서안역 도착', null),
          normal(null, '37년에 걸쳐 만들어진 세계 최대의 능 진시황릉'),
          normal(null, '세게 8대 불가사의 중 하나인 병마용박물원'),
          normal(null, '서안의 실크로드 입문거리 회족거리'),
          normal(null, '종고루광장 야경 및 서안 야시장'),
          normal(null, '서안 공항으로 이동'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
      {
        day: 6,
        regions: ['서안', '부산'],
        meals: meal(false, false, false),
        schedule: [
          flight('02:10', '서안 국제공항 출발', 'BX342'),
          flight('06:30', '김해 국제공항 도착', 'BX342'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [
      { name: '구채구송성가무쇼', price_usd: 50, price_krw: null, note: null },
      { name: '발맛사지(60분)', price_usd: 40, price_krw: null, note: null },
      { name: '야크불고기', price_usd: 30, price_krw: null, note: null },
      { name: '서안실크로드쇼', price_usd: 50, price_krw: null, note: null },
    ],
  },
};

// ══════════════════════════════════════════════════════════════
//  PKG3: 서안/칠채산 3박5일 (수요일 출발, 노쇼핑)
// ══════════════════════════════════════════════════════════════
const PKG3 = {
  title: '노쇼핑 BX 서안/난주/황하석림/바단지린사막+칠재산 패키지 3박5일',
  destination: '서안/칠채산',
  country: '중국',
  category: 'package',
  product_type: '노쇼핑',
  trip_style: '3박5일',
  duration: 5,
  nights: 3,
  departure_airport: '부산(김해)',
  airline: 'BX(에어부산)',
  min_participants: 10,
  status: 'pending',
  price: 1159000,
  guide_tip: 50,
  single_supplement: 60,
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  optional_tours: [
    { name: '강력추천옵션', price_usd: 130, price_krw: null, note: '평산호대협곡 $80/인, 빙구 단하 $50/인, 양고기바비큐 $30/인, 발+전신마사지90분 $50' },
  ],
  price_tiers: buildXianPriceTiers('수', [1339000, 1219000, 1159000, 1189000, 1179000, 1249000]),
  inclusions: ['왕복항공료, 호텔(2인1실), 식사, 관광지입장료, 고속열차(2등석), 한국어가이드, 여행자보험'],
  excludes: ['유류변동분(4월기준), 개인경비, 매너팁, 기사/가이드팁($50/인), 강력추천옵션($130/인)'],
  notices_parsed: [
    '중국 명절 기간 요금별도 문의 부탁드립니다.',
    '개별일정 조절 불가하며 현지에서 행사 조인이 불가합니다.',
    '단독행사 요청시 추가 요금 발생합니다.',
    '2인실 1명이 쓰시는 경우 싱글차지 $60/인(4월~6월,9월~10월), $75/인(7월~8월) 발생합니다.',
    '중국 노동절기간 (4/30~5/5) $35/인 추가됩니다. 중국 국경절 기간 추가요금 발생합니다.',
    '기본 식사는 중,석식$8/인 기준입니다. 특식 추가는 별도 문의 부탁드립니다.',
    '본 행사는 패키지 행사로 관광지, 식사 등 행사에 빠질 경우 환불이 되지 않습니다.',
    '여권은 출발일 기준, 만료일 6개월 이상 남아 있어야 합니다.',
    '취소수수료 규정 안내서 참고 하셔서 꼭 안내 부탁드립니다.',
  ],
  special_notes: null,
  product_highlights: [
    '단하지모 칠채산 일출 감상 (중국 서부 최고의 비경)',
    '바단지린사막 지프차 투어 (칭기스칸상·바단호 오아시스)',
    '바람의 아들·신화 촬영지 황화석림 관광 (구간차+전동차+보트)',
    '노쇼핑 — 쇼핑센터 방문 없는 실속 일정',
  ],
  product_summary: null,
  product_tags: ['칠채산', '바단지린사막', '황하석림', '서안', '노쇼핑'],
  accommodations: [
    '항무구 홀리데이 익스프레스 호텔 또는 동급 (4성급) × 1박',
    '무위 금도국제호텔 또는 동급 (4성급) × 1박',
    '장액 여경호텔 또는 동급 (4성급) × 1박',
  ],
  itinerary: [],
  raw_text: '',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
  itinerary_data: {
    meta: {
      title: '노쇼핑 BX 서안/난주/황하석림/바단지린사막+칠재산 패키지 3박5일',
      product_type: '노쇼핑',
      destination: '서안/칠채산',
      nights: 3,
      days: 5,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX341',
      flight_in: 'BX342',
      departure_days: '매주 수요일',
      min_participants: 10,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-27',
      hashtags: ['#칠채산', '#바단지린사막', '#황하석림', '#노쇼핑'],
      brand: '여소남',
    },
    highlights: {
      inclusions: ['왕복항공료, 호텔(2인1실), 식사, 관광지입장료, 고속열차(2등석), 한국어가이드, 여행자보험'],
      excludes: ['유류변동분(4월기준), 개인경비, 매너팁, 기사/가이드팁($50/인), 강력추천옵션($130/인)'],
      shopping: '노쇼핑 (쇼핑센터 방문 없음)',
      remarks: [
        '중국 명절 기간 요금별도 문의 부탁드립니다.',
        '개별일정 조절 불가하며 현지에서 행사 조인이 불가합니다.',
        '단독행사 요청시 추가 요금 발생합니다.',
        '2인실 1명이 쓰시는 경우 싱글차지 $60/인(4월~6월,9월~10월), $75/인(7월~8월) 발생합니다.',
        '중국 노동절기간 (4/30~5/5) $35/인 추가됩니다. 중국 국경절 기간 추가요금 발생합니다.',
        '기본 식사는 중,석식$8/인 기준입니다. 특식 추가는 별도 문의 부탁드립니다.',
        '본 행사는 패키지 행사로 관광지, 식사 등 행사에 빠질 경우 환불이 되지 않습니다.',
        '여권은 출발일 기준, 만료일 6개월 이상 남아 있어야 합니다.',
        '취소수수료 규정 안내서 참고 하셔서 꼭 안내 부탁드립니다.',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '서안'],
        meals: meal(false, false, false),
        schedule: [
          normal(null, '출발2시간전 김해공항 국제선 2층에서 미팅 후 수속'),
          flight('22:00', '김해 국제공항 출발', 'BX341'),
          flight('00:35', '서안 국제공항 도착 가이드 미팅후 호텔로 이동', 'BX341'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '항무구 홀리데이 익스프레스 호텔 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 2,
        regions: ['서안', '란주', '황화석림', '무위'],
        meals: meal(true, true, true, '호텔식', '우육면', '농가집'),
        schedule: [
          normal(null, '호텔 조식 후 (약10분소요)'),
          train('08:00', '서안역 출발', 'D2701', '*변경가능'),
          train('10:54', '란주역 도착', null),
          normal(null, '바람의 아들, 신화 등 영화를 촬영했던 황화석림관광 (구간차-전동차왕복+보트)관광'),
          bus(null, '무위로 이동(약3시간소요)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '무위 금도국제호텔 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 3,
        regions: ['무위', '바단지린', '장액'],
        meals: meal(true, true, true, '호텔식', '현지식', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후'),
          bus(null, '바단지린사막으로이동(약3시간30분)'),
          normal(null, '바단지린사막 지프차투어-입구-칭기스칸상-바단호(오아시스)'),
          bus(null, '장액으로 이동(약3시간소요)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '장액 여경호텔 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 4,
        regions: ['장액', '서안'],
        meals: meal(true, true, true, '호텔식', '현지식', '열차식'),
        schedule: [
          normal(null, '칠재산 일출 감상 *날씨상황으로 일출불가시 환불없을 미리 알려드립니다.'),
          normal(null, '호텔 조식 후'),
          bus(null, '중국 서부에서 제일 아름다운 단하지모 칠재산관광(셔틀버스포함) *약2시간소요'),
          train('15:50', '장액역 출발', 'D2708', '*변경가능'),
          train('22:00', '서안역 도착 (고속열차 2등석)', null),
          normal(null, '열차이동중 열차차창으로 기련산맥설산과 백리유채꽃(7~8월) 풍경감상'),
          normal(null, '서안 공항으로 이동'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
      {
        day: 5,
        regions: ['서안', '부산'],
        meals: meal(false, false, false),
        schedule: [
          flight('02:10', '서안 국제공항 출발', 'BX342'),
          flight('06:30', '김해 국제공항 도착', 'BX342'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [
      { name: '강력추천옵션', price_usd: 130, price_krw: null, note: '평산호대협곡 $80/인, 빙구 단하 $50/인, 양고기바비큐 $30/인, 발+전신마사지90분 $50' },
    ],
  },
};

// ══════════════════════════════════════════════════════════════
//  PKG4: 서안/칠채산 4박6일 (토요일 출발, 노쇼핑)
// ══════════════════════════════════════════════════════════════
const PKG4 = {
  title: '노쇼핑 BX 서안/난주/황하석림/바단지린사막+칠재산 패키지 4박6일',
  destination: '서안/칠채산',
  country: '중국',
  category: 'package',
  product_type: '노쇼핑',
  trip_style: '4박6일',
  duration: 6,
  nights: 4,
  departure_airport: '부산(김해)',
  airline: 'BX(에어부산)',
  min_participants: 10,
  status: 'pending',
  price: 1179000,
  guide_tip: 60,
  single_supplement: 60,
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  optional_tours: [
    { name: '강력추천옵션', price_usd: 130, price_krw: null, note: '평산호대협곡 $80/인, 빙구 단하 $50/인, 양고기바비큐 $30/인, 발+전신마사지90분 $50' },
  ],
  price_tiers: buildXianPriceTiers('토', [1329000, 1239000, 1179000, 1199000, 1199000, 1269000]),
  inclusions: ['왕복항공료, 호텔(2인1실), 식사, 관광지입장료, 고속열차(2등석), 한국어가이드, 여행자보험'],
  excludes: ['유류변동분(4월기준), 개인경비, 매너팁, 기사/가이드팁($60/인)'],
  notices_parsed: [
    '중국 명절 기간 요금별도 문의 부탁드립니다.',
    '개별일정 조절 불가하며 현지에서 행사 조인이 불가합니다.',
    '단독행사 요청시 추가 요금 발생합니다.',
    '2인실 1명이 쓰시는 경우 싱글차지 $60/인(4월~6월,9월~10월), $75/인(7월~8월) 발생합니다.',
    '중국 노동절기간 (4/30~5/5) $35/인 추가됩니다. 중국 국경절 기간 추가요금 발생합니다.',
    '기본 식사는 중,석식$8/인 기준입니다. 특식 추가는 별도 문의 부탁드립니다.',
    '본 행사는 패키지 행사로 관광지, 식사 등 행사에 빠질 경우 환불이 되지 않습니다.',
    '여권은 출발일 기준, 만료일 6개월 이상 남아 있어야 합니다.',
    '취소수수료 규정 안내서 참고 하셔서 꼭 안내 부탁드립니다.',
  ],
  special_notes: null,
  product_highlights: [
    '단하지모 칠채산 일출 감상 (중국 서부 최고의 비경)',
    '바단지린사막 지프차 투어 (칭기스칸상·바단호 오아시스)',
    '황하철교 + 백탑산 조망 + 황하모친상 (란주 시내 핵심)',
    '노쇼핑 — 쇼핑센터 방문 없는 실속 일정',
  ],
  product_summary: null,
  product_tags: ['칠채산', '바단지린사막', '황하석림', '서안', '노쇼핑'],
  accommodations: [
    '항무구 홀리데이 익스프레스 호텔 또는 동급 (4성급) × 1박',
    '백은 만성호텔 또는 동급 (4성급) × 1박',
    '무위 금도국제호텔 또는 동급 (4성급) × 1박',
    '장액 여경호텔 또는 동급 (4성급) × 1박',
  ],
  itinerary: [],
  raw_text: '',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
  itinerary_data: {
    meta: {
      title: '노쇼핑 BX 서안/난주/황하석림/바단지린사막+칠재산 패키지 4박6일',
      product_type: '노쇼핑',
      destination: '서안/칠채산',
      nights: 4,
      days: 6,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX341',
      flight_in: 'BX342',
      departure_days: '매주 토요일',
      min_participants: 10,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-27',
      hashtags: ['#칠채산', '#바단지린사막', '#황하석림', '#노쇼핑'],
      brand: '여소남',
    },
    highlights: {
      inclusions: ['왕복항공료, 호텔(2인1실), 식사, 관광지입장료, 고속열차(2등석), 한국어가이드, 여행자보험'],
      excludes: ['유류변동분(4월기준), 개인경비, 매너팁, 기사/가이드팁($60/인)'],
      shopping: '노쇼핑 (쇼핑센터 방문 없음)',
      remarks: [
        '중국 명절 기간 요금별도 문의 부탁드립니다.',
        '개별일정 조절 불가하며 현지에서 행사 조인이 불가합니다.',
        '단독행사 요청시 추가 요금 발생합니다.',
        '2인실 1명이 쓰시는 경우 싱글차지 $60/인(4월~6월,9월~10월), $75/인(7월~8월) 발생합니다.',
        '중국 노동절기간 (4/30~5/5) $35/인 추가됩니다. 중국 국경절 기간 추가요금 발생합니다.',
        '기본 식사는 중,석식$8/인 기준입니다. 특식 추가는 별도 문의 부탁드립니다.',
        '본 행사는 패키지 행사로 관광지, 식사 등 행사에 빠질 경우 환불이 되지 않습니다.',
        '여권은 출발일 기준, 만료일 6개월 이상 남아 있어야 합니다.',
        '취소수수료 규정 안내서 참고 하셔서 꼭 안내 부탁드립니다.',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '서안'],
        meals: meal(false, false, false),
        schedule: [
          normal(null, '출발2시간전 김해공항 국제선 2층에서 미팅 후 수속'),
          flight('22:00', '김해 국제공항 출발', 'BX341'),
          flight('00:35', '서안 국제공항 도착 가이드 미팅후 호텔로 이동', 'BX341'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '항무구 홀리데이 익스프레스 호텔 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 2,
        regions: ['서안', '란주', '백은'],
        meals: meal(true, true, true, '호텔식', '열차도시락', '우육면'),
        schedule: [
          normal(null, '호텔 조식 후 (약10분소요)'),
          train('11:08', '서안역 출발', 'D2701', '*변경가능'),
          train('14:14', '란주역 도착', null),
          normal(null, '황하철교(약30분소요), 황하모친상'),
          normal(null, '백탑산조망'),
          normal(null, '수차원 관광 (약30~40분소요)'),
          bus(null, '백은으로 이동(약1시간30분소요)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '백은 만성호텔 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 3,
        regions: ['백은', '황화석림', '무위'],
        meals: meal(true, true, true, '호텔식', '현지식', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후'),
          bus(null, '바람의 아들, 신화 등 영화를 촬영했던 황화석림관광 (구간차-전동차왕복+보트)관광'),
          normal(null, '중식 후'),
          bus(null, '무위로 이동(약3시간소요)'),
          normal(null, '뇌대한묘광장, 마탑비연(중국관광의 상징물)동상 등 시내관광'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '무위 금도국제호텔 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 4,
        regions: ['무위', '바단지린', '장액'],
        meals: meal(true, true, true, '호텔식', '현지식', '현지식'),
        schedule: [
          normal(null, '호텔 조식 후'),
          bus(null, '바단지린사막으로이동(약3시간30분)'),
          normal(null, '바단지린사막 지프차투어-입구-칭기스칸상-바단호(오아시스)'),
          bus(null, '장액으로 이동(약3시간소요)'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '장액 여경호텔 또는 동급', grade: '4성급', note: null },
      },
      {
        day: 5,
        regions: ['장액', '서안'],
        meals: meal(true, true, true, '호텔식', '현지식', '열차식'),
        schedule: [
          normal(null, '칠재산 일출 감상 *날씨상황으로 일출불가시 환불없을 미리 알려드립니다.'),
          normal(null, '호텔 조식 후'),
          bus(null, '중국 서부에서 제일 아름다운 단하지모 칠재산관광(셔틀버스포함) *약2시간소요'),
          train('15:50', '장액역 출발', 'D2708', '*변경가능'),
          train('22:00', '서안역 도착 (고속열차 2등석)', null),
          normal(null, '열차이동중 열차차창으로 기련산맥설산과 백리유채꽃(7~8월) 풍경감상'),
          normal(null, '서안 공항으로 이동'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
      {
        day: 6,
        regions: ['서안', '부산'],
        meals: meal(false, false, false),
        schedule: [
          flight('02:10', '서안 국제공항 출발', 'BX342'),
          flight('06:30', '김해 국제공항 도착', 'BX342'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [
      { name: '강력추천옵션', price_usd: 130, price_krw: null, note: '평산호대협곡 $80/인, 빙구 단하 $50/인, 양고기바비큐 $30/인, 발+전신마사지90분 $50' },
    ],
  },
};

const ALL_PACKAGES = [PKG1, PKG2, PKG3, PKG4];

async function main() {
  console.log(`📦 패키지 ${ALL_PACKAGES.length}개 등록 시작...\n`);

  // ── 중복 감지 ──
  const { data: existingPkgs } = await sb
    .from('travel_packages')
    .select('id, title, destination, product_type, duration, price, price_tiers, ticketing_deadline, short_code, status')
    .eq('land_operator_id', LAND_OPERATOR_ID)
    .in('status', ['approved', 'active', 'pending']);

  function findDuplicate(pkg) {
    return (existingPkgs || []).find(e =>
      e.destination === pkg.destination &&
      (e.product_type ?? null) === (pkg.product_type ?? null) &&
      e.duration === pkg.duration
    );
  }

  function isSamePrice(oldTiers, newTiers) {
    const oldPrices = (oldTiers || []).map(t => t.adult_price).sort().join(',');
    const newPrices = (newTiers || []).map(t => t.adult_price).sort().join(',');
    return oldPrices === newPrices;
  }

  const toArchive = [];
  const toInsert = [];
  const skipped = [];

  const { data: existingCodes } = await sb
    .from('travel_packages')
    .select('short_code')
    .ilike('short_code', `${SUPPLIER_CODE}-${DEST_CODE}-%`)
    .order('short_code', { ascending: false });

  function nextSeq(prefix) {
    const matched = (existingCodes || []).filter(r => r.short_code?.startsWith(prefix));
    return matched.reduce((max, r) => {
      const n = parseInt(r.short_code.split('-').pop() || '0', 10);
      return n > max ? n : max;
    }, 0);
  }
  const seqCounters = {};

  for (const pkg of ALL_PACKAGES) {
    const dup = findDuplicate(pkg);

    if (dup) {
      const samePrices = isSamePrice(dup.price_tiers, pkg.price_tiers);
      const sameDeadline = String(dup.ticketing_deadline) === String(TICKETING_DEADLINE);

      if (samePrices && sameDeadline) {
        skipped.push({ title: pkg.title, existingId: dup.id, reason: '완전 동일' });
        continue;
      }
      toArchive.push({ id: dup.id, title: dup.title, short_code: dup.short_code });
    }

    const dur = String(pkg.duration).padStart(2, '0');
    const prefix = `${SUPPLIER_CODE}-${DEST_CODE}-${dur}-`;
    if (!seqCounters[prefix]) seqCounters[prefix] = nextSeq(prefix);
    seqCounters[prefix]++;
    const short_code = `${prefix}${String(seqCounters[prefix]).padStart(2, '0')}`;

    toInsert.push({
      title: pkg.title,
      display_title: generateDisplayTitle(pkg),
      destination: pkg.destination,
      country: pkg.country,
      category: pkg.category,
      product_type: pkg.product_type,
      trip_style: pkg.trip_style,
      duration: pkg.duration,
      nights: pkg.nights,
      departure_airport: pkg.departure_airport,
      airline: pkg.airline,
      min_participants: pkg.min_participants,
      status: pkg.status,
      price: pkg.price,
      guide_tip: pkg.guide_tip,
      single_supplement: pkg.single_supplement,
      small_group_surcharge: pkg.small_group_surcharge,
      surcharges: pkg.surcharges,
      excluded_dates: pkg.excluded_dates,
      optional_tours: pkg.optional_tours,
      price_tiers: pkg.price_tiers,
      price_dates: tiersToDatePrices(pkg.price_tiers),
      inclusions: pkg.inclusions,
      excludes: pkg.excludes,
      notices_parsed: pkg.notices_parsed,
      special_notes: pkg.special_notes,
      product_highlights: pkg.product_highlights,
      product_summary: pkg.product_summary,
      product_tags: pkg.product_tags,
      itinerary_data: pkg.itinerary_data,
      itinerary: pkg.itinerary,
      accommodations: pkg.accommodations,
      raw_text: pkg.raw_text || '',
      filename: pkg.filename,
      file_type: pkg.file_type,
      confidence: pkg.confidence,
      land_operator_id: LAND_OPERATOR_ID,
      short_code,
      commission_rate: COMMISSION_RATE,
      ticketing_deadline: TICKETING_DEADLINE,
    });
  }

  // ── 리포트 ──
  console.log(`\n📋 중복 검사 결과:`);
  console.log(`  - 신규 등록: ${toInsert.length}개`);
  console.log(`  - 아카이브 (기존→대체): ${toArchive.length}개`);
  console.log(`  - 건너뜀 (동일): ${skipped.length}개\n`);

  if (skipped.length > 0) {
    skipped.forEach(s => console.log(`  ⏭️  SKIP: ${s.title} (${s.reason})`));
  }

  if (toArchive.length > 0) {
    const archiveIds = toArchive.map(a => a.id);
    await sb.from('travel_packages').update({ status: 'archived' }).in('id', archiveIds);
    toArchive.forEach(a => console.log(`  📦 아카이브: ${a.short_code} | ${a.title}`));
  }

  if (toInsert.length > 0) {
    const { data, error } = await sb
      .from('travel_packages')
      .insert(toInsert)
      .select('id, title, status, price, short_code, commission_rate, ticketing_deadline');

    if (error) { console.error('❌ 등록 실패:', error.message); process.exit(1); }
    console.log(`\n✅ ${data.length}개 상품 등록 완료!\n`);
    data.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.status}] ${r.short_code} | ${r.title}`);
      console.log(`     ID: ${r.id} | ₩${r.price?.toLocaleString()} | 마진 ${r.commission_rate}% | 발권 ${r.ticketing_deadline || '없음'}`);
    });
  }

  if (toInsert.length === 0 && toArchive.length === 0) {
    console.log('ℹ️  변경 사항 없음 — 모든 상품이 기존과 동일합니다.');
  }
}
main();
