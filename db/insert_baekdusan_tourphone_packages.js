/**
 * ★ 인천-연길/백두산 2026년 5~8월 노팁노옵션 1개 상품 등록
 *   랜드사: 투어폰 / 마진 10% / 발권기한 없음
 *
 *   1) 노팁노옵션 인천/연길/백두산 서파+북파 3박4일 (KE)
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

// ── price_tiers → price_dates ──
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
const LAND_OPERATOR_ID = '43a54eed-1390-4713-bb43-2624c87436a4'; // 투어폰
const COMMISSION_RATE = 10;
const TICKETING_DEADLINE = null;
const SUPPLIER_CODE = 'TP';
const DEST_CODE = 'YNJ';

// ══════════════════════════════════════════════════════════════
//  PKG1: 인천/연길/백두산 서파+북파 3박4일 (노팁노옵션, KE)
// ══════════════════════════════════════════════════════════════
const PKG1 = {
  title: '노팁노옵션 인천/연길/백두산 서파+북파 3박 4일',
  destination: '연길, 백두산(서파/북파)',
  country: '중국',
  category: 'package',
  product_type: '노팁노옵션',
  trip_style: '3박4일',
  duration: 4,
  nights: 3,
  departure_airport: '인천',
  airline: 'KE(대한항공)',
  min_participants: 12,
  status: 'pending',
  price: 999000,
  guide_tip: 0,
  single_supplement: null,
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  optional_tours: [], // 노옵션 — 선택관광 없음
  price_tiers: [
    { period_label: '5/24 (일)', departure_dates: ['2026-05-24'], date_range: { start: '2026-05-24', end: '2026-05-24' }, departure_day_of_week: '일', adult_price: 999000, child_price: null, status: 'available', note: null },
    { period_label: '5/4 (월)', departure_dates: ['2026-05-04'], date_range: { start: '2026-05-04', end: '2026-05-04' }, departure_day_of_week: '월', adult_price: 1059000, child_price: null, status: 'available', note: null },
    { period_label: '5/11 (월)', departure_dates: ['2026-05-11'], date_range: { start: '2026-05-11', end: '2026-05-11' }, departure_day_of_week: '월', adult_price: 1079000, child_price: null, status: 'available', note: null },
    { period_label: '5/14 (목)', departure_dates: ['2026-05-14'], date_range: { start: '2026-05-14', end: '2026-05-14' }, departure_day_of_week: '목', adult_price: 1099000, child_price: null, status: 'available', note: null },
    { period_label: '5/3,6,7,15', departure_dates: ['2026-05-03', '2026-05-06', '2026-05-07', '2026-05-15'], adult_price: 1119000, child_price: null, status: 'available', note: '일/수/목/금' },
    { period_label: '5/31 (일)', departure_dates: ['2026-05-31'], date_range: { start: '2026-05-31', end: '2026-05-31' }, departure_day_of_week: '일', adult_price: 1159000, child_price: null, status: 'available', note: null },
    { period_label: '5/28 (목)', departure_dates: ['2026-05-28'], date_range: { start: '2026-05-28', end: '2026-05-28' }, departure_day_of_week: '목', adult_price: 1239000, child_price: null, status: 'available', note: null },
    { period_label: '6/1 (월)', departure_dates: ['2026-06-01'], date_range: { start: '2026-06-01', end: '2026-06-01' }, departure_day_of_week: '월', adult_price: 1199000, child_price: null, status: 'available', note: null },
    { period_label: '6/30 (화)', departure_dates: ['2026-06-30'], date_range: { start: '2026-06-30', end: '2026-06-30' }, departure_day_of_week: '화', adult_price: 1239000, child_price: null, status: 'available', note: null },
    { period_label: '6/9 (화)', departure_dates: ['2026-06-09'], date_range: { start: '2026-06-09', end: '2026-06-09' }, departure_day_of_week: '화', adult_price: 1259000, child_price: null, status: 'available', note: null },
    { period_label: '6/13,15,16,27,28', departure_dates: ['2026-06-13', '2026-06-15', '2026-06-16', '2026-06-27', '2026-06-28'], adult_price: 1279000, child_price: null, status: 'available', note: '월/화/토/일' },
    { period_label: '7/13 (월)', departure_dates: ['2026-07-13'], date_range: { start: '2026-07-13', end: '2026-07-13' }, departure_day_of_week: '월', adult_price: 1279000, child_price: null, status: 'available', note: null },
    { period_label: '7/6,26,27', departure_dates: ['2026-07-06', '2026-07-26', '2026-07-27'], adult_price: 1359000, child_price: null, status: 'available', note: '월/일' },
    { period_label: '7/29 (수)', departure_dates: ['2026-07-29'], date_range: { start: '2026-07-29', end: '2026-07-29' }, departure_day_of_week: '수', adult_price: 1379000, child_price: null, status: 'available', note: null },
    { period_label: '8/24 (월)', departure_dates: ['2026-08-24'], date_range: { start: '2026-08-24', end: '2026-08-24' }, departure_day_of_week: '월', adult_price: 1299000, child_price: null, status: 'available', note: null },
    { period_label: '8/3,16,28', departure_dates: ['2026-08-03', '2026-08-16', '2026-08-28'], adult_price: 1359000, child_price: null, status: 'available', note: '월/금/일' },
    { period_label: '8/20 (목)', departure_dates: ['2026-08-20'], date_range: { start: '2026-08-20', end: '2026-08-20' }, departure_day_of_week: '목', adult_price: 1379000, child_price: null, status: 'available', note: null },
  ],
  inclusions: ['왕복항공권, 호텔(2인1실), 전용차량, 일정표상의 식사, 관광지입장료, 현지가이드, 여행자보험(1억원), 발+전신마사지(90분/팁별도), 특급호텔숙박+온천욕, 특식3회, 기사/가이드경비'],
  excludes: ['기타개인경비'],
  notices_parsed: [
    '- 여권 유효기간 출발일기준 6개월이상 남아있어야 됩니다.',
    '- 단수여권, 긴급여권, 관용여권은 중국 입국불가입니다.',
    '- 현지 날씨 사정으로 인해 백두산 입산이 불가하거나 아래 일정은 변경될 수 있습니다.',
    '- 순수한 단체관광 목적을 위한 패키지 상품이므로 일정 중 개별적인 활동은 불가합니다.',
    '쇼핑센터: 2회+농산품',
  ],
  special_notes: null,
  product_highlights: [
    '정5성급 호텔 3박 숙박',
    '백두산 서파 및 북파 2회 등정 (천지 조망)',
    '발+전신마사지(90분) 체험 및 온천욕',
    '특식 3회 제공 (삼겹살 무제한, 샤브샤브 무제한 등)',
  ],
  product_summary: null,
  product_tags: ['백두산', '서파', '북파', '연길', '노팁노옵션', '정5성호텔'],
  accommodations: [
    '다이너스티호텔 또는 동급(정5성) × 2박',
    '국제호텔 또는 동급(정5성) × 1박',
  ],
  itinerary: [],
  raw_text: '',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
  itinerary_data: {
    meta: {
      title: '노팁노옵션 인천/연길/백두산 서파+북파 3박 4일',
      product_type: '노팁노옵션',
      destination: '연길, 백두산(서파/북파)',
      nights: 3,
      days: 4,
      departure_airport: '인천',
      airline: 'KE(대한항공)',
      flight_out: 'KE115',
      flight_in: 'KE116',
      departure_days: '지정일 출발',
      min_participants: 12,
      room_type: '2인1실',
      ticketing_deadline: null,
      hashtags: ['#백두산', '#서파북파', '#정5성호텔', '#온천욕'],
      brand: '여소남',
    },
    highlights: {
      inclusions: ['왕복항공권, 호텔(2인1실), 전용차량, 일정표상의 식사, 관광지입장료, 현지가이드, 여행자보험(1억원), 발+전신마사지(90분/팁별도), 특급호텔숙박+온천욕, 특식3회, 기사/가이드경비'],
      excludes: ['기타개인경비'],
      shopping: '쇼핑센터 2회 + 농산품',
      remarks: [
        '- 여권 유효기간 출발일기준 6개월이상 남아있어야 됩니다.',
        '- 단수여권, 긴급여권, 관용여권은 중국 입국불가입니다.',
        '- 현지 날씨 사정으로 인해 백두산 입산이 불가하거나 아래 일정은 변경될 수 있습니다.',
        '- 순수한 단체관광 목적을 위한 패키지 상품이므로 일정 중 개별적인 활동은 불가합니다.',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['인천', '연길', '도문', '용정', '이도백하'],
        meals: meal(false, true, true, null, '꿔바로우+냉면', '삼겹살 무제한'),
        schedule: [
          flight('09:25', '인천 출발', 'KE115'),
          flight('10:50', '연길 도착 / 가이드 미팅', 'KE115'),
          bus(null, '중식 후 도문으로 이동 (약 1시간)'),
          normal(null, '▶두만강을 사이에 둔 중조국경지대 조망'),
          normal(null, '▶두만강 이북 남양시 조망 두만강 강변공원'),
          bus(null, '용정으로 이동 (약 1시간 30분)'),
          normal(null, '▶선구자에 나오는 일송정/해란강 – 차창'),
          normal(null, '▶시인이자 독립운동가였던 윤동주시인 생가 방문'),
          bus(null, '이도백하로 이동 (약 2시간)'),
          normal(null, '▶온척욕체험(수영복 개별지참)'),
          normal(null, '석식 후 호텔투숙 및 휴식'),
        ],
        hotel: { name: '다이너스티호텔 또는 동급', grade: '정5성', note: null },
      },
      {
        day: 2,
        regions: ['이도백하', '서파'],
        meals: meal(true, true, true, '호텔식', '비빔밥', '동북요리'),
        schedule: [
          bus(null, '호텔 조식 후 서파산문으로 이동 (약 1시간 30분)', '전일'),
          normal(null, '▶도보로 1,442개의 계단으로 백두산 등정'),
          normal(null, '▶북한과의 경계 37호 경계비'),
          normal(null, '▶37호 경계비에 올라 백두산천지 조망'),
          normal(null, '▶백두산 용암이 흘러내리면서 형성된 금강대협곡'),
          normal(null, '▶야생화 군락지 고산화원 - 차창'),
          bus(null, '이도백하로 이동 (약 2시간)'),
          normal(null, '▶포함사항 : 발+전신마사지(90분) 체험-팁별도'),
          normal(null, '호텔 투숙 및 휴식'),
        ],
        hotel: { name: '다이너스티호텔 또는 동급', grade: '정5성', note: null },
      },
      {
        day: 3,
        regions: ['이도백하', '북파', '연길'],
        meals: meal(true, true, true, '호텔식', '현지식', '샤브샤브 무제한'),
        schedule: [
          bus(null, '호텔 조식 후 북파산문으로 이동 (약 15분)', '전일'),
          bus(null, '▶짚차(20분) 탑승하여 천문봉에 올라 천지조망'),
          normal(null, '▶백두산의 웅장한 장백폭포'),
          normal(null, '▶장백폭포 주변의 다양한 온천지대 관광'),
          normal(null, '****온천계란 1인 2개씩 맛보기 체험***'),
          bus(null, '연길로 이동 (약 2시간)'),
          normal(null, '석식 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '국제호텔 또는 동급', grade: '정5성', note: null },
      },
      {
        day: 4,
        regions: ['연길', '인천'],
        meals: meal(true, true, false, '호텔식', '김밥 1줄', null),
        schedule: [
          normal(null, '호텔 조식 후 진달래광장'),
          bus(null, '공항으로 이동 (약 20분)'),
          bus(null, '연길로 이동 및 중식 후 공항으로 이동'),
          flight('11:55', '연길 출발', 'KE116'),
          flight('15:25', '인천 도착', 'KE116'),
        ],
        hotel: { name: null, grade: null, note: null },
      },
    ],
    optional_tours: [],
  },
};

const ALL_PACKAGES = [PKG1];

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
