# 통합 상품 등록

> **[자동 설정]** 이 커맨드는 파싱 정확도와 데이터 무결성을 위해 **Sonnet 4.6**으로 자동 처리됩니다.
> 사용자는 모델을 선택할 필요가 없습니다. `/register` 호출 → 자동 Sonnet 사용.

사용자가 입력한 원문과 랜드사/마진 정보입니다:

$ARGUMENTS

---

## 🚨 Step 0: 필수 사전 참조 (파싱 시작 전)

파싱 시작 전 반드시 다음 **3개 파일**을 Read:

1. `db/error-registry.md` — 누적된 오류 이력 (최근 10건 체크리스트)
2. `.claude/commands/manage-attractions.md` — **관광지 처리 가이드 (MUST READ)**
3. `CLAUDE.md` 섹션 0 — Zero-Hallucination Policy

## 🚫 관광지 자동 시드 금지 (ERR-20260418-33)

**이미 완전한 관광지 관리 파이프라인이 존재합니다.** 새로 만들지 마세요.

- ❌ `db/seed_XXX_attractions.js` 같은 임시 시드 스크립트 생성 금지
- ❌ Agent가 AI로 short_desc/long_desc 생성해서 DB INSERT 금지
- ❌ 상품 등록 중 관광지 자동 생성 금지
- ✅ 매칭 실패한 관광지는 **자동으로 `unmatched_attractions`에 플래그만 찍고 종료**
- ✅ 사용자가 `/admin/attractions/unmatched` 페이지에서 수동 처리 (CSV 다운로드 → 외부 편집 → CSV 업로드)

**이 단계를 생략하지 마십시오.** 과거에 발견되어 해결한 오류가 다시 나오면 시스템 신뢰도가 무너집니다.

---

## 🚨 Zero-Hallucination Policy (AI 파싱 절대 준수 규칙)

### 1. 숫자는 1:1 매핑 (템플릿 기본값 금지)

- "최소 성인 **10명** 이상" → `min_participants: 10` (절대 4 아님)
- 원문에 인원이 **명시되지 않으면** `null` (템플릿 기본값 4 쓰지 말 것)
- 가격/시간/일수도 동일: 원문 그대로 1:1

**이유**: ERR-20260418-01 (타이베이 10명 → 4명 조작)

### 2. 예시 목록은 축약 금지

- 원문: "(라면스프, 소세지/햄, 육포, 소고기고추장볶음(튜브형 포함), 육류가 들어간 면 종류, 베이컨 등)"
- ✅ 올바른 파싱: `notices_parsed[0].text`에 괄호 전체 그대로 보존
- ❌ 금지: "위반 시 벌금"으로 한 단어 요약 / "등"으로 예시 대체

**이유**: ERR-20260418-02 (대만 라면스프 하나에 수백만 원 벌금 리스크 직결)

### 3. 의심스러우면 원문 문자열 보존 (Quote > Summary)

- 요약하지 말고 원문 그대로 quote
- `raw_text` 필드에 항상 원문 전체 보존 (validatePackage W13~W15가 대조 검증)

### 4. 스키마 이중성 함정 주의

- `surcharges`는 반드시 **객체 배열**로 저장: `{ name, start, end, amount, currency, unit }`
  - `excludes`에 "$10/인/박" 문자열로만 넣으면 A4 포스터가 날짜를 못 읽음 (ERR-20260418-03)
- `optional_tours[].price`는 **문자열 형식** 통일 (예: "$35/인")

### 4-1. 날짜 필드 맥락 파싱 규칙 (ERR-date-confusion 방지)

원문의 `YYYY.M.D` / `YYYY-MM-DD` 날짜는 **맥락에 따라 다른 필드에 매핑**:

| 원문 패턴 | 의미 | DB 필드 |
|---------|------|--------|
| "X까지 발권" / "X까지 예약" | 발권기한 | `ticketing_deadline` |
| "X.Y 배포" / "X.Y 업데이트" / 상품명 뒤 단순 날짜 | 버전/배포일 | null (DB에 해당 필드 없음) |
| "X부터 출발" / 매일 출발 | 출발 시작일 | `price_dates` 첫 항목 |
| "X~Y 적용" / "X~Y 기간" | 가격 기간 | `price_tiers[].date_range` |
| "X~Y 제외" / "항공제외일" | 제외일 | `excluded_dates` |

**핵심 체크**: 원문에 "발권", "예약 마감", "티켓팅" 등 키워드가 **없으면** `ticketing_deadline = null` 설정.

### 5. 파싱 후 self-check 체크리스트

INSERT 전에 Agent가 스스로 점검:

