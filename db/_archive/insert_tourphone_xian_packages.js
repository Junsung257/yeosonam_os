// ============================================================
// 투어폰 서안(시안) 상품 4종 등록 스크립트
// - PKG1: 서안, 병마용, 화청지 3박5일 (실속, 수요일)
// - PKG2: 서안, 병마용, 화청지 4박6일 (실속, 토요일)
// - PKG3: 품격 서안(병마용,화청지), 화산 3박5일 (수요일, 노팁노옵션노쇼핑)
// - PKG4: 품격 서안(병마용,화청지), 화산 4박6일 (토요일, 노팁노옵션노쇼핑)
// ============================================================

const LAND_OPERATOR_ID = '43a54eed-1390-4713-bb43-2624c87436a4'; // 투어폰
const COMMISSION_RATE = 9;
const TICKETING_DEADLINE = '2026-04-29';
const SUPPLIER_CODE = 'TP';
const DEST_CODE = 'XIY';

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function flight(time, activity, transport) { return { time, activity, type: 'flight', transport, note: null }; }
function normal(time, activity, note) { return { time: time || null, activity, type: 'normal', transport: null, note: note || null }; }
function bus(time, activity, note) { return { time: time || null, activity, type: 'transport', transport: '전용차량', note: note || null }; }
function optional(time, activity, note) { return { time: time || null, activity, type: 'optional', transport: null, note: note || null }; }
function meal(b, l, d, bn, ln, dn) {
  return { breakfast: b, lunch: l, dinner: d, breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null };
}

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
  const points = (pkg.product_highlights || []).filter(h => !skipWords.some(w => h.includes(w))).slice(0, 3);
  const base = [prefix, pkg.destination, `${pkg.nights}박${pkg.duration}일`].filter(Boolean).join(' ');
  return points.length ? `${base} — ${points.join(' + ')}` : base;
}

