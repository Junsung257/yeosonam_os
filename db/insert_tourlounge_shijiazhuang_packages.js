/**
 * ★ 청주-석가장 2026년 4~5월 노팁노옵션 1개 상품 등록
 *   랜드사: 투어라운지 (신규) / 마진 150,000원 고정 / 발권기한 미정
 *
 *   1) 청주-석가장 [보천대협곡/천계산/대협곡/신동태항] 5일 노팁/노옵션/노쇼핑 (RF)
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
const LAND_OPERATOR_ID = 'b816d836-ac3e-4689-aaf8-d5541005017b'; // 투어라운지 (신규)
const COMMISSION_RATE = 0; // ★ 고정마진 15만원/인 — numeric(5,2) 제한으로 special_notes에 기록
const TICKETING_DEADLINE = null;
const SUPPLIER_CODE = 'TL'; // 투어라운지
const DEST_CODE = 'SJW';   // 석가장

// ══════════════════════════════════════════════════════════════
//  PKG1: 청주-석가장 4박5일 노팁/노옵션/노쇼핑
// ══════════════════════════════════════════════════════════════
const PKG1 = {
  title: '청주-석가장 [보천대협곡/천계산/대협곡/신동태항] 5일 노팁/노옵션/노쇼핑',
  destination: '석가장',
  country: '중국',
  category: 'package',
  product_type: '노팁노옵션',
  trip_style: '4박5일',
  duration: 5,
  nights: 4,
  departure_airport: '청주',
  airline: 'RF',
  min_participants: 10,
  status: 'pending',
  price: 999000,
  guide_tip: 0,
  single_supplement: 180000,
  small_group_surcharge: null,
  surcharges: [],
  excluded_dates: [],
  optional_tours: [], // 노옵션
  price_tiers: [
    {
      period_label: '04월~05월 매주 토요일',
      departure_dates: ['2026-04-04', '2026-04-11', '2026-04-18', '2026-04-25', '2026-05-02', '2026-05-09', '2026-05-16', '2026-05-23', '2026-05-30'],
      date_range: { start: '2026-04-04', end: '2026-05-30' },
      departure_day_of_week: '토',
      adult_price: 999000,
      child_price: null,
      status: 'available',
      note: null,
    },
  ],
  inclusions: ['항공료, TAX/유류세, 호텔(2인1실), 전일정 식사, 리무진차량, 관광지입장료, 여행자보험, 가이드&기사 경비'],
  excludes: ['개인경비 및 기타 매너팁, 싱글차지 18만원/인/전일정'],
  notices_parsed: [
    '▪ 양국승인조건 / 여권 유효기간은 최소 6개월 이상 남아 있어야 합니다.',
    '▪ 무료 수화물 안내: 위탁수하물 15KG / 기내수하물 7KG',
    '▪ 중국온라인 입국신고서 필수: https://s.nia.gov.cn/ArrivalCardFillingPC/entry-registation-home',
    '▪ 예약금 : 30만원(인) / 출발 2주전 잔금완납',
    '▪ 전세기 특별약관 적용됩니다. 신중하게 예약해주세요.',
    '- 여행개시 30일전 까지 취소시: 계약금 환불',
    '- 여행개시 29일전 20일전까지 통보시: 여행요금의 30% 배상',
    '- 여행개시 20일전 11일전까지 통보시: 여행요금의 50% 배상',
    '- 여행개시 10일전에서 당일까지 통보시: 여행요금의 100% 배상',
    '※ 단, 주말(토, 일요일) 및 업무시간 이외의 취소 통보는 취소료 규정 산정날짜에서 제외.',
  ],
  special_notes: '고정마진 15만원/인 | 쇼핑센터: 2회+농산품',
  product_highlights: [
    '임주 환빈서안호텔 및 한단 영양국제호텔 5성급 숙박',
    '천계산 운봉화랑 전동카 및 유리잔도 포함',
    '보천대협곡 레일케이블카 및 동굴엘레베이터 체험',
    '피로를 풀어주는 전신마사지 90분 체험 포함',
  ],
  product_summary: null,
  product_tags: ['석가장', '보천대협곡', '천계산', '동태항', '노팁노옵션'],
  accommodations: [
    '임주-환빈서안호텔 또는 동급 (5성급) × 2박',
    '한단-영양국제호텔 또는 동급 (5성급) × 2박',
  ],
  itinerary: [],
  raw_text: '',
  filename: 'manual_input',
  file_type: 'pdf',
  confidence: 1.0,
  itinerary_data: {
    meta: {
      title: '청주-석가장 [보천대협곡/천계산/대협곡/신동태항] 5일 노팁/노옵션/노쇼핑',
      product_type: '노팁노옵션',
      destination: '석가장',
      nights: 4,
      days: 5,
      departure_airport: '청주',
      airline: 'RF',
      flight_out: 'RF8133',
      flight_in: 'RF8143',
      departure_days: '매주 토요일',
      min_participants: 10,
      room_type: '2인1실',
      ticketing_deadline: null,
      hashtags: ['#보천대협곡', '#천계산', '#대협곡', '#신동태항'],
      brand: '여소남',
    },
    highlights: {
      inclusions: ['항공료, TAX/유류세, 호텔(2인1실), 전일정 식사, 리무진차량, 관광지입장료, 여행자보험, 가이드&기사 경비'],
      excludes: ['개인경비 및 기타 매너팁, 싱글차지 18만원/인/전일정'],
      shopping: '쇼핑센터 2회 + 농산품',
      remarks: [
        '▪ 양국승인조건 / 여권 유효기간은 최소 6개월 이상 남아 있어야 합니다.',
        '▪ 무료 수화물 안내: 위탁수하물 15KG / 기내수하물 7KG',
        '▪ 중국온라인 입국신고서 필수',
        '▪ 예약금 : 30만원(인) / 출발 2주전 잔금완납',
        '▪ 전세기 특별약관 적용됩니다. 신중하게 예약해주세요.',
      ],
    },
    days: [
      {
        day: 1,
        regions: ['청주', '석가장', '임주'],
        meals: meal(false, false, true, null, null, '샤브샤브 무제한'),
        schedule: [
          flight('14:25', '청주 국제공항 출발', 'RF8133'),
          flight('15:45', '석가장 국제공항 도착 후 가이드 미팅', 'RF8133'),
          bus(null, '임주로 이동 [약 4시간 30분 소요]'),
          normal(null, '석식 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '임주-환빈서안호텔 또는 동급', grade: '5성급', note: null },
      },
      {
        day: 2,
        regions: ['임주', '천계산', '보천', '대협곡'],
        meals: meal(true, true, true, '호텔식', null, '삼겹살 무제한'),
        schedule: [
          bus(null, '호텔 조식 후 천계산으로 이동 [약 1시간 30분 소요]'),
          normal(null, '▶운봉화랑[전동카 포함]-시담대-여화대-유리잔도'),
          bus(null, '중식 후 보천대협곡으로 이동 [약 40분 소요]'),
          normal(null, '▶입구-셔틀버스-공중버스-쌍심플래폼-레일케이블카-전동카-유리전망대-전동카-동굴엘레베이터-전동카-셔틀버스-출구'),
          bus(null, '임주로 이동 [약 2시간 소요]'),
          normal(null, '▶피로를 풀어주는 전신마사지 90분 체험 [매너팁 별도]'),
          normal(null, '석식 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '임주-환빈서안호텔 또는 동급', grade: '5성급', note: null },
      },
      {
        day: 3,
        regions: ['임주', '대협곡', '한단'],
        meals: meal(true, true, true, '호텔식', null, '현지식'),
        schedule: [
          bus(null, '호텔 조식 후 대협곡으로 이동 [약 50분 소요]'),
          normal(null, '▶도화곡-황룡담-이룡희주-함주-구련폭포[도보로 약 60분] 환산선 일주[전동카 포함]-천갱-수녀봉-몽환곡'),
          bus(null, '중식 후 한단으로 이동 [약 1시간 40분 소요]'),
          normal(null, '석식 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '한단-영양국제호텔 또는 동급', grade: '5성급', note: null },
      },
      {
        day: 4,
        regions: ['한단', '동태항'],
        meals: meal(true, true, true, '호텔식', null, '현지식'),
        schedule: [
          bus(null, '호텔 조식 후 동태항으로 이동 [약 1시간 20분 소요]'),
          normal(null, '▶입구-케이블카-남천문-중천문-태항일주-태항천폭-천척장성-불관대-홍석잔도-북고봉-셔틀버스 하산'),
          bus(null, '중식 후 한단으로 이동 [약 1시간 20분 소요]'),
          normal(null, '▶2600년 역사를 가지고 있는 북방 수성-광부고성'),
          normal(null, '석식 후 호텔 투숙 및 휴식'),
        ],
        hotel: { name: '한단-영양국제호텔 또는 동급', grade: '5성급', note: null },
      },
      {
        day: 5,
        regions: ['한단', '석가장', '청주'],
        meals: meal(true, true, false, '호텔식', '호텔식', null),
        schedule: [
          bus(null, '호텔 조식 후 석가장으로 이동 [약 2시간 소요]'),
          normal(null, '▶조운묘 관광'),
          bus(null, '중식 후 공항으로 이동'),
          flight('16:45', '석가장 국제공항 출발', 'RF8143'),
          flight('19:35', '청주 국제공항 도착', 'RF8143'),
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
      console.log(`     ID: ${r.id} | ₩${r.price?.toLocaleString()} | 마진 ₩${r.commission_rate?.toLocaleString()} | 출발일 ${r.price_dates?.length || 0}건`);
    });
  }

  if (toInsert.length === 0 && toArchive.length === 0) {
    console.log('ℹ️  변경 사항 없음 — 모든 상품이 기존과 동일합니다.');
  }
}
main();
