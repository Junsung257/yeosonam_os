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

## 스크립트 생성 방법

**공용 템플릿 사용** — `db/templates/insert-template.js`에 모든 공통 로직이 있음:
- `createInserter()`: 중복감지 + 아카이브 + short_code 자동 + INSERT
- `helpers`: `flight()`, `normal()`, `optional()`, `shopping()`, `train()`, `meal()`
- `generateDisplayTitle()`, `tiersToDatePrices()`

**랜드사 UUID** — `db/land-operators.json` 참조 (스크립트 내에서 자동 로드됨)

### 생성할 스크립트 구조:

```javascript
const { createInserter } = require('./templates/insert-template');

const inserter = createInserter({
  landOperator: '투어폰',          // land-operators.json 키
  commissionRate: 9,               // 사용자 입력 마진율
  ticketingDeadline: '2026-04-27', // 발권기한 (없으면 null)
  destCode: 'LAO',                 // short_code용 목적지 코드
});
const { helpers: { flight, normal, optional, shopping, train, meal } } = inserter;

// ── 상품 정의 ──
const PKG1 = {
  title: '...',
  destination: '...', country: '...', category: 'package',
  product_type: '실속', trip_style: '3박5일',
  duration: 5, nights: 3,
  departure_airport: '부산(김해)', airline: 'BX(에어부산)',
  min_participants: 4, status: 'pending',
  price: 599000,  // 기준가 (최저가)
  guide_tip: 50, single_supplement: null, small_group_surcharge: null,
  surcharges: [], excluded_dates: [],
  price_tiers: [ /* 아래 포맷 참조 */ ],
  inclusions: [ /* 원문 그대로 */ ],
  excludes: [ /* 원문 그대로 */ ],
  optional_tours: [ /* { name, price_usd, price_krw, note } */ ],
  accommodations: ['호텔명(등급)'],
  product_highlights: ['핵심 특전 3개 이내'],
  product_summary: '2~3줄 요약',
  product_tags: ['태그'],
  notices_parsed: [ /* {type:'CRITICAL'|'PAYMENT'|'POLICY'|'INFO', title, text} */ ],
  special_notes: null,
  itinerary_data: { /* 아래 포맷 참조 */ },
  itinerary: ['제1일: ...'],
  raw_text: '', filename: 'manual_input', file_type: 'manual', confidence: 1.0,
};

const ALL_PACKAGES = [PKG1];
inserter.run(ALL_PACKAGES);
```

## Destination 코드 매핑
ZJJ(장가계), NHA(나트랑), DLT(달랏), BHO(보홀), FUK(후쿠오카), MAC(마카오), LAO(라오스), HAN(하노이), DAD(다낭), CXR(캄란), CNX(치앙마이), BKI(코타키나발루), PQC(푸꾸옥), XIY(서안), TAO(칭다오), MNG(몽골), BKK(방콕), SGN(호치민), DPS(발리), CEB(세부)

## price_tiers 포맷

```javascript
{
  period_label: '4/1~4/30 목요일',
  date_range: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' },  // 또는 departure_dates: ['YYYY-MM-DD', ...]
  departure_day_of_week: '목',     // date_range 사용 시 요일
  adult_price: 899000,
  child_price: null,
  status: 'available',
  note: null
}
```

## itinerary_data 포맷 (TravelItinerary)

```javascript
{
  meta: {
    title, product_type, destination, nights, days,
    departure_airport, airline, flight_out, flight_in,
    departure_days, min_participants, room_type: '2인1실',
    ticketing_deadline: null, hashtags: ['#지역명'], brand: '여소남',
  },
  highlights: {
    inclusions: [...],    // 포함내역 원문 그대로
    excludes: [...],      // 불포함내역 원문 그대로
    shopping: '...',      // 쇼핑 원문 (없으면 null)
    remarks: [...],       // 비고 원문 (★ 반드시 string[] — 객체 금지!)
  },
  days: [{
    day: 1, regions: ['부산', '목적지'],
    meals: meal(false, false, false, null, null, null),
    schedule: [
      flight('21:25', '김해 국제공항 출발', 'BX745'),
      normal(null, '호텔 이동 후 체크인'),
    ],
    hotel: { name: '호텔명', grade: '4성', note: '또는 동급' },
  }],
  optional_tours: [{ name: '마사지', price_usd: 40, price_krw: null, note: null }],
}
```

## 추출 체크리스트

### 1순위 (누락 시 무효)
1. **랜드사** → `createInserter({ landOperator: '...' })`
2. **마진율** → `commissionRate`
3. **발권기한** → `ticketingDeadline` (YYYY-MM-DD, 없으면 null)

### 2순위 (상품 속성)
4. product_type: 실속/노팁풀옵션/노팁노옵션/품격
5. price_tiers: 기간별 가격표
6. inclusions / excludes: 원문 그대로
7. optional_tours: 이름 + USD 가격
8. itinerary_data.days: 일차별 일정 (flight/normal/optional/shopping/train/meal 타입)
9. accommodations: 호텔명 + 등급
10. notices_parsed: 유의사항 구조화
11. guide_tip / single_supplement / small_group_surcharge

## 실행 흐름

1. 위 체크리스트 기반으로 데이터 추출
2. `db/insert_{destination}_{identifier}_packages.js` 생성
3. 사용자에게 `node db/insert_xxx.js` 실행 확인

**절대 코드베이스 탐색하지 말 것. 이 프롬프트가 전부.**

---

## 크래시 방지 규칙 (프로덕션 사고 학습)

1. **schedule[].type**: `'normal'|'optional'|'shopping'|'flight'|'train'|'meal'|'hotel'` — `'transport'` 절대 금지 (TransportBar 크래시)
2. **highlights.remarks**: 반드시 `string[]` — 객체 배열 넣으면 크래시
3. **price_dates**: `tiersToDatePrices()` 자동 생성 필수 — 빠지면 달력 요금표 안 보임 (insert-template이 자동 처리)
4. **optional_tours에 쇼핑 금지** — 쇼핑은 `special_notes` + `highlights.shopping`에만
5. **hotel null**: `{ name: null, grade: null, note: null }` → 프론트에서 자동 처리 (기내숙박/숨김/공항대기)
