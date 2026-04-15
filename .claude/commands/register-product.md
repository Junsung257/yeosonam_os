# 상품 등록 커맨드

아래는 사용자가 입력한 상품 원문과 랜드사/마진 정보입니다:

$ARGUMENTS

---

위 내용을 기반으로 **탐색/분석 없이 즉시** `db/insert_XXX_packages.js` 스크립트를 생성하라.

## 절대 규칙
1. **코드베이스 탐색 금지** — 이 프롬프트에 필요한 모든 컨텍스트가 있음
2. **구조 분석/질문 금지** — 바로 스크립트 작성 시작
3. **필수 입력**: 사용자가 상품 텍스트와 함께 `랜드사코드 마진율%`를 알려줌 (예: "투어폰 9%")
4. **원문 보존** — 일정/포함/불포함/비고는 원문 그대로 저장 (AI 가공 금지)

## 테이블: `travel_packages` — 필수 컬럼 (하나도 빠지면 안됨)

```
── 기본 정보 ──
title, display_title, destination, country, category('package'), product_type('실속'|'노팁노옵션'|'노팁풀옵션'|'품격'),
trip_style('3박5일'), duration, nights, departure_airport, airline, min_participants,
status('pending'), price(기준가), guide_tip, single_supplement, small_group_surcharge,

── ★ 랜드사/코드/마진 (절대 누락 금지) ──
land_operator_id(UUID),     // land_operators 테이블 FK — 아래 매핑표 참조
short_code(string),         // '{SUPPLIER}-{DEST}-{DURATION}-{SEQ}' 형식 (예: TP-LAO-05-01)
commission_rate(numeric),   // 사용자가 알려준 마진율 숫자 (예: 9)
ticketing_deadline(date),   // 발권기한/선발권조건 날짜 (YYYY-MM-DD) — 없으면 null

── 요금/일정/기타 ──
surcharges(JSON[]), excluded_dates(string[]), optional_tours(JSON[]),
price_tiers(JSON[]), inclusions(string[]), excludes(string[]),
notices_parsed(string[]), special_notes(string), product_highlights(string[]),
product_summary(string), product_tags(string[]), itinerary_data(JSON),
itinerary(string[]), accommodations(string[]),
raw_text(''), filename('manual_input'), file_type('pdf'), confidence(1.0)
```

## land_operators UUID 매핑 (land_operator_id)
```
투어폰:     43a54eed-1390-4713-bb43-2624c87436a4
투어비:     6a2f187f-c33e-45f1-b444-271c5cdcf74e
더투어:     ae53f857-de2a-43b6-8763-8289f75b91a0
랜드부산:   de5cd166-9f84-41f5-9124-e9b6b1081ffe
모두투어:   c982567e-fb23-4f82-8cda-8e7df8e74ea1
베스트아시아: cd55c45d-69bd-4add-8e07-44f022e35c1c
투어코코넛: ca9eba2f-203c-41a8-ad25-3d3416851b30
티트레블:   7b89ad15-c22a-45aa-8d80-ad367d1e0d33
하나투어:   875a1cd2-8eeb-43b2-b099-2f75e30e160d
```

## Supplier/Destination 코드 매핑 (short_code용)
- Supplier: TP(투어폰), TB(투어비), TT(더투어), LB(랜드부산), YS(여소남), MD(모두투어), BA(베스트아시아), TC(투어코코넛), TI(티트레블), HN(하나투어)
- Destination: ZJJ(장가계), NHA(나트랑), DLT(달랏), BHO(보홀), FUK(후쿠오카), MAC(마카오), LAO(라오스), HAN(하노이), DAD(다낭), CXR(캄란), CNX(치앙마이), BKI(코타키나발루), PQC(푸꾸옥)

## short_code 생성 규칙
```
{SUPPLIER_CODE}-{DEST_CODE}-{DURATION(2자리)}-{순번(2자리)}
예: TP-LAO-05-01 (투어폰-라오스-5일-1번)
```
순번은 동일 prefix 기존 최대 +1. 스크립트에서 DB 조회 후 자동 부여.

## 스크립트 템플릿

