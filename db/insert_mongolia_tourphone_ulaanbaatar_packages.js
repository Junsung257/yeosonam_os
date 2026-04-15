/**
 * ★ 투어폰 몽골 울란바토르/테를지 상품 2건 일괄 등록 (2026년 5~10월 시즌)
 *
 * 1) 몽골 울란바토르/테를지 3박 5일 [노팁노옵션] — 매주 금요일 출발 (LJ781/LJ782)
 * 2) 몽골 울란바토르/테를지/엘승타사르하이 4박 6일 [노팁노옵션] — 매주 월요일 출발 (LJ781/LJ782)
 *
 * 랜드사: 투어폰 | 마진율: 9% | 발권기한: 2026-04-29
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
function meal(b, l, d, bn, ln, dn) {
  return { breakfast: b, lunch: l, dinner: d, breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null };
}

// ── display_title 자동생성 ──
function generateDisplayTitle(pkg) {
  const type = (pkg.product_type || '').toLowerCase();
  let prefix = '';
  if (type.includes('노쇼핑') && type.includes('노팁') && type.includes('노옵션')) prefix = '추가비용 없는';
  else if (type.includes('노팁') && type.includes('노옵션')) prefix = '팁·옵션 걱정없는';
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
    if (tier.departure_dates) dates.push(...tier.departure_dates);
    for (const date of dates) {
      if (!date || seen.has(date)) continue;
      seen.add(date);
      result.push({ date, price: tier.adult_price || 0, confirmed: false });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

// ══════════════════════════════════════════════════════════════
// ── 공통 포함/불포함/비고 ──
// ══════════════════════════════════════════════════════════════
const COMMON_INCLUSIONS = [
  '항공료 및 텍스, 유류할증료(2월 기준)',
  '여행자보험',
  '숙박',
  '차량',
  '한국어가이드',
  '관광지입장료',
  '기사/가이드경비',
];
const COMMON_EXCLUDES = [
  '매너팁',
  '유류비변동분',
  '싱글비용',
];
const COMMON_REMARKS = [
  '여권 유효기간은 6개월 이상 남아 있어야 합니다.',
  '호텔 싱글비용 $40/인,박 추가됩니다.',
  '아래 일정은 항공 및 현지 사정에 의해 변경될 수 있습니다.',
  '[테를지 럭셔리게르] 게르 내부에 욕실·화장실 구비.',
  '[엘승타사르하이 전통게르] 공용 욕실·화장실 사용.',
  '모든 게르에 세면 도구 및 어메니티 제공되지 않으니 개별적으로 준비해 주시기 바랍니다.',
  '4월 29일(수)까지 항공권 발권하는 조건입니다.',
];

// ══════════════════════════════════════════════════════════════
// ── 상품 1: 울란바토르/테를지 3박5일 [금요일 출발] ──
// ══════════════════════════════════════════════════════════════
const PKG_3N5D = {
  title: '몽골 울란바토르/테를지 3박 5일 [노팁노옵션] - 금요일 출발',
  destination: '울란바토르/테를지',
  country: '몽골',
  category: 'package',
  product_type: '노팁노옵션',
  trip_style: '3박5일',
  duration: 5, nights: 3,
  departure_airport: '부산(김해)',
  airline: 'LJ(진에어)',
  min_participants: 4,
  status: 'pending',
  price: 1429000,
  guide_tip: 0,
  single_supplement: null, // 호텔 2박 기준 $40/인·박 별도 (special_notes 명시)
  small_group_surcharge: 0,
  surcharges: [],
  excluded_dates: [],
  optional_tours: [],
  price_tiers: [
    { period_label: '5월 22일(금)', departure_dates: ['2026-05-22'], adult_price: 1549000, child_price: null, status: 'available', note: null },
    { period_label: '5월 29일(금)', departure_dates: ['2026-05-29'], adult_price: 1469000, child_price: null, status: 'available', note: null },
    { period_label: '6월 5·12일(금)', departure_dates: ['2026-06-05', '2026-06-12'], adult_price: 1469000, child_price: null, status: 'available', note: null },
    { period_label: '6월 19·26일(금)', departure_dates: ['2026-06-19', '2026-06-26'], adult_price: 1499000, child_price: null, status: 'available', note: null },
    { period_label: '7월 3일(금)', departure_dates: ['2026-07-03'], adult_price: 1469000, child_price: null, status: 'available', note: null },
    { period_label: '7월 10일(금)', departure_dates: ['2026-07-10'], adult_price: 1599000, child_price: null, status: 'available', note: null },
    { period_label: '7월 17일(금)', departure_dates: ['2026-07-17'], adult_price: 1659000, child_price: null, status: 'available', note: null },
    { period_label: '7월 24일(금)', departure_dates: ['2026-07-24'], adult_price: 1619000, child_price: null, status: 'available', note: null },
    { period_label: '7월 31일(금)', departure_dates: ['2026-07-31'], adult_price: 1849000, child_price: null, status: 'available', note: '성수기' },
    { period_label: '8월 7일(금)', departure_dates: ['2026-08-07'], adult_price: 1609000, child_price: null, status: 'available', note: null },
    { period_label: '8월 14일(금)', departure_dates: ['2026-08-14'], adult_price: 1969000, child_price: null, status: 'available', note: '광복절·극성수기' },
    { period_label: '8월 21·28일(금)', departure_dates: ['2026-08-21', '2026-08-28'], adult_price: 1599000, child_price: null, status: 'available', note: null },
    { period_label: '9월 4·11·18일(금)', departure_dates: ['2026-09-04', '2026-09-11', '2026-09-18'], adult_price: 1449000, child_price: null, status: 'available', note: null },
    { period_label: '9월 25일(금)', departure_dates: ['2026-09-25'], adult_price: 1429000, child_price: null, status: 'available', note: null },
    { period_label: '10월 2일(금)', departure_dates: ['2026-10-02'], adult_price: 1579000, child_price: null, status: 'available', note: null },
  ],
  inclusions: COMMON_INCLUSIONS,
  excludes: COMMON_EXCLUDES,
  notices_parsed: COMMON_REMARKS,
  special_notes: '호텔 2박 기준 싱글차지 $40/인·박 별도 부과. 게르 숙박에는 싱글차지 없음. 여권 유효기간 6개월 이상 필수.',
  product_highlights: [
    '테를지 럭셔리 게르 2인1실 (게르 내부 욕실·화장실 구비)',
    '세계 최대 칭기즈칸 마동상 내/외부 관람',
    '초원 위에서 즐기는 승마체험 1시간',
    '몽골 전통공연 관람',
    '여행 피로를 풀어주는 마사지 60분',
    '유목민 마을 방문 & 수테차·으름·아롤 시식',
    '노팁 · 노옵션 · 노쇼핑',
  ],
  product_summary: '광활한 대초원의 나라 몽골, 금요일 출발 3박5일 일정. 테를지 국립공원 럭셔리 게르에서 하룻밤, 세계 최대 칭기즈칸 마동상 내/외부 관람, 승마 체험 1시간, 몽골 전통공연 감상, 마사지 60분까지 핵심 명소를 모두 담은 여소남 노팁·노옵션·노쇼핑 상품.',
  product_tags: ['#몽골', '#울란바토르', '#테를지', '#게르', '#승마체험', '#노팁노옵션', '#진에어'],
  itinerary_data: {
    meta: {
      title: '몽골 울란바토르/테를지 3박 5일 [노팁노옵션]',
      product_type: '노팁노옵션',
      destination: '울란바토르/테를지',
      nights: 3, days: 5,
      departure_airport: '부산(김해)',
      airline: 'LJ(진에어)',
      flight_out: 'LJ781',
      flight_in: 'LJ782',
      departure_days: '매주 금요일',
      min_participants: 4,
      room_type: '호텔·게르 2인 1실',
      ticketing_deadline: '2026-04-29',
      hashtags: ['#몽골', '#울란바토르', '#테를지', '#게르'],
      brand: '여소남',
    },
    highlights: {
      inclusions: COMMON_INCLUSIONS,
      excludes: COMMON_EXCLUDES,
      shopping: '노쇼핑',
      remarks: COMMON_REMARKS,
    },
    days: [
      {
        day: 1,
        regions: ['부산', '울란바토르'],
        meals: meal(false, false, false, null, null, null),
        schedule: [
          flight('21:40', '부산 출발', 'LJ781'),
          flight('00:30', '울란바토르 도착 / 가이드 미팅 후 호텔 투숙', 'LJ781'),
        ],
        hotel: { name: 'J / 프리미엄 / 인터내셔널 호텔 또는 동급', grade: '4성', note: null },
      },
      {
        day: 2,
        regions: ['울란바토르', '테를지'],
        meals: meal(true, true, true, '호텔식', '한식', '허르헉'),
        schedule: [
          normal(null, '조식 후 테를지 국립공원으로 이동 (약 2시간 30분)'),
          normal(null, '▶ 몽골제국 800주년을 기념하며 만들어진 세계 최대 칭기즈칸 마동상 관광 (외부/내부 관람)'),
          normal(null, '▶ 테를지 국립공원 도착'),
          normal(null, '▶ 한국의 성황당과 같은 의미를 지닌 어워 관광'),
          normal(null, '▶ 테를지의 각종 기암괴석(거북바위, 책 읽는 바위 등) 감상'),
          normal(null, '▶ 유목민 마을 방문하여 유목민 생활 체험 — 수테차 시음, 으름(몽골식 버터), 아롤(몽골식 치즈) 시식'),
          normal(null, '▶ 말을 타고 초원의 모습을 두 눈 가득 담아보세요! 승마체험 (1시간)'),
          normal(null, '석식(허르헉) 후 아름다운 몽골 밤하늘의 야경 감상, 몽골 전통가옥 게르에서 휴식'),
        ],
        hotel: { name: '테를지 럭셔리 게르캠프', grade: '럭셔리 게르', note: '2인 1실 · 게르 내부 욕실·화장실 구비' },
      },
      {
        day: 3,
        regions: ['테를지', '울란바토르'],
        meals: meal(true, true, true, '캠프식', '한식', '삼겹살'),
        schedule: [
          normal(null, '조식 후 ▶ 코끼리를 형상화하여 만든 새벽사원 아리야발사원 방문'),
          normal(null, '▶ 열트산 탐방 및 몽골의 젖줄 톨강 감상'),
          normal(null, '▶ 낭만 가득! 감성 폭발! 푸르공에서 사진찍기 체험'),
          normal(null, '테를지 출발 후 울란바토르 도착'),
          normal(null, '▶ 울란바토르 시내를 한눈에 내려다볼 수 있는 자이승 승전탑'),
          normal(null, '▶ 몽골의 슈바이처로 불리는 이태준 열사 기념공원'),
          normal(null, '▶ 금으로 도금된 26m의 관세음보살상이 있는 대형불상공원'),
          normal(null, '석식 및 호텔 투숙'),
        ],
        hotel: { name: 'J / 프리미엄 / 인터내셔널 호텔 또는 동급', grade: '4성', note: null },
      },
      {
        day: 4,
        regions: ['울란바토르'],
        meals: meal(true, true, true, '호텔식', '한식', '샤브샤브'),
        schedule: [
          normal(null, '조식 후 ▶ 울란바토르의 중심 칭기스칸 광장(구. 수흐바타르 광장), 몽골 국회의사당 자유시간 및 사진 촬영'),
          normal(null, '▶ 2022년 10월 오픈한 칭기스칸 박물관'),
          normal(null, '▶ 몽골 최대 규모의 라마불교 사원 간등사'),
          normal(null, '▶ 한/몽 우호의 상징 서울의 거리'),
          normal(null, '▶ 몽골의 노래·춤·음악을 보고 듣고 느끼는 몽골 전통공연'),
          normal(null, '▶ 여행의 피로를 풀어주는 마사지 60분 (매너팁 별도)'),
          normal(null, '칭기스칸 국제공항으로 이동'),
        ],
        hotel: null,
      },
      {
        day: 5,
        regions: ['울란바토르', '부산'],
        meals: meal(false, false, false, null, null, null),
        schedule: [
          flight('01:30', '울란바토르 출발', 'LJ782'),
          flight('06:10', '부산 도착', 'LJ782'),
        ],
        hotel: null,
      },
    ],
    optional_tours: [],
  },
  itinerary: [
    'Day 1: 부산(21:40) → 울란바토르(00:30) 호텔 투숙',
    'Day 2: 울란바토르 → 테를지 / 칭기즈칸 마동상 / 어워 / 승마체험 / 게르 숙박',
    'Day 3: 테를지 → 울란바토르 / 아리야발사원 / 자이승 승전탑 / 대형불상공원',
    'Day 4: 울란바토르 시내 / 칭기스칸 박물관 / 간등사 / 전통공연 / 마사지',
    'Day 5: 울란바토르(01:30) → 부산(06:10)',
  ],
  accommodations: [
    'J / 프리미엄 / 인터내셔널 호텔 또는 동급 (4성) × 2박',
    '테를지 럭셔리 게르캠프 (2인 1실) × 1박',
  ],
  raw_text: '',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
};

// ══════════════════════════════════════════════════════════════
// ── 상품 2: 울란바토르/테를지/엘승타사르하이 4박6일 [월요일 출발] ──
// ══════════════════════════════════════════════════════════════
const PKG_4N6D = {
  title: '몽골 울란바토르/테를지/엘승타사르하이 4박 6일 [노팁노옵션] - 월요일 출발',
  destination: '울란바토르/테를지/엘승타사르하이',
  country: '몽골',
  category: 'package',
  product_type: '노팁노옵션',
  trip_style: '4박6일',
  duration: 6, nights: 4,
  departure_airport: '부산(김해)',
  airline: 'LJ(진에어)',
  min_participants: 4,
  status: 'pending',
  price: 1469000,
  guide_tip: 0,
  single_supplement: null,
  small_group_surcharge: 0,
  surcharges: [],
  excluded_dates: [],
  optional_tours: [],
  price_tiers: [
    { period_label: '5월 25일(월)', departure_dates: ['2026-05-25'], adult_price: 1579000, child_price: null, status: 'available', note: null },
    { period_label: '6월 1·8일(월)', departure_dates: ['2026-06-01', '2026-06-08'], adult_price: 1579000, child_price: null, status: 'available', note: null },
    { period_label: '6월 15일(월)', departure_dates: ['2026-06-15'], adult_price: 1609000, child_price: null, status: 'available', note: null },
    { period_label: '6월 22·29일(월)', departure_dates: ['2026-06-22', '2026-06-29'], adult_price: 1469000, child_price: null, status: 'available', note: null },
    { period_label: '7월 6일(월)', departure_dates: ['2026-07-06'], adult_price: 1529000, child_price: null, status: 'available', note: null },
    { period_label: '7월 13일(월)', departure_dates: ['2026-07-13'], adult_price: 1569000, child_price: null, status: 'available', note: null },
    { period_label: '7월 20일(월)', departure_dates: ['2026-07-20'], adult_price: 1599000, child_price: null, status: 'available', note: null },
    { period_label: '7월 27일(월)', departure_dates: ['2026-07-27'], adult_price: 1799000, child_price: null, status: 'available', note: '성수기' },
    { period_label: '8월 3·10일(월)', departure_dates: ['2026-08-03', '2026-08-10'], adult_price: 1769000, child_price: null, status: 'available', note: '극성수기' },
    { period_label: '8월 17·24일(월)', departure_dates: ['2026-08-17', '2026-08-24'], adult_price: 1699000, child_price: null, status: 'available', note: null },
    { period_label: '8월 31일(월)', departure_dates: ['2026-08-31'], adult_price: 1469000, child_price: null, status: 'available', note: null },
    { period_label: '9월 7·14일(월)', departure_dates: ['2026-09-07', '2026-09-14'], adult_price: 1569000, child_price: null, status: 'available', note: null },
    { period_label: '9월 21일(월)', departure_dates: ['2026-09-21'], adult_price: 1579000, child_price: null, status: 'available', note: null },
    { period_label: '9월 28일(월)', departure_dates: ['2026-09-28'], adult_price: 1549000, child_price: null, status: 'available', note: null },
    { period_label: '10월 5일(월)', departure_dates: ['2026-10-05'], adult_price: 1649000, child_price: null, status: 'available', note: null },
  ],
  inclusions: COMMON_INCLUSIONS,
  excludes: COMMON_EXCLUDES,
  notices_parsed: COMMON_REMARKS,
  special_notes: '호텔 2박 기준 싱글차지 $40/인·박 별도 부과. 게르 2박에는 싱글차지 없음. 여권 유효기간 6개월 이상 필수.',
  product_highlights: [
    '엘승타사르하이 사막 낙타타기 · 모래썰매 체험',
    '테를지 럭셔리 게르 2인1실 (게르 내부 욕실·화장실 구비)',
    '세계 최대 칭기즈칸 마동상 내/외부 관람',
    '초원 위에서 즐기는 승마체험 1시간',
    '몽골 전통공연 관람',
    '여행 피로를 풀어주는 마사지 60분',
    '유목민 마을 방문 & 수테차·으름·아롤 시식',
    '미니 고비사막 오아시스 감상',
    '노팁 · 노옵션 · 노쇼핑',
  ],
  product_summary: '몽골의 초원과 사막을 동시에! 월요일 출발 4박6일 일정. 엘승타사르하이 미니 고비사막에서 낙타타기·모래썰매 체험, 테를지 국립공원 럭셔리 게르 숙박, 세계 최대 칭기즈칸 마동상 관람, 승마체험·전통공연·마사지까지 여소남 노팁·노옵션·노쇼핑 상품.',
  product_tags: ['#몽골', '#울란바토르', '#테를지', '#엘승타사르하이', '#사막', '#게르', '#낙타타기', '#승마체험', '#노팁노옵션', '#진에어'],
  itinerary_data: {
    meta: {
      title: '몽골 울란바토르/테를지/엘승타사르하이 4박 6일 [노팁노옵션]',
      product_type: '노팁노옵션',
      destination: '울란바토르/테를지/엘승타사르하이',
      nights: 4, days: 6,
      departure_airport: '부산(김해)',
      airline: 'LJ(진에어)',
      flight_out: 'LJ781',
      flight_in: 'LJ782',
      departure_days: '매주 월요일',
      min_participants: 4,
      room_type: '호텔·게르 2인 1실',
      ticketing_deadline: '2026-04-29',
      hashtags: ['#몽골', '#울란바토르', '#테를지', '#엘승타사르하이', '#사막'],
      brand: '여소남',
    },
    highlights: {
      inclusions: COMMON_INCLUSIONS,
      excludes: COMMON_EXCLUDES,
      shopping: '노쇼핑',
      remarks: COMMON_REMARKS,
    },
    days: [
      {
        day: 1,
        regions: ['부산', '울란바토르'],
        meals: meal(false, false, false, null, null, null),
        schedule: [
          flight('21:40', '부산 출발', 'LJ781'),
          flight('00:30', '울란바토르 도착 / 가이드 미팅 후 호텔 투숙', 'LJ781'),
        ],
        hotel: { name: 'J / 프리미엄 / 인터내셔널 호텔 또는 동급', grade: '4성', note: null },
      },
      {
        day: 2,
        regions: ['울란바토르', '엘승타사르하이'],
        meals: meal(true, true, true, '호텔식', '현지식', '현지식'),
        schedule: [
          normal(null, '조식 후 엘승타사르하이로 이동 (약 4시간 30분)'),
          normal(null, '이동 중 끝없이 펼쳐진 대초원지대 및 유목민 감상'),
          normal(null, '도착 후 중식'),
          normal(null, '▶ 사막에서의 낙타타기 체험, 모래썰매 체험'),
          normal(null, '▶ 미니 오아시스 감상'),
          normal(null, '석식 후 몽골 전통가옥 게르에서 휴식'),
        ],
        hotel: { name: '엘승타사르하이 전통게르', grade: '전통 게르', note: '2인 1실 · 공용 욕실·화장실 사용' },
      },
      {
        day: 3,
        regions: ['엘승타사르하이', '테를지'],
        meals: meal(true, true, true, '캠프식', '한식', '허르헉'),
        schedule: [
          normal(null, '조식 후 울란바토르 경유하여 테를지 국립공원으로 이동 (약 5시간 30분)'),
          normal(null, '▶ 몽골제국 800주년을 기념하며 만들어진 세계 최대 칭기즈칸 마동상 관광 (외부/내부 관람)'),
          normal(null, '▶ 테를지 국립공원 도착'),
          normal(null, '▶ 한국의 성황당과 같은 의미를 지닌 어워 관광'),
          normal(null, '▶ 테를지의 각종 기암괴석(거북바위, 책 읽는 바위 등) 감상'),
          normal(null, '▶ 유목민 마을 방문하여 유목민 생활 체험 — 수테차 시음, 으름(몽골식 버터), 아롤(몽골식 치즈) 시식'),
          normal(null, '▶ 말을 타고 초원의 모습을 두 눈 가득 담아보세요! 승마체험 (1시간)'),
          normal(null, '석식(허르헉) 후 아름다운 몽골 밤하늘의 야경 감상, 몽골 전통가옥 게르에서 휴식'),
        ],
        hotel: { name: '테를지 럭셔리 게르캠프', grade: '럭셔리 게르', note: '2인 1실 · 게르 내부 욕실·화장실 구비' },
      },
      {
        day: 4,
        regions: ['테를지', '울란바토르'],
        meals: meal(true, true, true, '캠프식', '한식', '삼겹살'),
        schedule: [
          normal(null, '조식 후 ▶ 코끼리를 형상화하여 만든 새벽사원 아리야발사원 방문'),
          normal(null, '▶ 열트산 탐방 및 몽골의 젖줄 톨강 감상'),
          normal(null, '▶ 낭만 가득! 감성 폭발! 푸르공에서 사진찍기 체험'),
          normal(null, '테를지 출발 후 울란바토르 도착'),
          normal(null, '▶ 울란바토르 시내를 한눈에 내려다볼 수 있는 자이승 승전탑'),
          normal(null, '▶ 몽골의 슈바이처로 불리는 이태준 열사 기념공원'),
          normal(null, '▶ 금으로 도금된 26m의 관세음보살상이 있는 대형불상공원'),
          normal(null, '석식 및 호텔 투숙'),
        ],
        hotel: { name: 'J / 프리미엄 / 인터내셔널 호텔 또는 동급', grade: '4성', note: null },
      },
      {
        day: 5,
        regions: ['울란바토르'],
        meals: meal(true, true, true, '호텔식', '한식', '샤브샤브'),
        schedule: [
          normal(null, '조식 후 ▶ 울란바토르의 중심 칭기스칸 광장(구. 수흐바타르 광장), 몽골 국회의사당 자유시간 및 사진 촬영'),
          normal(null, '▶ 2022년 10월 오픈한 칭기스칸 박물관'),
          normal(null, '▶ 몽골 최대 규모의 라마불교 사원 간등사'),
          normal(null, '▶ 한/몽 우호의 상징 서울의 거리'),
          normal(null, '▶ 몽골의 노래·춤·음악을 보고 듣고 느끼는 몽골 전통공연'),
          normal(null, '▶ 여행의 피로를 풀어주는 마사지 60분 (매너팁 별도)'),
          normal(null, '칭기스칸 국제공항으로 이동'),
        ],
        hotel: null,
      },
      {
        day: 6,
        regions: ['울란바토르', '부산'],
        meals: meal(false, false, false, null, null, null),
        schedule: [
          flight('01:30', '울란바토르 출발', 'LJ782'),
          flight('06:10', '부산 도착', 'LJ782'),
        ],
        hotel: null,
      },
    ],
    optional_tours: [],
  },
  itinerary: [
    'Day 1: 부산(21:40) → 울란바토르(00:30) 호텔 투숙',
    'Day 2: 울란바토르 → 엘승타사르하이 / 낙타타기 / 모래썰매 / 게르 숙박',
    'Day 3: 엘승타사르하이 → 테를지 / 칭기즈칸 마동상 / 승마체험 / 게르 숙박',
    'Day 4: 테를지 → 울란바토르 / 아리야발사원 / 자이승 승전탑 / 불상공원',
    'Day 5: 울란바토르 시내 / 칭기스칸 박물관 / 간등사 / 전통공연 / 마사지',
    'Day 6: 울란바토르(01:30) → 부산(06:10)',
  ],
  accommodations: [
    'J / 프리미엄 / 인터내셔널 호텔 또는 동급 (4성) × 2박',
    '엘승타사르하이 전통게르 (2인 1실) × 1박',
    '테를지 럭셔리 게르캠프 (2인 1실) × 1박',
  ],
  raw_text: '',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
};

// ══════════════════════════════════════════════════════════════
// ── 랜드사/마진/발권기한 ──
// ══════════════════════════════════════════════════════════════
const LAND_OPERATOR_ID = '43a54eed-1390-4713-bb43-2624c87436a4'; // 투어폰
const COMMISSION_RATE = 9;
const TICKETING_DEADLINE = '2026-04-29';
const SUPPLIER_CODE = 'TP';
const DEST_CODE = 'ULN'; // 울란바토르 (칭기스칸 공항 ICAO/IATA)

const ALL_PACKAGES = [PKG_3N5D, PKG_4N6D];

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
      e.product_type === pkg.product_type &&
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

  // ── short_code 순번 조회 ──
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

    // short_code 자동 생성
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
      // ★ 절대 누락 금지 컬럼 ★
      land_operator_id: LAND_OPERATOR_ID,
      short_code,
      commission_rate: COMMISSION_RATE,
      ticketing_deadline: TICKETING_DEADLINE,
    });
  }

  // ── 결과 리포트 ──
  console.log(`\n📋 중복 검사 결과:`);
  console.log(`  - 신규 등록: ${toInsert.length}개`);
  console.log(`  - 아카이브 (기존→대체): ${toArchive.length}개`);
  console.log(`  - 건너뜀 (동일): ${skipped.length}개\n`);

  if (skipped.length > 0) {
    skipped.forEach(s => console.log(`  ⏭️  SKIP: ${s.title} (${s.reason})`));
  }

  // ── 1. 기존 상품 아카이브 ──
  if (toArchive.length > 0) {
    const archiveIds = toArchive.map(a => a.id);
    await sb.from('travel_packages').update({ status: 'archived' }).in('id', archiveIds);
    toArchive.forEach(a => console.log(`  📦 아카이브: ${a.short_code} | ${a.title}`));
  }

  // ── 2. 신규 상품 등록 ──
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

main().catch(err => {
  console.error('❌ 실행 중 오류:', err);
  process.exit(1);
});
