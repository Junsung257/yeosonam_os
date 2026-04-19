/**
 * ★ 부산-후쿠오카/나가사키/사세보 2026.4.1 배포 골프 2박3일 2건 등록
 *   랜드사: 랜드부산 / 커미션 0% (10만원 고정은 special_notes 명시) / 발권기한 2026-04-01
 *
 *   1) 나가사키 정통 골프 54H 초석 2박3일 (사세보국제, 타케오우레시노, 오무라만)
 *   2) 나가사키 품격 골프 54H 초석 2박3일 (사가클래식, 와카키, 오션팰리스, 페닌슐라)
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envFile = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envFile.split('\n').forEach(l => { const [k, ...v] = l.split('='); if (k) env[k.trim()] = v.join('=').trim(); });
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const LAND_OPERATOR_ID = 'de5cd166-9f84-41f5-9124-e9b6b1081ffe'; // 랜드부산
const SUPPLIER_CODE = 'LB';
const DEST_CODE = 'FUK';
const COMMISSION_RATE = 0; // 10만원 고정이므로 %=0 + special_notes 명시
const TICKETING_DEADLINE = '2026-04-01';

// 헬퍼
const flight = (time, activity, transport) => ({ time, activity, type: 'flight', transport, note: null });
const normal = (time, activity, note) => ({ time: time || null, activity, type: 'normal', transport: null, note: note || null });
const meal = (b, l, d, bn, ln, dn) => ({ breakfast: b, lunch: l, dinner: d, breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null });

// price_tiers 생성
const PERIOD_1 = { start: '2026-04-01', end: '2026-06-05', label: '4/1~6/5' };
const PERIOD_2 = { start: '2026-06-06', end: '2026-06-30', label: '6/6~6/30' };
const PRICING = {
  정통: {
    '4/1~6/5': { 월: 1479000, 화: 1479000, 수: 1479000, 목: 1579000, 금: 1749000, 토: 1719000, 일: 1549000 },
    '6/6~6/30': { 월: 1459000, 화: 1459000, 수: 1459000, 목: 1549000, 금: 1719000, 토: 1689000, 일: 1519000 },
  },
  품격: {
    '4/1~6/5': { 월: 1529000, 화: 1529000, 수: 1529000, 목: 1639000, 금: 1799000, 토: 1769000, 일: 1619000 },
    '6/6~6/30': { 월: 1499000, 화: 1499000, 수: 1499000, 목: 1609000, 금: 1769000, 토: 1739000, 일: 1579000 },
  },
};
const EXCLUDED_DATES = [
  '2026-03-18', '2026-03-19', '2026-03-20',
  '2026-04-27', '2026-04-28', '2026-04-29', '2026-04-30', '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04',
];

function buildTiers(kind) {
  const pricing = PRICING[kind];
  const tiers = [];
  for (const period of [PERIOD_1, PERIOD_2]) {
    const weekly = pricing[period.label];
    for (const [dow, price] of Object.entries(weekly)) {
      tiers.push({
        period_label: `${period.label} ${dow}`,
        date_range: { start: period.start, end: period.end },
        departure_day_of_week: dow,
        adult_price: price,
        status: 'available',
        note: null,
      });
    }
  }
  return tiers;
}

// tiers → price_dates (출발일 매핑)
const DOW_MAP = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
function tiersToDatePrices(tiers) {
  const excluded = new Set(EXCLUDED_DATES);
  const result = [];
  const seen = new Set();
  for (const t of tiers) {
    if (!t.date_range || !t.departure_day_of_week) continue;
    const targetDow = DOW_MAP[t.departure_day_of_week];
    if (targetDow == null) continue;
    const [sy, sm, sd] = t.date_range.start.split('-').map(Number);
    const [ey, em, ed] = t.date_range.end.split('-').map(Number);
    const cursor = new Date(sy, sm - 1, sd);
    const endDate = new Date(ey, em - 1, ed);
    while (cursor <= endDate) {
      if (cursor.getDay() === targetDow) {
        const iso = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;
        if (!excluded.has(iso) && !seen.has(iso)) {
          seen.add(iso);
          result.push({ date: iso, price: t.adult_price, confirmed: false });
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

const COMMON_INCLUSIONS = [
  '왕복 항공료',
  '호텔 2박 (2인1실 신관 기준)',
  '조식 2회',
  '2억 여행자보험',
  '골프비용 (그린피, 전동카트피)',
  '차량비용 (도로비, 유류비)',
  '한국인 차량가이드',
];
const COMMON_EXCLUDES = [
  '유류할증료 변동분 (4월 기준)',
  '기타 개인경비',
  '골프 수화물 (기본 15kg 외, 발권 후 개별 구매)',
  '중식',
  '석식',
  '일본 공휴일 추가요금 (3/18~20, 4/27~5/4)',
  '싱글차지 3,000엔/박/인',
  '본관 숙박 시 2,000엔/박/인',
];
const COMMON_SURCHARGES = [
  { name: '일본 공휴일 추가요금', start: '2026-03-18', end: '2026-03-20', amount: null, currency: null, unit: '별도확인' },
  { name: '일본 오봉 추가요금', start: '2026-04-27', end: '2026-05-04', amount: null, currency: null, unit: '별도확인' },
  { name: '싱글차지', start: null, end: null, amount: 3000, currency: 'JPY', unit: '박/인' },
  { name: '본관 숙박차지', start: null, end: null, amount: 2000, currency: 'JPY', unit: '박/인' },
];
const COMMON_NOTICES = [
  { type: 'CRITICAL', title: '본 상품 필수 안내', text: '• 특별약관 적용 상품입니다\n• 예약 후 취소 시 1인 200,000원 공제 후 환불\n• 항공 블록좌석 아님 — 예약 시 요금 재확인 필요\n• 여권 만료일 출발일 기준 6개월 이상 필수' },
  { type: 'PAYMENT', title: '취소 수수료', text: '• 출발 14~7일전: 총 금액의 50% 공제\n• 출발 7~4일전: 70% 공제\n• 출발 4~2일전: 90% 공제\n• 출발 1일~당일: 100% 환불 불가\n• 파이널 후 취소 불가' },
  { type: 'POLICY', title: '골프장 및 호텔', text: '• 캐디 부족으로 셀프 플레이만 가능\n• 문신 있는 경우 골프장/목욕탕 이용 불가\n• 호텔 예약 상황에 따라 동급 대체 가능\n• 2인1실 신관 기준\n• 첫날 오후 티업으로 라커룸/욕장 사용 불가' },
  { type: 'INFO', title: '식사 옵션', text: '• 호텔식/카즈야식당(야키니쿠): 4,500엔/인\n• 일식코스(외부): 6,000엔/인\n• 미슐랭 원스타 스시: 11,000엔/인\n• 일몰 후 야간플레이 불가' },
];
const LAND_COMMISSION_NOTE =
  '[랜드사 커미션] 랜드부산 10만원/건 고정 (% 커미션 아님). 정산 시 별도 처리 필요. commission_rate=0 저장은 스키마 제약.';

const RAW_TEXT = `4.1배포 / 랜드부산 / 커미션 10만원 고정 / 발권기한 2026-04-01

[요금표 (단위: 원)]
4/1~6/5: 월화수 1,479,000 정통 / 1,529,000 품격 (4명 출발확정) | 목 1,579,000 / 1,639,000 | 금 1,749,000 / 1,799,000 | 토 1,719,000 / 1,769,000 | 일 1,549,000 / 1,619,000
6/6~6/30: 월화수 1,459,000 / 1,499,000 | 목 1,549,000 / 1,609,000 | 금 1,719,000 / 1,769,000 | 토 1,689,000 / 1,739,000 | 일 1,519,000 / 1,579,000

● 항공제외일: 3/18~20, 4/27~5/4
● 호텔 예약시 날짜별 써차지 체크
● 항공 그룹요금 예약 시 날짜별 재확인

[정통 3색 코스]: 사세보국제CC / 타케오우레시노CC / 오무라만CC
[품격 3색 코스]: 사가클래식CC / 와카키CC / 오션팰리스CC / 페닌슐라CC

포함: 왕복항공료, 호텔, 조식, 2억 여행자보험, 골프비용(그린피/전동카트피), 차량비용, 한국인 차량가이드
불포함: 유류할증료 변동분, 기타 개인경비, 골프 수화물, 중식, 석식
쇼핑센터: 노옵션 & 노쇼핑

HOTEL: 더 사세보 파라다이스 가든 호텔 또는 동급 (4성급, 2인1실 신관 기준)

[일정]
제1일: 부산 07:30 BX148 → 후쿠오카 08:25 / 사세보 이동 / 18홀 라운딩 (오후티업/스루/셀프) / 호텔 체크인 / 온천욕
제2일: 호텔 조식 / 18홀 라운딩 / 호텔 휴식 (온천욕)
제3일: 호텔 조식 / 체크아웃 / 18홀 라운딩 / 후쿠오카 공항 이동 / 19:55 BX143 → 부산 21:05

추가요금: 싱글차지 3,000엔/박/인 | 본관 2,000엔/박/인 | 일본 공휴일 3/18~20, 4/27~5/4 별도확인
취소규정: 예약 후 1인 200,000원 공제 / 14~7일전 50% / 7~4일전 70% / 4~2일전 90% / 1일~당일 100% 환불불가 / 파이널 후 취소불가`;

function buildPkg({ title, product_type, price, tiers, courses }) {
  return {
    title,
    destination: '나가사키',
    country: '일본',
    category: 'golf',
    product_type,
    trip_style: '2박3일',
    duration: 3,
    nights: 2,
    departure_airport: '부산(김해)',
    departure_days: '매일',
    airline: 'BX(에어부산)',
    min_participants: 4,
    status: 'pending',
    price,
    guide_tip: null,
    single_supplement: '3,000엔/박/인',
    small_group_surcharge: null,
    surcharges: COMMON_SURCHARGES,
    excluded_dates: EXCLUDED_DATES,
    optional_tours: [],
    price_tiers: tiers,
    price_dates: tiersToDatePrices(tiers),
    inclusions: COMMON_INCLUSIONS,
    excludes: COMMON_EXCLUDES,
    notices_parsed: COMMON_NOTICES,
    special_notes: `${LAND_COMMISSION_NOTE}\n\n* 쇼핑센터: 노옵션 & 노쇼핑\n* 셀프 플레이만 (캐디 불가)\n* 1인실 3,000엔/박/인 / 본관 2,000엔/박/인 추가\n* 사세보국제/나가사키파크/하우스텐보스만 클럽식 포함`,
    product_highlights: [
      `${courses} 54홀 (18홀×3일)`,
      '호텔 2박 + 조식 포함',
      'BX 에어부산 김해 직항',
    ],
    product_summary: `부산-후쿠오카 BX 직항 / 사세보 호텔 2박 / ${courses} 중 18홀씩 54홀 라운딩 / 조식 포함 / 노옵션·노쇼핑`,
    product_tags: ['골프', '노옵션', '노쇼핑', product_type],
    itinerary_data: {
      days: [
        {
          day: 1,
          regions: ['부산', '후쿠오카', '사세보'],
          meals: meal(false, false, false, null, null, null),
          schedule: [
            normal('05:30', '출발 2시간 전 김해공항 국제선 2층 미팅 후 수속'),
            flight('07:30', `BX148 김해국제공항 출발 → 후쿠오카국제공항 08:25 도착`, 'BX148'),
            normal(null, '한국인 차량가이드 미팅 후 골프장 이동 (1시간 10~20분 소요)'),
            normal(null, `▶${courses} 중 18홀 라운딩 (오후티업/스루, 셀프 플레이)`),
            normal(null, '라운딩 후 호텔 체크인'),
            normal(null, '석식 후 휴식 (온천욕)'),
            { time: null, activity: '더 사세보 파라다이스 가든 호텔 또는 동급 (4성급, 2인1실) 투숙', type: 'hotel', transport: null, note: null },
          ],
          hotel: { name: '더 사세보 파라다이스 가든 호텔 또는 동급', grade: '4성급', note: '2인1실 신관 기준' },
        },
        {
          day: 2,
          regions: ['사세보'],
          meals: meal(true, false, false, '호텔식', null, null),
          schedule: [
            normal(null, '호텔 조식 후 골프장으로 이동'),
            normal(null, `▶${courses} 중 18홀 라운딩 (셀프 플레이)`),
            normal(null, '라운딩 후 호텔로 이동'),
            normal(null, '석식 후 휴식 (온천욕)'),
            { time: null, activity: '더 사세보 파라다이스 가든 호텔 또는 동급 (4성급, 2인1실) 투숙', type: 'hotel', transport: null, note: null },
          ],
          hotel: { name: '더 사세보 파라다이스 가든 호텔 또는 동급', grade: '4성급', note: '2인1실 신관 기준' },
        },
        {
          day: 3,
          regions: ['사세보', '후쿠오카', '부산'],
          meals: meal(true, false, false, '호텔식', null, null),
          schedule: [
            normal(null, '호텔 조식 후 체크아웃, 골프장으로 이동'),
            normal(null, `▶${courses} 중 18홀 라운딩 (셀프 플레이)`),
            normal(null, '라운딩 후 후쿠오카 공항으로 이동 (현지 운전기사 수송 후 개별수속)'),
            flight('19:55', 'BX143 후쿠오카국제공항 출발 → 김해국제공항 21:05 도착', 'BX143'),
          ],
          hotel: null,
        },
      ],
    },
    itinerary: [
      '제1일: 부산(김해) → 후쿠오카 → 사세보 | 18홀 라운딩 + 호텔 체크인 + 온천욕',
      '제2일: 사세보 | 18홀 라운딩 + 온천 휴식',
      '제3일: 사세보 → 후쿠오카 → 부산 | 18홀 라운딩 후 귀국',
    ],
    accommodations: ['더 사세보 파라다이스 가든 호텔 또는 동급 (4성급, 2인1실 신관 기준)'],
    raw_text: RAW_TEXT,
    filename: 'landbusan_nagasaki_golf_20260401.txt',
    file_type: 'manual',
    confidence: 0.95,
  };
}

const packages = [
  buildPkg({
    title: '나가사키 정통 골프 54H 초석 2박3일',
    product_type: '정통',
    price: 1459000,
    tiers: buildTiers('정통'),
    courses: '사세보국제CC / 타케오우레시노CC / 오무라만CC',
  }),
  buildPkg({
    title: '나가사키 품격 골프 54H 초석 2박3일',
    product_type: '품격',
    price: 1499000,
    tiers: buildTiers('품격'),
    courses: '사가클래식CC / 오션팰리스CC / 페닌슐라CC / 와카키CC',
  }),
];

// ── 메인 ──
async function main() {
  console.log(`🔍 ${packages.length}건 상품 등록 준비\n`);

  // 기존 활성 상품 조회 (중복 감지용)
  const { data: existingPkgs } = await sb.from('travel_packages')
    .select('id, title, destination, product_type, duration, price, price_tiers, price_dates, ticketing_deadline, short_code, status')
    .eq('land_operator_id', LAND_OPERATOR_ID)
    .in('status', ['approved', 'active', 'pending', 'pending_review']);
  console.log(`기존 활성 상품: ${existingPkgs?.length || 0}건\n`);

  // short_code 시퀀스 확인
  const { data: allCodes } = await sb.from('travel_packages')
    .select('short_code')
    .ilike('short_code', `${SUPPLIER_CODE}-${DEST_CODE}-%`);
  function nextSeq(prefix) {
    return (allCodes || []).reduce((max, r) => {
      if (!r.short_code?.startsWith(prefix)) return max;
      const n = parseInt(r.short_code.split('-').pop() || '0', 10);
      return n > max ? n : max;
    }, 0);
  }

  const toInsert = [];
  const seqCounters = {};

  for (const pkg of packages) {
    // 중복 감지 (같은 destination + duration + product_type)
    const dup = (existingPkgs || []).find(e =>
      e.destination === pkg.destination &&
      e.duration === pkg.duration &&
      (e.product_type || '').includes(pkg.product_type || '')
    );
    if (dup) {
      console.log(`⚠️  유사 상품 발견: ${dup.short_code || dup.id} | ${dup.title} (${dup.status})`);
      console.log(`    → 이번은 신규 등록으로 진행. 기존은 라이브 유지.`);
    }

    const dur = String(pkg.duration).padStart(2, '0');
    const prefix = `${SUPPLIER_CODE}-${DEST_CODE}-${dur}-`;
    if (!seqCounters[prefix]) seqCounters[prefix] = nextSeq(prefix);
    seqCounters[prefix]++;
    const short_code = `${prefix}${String(seqCounters[prefix]).padStart(2, '0')}`;

    toInsert.push({
      title: pkg.title,
      destination: pkg.destination,
      country: pkg.country,
      category: pkg.category,
      product_type: pkg.product_type,
      trip_style: pkg.trip_style,
      duration: pkg.duration,
      nights: pkg.nights,
      departure_airport: pkg.departure_airport,
      departure_days: pkg.departure_days,
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
      price_dates: pkg.price_dates,
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
      raw_text: pkg.raw_text,
      filename: pkg.filename,
      file_type: pkg.file_type,
      confidence: pkg.confidence,
      land_operator_id: LAND_OPERATOR_ID,
      short_code,
      commission_rate: COMMISSION_RATE,
      ticketing_deadline: TICKETING_DEADLINE,
    });
  }

  console.log(`\n📦 INSERT 대상 ${toInsert.length}건:\n`);
  toInsert.forEach((p, i) => console.log(`  ${i + 1}. ${p.short_code} | ${p.title} (${p.price?.toLocaleString()}원~)`));

  // INSERT
  const { data, error } = await sb.from('travel_packages')
    .insert(toInsert)
    .select('id, title, short_code, status, price, commission_rate, ticketing_deadline');

  if (error) { console.error('❌ 등록 실패:', error.message); process.exit(1); }
  console.log(`\n✅ ${data.length}건 등록 완료!\n`);
  data.forEach((r, i) => {
    console.log(`  ${i + 1}. [${r.status}] ${r.short_code} | ${r.title}`);
    console.log(`     ID: ${r.id} | ₩${r.price?.toLocaleString()} | 커미션 ${r.commission_rate}% | 발권 ${r.ticketing_deadline}`);
    console.log(`     URL: https://yeosonam.com/packages/${r.id}`);
  });

  // 🚨 MANDATORY: 자동 감사 (register.md Step 7)
  if (!process.env.SKIP_POST_AUDIT) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🔍 Step 7: 자동 감사 실행');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    const { spawnSync } = require('child_process');
    const path = require('path');
    const ids = data.map(d => d.id);
    spawnSync('node', [path.join(__dirname, 'post_register_audit.js'), ...ids], { stdio: 'inherit' });
  }
}
main().catch(e => { console.error(e); process.exit(1); });