```javascript
/**
 * ★ {출발지}-{목적지} {년도}년 {월}월 {상품유형} {N}개 상품 일괄 등록
 * {상품 목록}
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
function optional(time, activity, note) { return { time: time || null, activity, type: 'optional', transport: null, note: note || null }; }
function shopping(time, activity) { return { time: time || null, activity, type: 'shopping', transport: null, note: null }; }
function train(time, activity, transport) { return { time: time || null, activity, type: 'train', transport: transport || '고속열차', note: null }; }
function meal(b, l, d, bn, ln, dn) {
  return { breakfast: b, lunch: l, dinner: d, breakfast_note: bn || null, lunch_note: ln || null, dinner_note: dn || null };
}

// ── ★ display_title 자동생성 (고객용 제목) ──
function generateDisplayTitle(pkg) {
  const type = (pkg.product_type || '').toLowerCase();
  let prefix = '';
  if (type.includes('노쇼핑') && type.includes('노팁') && type.includes('노옵션'))
    prefix = '추가비용 없는';
  else if (type.includes('노팁') && type.includes('노옵션'))
    prefix = '팁·옵션 걱정없는';
  else if (type.includes('고품격'))
    prefix = '프리미엄';
  else if (type.includes('품격'))
    prefix = '5성급 검증된';
  else if (type.includes('실속'))
    prefix = '핵심만 담은';

  const skipWords = ['노쇼핑', '노팁', '노옵션', '노팁노옵션'];
  const points = (pkg.product_highlights || [])
    .filter(h => !skipWords.some(w => h.includes(w)))
    .slice(0, 3);

  const base = [prefix, pkg.destination, `${pkg.nights}박${pkg.duration}일`].filter(Boolean).join(' ');
  return points.length ? `${base} — ${points.join(' + ')}` : base;
}

// ── ★ price_tiers → price_dates 자동변환 (절대 생략 금지) ──
const DOW_MAP = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
function tiersToDatePrices(tiers) {
  const seen = new Set();
  const result = [];
  for (const tier of tiers) {
    if (tier.status === 'soldout') continue;
    const dates = [];
    // date_range + departure_day_of_week → 개별 날짜 확장
    if (tier.date_range?.start && tier.date_range?.end && tier.departure_day_of_week != null) {
      const dow = DOW_MAP[tier.departure_day_of_week];
      const [sy,sm,sd] = tier.date_range.start.split('-').map(Number);
      const [ey,em,ed] = tier.date_range.end.split('-').map(Number);
      const c = new Date(sy, sm-1, sd);
      const end = new Date(ey, em-1, ed);
      while (c <= end) {
        if (c.getDay() === dow) {
          dates.push(`${c.getFullYear()}-${String(c.getMonth()+1).padStart(2,'0')}-${String(c.getDate()).padStart(2,'0')}`);
        }
        c.setDate(c.getDate()+1);
      }
    }
    // departure_dates (명시적 날짜)
    if (tier.departure_dates) dates.push(...tier.departure_dates);
    for (const date of dates) {
      if (!date || seen.has(date)) continue;
      seen.add(date);
      result.push({ date, price: tier.adult_price || 0, confirmed: false });
    }
  }
  return result.sort((a,b) => a.date.localeCompare(b.date));
}
```

## price_tiers 포맷

```javascript
{
  period_label: '4/1~4/30 목요일',           // 원문 기간
  date_range: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' },  // 또는 departure_dates: ['YYYY-MM-DD', ...]
  departure_day_of_week: '목',               // 요일 (date_range 사용 시)
  adult_price: 899000,                       // 성인 판매가
  child_price: null,                         // 아동가 (있으면)
  status: 'available',
  note: '특정일 제외 등'                      // 비고 (있으면)
}
```

## itinerary_data 포맷 (TravelItinerary)