const DOW_MAP = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
function tiersToDatePrices(tiers) {
  const seen = new Set();
  const result = [];
  for (const tier of tiers) {
    if (tier.status === 'soldout') continue;
    const dates = [];
    if (tier.date_range?.start && tier.date_range?.end && tier.departure_day_of_week != null && DOW_MAP[tier.departure_day_of_week] != null) {
      const dow = DOW_MAP[tier.departure_day_of_week];
      const [sy, sm, sd] = tier.date_range.start.split('-').map(Number);
      const [ey, em, ed] = tier.date_range.end.split('-').map(Number);
      const c = new Date(sy, sm - 1, sd);
      const end = new Date(ey, em - 1, ed);
      while (c <= end) {
        if (c.getDay() === dow) dates.push(`${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`);
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

// ============================================================
// PKG1: 서안, 병마용, 화청지 3박5일 (실속, 수요일)
// ============================================================
const PKG1 = {
  title: '서안, 병마용, 화청지 3박 5일',
  destination: '서안',
  country: '중국',
  category: 'package',
  product_type: '실속',
  trip_style: '3박5일',
  duration: 5,
  nights: 3,
  departure_airport: '부산(김해)',
  airline: 'BX(에어부산)',
  min_participants: 4,
  status: 'pending',
  price: 549000,
  guide_tip: 50,
  single_supplement: null,
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  price_tiers: [
    { period_label: '4월 초~중순', departure_dates: ['2026-04-01', '2026-04-08', '2026-04-15', '2026-04-22'], adult_price: 749000, child_price: null, status: 'available', note: null },
    { period_label: '4월 말', departure_dates: ['2026-04-29'], adult_price: 769000, child_price: null, status: 'available', note: null },
    { period_label: '5월', departure_dates: ['2026-05-06', '2026-05-13', '2026-05-20', '2026-05-27'], adult_price: 629000, child_price: null, status: 'available', note: null },
    { period_label: '6월 초', departure_dates: ['2026-06-03'], adult_price: 699000, child_price: null, status: 'available', note: null },
    { period_label: '6월 중~말', departure_dates: ['2026-06-10', '2026-06-17', '2026-06-24'], adult_price: 569000, child_price: null, status: 'available', note: null },
    { period_label: '7월 초', departure_dates: ['2026-07-01', '2026-07-08'], adult_price: 549000, child_price: null, status: 'available', note: null },
    { period_label: '7월 중순', departure_dates: ['2026-07-15', '2026-07-22'], adult_price: 649000, child_price: null, status: 'available', note: null },
    { period_label: '7월 말', departure_dates: ['2026-07-29'], adult_price: 579000, child_price: null, status: 'available', note: null },
    { period_label: '8월 초', departure_dates: ['2026-08-05'], adult_price: 579000, child_price: null, status: 'available', note: null },
    { period_label: '8월 중순', departure_dates: ['2026-08-12'], adult_price: 649000, child_price: null, status: 'available', note: null },
    { period_label: '8월 하순', departure_dates: ['2026-08-19', '2026-08-26'], adult_price: 549000, child_price: null, status: 'available', note: null },
    { period_label: '9월 초~중순', departure_dates: ['2026-09-02', '2026-09-09', '2026-09-16'], adult_price: 599000, child_price: null, status: 'available', note: null },
    { period_label: '9월 추석', departure_dates: ['2026-09-23'], adult_price: 969000, child_price: null, status: 'available', note: null },
    { period_label: '9월 말', departure_dates: ['2026-09-30'], adult_price: 699000, child_price: null, status: 'available', note: null },
    { period_label: '10월 초', departure_dates: ['2026-10-07'], adult_price: 799000, child_price: null, status: 'available', note: null },
    { period_label: '10월 중순', departure_dates: ['2026-10-14'], adult_price: 679000, child_price: null, status: 'available', note: null },
  ],
  optional_tours: [
    { name: '발마사지', price_usd: 30, price_krw: null, note: null },
    { name: '전신마사지', price_usd: 40, price_krw: null, note: null },
    { name: '장한가쇼', price_usd: 70, price_krw: null, note: '$70~$100' },
    { name: '실크로드쇼', price_usd: 50, price_krw: null, note: null },
    { name: '화산(서봉케이블카)', price_usd: 180, price_krw: null, note: null },
    { name: '화산(북봉케이블카)', price_usd: 120, price_krw: null, note: null },
    { name: '화산서악묘', price_usd: 40, price_krw: null, note: null },
    { name: '한양능박물관', price_usd: 35, price_krw: null, note: null },
    { name: '대명궁', price_usd: 40, price_krw: null, note: '[강력추천옵션]' },
    { name: '야경투어(대당부용원+불야성)', price_usd: 50, price_krw: null, note: '[강력추천옵션]' },
    { name: '성벽&비림', price_usd: 60, price_krw: null, note: '[강력추천옵션]' },
  ],
  inclusions: ['항공료 및 텍스, 유류할증료(4월 기준), 여행자보험, 숙박, 차량, 한국어 가이드, 관광지입장료'],
  excludes: ['기사/가이드경비 $50/인, 매너팁, 유류비변동분, 싱글비용'],
  notices_parsed: [
    '여권 유효기간은 6개월 이상 남아 있어야 합니다.',
    '여권 유효기간은 6개월 이상 남아 있어야 하며 재발급 후 담당자에게 따로 전달 안할시 관광지 입장 불가에대한 책임은지지 않습니다.',
    '아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다.',
  ],
  special_notes: '쇼핑: 라텍스, 찻집, 침향 (총3회)+농산물',
  product_highlights: [
    '진시황릉·병마용·화청지 핵심 3대 관광지',
    '서안 회족거리·종고루광장 야경 감상',
    '뺭뺭면, 샤브샤브, 삼겹살 특식 제공',
  ],
  product_tags: ['서안', '병마용', '화청지', '실속'],
  accommodations: ['천익호텔 또는 홀리데이인익스프레호텔 또는 동급(4성) × 3박'],
  product_summary: null,
  itinerary: [],
  raw_text: '',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
  itinerary_data: {
    meta: {
      title: '서안, 병마용, 화청지 3박 5일',
      product_type: '실속',
      destination: '서안',
      nights: 3,
      days: 5,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX341',
      flight_in: 'BX342',
      departure_days: '매주 수요일',
      min_participants: 4,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-29',
      hashtags: ['#서안', '#병마용', '#화청지', '#실속'],
      brand: '여소남',
    },
    highlights: {
      inclusions: ['항공료 및 텍스, 유류할증료(4월 기준), 여행자보험, 숙박, 차량, 한국어 가이드, 관광지입장료'],
      excludes: ['기사/가이드경비 $50/인, 매너팁, 유류비변동분, 싱글비용'],
      shopping: '라텍스, 찻집, 침향 (총3회)+농산물',
      remarks: [
        '여권 유효기간은 6개월 이상 남아 있어야 합니다.',
        '여권 유효기간은 6개월 이상 남아 있어야 하며 재발급 후 담당자에게 따로 전달 안할시 관광지 입장 불가에대한 책임은지지 않습니다.',
        '아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다.',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '서안'],
        meals: meal(false, false, false),
        schedule: [
          flight('21:55', '부산 출발', 'BX341'),
          normal('00:35', '서안 도착 / 가이드 미팅 후 호텔 투숙'),
        ],
        hotel: { name: '천익호텔 또는 홀리데이인익스프레호텔 또는 동급', grade: '4성', note: null },
      },
      {
        day: 2,
        regions: ['서안'],
        meals: meal(true, true, true, '호텔식', null, '뺭뺭면'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '▶인도에서 가져온 경전을 보관한 소안탑+ 서안박물관 (화요일휴관)'),
          normal(null, '▶서안의 옛 궁궐 정원인 흥경궁공원'),
          normal(null, '▶서안의 실크로드 입문거리 회족거리'),
          normal(null, '▶종고루광장야경'),
          normal(null, '석식 후 호텔 투숙'),
          optional(null, '[강력추천옵션] 대명궁유적지(전동차포함) : $40'),
          optional(null, '☆당나라 3대 궁전 중의 하나'),
        ],
        hotel: { name: '천익호텔 또는 홀리데이인익스프레호텔 또는 동급', grade: '4성', note: null },
      },
      {
        day: 3,
        regions: ['서안'],
        meals: meal(true, true, true, '호텔식', null, '샤브샤브'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '▶37년에 걸쳐 만들어진 세계 최대의 능 진시황릉'),
          normal(null, '▶세계 8대 불가사의 중 하나인 병마용'),
          normal(null, '▶당현종과 양귀비의 로맨스 장소이자 황제들의 온천휴양지 화청지'),
          normal(null, '석식 후 호텔 투숙'),
          optional(null, '[강력추천옵션] 명대 성벽 + 비림박물관 : $60'),
          optional(null, '☆중국에서 가장 잘 보존된 중세방어 성벽인 명대 성벽'),
          optional(null, '☆한나라 때부터 4,000여개의 비석을 전시/보관하고 있는 비림박물관'),
        ],
        hotel: { name: '천익호텔 또는 홀리데이인익스프레호텔 또는 동급', grade: '4성', note: null },
      },
      {
        day: 4,
        regions: ['서안'],
        meals: meal(true, true, true, '호텔식', null, '삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '▶밀종의 발원지 대흥선사'),
          normal(null, '▶중국의 인사동 거리라 불리는 문서거리(古文化街)'),
          normal(null, '▶한나라 건녕에 창건된 1,800년된 고찰 와룡사'),
          normal(null, '▶고대 황제와 문인들의 놀이터 곡강유적지공원'),
          normal(null, '▶현장법사가 서역에서 가져온 불경을 보존한 대안탑(차창)'),
          normal(null, '▶중국의 4대 명필가의 동상과 글씨를 장식해 놓은 대안탑북광장'),
          optional(null, '[강력추천옵션] 대당부용원+대당불야성 야경감상 : $50/인'),
          optional(null, '☆세계에서 가장 큰 당건축 테마파크공원으로 중국의 전통과'),
          optional(null, '화려함을 한눈에 담을 수 있습니다.'),
          bus(null, '공항으로 이동'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
      {
        day: 5,
        regions: ['서안', '부산'],
        meals: meal(false, false, false),
        schedule: [
          flight('02:10', '서안 출발', 'BX342'),
          normal('06:30', '부산 도착'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [
      { name: '발마사지', price_usd: 30, price_krw: null, note: null },
      { name: '전신마사지', price_usd: 40, price_krw: null, note: null },
      { name: '장한가쇼', price_usd: 70, price_krw: null, note: '$70~$100' },
      { name: '실크로드쇼', price_usd: 50, price_krw: null, note: null },
      { name: '화산(서봉케이블카)', price_usd: 180, price_krw: null, note: null },
      { name: '화산(북봉케이블카)', price_usd: 120, price_krw: null, note: null },
      { name: '화산서악묘', price_usd: 40, price_krw: null, note: null },
      { name: '한양능박물관', price_usd: 35, price_krw: null, note: null },
      { name: '대명궁', price_usd: 40, price_krw: null, note: '[강력추천옵션]' },
      { name: '야경투어(대당부용원+불야성)', price_usd: 50, price_krw: null, note: '[강력추천옵션]' },
      { name: '성벽&비림', price_usd: 60, price_krw: null, note: '[강력추천옵션]' },
    ],
  },
};

// ============================================================
// PKG2: 서안, 병마용, 화청지 4박6일 (실속, 토요일)
// ============================================================
const PKG2 = {
  title: '서안, 병마용, 화청지 4박 6일',
  destination: '서안',
  country: '중국',
  category: 'package',
  product_type: '실속',
  trip_style: '4박6일',
  duration: 6,
  nights: 4,
  departure_airport: '부산(김해)',
  airline: 'BX(에어부산)',
  min_participants: 4,
  status: 'pending',
  price: 499000,
  guide_tip: 60,
  single_supplement: null,
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  price_tiers: [
    { period_label: '4월', departure_dates: ['2026-04-04', '2026-04-11', '2026-04-18', '2026-04-25'], adult_price: 699000, child_price: null, status: 'available', note: null },
    { period_label: '5월 초', departure_dates: ['2026-05-02'], adult_price: 699000, child_price: null, status: 'available', note: null },
    { period_label: '5월 초~중순', departure_dates: ['2026-05-09', '2026-05-16'], adult_price: 599000, child_price: null, status: 'available', note: null },
    { period_label: '5월 하순', departure_dates: ['2026-05-23', '2026-05-30'], adult_price: 649000, child_price: null, status: 'available', note: null },
    { period_label: '6월 초', departure_dates: ['2026-06-06'], adult_price: 699000, child_price: null, status: 'available', note: null },
    { period_label: '6월 중~말', departure_dates: ['2026-06-13', '2026-06-20', '2026-06-27'], adult_price: 549000, child_price: null, status: 'available', note: null },
    { period_label: '7월 초~중순', departure_dates: ['2026-07-04', '2026-07-11', '2026-07-18'], adult_price: 499000, child_price: null, status: 'available', note: null },
    { period_label: '7월 말', departure_dates: ['2026-07-25'], adult_price: 529000, child_price: null, status: 'available', note: null },
    { period_label: '8월 초', departure_dates: ['2026-08-01'], adult_price: 529000, child_price: null, status: 'available', note: null },
    { period_label: '8월 광복절', departure_dates: ['2026-08-15'], adult_price: 599000, child_price: null, status: 'available', note: null },
    { period_label: '8월', departure_dates: ['2026-08-08', '2026-08-22', '2026-08-29'], adult_price: 499000, child_price: null, status: 'available', note: null },
    { period_label: '9월 초~중순', departure_dates: ['2026-09-05', '2026-09-12', '2026-09-19'], adult_price: 559000, child_price: null, status: 'available', note: null },
    { period_label: '9월 말', departure_dates: ['2026-09-26'], adult_price: 679000, child_price: null, status: 'available', note: null },
    { period_label: '10월 초', departure_dates: ['2026-10-03'], adult_price: 829000, child_price: null, status: 'available', note: null },
    { period_label: '10월 중순', departure_dates: ['2026-10-10'], adult_price: 629000, child_price: null, status: 'available', note: null },
  ],
  optional_tours: [
    { name: '발마사지', price_usd: 30, price_krw: null, note: null },
    { name: '전신마사지', price_usd: 40, price_krw: null, note: null },
    { name: '장한가쇼', price_usd: 70, price_krw: null, note: '$70~$100' },
    { name: '실크로드쇼', price_usd: 50, price_krw: null, note: '[강력추천옵션]' },
    { name: '화산(서봉케이블카)', price_usd: 180, price_krw: null, note: null },
    { name: '화산(북봉케이블카)', price_usd: 120, price_krw: null, note: null },
    { name: '화산서악묘', price_usd: 40, price_krw: null, note: null },
    { name: '한양능박물관', price_usd: 35, price_krw: null, note: null },
    { name: '대명궁', price_usd: 40, price_krw: null, note: '[강력추천옵션]' },
    { name: '야경투어(대당부용원+불야성)', price_usd: 50, price_krw: null, note: '[강력추천옵션]' },
    { name: '성벽&비림', price_usd: 60, price_krw: null, note: '[강력추천옵션]' },
  ],
  inclusions: ['항공료 및 텍스, 유류할증료(4월 기준), 여행자보험, 숙박, 차량, 한국어 가이드, 관광지입장료'],
  excludes: ['기사/가이드경비 $60/인, 매너팁, 유류비변동분, 싱글비용'],
  notices_parsed: [
    '여권 유효기간은 6개월 이상 남아 있어야 합니다.',
    '여권 유효기간은 6개월 이상 남아 있어야 하며 재발급 후 담당자에게 따로 전달 안할시 관광지 입장 불가에대한 책임은지지 않습니다.',
    '아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다.',
  ],
  special_notes: '쇼핑: 라텍스, 찻집, 침향 (총3회)+농산물',
  product_highlights: [
    '진시황릉·병마용·화청지 핵심 3대 관광지',
    '서안 회족거리·종고루광장 야경 감상',
    '뺭뺭면, 사천요리, 삼겹살 특식 제공',
  ],
  product_tags: ['서안', '병마용', '화청지', '실속'],
  accommodations: ['천익호텔 또는 홀리데이인익스프레호텔 또는 동급(4성) × 4박'],
  product_summary: null,
  itinerary: [],
  raw_text: '',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
  itinerary_data: {
    meta: {
      title: '서안, 병마용, 화청지 4박 6일',
      product_type: '실속',
      destination: '서안',
      nights: 4,
      days: 6,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX341',
      flight_in: 'BX342',
      departure_days: '매주 토요일',
      min_participants: 4,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-29',
      hashtags: ['#서안', '#병마용', '#화청지', '#실속'],
      brand: '여소남',
    },
    highlights: {
      inclusions: ['항공료 및 텍스, 유류할증료(4월 기준), 여행자보험, 숙박, 차량, 한국어 가이드, 관광지입장료'],
      excludes: ['기사/가이드경비 $60/인, 매너팁, 유류비변동분, 싱글비용'],
      shopping: '라텍스, 찻집, 침향 (총3회)+농산물',
      remarks: [
        '여권 유효기간은 6개월 이상 남아 있어야 합니다.',
        '여권 유효기간은 6개월 이상 남아 있어야 하며 재발급 후 담당자에게 따로 전달 안할시 관광지 입장 불가에대한 책임은지지 않습니다.',
        '아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다.',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '서안'],
        meals: meal(false, false, false),
        schedule: [
          flight('21:55', '부산 출발', 'BX341'),
          normal('00:35', '서안 도착 / 가이드 미팅 후 호텔 투숙'),
        ],
        hotel: { name: '천익호텔 또는 홀리데이인익스프레호텔 또는 동급', grade: '4성', note: null },
      },
      {
        day: 2,
        regions: ['서안'],
        meals: meal(true, true, true, '호텔식', null, '뺭뺭면'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '▶인도에서 가져온 견전을 보관한 소안탑+서안박물관 (화요일휴관)'),
          normal(null, '▶서안의 옛궁궐 정원인 흥경궁공원'),
          normal(null, '▶일본이 패망후 건설된 전쟁기념관인 팔로군 기념관'),
          normal(null, '석식 후 호텔 투숙'),
          optional(null, '[강력추천옵션] 명대 성벽 + 비림박물관 : $60'),
          optional(null, '☆중국에서 가장 잘 보존된 중세방어 성벽인 명대 성벽'),
          optional(null, '☆한나라 때부터 4,000여개의 비석을 전시/보관하고 있는 비림박물관'),
        ],
        hotel: { name: '천익호텔 또는 홀리데이인익스프레호텔 또는 동급', grade: '4성', note: null },
      },
      {
        day: 3,
        regions: ['서안'],
        meals: meal(true, true, true, '호텔식', null, '사천요리'),
        schedule: [
          normal(null, '호텔 조식 후 ▶밀종의발원지대흥선사'),
          normal(null, '▶고씨장원'),
          normal(null, '▶서안의 실크로드 입문거리 회족거리'),
          normal(null, '▶종고루광장야경. 석식 후 호텔투숙'),
          optional(null, '[강력추천옵션] 대명궁유적지(전동차포함) : $40'),
          optional(null, '☆당나라 3대 궁전 중 하나'),
        ],
        hotel: { name: '천익호텔 또는 홀리데이인익스프레호텔 또는 동급', grade: '4성', note: null },
      },
      {
        day: 4,
        regions: ['서안'],
        meals: meal(true, true, true, '호텔식', null, '삼겹살'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '▶현장법사가 서역에서 가져온 불경을 보존한 대안탑(차창)'),
          normal(null, '▶중국의 4대 명필가의 동상과 글씨를 장식해 놓은 대안탑북광장'),
          normal(null, '▶진2세 황제 -호혜묘'),
          normal(null, '▶고대 황제와 문인들의 놀이터 곡강유적지공원'),
          normal(null, '석식 후 호텔투숙'),
          optional(null, '[강력추천옵션] 대당부용원+대당불야성 야경감상 : $50'),
          optional(null, '☆세계에서 가장 큰 당건축 테마파크공원으로 중국의 전통과'),
          optional(null, '화려함을 한눈에 담을 수 있습니다.'),
        ],
        hotel: { name: '천익호텔 또는 홀리데이인익스프레호텔 또는 동급', grade: '4성', note: null },
      },
      {
        day: 5,
        regions: ['서안'],
        meals: meal(true, true, true, '호텔식', null, '샤브샤브'),
        schedule: [
          normal(null, '호텔 조식 후 ▶37년에 걸쳐 만들어진 세계 최대의 능 진시황릉'),
          normal(null, '▶세계 8대 불가사의 중 하나인 병마용'),
          normal(null, '▶당현종과 양귀비의 로맨스장소이자 황제들의 온천휴양지 화청지'),
          optional(null, '[강력추천옵션] 실크로드쇼 혹은 천고정쇼 : $50'),
          optional(null, '☆20마리 낙타와 30마리 늑대까지 출동되는 스릴있고 실감나는 쇼'),
          bus(null, '공항으로 이동'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
      {
        day: 6,
        regions: ['서안', '부산'],
        meals: meal(false, false, false),
        schedule: [
          flight('02:10', '서안 출발', 'BX342'),
          normal('06:30', '부산 도착'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [
      { name: '발마사지', price_usd: 30, price_krw: null, note: null },
      { name: '전신마사지', price_usd: 40, price_krw: null, note: null },
      { name: '장한가쇼', price_usd: 70, price_krw: null, note: '$70~$100' },
      { name: '실크로드쇼', price_usd: 50, price_krw: null, note: '[강력추천옵션]' },
      { name: '화산(서봉케이블카)', price_usd: 180, price_krw: null, note: null },
      { name: '화산(북봉케이블카)', price_usd: 120, price_krw: null, note: null },
      { name: '화산서악묘', price_usd: 40, price_krw: null, note: null },
      { name: '한양능박물관', price_usd: 35, price_krw: null, note: null },
      { name: '대명궁', price_usd: 40, price_krw: null, note: '[강력추천옵션]' },
      { name: '야경투어(대당부용원+불야성)', price_usd: 50, price_krw: null, note: '[강력추천옵션]' },
      { name: '성벽&비림', price_usd: 60, price_krw: null, note: '[강력추천옵션]' },
    ],
  },
};

// ============================================================
// PKG3: 품격 서안(병마용,화청지), 화산 3박5일 (수요일, 노팁노옵션노쇼핑)
// ============================================================
const PKG3 = {
  title: '품격 서안(병마용,화청지), 화산 3박 5일',
  destination: '서안',
  country: '중국',
  category: 'package',
  product_type: '품격',
  trip_style: '3박5일',
  duration: 5,
  nights: 3,
  departure_airport: '부산(김해)',
  airline: 'BX(에어부산)',
  min_participants: 4,
  status: 'pending',
  price: 1069000,
  guide_tip: 0,
  single_supplement: null,
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  price_tiers: [
    { period_label: '4월 초~중순', departure_dates: ['2026-04-01', '2026-04-08', '2026-04-15', '2026-04-22'], adult_price: 1269000, child_price: null, status: 'available', note: null },
    { period_label: '4월 말', departure_dates: ['2026-04-29'], adult_price: 1299000, child_price: null, status: 'available', note: null },
    { period_label: '5월', departure_dates: ['2026-05-06', '2026-05-13', '2026-05-20', '2026-05-27'], adult_price: 1159000, child_price: null, status: 'available', note: null },
    { period_label: '6월 초', departure_dates: ['2026-06-03'], adult_price: 1199000, child_price: null, status: 'available', note: null },
    { period_label: '6월 중~말', departure_dates: ['2026-06-10', '2026-06-17', '2026-06-24'], adult_price: 1099000, child_price: null, status: 'available', note: null },
    { period_label: '7월 초', departure_dates: ['2026-07-01', '2026-07-08'], adult_price: 1069000, child_price: null, status: 'available', note: null },
    { period_label: '7월 중순', departure_dates: ['2026-07-15', '2026-07-22'], adult_price: 1149000, child_price: null, status: 'available', note: null },
    { period_label: '7월 말', departure_dates: ['2026-07-29'], adult_price: 1099000, child_price: null, status: 'available', note: null },
    { period_label: '8월 초', departure_dates: ['2026-08-05'], adult_price: 1099000, child_price: null, status: 'available', note: null },
    { period_label: '8월 중순', departure_dates: ['2026-08-12'], adult_price: 1149000, child_price: null, status: 'available', note: null },
    { period_label: '8월 하순', departure_dates: ['2026-08-19', '2026-08-26'], adult_price: 1069000, child_price: null, status: 'available', note: null },
    { period_label: '9월 초~중순', departure_dates: ['2026-09-02', '2026-09-09', '2026-09-16'], adult_price: 1119000, child_price: null, status: 'available', note: null },
    { period_label: '9월 추석', departure_dates: ['2026-09-23'], adult_price: 1549000, child_price: null, status: 'available', note: null },
    { period_label: '9월 말', departure_dates: ['2026-09-30'], adult_price: 1269000, child_price: null, status: 'available', note: null },
    { period_label: '10월 초', departure_dates: ['2026-10-07'], adult_price: 1299000, child_price: null, status: 'available', note: null },
    { period_label: '10월 중순', departure_dates: ['2026-10-14'], adult_price: 1199000, child_price: null, status: 'available', note: null },
  ],
  optional_tours: [],
  inclusions: ['항공료 및 텍스, 유류할증료(4월 기준), 여행자보험, 숙박, 한국어 가이드, 입장료, 기사/가이드 경비'],
  excludes: ['매너팁, 유류비변동분, 싱글비용'],
  notices_parsed: [
    '여권 유효기간은 6개월 이상 남아 있어야 합니다.',
    '여권 유효기간은 6개월 이상 남아 있어야 하며 재발급 후 담당자에게 따로 전달 안할시 관광지 입장 불가에대한 책임은지지 않습니다.',
    '아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다.',
  ],
  special_notes: '노팁/노옵션/노쇼핑',
  product_highlights: [
    '5성급 풀만 OR 쉐라톤호텔 3박 숙박',
    '화산 북봉 케이블카 왕복 포함 관광',
    '발+전신 마사지 90분 및 실크로드쇼(VIP석) 포함',
    '덕발장 교자연·삼겹살 무제한·샤브샤브 무제한 특식',
  ],
  product_tags: ['서안', '화산', '병마용', '화청지', '품격', '노팁노옵션노쇼핑'],
  accommodations: ['서안풀만호텔 또는 쉐라톤호텔 또는 동급(5성) × 3박'],
  product_summary: null,
  itinerary: [],
  raw_text: '',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
  itinerary_data: {
    meta: {
      title: '품격 서안(병마용,화청지), 화산 3박 5일',
      product_type: '품격',
      destination: '서안',
      nights: 3,
      days: 5,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX341',
      flight_in: 'BX342',
      departure_days: '매주 수요일',
      min_participants: 4,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-29',
      hashtags: ['#서안', '#화산', '#풀만호텔', '#노팁노옵션'],
      brand: '여소남',
    },
    highlights: {
      inclusions: ['항공료 및 텍스, 유류할증료(4월 기준), 여행자보험, 숙박, 한국어 가이드, 입장료, 기사/가이드 경비'],
      excludes: ['매너팁, 유류비변동분, 싱글비용'],
      shopping: '노쇼핑',
      remarks: [
        '여권 유효기간은 6개월 이상 남아 있어야 합니다.',
        '여권 유효기간은 6개월 이상 남아 있어야 하며 재발급 후 담당자에게 따로 전달 안할시 관광지 입장 불가에대한 책임은지지 않습니다.',
        '아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다.',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '서안'],
        meals: meal(false, false, false),
        schedule: [
          flight('21:55', '부산 출발', 'BX341'),
          normal('00:35', '서안 도착 / 가이드 미팅 후 호텔 투숙'),
        ],
        hotel: { name: '서안풀만호텔 또는 쉐라톤호텔 또는 동급', grade: '5성', note: null },
      },
      {
        day: 2,
        regions: ['서안'],
        meals: meal(true, true, true, '호텔식', null, '덕발장 교자연'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '▶중국보존건축물중 가장 완전한 서안성벽+함광문유적지박물관'),
          normal(null, '▶당나라 3대 궁전 중의 하나인 흥경궁공원'),
          normal(null, '▶인도에서 가져온 견전을 보관한 소안탑(서안박물관)'),
          normal(null, '▶소수민족 회족의 전통을 엿볼 수 있는 회족거리'),
          normal(null, '▶종루 야경 및 서안 야시장'),
          normal(null, '석식 후 호텔 투숙'),
        ],
        hotel: { name: '서안풀만호텔 또는 쉐라톤호텔 또는 동급', grade: '5성', note: null },
      },
      {
        day: 3,
        regions: ['서안'],
        meals: meal(true, true, true, '호텔식', null, '삼겹살 무제한'),
        schedule: [
          normal(null, '호텔 조식 후'),
          bus(null, '화산으로 이동(2시간30분소요)'),
          normal(null, '▶화산 관광(북봉 케이블카 왕복포함)'),
          bus(null, '서안으로 귀환'),
          normal(null, '▶여행의 피로를 풀어주는 발+전신 마사지(90분) 체험'),
          normal(null, '석식 후 호텔 휴식'),
        ],
        hotel: { name: '서안풀만호텔 또는 쉐라톤호텔 또는 동급', grade: '5성', note: null },
      },
      {
        day: 4,
        regions: ['서안'],
        meals: meal(true, true, true, '호텔식', null, '샤브샤브무제한'),
        schedule: [
          normal(null, '호텔 조식 후'),
          bus(null, '임동현으로 이동 (약 40분 소요)'),
          normal(null, '▶양귀비와 당현종의 로맨스장소인 화청지'),
          normal(null, '중식 후'),
          normal(null, '▶중국 최초의 황제인 진시황제의 묘지인 진시황릉'),
          normal(null, '▶흙으로 구워만든 병사, 말등의 모형갱도인 병마용'),
          normal(null, '▶실크로드쇼 (VIP석)관람'),
          bus(null, '공항으로이동'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
      {
        day: 5,
        regions: ['서안', '부산'],
        meals: meal(false, false, false),
        schedule: [
          flight('02:10', '서안 출발', 'BX342'),
          normal('06:30', '부산 도착'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [],
  },
};

// ============================================================
// PKG4: 품격 서안(병마용,화청지), 화산 4박6일 (토요일, 노팁노옵션노쇼핑)
// ============================================================
const PKG4 = {
  title: '품격 서안(병마용,화청지), 화산 4박 6일',
  destination: '서안',
  country: '중국',
  category: 'package',
  product_type: '품격',
  trip_style: '4박6일',
  duration: 6,
  nights: 4,
  departure_airport: '부산(김해)',
  airline: 'BX(에어부산)',
  min_participants: 4,
  status: 'pending',
  price: 1109000,
  guide_tip: 0,
  single_supplement: null,
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  price_tiers: [
    { period_label: '4월', departure_dates: ['2026-04-04', '2026-04-11', '2026-04-18', '2026-04-25'], adult_price: 1299000, child_price: null, status: 'available', note: null },
    { period_label: '5월 초', departure_dates: ['2026-05-02'], adult_price: 1329000, child_price: null, status: 'available', note: null },
    { period_label: '5월 초~중순', departure_dates: ['2026-05-09', '2026-05-16'], adult_price: 1229000, child_price: null, status: 'available', note: null },
    { period_label: '5월 하순', departure_dates: ['2026-05-23', '2026-05-30'], adult_price: 1269000, child_price: null, status: 'available', note: null },
    { period_label: '6월 초', departure_dates: ['2026-06-06'], adult_price: 1299000, child_price: null, status: 'available', note: null },
    { period_label: '6월 중~말', departure_dates: ['2026-06-13', '2026-06-20', '2026-06-27'], adult_price: 1149000, child_price: null, status: 'available', note: null },
    { period_label: '7월 초~중순', departure_dates: ['2026-07-04', '2026-07-11', '2026-07-18'], adult_price: 1109000, child_price: null, status: 'available', note: null },
    { period_label: '7월 말', departure_dates: ['2026-07-25'], adult_price: 1149000, child_price: null, status: 'available', note: null },
    { period_label: '8월 초', departure_dates: ['2026-08-01'], adult_price: 1149000, child_price: null, status: 'available', note: null },
    { period_label: '8월 광복절', departure_dates: ['2026-08-15'], adult_price: 1229000, child_price: null, status: 'available', note: null },
    { period_label: '8월', departure_dates: ['2026-08-08', '2026-08-22', '2026-08-29'], adult_price: 1109000, child_price: null, status: 'available', note: null },
    { period_label: '9월 초~중순', departure_dates: ['2026-09-05', '2026-09-12', '2026-09-19'], adult_price: 1169000, child_price: null, status: 'available', note: null },
    { period_label: '9월 말', departure_dates: ['2026-09-26'], adult_price: 1349000, child_price: null, status: 'available', note: null },
    { period_label: '10월 초', departure_dates: ['2026-10-03'], adult_price: 1449000, child_price: null, status: 'available', note: null },
    { period_label: '10월 중순', departure_dates: ['2026-10-10'], adult_price: 1249000, child_price: null, status: 'available', note: null },
  ],
  optional_tours: [],
  inclusions: ['항공료 및 텍스, 유류할증료(4월 기준), 여행자보험, 숙박, 한국어 가이드, 입장료, 기사/가이드 경비'],
  excludes: ['매너팁, 유류비변동분, 싱글비용'],
  notices_parsed: [
    '여권 유효기간은 6개월 이상 남아 있어야 합니다.',
    '여권 유효기간은 6개월 이상 남아 있어야 하며 재발급 후 담당자에게 따로 전달 안할시 관광지 입장 불가에대한 책임은지지 않습니다.',
    '아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다.',
  ],
  special_notes: '노팁/노옵션/노쇼핑',
  product_highlights: [
    '5성급 풀만 OR 쉐라톤호텔 4박 숙박',
    '화산 북봉 케이블카 왕복 포함 관광',
    '발+전신 마사지 90분 및 실크로드쇼(VIP석) 포함',
    '덕발장 교자연·삼겹살 무제한·샤브샤브 무제한 특식',
  ],
  product_tags: ['서안', '화산', '병마용', '화청지', '품격', '노팁노옵션노쇼핑'],
  accommodations: ['서안풀만호텔 또는 쉐라톤호텔 또는 동급(5성) × 4박'],
  product_summary: null,
  itinerary: [],
  raw_text: '',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
  itinerary_data: {
    meta: {
      title: '품격 서안(병마용,화청지), 화산 4박 6일',
      product_type: '품격',
      destination: '서안',
      nights: 4,
      days: 6,
      departure_airport: '부산(김해)',
      airline: 'BX(에어부산)',
      flight_out: 'BX341',
      flight_in: 'BX342',
      departure_days: '매주 토요일',
      min_participants: 4,
      room_type: '2인1실',
      ticketing_deadline: '2026-04-29',
      hashtags: ['#서안', '#화산', '#풀만호텔', '#노팁노옵션'],
      brand: '여소남',
    },
    highlights: {
      inclusions: ['항공료 및 텍스, 유류할증료(4월 기준), 여행자보험, 숙박, 한국어 가이드, 입장료, 기사/가이드 경비'],
      excludes: ['매너팁, 유류비변동분, 싱글비용'],
      shopping: '노쇼핑',
      remarks: [
        '여권 유효기간은 6개월 이상 남아 있어야 합니다.',
        '여권 유효기간은 6개월 이상 남아 있어야 하며 재발급 후 담당자에게 따로 전달 안할시 관광지 입장 불가에대한 책임은지지 않습니다.',
        '아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다.',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['부산', '서안'],
        meals: meal(false, false, false),
        schedule: [
          flight('21:55', '부산 출발', 'BX341'),
          normal('00:35', '서안 도착 / 가이드 미팅 후 호텔 투숙'),
        ],
        hotel: { name: '서안풀만호텔 또는 쉐라톤호텔 또는 동급', grade: '5성', note: null },
      },
      {
        day: 2,
        regions: ['서안'],
        meals: meal(true, true, true, '호텔식', null, '덕발장 교자연'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '▶중국보존건축물중 가장 완전한 서안성벽+함광문유적지박물관'),
          normal(null, '▶당나라 3대 궁전 중의 하나인 흥경궁공원'),
          normal(null, '▶인도에서 가져온 견전을 보관한 소안탑(서안박물관)'),
          normal(null, '▶소수민족 회족의 전통을 엿볼 수 있는 회족거리'),
          normal(null, '▶종루 야경 및 서안 야시장'),
          normal(null, '석식 후 호텔 투숙'),
        ],
        hotel: { name: '서안풀만호텔 또는 쉐라톤호텔 또는 동급', grade: '5성', note: null },
      },
      {
        day: 3,
        regions: ['서안'],
        meals: meal(true, true, true, '호텔식', null, '삼겹살 무제한'),
        schedule: [
          normal(null, '호텔 조식 후'),
          bus(null, '화산으로 이동(2시간30분소요)'),
          normal(null, '▶화산 관광(북봉 케이블카 왕복포함)'),
          bus(null, '서안으로 귀환'),
          normal(null, '▶여행의 피로를 풀어주는 발+전신 마사지(90분) 체험'),
          normal(null, '석식 후 호텔 휴식'),
        ],
        hotel: { name: '서안풀만호텔 또는 쉐라톤호텔 또는 동급', grade: '5성', note: null },
      },
      {
        day: 4,
        regions: ['서안'],
        meals: meal(true, true, true, '호텔식', null, '샤브샤브 무제한'),
        schedule: [
          normal(null, '호텔 조식 후'),
          bus(null, '임동현으로  이동 (약 40분 소요 )'),
          normal(null, '▶양귀비와 당현종의 로맨스장소인 화청지'),
          normal(null, '중식 후'),
          normal(null, '▶중국최초의 황제인 진시황제의 묘지인 진시황릉'),
          normal(null, '▶흙으로 구워 만든 병사, 말등의 모형갱도인 병마용'),
          normal(null, '석식 후 호텔 휴식'),
        ],
        hotel: { name: '서안풀만호텔 또는 쉐라톤호텔 또는 동급', grade: '5성', note: null },
      },
      {
        day: 5,
        regions: ['서안'],
        meals: meal(true, true, true, '호텔식', null, '사천요리'),
        schedule: [
          normal(null, '호텔 조식 후'),
          normal(null, '▶현장법사가 서역에서 가져온 불경을 보존한 대안탑(등탑불포함)'),
          normal(null, '▶중국의 4대 명필가의 동상과 글씨를 장식해 놓은 대안탑북광장'),
          normal(null, '▶진나라 2세 호혜묘'),
          normal(null, '▶곡강유적지 공원'),
          normal(null, '▶실크로드쇼 관람 (VIP석) 관람'),
          normal(null, '▶당나라로 돌아간 느낌을 주는 대당불야성 감상'),
          bus(null, '공항으로 이동'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
      {
        day: 6,
        regions: ['서안', '부산'],
        meals: meal(false, false, false),
        schedule: [
          flight('02:10', '서안 출발', 'BX342'),
          normal('06:30', '부산 도착'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [],
  },
};

// ============================================================
// Main
// ============================================================
const ALL_PACKAGES = [PKG1, PKG2, PKG3, PKG4];

async function main() {
  console.log(`📦 패키지 ${ALL_PACKAGES.length}개 등록 시작...\n`);

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
      .select('id, title, status, price, short_code, commission_rate, ticketing_deadline, price_dates');

    if (error) { console.error('❌ 등록 실패:', error.message); process.exit(1); }
    console.log(`\n✅ ${data.length}개 상품 등록 완료!\n`);
    data.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.status}] ${r.short_code} | ${r.title}`);
      console.log(`     ID: ${r.id} | ₩${r.price?.toLocaleString()} | 마진 ${r.commission_rate}% | 발권 ${r.ticketing_deadline || '없음'} | 출발일 ${r.price_dates?.length || 0}건`);
    });
  }

  if (toInsert.length === 0 && toArchive.length === 0) {
    console.log('ℹ️  변경 사항 없음 — 모든 상품이 기존과 동일합니다.');
  }
}
main();