- [ ] 원문에 "N명 이상" 표기가 있다면 `min_participants`와 일치하는가?
- [ ] 원문 비고 섹션 길이 대비 `notices_parsed` 합계 길이 ≥ 70%인가?
- [ ] 원문 "출확/출발확정" 표기가 `price_dates[].confirmed: true`에 반영되었는가?
- [ ] 원문 써차지 날짜 범위가 `pkg.surcharges` 객체 배열에 모두 있는가?
- [ ] 원문 쇼핑센터 "N회" 수치가 `special_notes`에 정확히 반영되었는가?
- [ ] 일정 내 관광지가 `attractions` 테이블에 있는지 확인 후 없으면 시드 필요 플래그
- [ ] **[신규]** `departure_days` 가 평문(`"월/수"`) 인가? `["금"]` 같은 JSON 배열 문자열 금지 (W16)
- [ ] **[신규]** `optional_tours[]` 의 "2층버스" / "리버보트" 같은 모호 이름에 `region` 필드가 채워져 있는가? (W17)

### 6. 🚨 DAY 교차 오염 방지 (ERR-KUL-02/03)

**한 원문에 여러 상품(예: 3박5일 + 4박6일)이 공존하는 경우 가장 빈번한 실수.**

AI가 3박5일 DAY N의 일정을 4박6일 DAY N에 복사하거나, 두 상품이 공유하는 호텔/관광지가 있다고 가정해 임의 삽입하는 패턴.

**필수 준수 규칙**:

1. **상품별 독립 컨텍스트 파싱**
   - 원문에서 각 상품 블록을 명확히 분리 (예: `[D7] ... 3박5일` 과 `[D7] ... 4박6일`)
   - 한 상품의 일정을 파싱할 때 **다른 상품의 일정 텍스트를 참조 금지**
   - DAY별 파싱은 해당 상품 블록 내부에서만 수행

2. **랜드마크 원문 대조 필수**
   - 각 DAY의 관광지 목록은 **해당 상품 블록 원문에 실제로 존재하는 명칭만** 포함
   - 예: 4박6일 원문에 "메르데카 광장"이 없으면 4박6일 일정에 절대 포함 금지
   - validator W18이 이를 자동 탐지: 원문에 없는 랜드마크 등장 시 경고

3. **유사 일정에 대한 경계**
   - "두 상품 모두 쿠알라룸푸르 시티투어"라고 비슷해 보여도, **원문이 명시하는 관광지 세트가 다를 수 있음**
   - 3박5일: 왕궁/국립이슬람사원/메르데카/KLCC
   - 4박6일: 왕궁/국립이슬람사원/KLCC (메르데카 없음)
   - 원문을 한 글자 한 글자 확인 후 반영

4. **self-check**
   - [ ] 각 DAY의 모든 관광지가 해당 상품 원문 블록에 텍스트로 존재하는가?
   - [ ] 원문에 없는 "공통으로 있을 법한" 장소를 임의 추가하지 않았는가?
   - [ ] 같은 원문의 다른 상품과 비교 시 일정 차이점이 원문 그대로 반영되었는가?

### 6. validatePackage 경고가 뜨면 **반드시 원문 대조**

- `[W13 ERR-...] min_participants 원문 불일치` 경고 → 즉시 수정 (조작 방지)
- `[W14 ERR-...] notices_parsed 축약 의심` 경고 → 원문 확인 후 예시 복원
- `[W15 ERR-...] surcharges 기간 누락 의심` 경고 → `pkg.surcharges` 객체 배열 보강

---

## Step 1: 입력 파싱

사용자 입력에서 추출:
- **랜드사명** + **마진율%** (예: "투어폰 9%")
- **발권기한** (있으면 YYYY-MM-DD)
- **원문 본문** (나머지 전체)

## Step 2: 지역 감지

원문에서 아래 키워드를 탐색하여 지역 코드 판별:

| 키워드 | 지역 | 코드 |
|--------|------|------|
| 서안, 병마용, 화청지, 진시황, 화산(중국) | 서안 | XIY |
| 칭다오, 청도, 잔교, 태산, 노산 | 칭다오 | TAO |
| 장가계, 천문산, 천자산, 원가계, 보봉호 | 장가계 | DYG |
| 나트랑, 달랏, 판랑, 캄란, 빈펄 | 나트랑 | NHA |
| 라오스, 비엔티엔, 루앙프라방, 방비엥 | 라오스 | LAO |
| 몽골, 울란바토르, 테를지, 게르 | 몽골 | MNG |
| 다낭, 호이안, 후에, 바나힐 | 다낭 | DAD |
| 하노이, 하롱베이, 닌빈 | 하노이 | HAN |
| 보홀, 초콜릿힐, 타시에르 | 보홀 | BHO |
| 후쿠오카, 유후인, 벳부 | 후쿠오카 | FUK |

