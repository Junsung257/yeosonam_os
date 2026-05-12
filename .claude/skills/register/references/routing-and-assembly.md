# Step 3 — 라우팅 (3분기 자동 판단) + 경로 A·B 상세

> **언제 읽는가**: 어셈블러 존재 여부 / 임계값(N=3) / 경로 A·B-1·B-2 상세 흐름이 필요할 때.

> **🟢 사장님 안내**: `/register`만 부르면 **Agent가 자동으로 분기**합니다. 어셈블러 존재 여부, 기존 상품 수, 중복 여부 모두 자동 판단. 사장님이 어셈블러 호출법을 외울 필요 없음.

## 3-0. 어셈블러 존재 여부 확인 (Agent 자동 실행)

```bash
ls db/assembler_{region_code 소문자}.js 2>/dev/null
```

**현재 어셈블러 존재 지역** (자동 갱신 안 됨 — `ls db/assembler_*.js` 로 항상 재확인):
- `assembler_xian.js` → 서안 (XIY)
- `assembler_qingdao.js` → 칭다오 (TAO)
- `assembler_danang.js` → 다낭/호이안 (DAD) ← 2026-04-20 추가
- `assembler_bho.js` → 보홀 (BHO) ← 2026-04-30 완성 (라이브러리 모드)

**BHO 어셈블러 사용 방법 (경로 A)**:
```js
// db/insert_bohol_{operator}_packages.js (~100줄)
const { createInserter, computeRawHash } = require('./templates/insert-template');
const { buildBoholPackages } = require('./assembler_bho');

const inserter = createInserter({ landOperator: '랜드사명', commissionRate: N, ... });
const { helpers: { flight, normal } } = inserter;  // ← 올바른 helpers 사용 패턴

const packages = buildBoholPackages({
  inserter, hotels, flightOut, flightIn,
  priceDates3D, priceDates4D,  // db/lib/parse-price-table.js로 추출 권장
  inclusions, excludes, notices, rawText,
});
inserter.run(packages);
```

**가격표 날짜 이상치 탐지**: `db/lib/parse-price-table.js`의 `parsePriceRows()` 사용 → 월 오타·요일 불일치·날짜 중복 자동 탐지.

**모델 선택**: BHO 어셈블러 존재 → **Haiku 4.5 사용 가능** (호텔명/항공편/가격표 단순 추출). Sonnet 불필요.

**존재**: → 경로 A (즉시 어셈블러 실행, MD 추가 분석 최소화 — 토큰 ~90% 절감)
**없음**: → 3-1로 진행

## 3-0-a. 중복 자동 SKIP (모든 경로 공통)

`insert-template.js`의 `findDuplicate()` + `isSamePriceDates()` + `isSameDeadline()`이 자동 검사:
- **동일 랜드사 + destination + product_type + duration + 출발일 겹침 + 가격 동일 + 마감 동일** → 즉시 SKIP (토큰 0)
- 가격만 변경 → 기존 archived + 신규 INSERT
- 완전성 점수 -20% 이상 하락 → `pending_replace` 보류 (라이브 교체 차단, ERR-KUL-safe-replace)

→ 사장님이 같은 원문을 두 번 붙여넣어도 안전. 자동 SKIP.

## 3-1. 해당 지역 기존 상품 수 조회 (🆕 N=3 자동 트리거)

```sql
SELECT COUNT(*) FROM travel_packages
 WHERE destination ILIKE '%{지역명}%'
```

- **등록된 상품 2개 이하** (이번 상품 포함 시 1~3번째): → **경로 B-1** (insert-template만)
- **등록된 상품 3개 이상** (이번 상품 포함 시 4번째+) 또는 이번이 **3번째 상품**: → **경로 B (B-1 + B-2 어셈블러 자동 생성)**

**임계값 N=3 근거**:
- 2개 이하는 공통 패턴 확신 불가 (우연의 일치)
- 3개부터 공통 블록 vs 차별 블록 구분 가능
- 호텔 풀 / 식사 풀 / 템플릿(실속/품격) 자연스럽게 추출