```javascript
{
  meta: {
    title: '상품명',
    product_type: '실속|노팁노옵션|노팁풀옵션',
    destination: '비엔티엔/루앙프라방/방비엥',
    nights: 3, days: 5,
    departure_airport: '부산(김해)',
    airline: 'BX(에어부산)',
    flight_out: 'BX745', flight_in: 'BX746',
    departure_days: '매주 목요일',
    min_participants: 4,
    room_type: '2인1실',
    ticketing_deadline: null,
    hashtags: ['#루앙프라방', '#방비엥'],
    brand: '여소남',
  },
  highlights: {
    inclusions: [...],   // 포함내역 원문 그대로
    excludes: [...],     // 불포함내역 원문 그대로
    shopping: '침향, 라텍스, 잡화 3회',
    remarks: [...],      // 비고 원문 그대로
  },
  days: [
    {
      day: 1,
      regions: ['부산', '비엔티엔'],
      meals: meal(false, false, false, null, null, null),
      schedule: [
        flight('21:25', '김해 국제공항 출발', 'BX745'),
        flight('00:15', '비엔티엔 도착 후 입국수속, 가이드 미팅', 'BX745'),
        normal(null, '호텔 이동 후 체크인, 휴식'),
      ],
      hotel: { name: '아론 호텔 또는 동급', grade: '4성', note: null },
    },
    // ... day 2, 3, 4 ...
  ],
  optional_tours: [
    { name: '전신마사지 2시간', price_usd: 40, price_krw: null, note: '팁별도' },
    // ...
  ],
}
```

## 삽입 함수

```javascript
// ── 랜드사/마진/발권기한 (사용자 입력에서 추출) ──
const LAND_OPERATOR_ID = '투어폰UUID여기'; // land_operators UUID 매핑표 참조
const COMMISSION_RATE = 9;                 // 사용자가 알려준 마진율
const TICKETING_DEADLINE = '2026-04-27';   // 발권기한 (없으면 null)
const SUPPLIER_CODE = 'TP';                // short_code prefix용
const DEST_CODE = 'LAO';                   // short_code prefix용

const ALL_PACKAGES = [PKG1, PKG2, ...];

async function main() {
  console.log(`📦 패키지 ${ALL_PACKAGES.length}개 등록 시작...\n`);

  // ══════════════════════════════════════════════════════════════
  //  ★ 중복 감지: 동일 랜드사 + 목적지 + 상품유형 + 일수 = 동일 상품
  //  - 완전 동일 → SKIP
  //  - 요금/기한 변경 → 기존 아카이브 + 신규 등록
  // ══════════════════════════════════════════════════════════════
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

  const toArchive = [];  // 아카이브할 기존 상품 ID
  const toInsert = [];   // 신규 등록할 상품
  const skipped = [];    // 완전 동일 → 건너뜀

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
        // 시나리오 1: 완전 동일 → SKIP
        skipped.push({ title: pkg.title, existingId: dup.id, reason: '완전 동일' });
        continue;
      }
      // 시나리오 2,3: 요금/기한 변경 → 기존 아카이브 + 신규 등록
      toArchive.push({ id: dup.id, title: dup.title, short_code: dup.short_code });
    }

    // 신규 등록 (short_code 자동 생성)
    const dur = String(pkg.duration).padStart(2, '0');
    const prefix = `${SUPPLIER_CODE}-${DEST_CODE}-${dur}-`;
    if (!seqCounters[prefix]) seqCounters[prefix] = nextSeq(prefix);
    seqCounters[prefix]++;
    const short_code = `${prefix}${String(seqCounters[prefix]).padStart(2, '0')}`;

    toInsert.push({
      title: pkg.title, display_title: generateDisplayTitle(pkg),
      destination: pkg.destination, country: pkg.country,
      category: pkg.category, product_type: pkg.product_type, trip_style: pkg.trip_style,
      duration: pkg.duration, nights: pkg.nights, departure_airport: pkg.departure_airport,
      airline: pkg.airline, min_participants: pkg.min_participants, status: pkg.status,
      price: pkg.price, guide_tip: pkg.guide_tip, single_supplement: pkg.single_supplement,
      small_group_surcharge: pkg.small_group_surcharge, surcharges: pkg.surcharges,
      excluded_dates: pkg.excluded_dates, optional_tours: pkg.optional_tours,
      price_tiers: pkg.price_tiers,
      price_dates: tiersToDatePrices(pkg.price_tiers),  // ★ 자동생성
      inclusions: pkg.inclusions, excludes: pkg.excludes,
      notices_parsed: pkg.notices_parsed, special_notes: pkg.special_notes,
      product_highlights: pkg.product_highlights, product_summary: pkg.product_summary,
      product_tags: pkg.product_tags, itinerary_data: pkg.itinerary_data,
      itinerary: pkg.itinerary, accommodations: pkg.accommodations,
      raw_text: pkg.raw_text || '', filename: pkg.filename,
      file_type: pkg.file_type, confidence: pkg.confidence,
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
main();
```