감지 결과를 사용자에게 확인: "**[서안] 지역으로 감지되었습니다. 맞습니까?**"

## Step 3: 라우팅 (3분기 자동 판단)

### 3-0. 어셈블러 존재 여부 확인

```bash
ls db/assembler_{region_code 소문자}.js 2>/dev/null
```

**존재**: → 경로 A  
**없음**: → 3-1로 진행

### 3-1. 해당 지역 기존 상품 수 조회 (🆕 N=3 자동 트리거)

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

### 경로 A — 어셈블러 존재 (XIY, TAO 등)

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

### 경로 B — 어셈블러 없음 (신규 지역)

**Step 3-1 결과에 따라 분기:**

- 🟡 **B-1 단독** (해당 지역 상품 1~2개일 때): 상품 등록만 수행, 어셈블러는 아직 생성하지 않음
- 🟢 **B-1 + B-2 동시 수행** (해당 지역 상품 3개 이상 시): 상품 등록 + 어셈블러 자동 생성

즉, **이번 상품이 해당 지역의 3번째 상품**이 되는 순간 어셈블러를 생성합니다:
- 기존 2개 + 이번 신규 1개 = 총 3개 상품 분석
- 공통 블록 추출 → BLOCKS 배열
- 상품 타입별 조합 → TEMPLATES 배열 (실속/품격 등)

#### B-1. 상품 등록 (즉시)
`/register-product` 커맨드의 규칙을 따른다:
1. `.claude/commands/register-product.md`를 **Read**하여 스크립트 생성 규칙 참조
2. `db/templates/insert-template.js`의 `createInserter()` 활용 (Zod 검증 내장)
3. `db/insert_{dest}_{id}_packages.js` 생성 → 사용자 확인 후 실행

#### B-2. 어셈블러 자동 생성 (🚨 생략 금지 — ERR-20260418-34)
상품 등록 완료 후, **반드시** 해당 지역 전용 어셈블러를 생성한다.
**"생략 가능"이라고 임의 판단 금지**. 경로 B는 B-1과 B-2를 **항상 함께** 수행:

1. `db/assembler_xian.js`를 **Read**하여 어셈블러 패턴 참조
2. 방금 파싱한 데이터에서 추출하여 `db/assembler_{region}.js` 생성:
   - **BLOCKS 배열**: 원문의 관광지/마사지/쇼/쇼핑 활동 → 블록 정의 (keywords 포함)
   - **TEMPLATES 배열**: 상품 유형별 코스 구성 (실속/품격 등)
   - **parseRawText()**: 해당 랜드사의 원문 포맷에 맞춘 파서
   - **가격 파싱**: 원문의 가격 패턴 (예: "599,000원" vs "1,259,-")
   - **포함/불포함**: 원문의 구분자 패턴
   - **호텔/식사 매칭**: hotel_pool, meal_pool
3. 중복 감지 로직은 `insertToDB()`에 내장 (assembler_xian.js와 동일)
4. 어셈블러 완성 후 사용자에게 보고:
   ```
   ✅ db/assembler_{region}.js 생성 완료
      블록: {N}개 (관광 {A}, 옵션 {B}, 쇼핑 {C})
      다음 등록부터 이 어셈블러가 자동 사용됩니다.
   ```

---

## 중복 방어 (모든 경로 자동)

- **어셈블러 경로**: `insertToDB()`에 내장된 중복감지 (destination + product_type + duration)
- **insert-template.js 경로**: `findDuplicate()` + `isSamePrice()` + Zod 검증
- 완전 동일 → **SKIP** (토큰 소모 없이 즉시 종료)
- 가격/기한 변경 → 기존 **archived** + 신규 등록

## 검증 (모든 경로)

INSERT 전에 `insert-template.js`의 `validatePackage()` 자동 실행:
- price_dates: YYYY-MM-DD 형식 + 양수 가격 + 최소 1개
- itinerary_data.days: 최소 1일 + day >= 1
- schedule[].activity: 빈 문자열 금지
- schedule[].type: 'transport' 금지 (TransportBar 크래시)
- highlights.remarks: string[] 강제 (객체 배열 금지)

---

## 🚨🚨🚨 Step 7: 등록 후 자동 감사 (**MANDATORY — 절대 생략 금지**)