---

## 경로 A — 어셈블러 존재 (XIY, TAO 등)

```bash
# 1. 원문 저장
# db/sample.txt에 원문 저장

# 2. dry-run
node db/assembler_{region}.js db/sample.txt --operator <랜드사> --commission <N> --deadline <날짜> --dry-run

# 3. 검수 리포트를 사용자에게 보여주기

# 4. 사용자 승인 후
node db/assembler_{region}.js db/sample.txt --operator <랜드사> --commission <N> --deadline <날짜> --insert

# 5. 정리
rm db/sample.txt
```

## 경로 B — 어셈블러 없음 (신규 지역)

**Step 3-1 결과에 따라 분기:**

- 🟡 **B-1 단독** (해당 지역 상품 1~2개일 때): 상품 등록만 수행, 어셈블러는 아직 생성하지 않음
- 🟢 **B-1 + B-2 동시 수행** (해당 지역 상품 3개 이상 시): 상품 등록 + 어셈블러 자동 생성

즉, **이번 상품이 해당 지역의 3번째 상품**이 되는 순간 어셈블러를 생성합니다:
- 기존 2개 + 이번 신규 1개 = 총 3개 상품 분석
- 공통 블록 추출 → BLOCKS 배열
- 상품 타입별 조합 → TEMPLATES 배열 (실속/품격 등)

### B-1. 상품 등록 (즉시)
`/register-product` 커맨드의 규칙을 따른다:
1. `.claude/commands/register-product.md`를 **Read**하여 스크립트 생성 규칙 참조
2. `db/templates/insert-template.js`의 `createInserter()` 활용 (Zod 검증 내장)
3. `db/insert_{dest}_{id}_packages.js` 생성 → 사용자 확인 후 실행

### B-2. 어셈블러 자동 부트스트랩 (🆕 P3 #1, 2026-04-27 도입)

상품 등록 완료 후, **반드시** `db/auto_bootstrap_assembler.js` 를 호출해 STUB 어셈블러를 생성한다.

```bash
node db/auto_bootstrap_assembler.js --region=<지역명> --dest-code=<XYZ>
```

자동 추출 산출물 (`db/assembler_<slug>.stub.js`):
- **BLOCKS** — 등록된 N개 상품의 `itinerary_data` 에서 `▶...` 마커 활동을 빈도순으로 정렬, 자동 추출
- **DESTINATION.hotel_pool** — 등록 상품의 `accommodations` 통합 (등급 분류는 수기 보완 필요)
- **AIRLINES** — 등록 상품의 `airline` / `departure_airport` 자동 매핑
- **COMMON_INCLUSIONS / COMMON_EXCLUDES** — 절반 이상 등장한 항목 (지역 공통 패턴)

**자동화 안 되는 부분 (Agent 또는 사장님이 stub 검수 후 보완):**
- BLOCKS 의 `keywords` 정제 (자동은 단순 토큰만 추출)
- BLOCKS 의 `score` 검토 (점수 가중치는 수기 결정)
- TEMPLATES 작성 (실속/품격 같은 상품 유형별 BLOCK 조합)
- `parseRawText` / `buildProduct` / `insertToDB` 구현 — `db/assembler_qingdao.js` 등 참고

검수 후 `.stub.js` → `.js` 로 rename 하면 다음 등록부터 자동 사용된다 (Step 3-0 어셈블러 존재 감지).

**보고 포맷:**
```
✅ db/assembler_{slug}.stub.js 자동 부트스트랩 완료
   ├ BLOCKS: N개 (등장 빈도순)
   ├ 호텔 풀: H개
   ├ 공통 inclusions: I개 / excludes: E개
   └ 다음: stub 검수 → assembler_{slug}.js 로 rename → 다음 등록부터 자동 사용
```

**기존 어셈블러 존재 시**: 스크립트가 거부 (덮어쓰기 방지). 보완하려면 직접 편집.