## 추출 체크리스트 (원문에서 자동 매핑)

### ★ 1순위 — 누락 시 상품 무효 (반드시 먼저 세팅)
1. **랜드사 UUID**: 사용자 입력 "투어폰" → land_operator_id UUID 매핑표에서 조회
2. **마진율**: 사용자 입력 "9%" → commission_rate = 9
3. **short_code**: SUPPLIER-DEST-DURATION-SEQ 자동생성 (DB 기존 최대+1)
4. **발권기한**: 원문에서 "~까지 선발권조건" 등 → ticketing_deadline (YYYY-MM-DD)

### 2순위 — 상품 속성
5. **상품 분류**: 실속/노팁풀옵션/노팁노옵션/품격 → product_type
6. **루트 패턴**: 비방방/비루방/비루방방 등 → destination, title
7. **요금표**: 기간별 × 상품유형별 가격 → price_tiers[]
8. **포함내역**: 원문 그대로 → inclusions[], highlights.inclusions[]
9. **불포함내역**: 원문 그대로 → excludes[], highlights.excludes[]
10. **선택관광**: 이름+USD가격 → optional_tours[]
11. **쇼핑**: 원문 → highlights.shopping
12. **비고**: 원문 그대로 → notices_parsed[], highlights.remarks[]
13. **호텔**: 이름+등급 → accommodations[], day.hotel
14. **일정**: 일차별 → itinerary_data.days[] (flight/normal/optional/shopping/train/meal 타입 분류)
15. **항공편**: 편명+시간 → meta.flight_out/in, schedule flight()
16. **식사**: 조/중/석 메뉴 → meal() 헬퍼
17. **싱글차지/가이드팁**: → single_supplement, guide_tip
18. **제외일/특정일**: → excluded_dates[], 특별요금 price_tier

## 실행 흐름

사용자가 원문 텍스트를 붙여넣으면:
1. 위 체크리스트 기반으로 데이터 추출
2. `db/insert_{destination}_{identifier}_packages.js` 파일 바로 생성
3. 생성 완료 후 `node db/insert_xxx.js` 실행 여부를 사용자에게 확인

**절대 코드베이스 탐색하지 말 것. 이 프롬프트가 전부.**

---

## ⛔ 크래시 방지 규칙 (실제 프로덕션 사고에서 학습)

### 1. schedule[].type 허용값
```
'normal' | 'optional' | 'shopping' | 'flight' | 'train' | 'meal' | 'hotel'
```
- ❌ `'transport'` 절대 사용 금지 → TransportBar 크래시 유발
- 전용차량 이동: `normal(null, '공항으로 이동')` 또는 `{ type: 'normal', transport: '전용차량' }`

### 2. highlights.remarks는 string[]
```javascript
// ✅
remarks: ['• 여권 유효기간 6개월 이상', '• 일정 변경 가능']
// ❌ 크래시
remarks: [{ type: 'CRITICAL', title: '필수', text: '...' }]
```
- `notices_parsed`는 구조화 객체 `{type, title, text}[]` OK
- `highlights.remarks`는 반드시 `string[]`

### 3. price_dates 필수 생성
- `tiersToDatePrices(price_tiers)`로 자동 생성 → 빠지면 달력 요금표 안 보임

### 4. 선택관광에 쇼핑 항목 넣지 말 것
- `optional_tours[]`에 라텍스/찻집/침향 등 쇼핑 넣으면 안 됨
- 쇼핑은 `special_notes`와 `highlights.shopping`에만

### 5. 호텔 null 시 프론트 자동 처리
- Day1 심야출발: ✈️ 기내숙박
- 마지막날 귀국: 숨김
- 공항이동 후: 🏢 공항대기
- `hotel: { name: null, grade: null, note: null }` 그대로 넣으면 됨