### 메타 규칙 (ERR-process-violation)
> **사용자가 명시적으로 지시하지 않아도, INSERT 성공 즉시 반드시 `post_register_audit.js`를 실행하고 결과 리포트를 사용자에게 출력한다.**
> **"나중에 하세요" / "수동으로 하세요" 안내 금지. 모든 단계를 Agent가 완수한다.**
> **이 규칙 위반 시 ERR-process-violation 로 error-registry.md에 기록.**

### 자동 실행 체크리스트 (Agent self-check)
- [ ] INSERT 성공 직후 `node db/post_register_audit.js <inserted-id-1> <inserted-id-2> ...` 호출했는가?
- [ ] W1~W19 경고 결과를 사용자에게 보고했는가?
- [ ] 렌더 audit 결과(최저가/호텔/항공편 표시 여부)를 사용자에게 보고했는가?
- [ ] 경고가 있으면 자동 수정 가능한 것은 즉시 DB UPDATE 했는가? (meta 누락 / 과거 출발일 등)
- [ ] 사용자에게 "마지막 수동 단계" 안내 (어드민 status 변경 URL) 제공했는가?

### 구현 메커니즘
1. `db/templates/insert-template.js` 의 `run()` 함수는 INSERT 후 자동으로 `post_register_audit.js` 를 spawn 실행한다 (이미 통합됨).
2. 신규 작성하는 모든 `db/insert_*.js` 스크립트는 main() 끝에 `spawnSync('node', ['db/post_register_audit.js', ...ids])` 를 포함해야 한다.
3. 환경변수 `SKIP_POST_AUDIT=true` 로만 스킵 가능 (CI/테스트 목적).

INSERT 완료 후 **반드시** 다음 순서로 자동 실행:

### 7-1. ISR 캐시 무효화
상품 UPDATE/INSERT 후 ISR 캐시를 즉시 무효화하여 모바일 랜딩 페이지가 1시간 대기 없이 바로 갱신되도록 함.
- API route (`/api/packages` POST/PATCH)에서 `revalidatePath` 자동 호출 — 이미 구현됨
- DB 직접 수정 스크립트라면: `curl POST /api/revalidate { paths: ["/packages/[id]"], secret: $REVALIDATE_SECRET }`

### 7-2. 원문 ↔ 렌더 엔터티 대조 감사
```bash
node db/audit_render_vs_source.js <방금 등록한 package_id>
```

이 감사가 자동으로 체크:
- 원문의 모든 **가격**(1,249,000 등)이 렌더에 표시되는가?
- 원문의 모든 **호텔명**이 렌더에 표시되는가?
- 원문의 모든 **관광지(▶ 항목)**가 렌더에 표시되는가?
- 원문의 모든 **항공편 번호**가 렌더에 표시되는가?
- 일차 수가 일치하는가?

### 7-3. AI 감사 (선택, 고품질 검증)
```bash
node db/audit_render_vs_source.js <package_id> --ai
```
Gemini 2.5 Flash가 충실도 %와 왜곡 항목 자동 리포트 (약 $0.02/건).

### 7-4. 최종 리포트 사용자에게 출력

등록 완료 후 대화창에 다음 형식으로 보고:

```
✅ 상품 등록 완료
   - Package ID: xxxxx
   - 상품명: [title]
   - 모바일 URL: https://yeosonam.com/packages/[id]

🔍 자동 감사 결과:
   ✅ prices:    original 15개 / 렌더 15개 (100%)
   ✅ hotels:    original 3개 / 렌더 3개 (100%)
   ⚠️ landmarks: original 14개 / 렌더 13개 (1건 누락: "스카이로드")
   ✅ flights:   2개 일치
   ✅ days:      5일차까지 전부 렌더

⚠️ 액션 필요:
   - "스카이로드" 관광지가 렌더되지 않음 → attractions 테이블에 시드 필요
   - 자동 시드는 정책상 금지. 다음 중 선택:
     A) /admin/attractions 에서 수동 추가 (권장)
     B) /admin/attractions/unmatched 에서 CSV 다운로드 후 편집 업로드

📊 상세 리포트: scratch/audits/render_vs_source_YYYY-MM-DD_[id].md
```

통과 시 즉시 고객 노출. 이슈 있으면 어드민 수정 링크 제공.

### 7-5. Visual Regression 베이스라인 (대표 상품만, 선택)
상품이 대표 상품 라인업에 포함되면 Playwright 스냅샷 추가:
1. `tests/visual/fixtures.json` 에 `{ id, title, product }` 항목 추가
2. `npm run test:visual:update` 한 번 실행하여 베이스라인 생성
3. 이후 코드/데이터 변경 시 `npm run test:visual` 자동 회귀 탐지
