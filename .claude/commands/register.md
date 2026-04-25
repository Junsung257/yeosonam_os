# 통합 상품 등록

> **[자동 설정]** 이 커맨드는 파싱 정확도와 데이터 무결성을 위해 **Sonnet 4.6**으로 자동 처리됩니다.
> 사용자는 모델을 선택할 필요가 없습니다. `/register` 호출 → 자동 Sonnet 사용.

사용자가 입력한 원문과 랜드사/마진 정보입니다:

$ARGUMENTS

---

## 🆕 P0~P1 변경사항 (2026-04-27) — 반드시 준수

1. **`special_notes` 컬럼은 신규 등록에서 사용 금지.** 대신:
   - `customer_notes` — 고객 노출 OK 자유 텍스트 (모바일·A4 fallback 출처). W21 키워드 검증 적용.
   - `internal_notes` — 운영 전용 메모 (랜드사 협의사항·내부 알림). 고객 노출 차단.
2. **audit_status 는 4단계** (`blocked` / `warnings` / `info` / `clean`):
   - `clean` — 즉시 자동 승인.
   - `info` — W12 같은 안내성 경고만 존재. **자동 승인 OK** (기존 warnings 처럼 force 불필요).
   - `warnings` — 환각·축약 의심. `--force` 필요.
   - `blocked` — errors 존재. 수정 후 재감사.
3. **추가요금 통화 표기** — CRC `priceLabel` 이 KRW 는 `30,000원` / USD 는 `$30` / JPY 는 `¥3000` / CNY 는 `30元` 으로 자동 포맷. surcharges 객체 배열의 `currency` 필드만 정확히 채우면 됨.
4. **정액 마진 (commission_fixed_amount + commission_currency)** — 사장님이 입력에 "9만원" 같은 정액 표기 시:
   ```js
   const inserter = createInserter({
     landOperator: '랜드부산',
     commissionFixedAmount: 90000,   // 정액 KRW
     commissionCurrency: 'KRW',
     ticketingDeadline: '2026-04-29',
     destCode: 'TAO',
   });
   ```
   - 정액 모드 활성화 시 `commission_rate=0` 자동 설정 (상호배타)
   - `internal_notes` 에 정액 메모 중복 기재 불필요 (컬럼에 명시됨)
   - `dump_package_result.js` 에서 "commission: 90,000원/건 정액" 으로 자동 표기

---

## 🔴 Rule Zero: 원문 원본 불변 보존 (ERR-FUK-rawtext-pollution@2026-04-19)

**`raw_text` 필드에는 사용자가 붙여넣은 원문을 글자 하나 변형 없이 저장.**
- ❌ **금지**: 요약, 축약, 정규화, 오타 교정, 줄바꿈 정리, 섹션 재배치, 괄호 통일
- ✅ **허용**: BOM 제거, UTF-8 인코딩 정규화만
- 파서 요약본은 `parsed_data.summary` 또는 `product_summary`에 별도 저장
- `raw_text_hash = sha256(raw_text)`를 반드시 같이 저장 → 사후 변조 탐지

**왜 중요한가**: raw_text는 감사(E1~E4)의 기준점입니다. 요약본을 저장하면 "여행자보험 → 2억 여행자보험" 같은 주입이 raw_text와 inclusions 양쪽에 동시 존재하게 되어 **감사가 영구적으로 통과**해버립니다. 오늘 LB-FUK-03-01/02에서 실제로 발생했습니다.

**인서트 전 체크**:
```js
const crypto = require('crypto');
const raw_text = USER_INPUT_VERBATIM;   // 절대 가공 금지
const raw_text_hash = crypto.createHash('sha256').update(raw_text).digest('hex');
```

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
- `raw_text` 필드에 항상 원문 전체 보존 (Rule Zero 참고 — sha256 해시 동반 저장)

### 3-1. 보험/특전 금액 주입 절대 금지 (ERR-FUK-insurance-injection@2026-04-19)

- 원문에 **"2억"/"1억"/"여행자보험 N만원"** 같은 금액 표기가 **없으면** `inclusions`에 금액 삽입 금지
- ✅ 올바름: 원문이 `"여행자보험"` → DB도 `"여행자보험"`
- ❌ 금지: 원문이 `"여행자보험"` → DB에 `"2억 여행자보험"` (일반 패키지 관행을 무의식 차용)
- 동일 규칙이 **호텔 등급(4성급 등), 라운딩 홀 수(54H), 식사 횟수**에도 적용

**자동 탐지**: `post_register_audit.js`의 Rule E1이 금액 토큰 존재 여부를 raw_text와 대조.

### 3-2. `itinerary_data.days[].regions`는 원문 "지역/일자" 컬럼 1:1 매핑 (ERR-FUK-regions-copy@2026-04-19)

- 여러 상품(정통/품격 등)을 한 원문에서 파생할 때 **Day별 regions 배열을 복사해 쓰면 안 됨**
- 각 상품의 원문 "지역" 칸에 적힌 이동 경로 그대로 저장
  - 예: 품격 Day2 = `"사세보 → 나가사키 → 사세보"` → `["사세보","나가사키","사세보"]`
  - 정통 Day2 = `"사세보"` → `["사세보"]`
- 모든 Day에서 regions가 완전히 같은 경우 `post_register_audit` Rule E2가 경고 발생

### 3-3. `excluded_dates` ∩ `surcharges` 날짜 교집합 금지 (ERR-FUK-date-overlap@2026-04-19)

- **출발 불가능한 날짜에 추가요금을 받는다는 건 모순**
- 원문에 "항공제외일 3/18~20"과 "일본공휴일 추가요금 3/18~20"이 동시에 있으면:
  - `excluded_dates`에만 넣고 `surcharges`에서는 제외
  - 또는 반대. 둘 다 넣지 말 것
- 자동 탐지: Rule E3

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
- [ ] **[W26 — ERR-HSN-render-bundle]** `inclusions` 배열의 각 항목이 **콤마 없는 단일 토큰**인가? `"항공료, 택스, 유류세"` 한 문자열 금지 → `["항공료","택스","유류세",...]` 로 분리해야 A4 포스터 아이콘 매칭 정상.
- [ ] **[W27 — ERR-HSN-render-bundle]** 각 일차의 `schedule` 에서 `type:'flight'` activity 가 **하루 최대 1개**이고, activity 텍스트가 `"출발지 출발 → 도착지 도착 HH:MM"` (→ 토큰 포함 단일 문장) 포맷인가? 출발·도착을 2개 flight 로 분리 금지 → 모바일 히어로 도착 시간 "—" + DAY 타임라인 이중 렌더 유발.
- [ ] **[W28 — ERR-HSN-render-bundle]** 호텔 관련 activity 는 `"호텔 투숙 및 휴식"` 고정 문구만 허용. `"호텔 체크인 및 휴식"` / `"라운드 후 석식 및 호텔 투숙"` 같은 **앞절 붙이기 금지** — DetailClient 가 "호텔.*투숙" 매칭 시 activity 전체를 스킵해 앞부분 정보 손실 유발. 필요한 경우 별도 normal activity 로 분리 (예: `"라운드 후 석식"` → 별행 + `"호텔 투숙 및 휴식"` 은 기본 호텔 카드에서 자동 표시).
- [ ] **[W29 — ERR-HSN-render-bundle]** `notices_parsed` PAYMENT/RESERVATION 타입에 **"출발N일전"** 형태(예: "항공 발권후(출발21일전) 취소시") 가 있으면 standard-terms 가 날짜 자동 주입할지 확인. negative lookbehind 적용됐지만 레거시 데이터는 원문 편집 권장 (Zero-Hallucination 방어).
- [ ] **[W30 — ERR-HET-render-over-split@2026-04-21]** `▶` 접두사 activity 에 `(…)` 괄호가 있을 때, **괄호 안이 서브 관광지 리스트가 아니라 체험/부연설명/연혁**이면 괄호 안 콤마를 `,` 대신 `·` (중점) 으로 쓸 것. 또는 괄호 자체를 제거하고 `note` 필드에 넣을 것. `splitScheduleItems` 가 W30 휴리스틱(suffix 유무 + 서술 키워드)으로 자동 방어하지만 **원문에 `(체험 A, B, C)` 형태가 나오면 Agent 가 애초에 `·` 로 변환 후 INSERT** 하는 것이 가장 안전.
   - ❌ `'▶유목민 생활 체험 (초원 오토바이, 활쏘기, 몽골족 간식)'` — 과다 분리 유발
   - ✅ `'▶유목민 생활 체험 (초원 오토바이·활쏘기·몽골족 간식)'`
   - ✅ `'▶왕소군묘 (2000년 역사·중국 4대 미인 중 한 명·평화의 상징)'`
   - ✅ `'▶샹사완 사막 액티비티 체험 (써핑카트·사막낙타체험·모래썰매)'`
   - 예외(분리 OK): `'▶호이안 구시가지 (풍흥의 집, 일본내원교, 떤키의 집) 유네스코 지정 전통거리 관광'` — 괄호 뒤 suffix 있고 괄호 안은 진짜 서브 관광지.

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

## 🆕 Step 2.5: IR 파이프 (Canary, 2026-04-21 도입)

Phase 1.5 로 도입된 **Intake Normalizer (IR) 파이프** 가 기본 권장 경로가 됩니다.
원문 → Zod-IR → pkg 3단 구조로 환각·축약·조작을 구조적으로 차단합니다.

### IR 파이프 사용법 — 3가지 엔진 선택 가능

```bash
# 0) 서버 실행 필수
npm run dev

# [A] DIRECT 엔진 — Claude Code 세션(이 대화)이 직접 IR 작성, LLM 호출 0원 ⭐ 추천
#   사장님이 /register <원문> 하면 Agent가 IR JSON을 scratch/*.json 에 쓴 다음:
node db/register_via_ir.js <raw.txt> --engine=direct --ir=<scratch/ir.json> --insert

# [B] Gemini 2.5 Flash 엔진 — 저렴·빠름 (~0.003$/건)
node db/register_via_ir.js <raw.txt> --operator=<랜드사> --margin=<N> --engine=gemini --dry-run
node db/register_via_ir.js <raw.txt> --operator=<랜드사> --margin=<N> --engine=gemini --insert

# [C] Claude Sonnet 4.6 API — 프리미엄 품질 (~0.03$/건)
node db/register_via_ir.js <raw.txt> --operator=<랜드사> --margin=<N> --engine=claude --insert
```

### 엔진 비교 및 추천

| 엔진 | 비용 | 품질 | 배치 | 추천 상황 |
|---|---|---|---|---|
| **direct** (Claude Code 세션) | **0원** | **95%+** | ❌ 대화형 | **월 ~30건까지, 최고 품질**. 사장님 현재 규모에 최적 |
| gemini (Flash) | 0.003$/건 | 85% | ✅ | 자동화·배치·반복 상품 |
| claude (Sonnet API) | 0.03$/건 | 95% | ✅ | 중요 상품·복잡 원문 |

### 경로 최종 결정 플로우

| 상황 | 경로 |
|---|---|
| 어셈블러 존재 (XIY/TAO/DAD) | **경로 A (어셈블러)** — 무과금 패스트트랙 유지 |
| 어셈블러 없음 + Claude Code 대화형 (사장님 `/register` 호출) | **IR direct** (0원, 최고 품질) |
| 어셈블러 없음 + 자동화·배치 필요 | **IR gemini** (저렴) |
| 의심 상품·복잡 원문 | **IR claude** (프리미엄 API) |
| LLM 불가 + 급함 | **레거시 수기 insert 스크립트** (경로 B-1) |

### Direct 모드 Agent 워크플로우 (사장님 `/register` 호출 시)

사장님이 `/register <원문>` 하면:
1. Agent 가 `NormalizedIntakeSchema` 를 읽고 **IR JSON 을 직접 작성**
2. `scratch/ir-<region>-<timestamp>.json` 에 저장
3. `node db/register_via_ir.js <raw.txt> --engine=direct --ir=<scratch/ir.json> --insert` 실행
4. /api/register-via-ir 가 Zod 검증 → pkg 변환 → INSERT → post-audit
5. 결과값 한 화면 리포트

→ **LLM API 호출 0원 · 사장님 대기 시간 2~5분 · 품질 95%+**

### 신규 지역 사전 준비
```bash
# 어셈블러 BLOCKS 가 있으면 attractions 테이블 부트스트랩 (1회)
node db/bootstrap_attractions_from_assemblers.js --region=<지역> --insert
# 그 후 /admin/attractions 에서 long_desc·사진 수기 보완
```

### IR 파이프 산출물
- `normalized_intakes` 테이블에 IR 원본 저장 (status: draft→converted)
- `travel_packages` 에 pkg INSERT
- `unmatched_activities` 에 lookup 실패 세그먼트 자동 큐잉
- 자동 약관 조립 (terms-library resolver) 으로 `notices_parsed.auto` 채움

### 파일 맵 (Phase 1.5 자산)
- `src/lib/intake-normalizer.ts` — Zod 스키마 (7-kind segment)
- `src/lib/normalize-with-llm.ts` — Claude Sonnet 4.6 tool use
- `src/lib/ir-to-package.ts` — 기계 변환
- `src/lib/terms-library.ts` — 자동 약관 resolver
- `src/app/api/register-via-ir/route.ts` — API
- `db/register_via_ir.js` — CLI 래퍼
- `db/bootstrap_attractions_from_assemblers.js` — 신규 지역 부트스트랩

---

## 🆕 Step 2.7: 파싱 직후 Pre-INSERT Self-Check (W26~W29 재실행 방지)

> **목적**: INSERT 제출 전에 Agent 가 **스키마 위반을 선제 검출**해서 재실행 사이클을 막는다.
> 2026-04-21 호화호특 등록 시 W28 에 걸려 INSERT 1회 낭비 (~60초 + 5K 토큰).
> 이 체크를 스크립트 작성 중에 강제하면 재발 차단.

Agent 는 `inserter.run(packages)` 를 호출하기 **직전** 아래 5개를 self-check:

```js
for (const p of packages) {
  // 1) W26 — inclusions 콤마 포함 단일 문자열 금지
  for (const inc of (p.inclusions || [])) {
    if (typeof inc === 'string' && inc.split(/,(?=\s*\D)/).length > 1)
      throw new Error(`[W26 self-check] inclusions "${inc}" 콤마 포함 — 개별 배열로 분리`);
  }
  // 2) W27 — 하루 flight 여러개면 반드시 "→" 토큰
  const days = Array.isArray(p.itinerary_data) ? p.itinerary_data : (p.itinerary_data?.days || []);
  for (const d of days) {
    const flights = (d.schedule || []).filter(s => s.type === 'flight');
    if (flights.length > 1 && flights.some(f => !/→|↦|⇒/.test(f.activity || '')))
      throw new Error(`[W27 self-check] Day ${d.day} flight ${flights.length}개 but "→" 토큰 누락`);
  }
  // 3) W28 — "호텔 투숙/휴식" 앞절 붙이기 금지 ("석식 후 호텔 투숙 및 휴식" 같은 활동)
  for (const d of days) {
    for (const s of (d.schedule || [])) {
      if (s.type !== 'normal' || !s.activity) continue;
      if (/호텔\s*(?:투숙|휴식|체크인|체크 인)/.test(s.activity) && !/^[*\s]*호텔/.test(s.activity))
        throw new Error(`[W28 self-check] Day ${d.day} "${s.activity}" — 앞절 붙이기 금지. 별도 normal 로 분리`);
    }
  }
  // 4) W29 — notices_parsed PAYMENT 에 "출발N일전" 있으면 surcharges 날짜 주입 경계 재확인
  // 5) raw_text >= 50자 + raw_text_hash 동반
  if (!p.raw_text || p.raw_text.length < 50)
    throw new Error('[RuleZero self-check] raw_text 누락');
}
```

**이 블록을 등록 스크립트 상단에 inline 로 넣거나**, 공용화되면 `insert-template.js` 의 `preflightCheck(packages)` 로 이관한다.

---

## Step 3: 라우팅 (3분기 자동 판단)

> **🟢 사장님 안내**: `/register`만 부르면 **Agent가 자동으로 분기**합니다. 어셈블러 존재 여부, 기존 상품 수, 중복 여부 모두 자동 판단. 사장님이 어셈블러 호출법을 외울 필요 없음.

### 3-0. 어셈블러 존재 여부 확인 (Agent 자동 실행)

```bash
ls db/assembler_{region_code 소문자}.js 2>/dev/null
```

**현재 어셈블러 존재 지역** (자동 갱신 안 됨 — `ls db/assembler_*.js` 로 항상 재확인):
- `assembler_xian.js` → 서안 (XIY)
- `assembler_qingdao.js` → 칭다오 (TAO)
- `assembler_danang.js` → 다낭/호이안 (DAD) ← 2026-04-20 추가

**존재**: → 경로 A (즉시 어셈블러 실행, MD 추가 분석 최소화 — 토큰 ~90% 절감)
**없음**: → 3-1로 진행

### 3-0-a. 중복 자동 SKIP (모든 경로 공통)

`insert-template.js`의 `findDuplicate()` + `isSamePriceDates()` + `isSameDeadline()`이 자동 검사:
- **동일 랜드사 + destination + product_type + duration + 출발일 겹침 + 가격 동일 + 마감 동일** → 즉시 SKIP (토큰 0)
- 가격만 변경 → 기존 archived + 신규 INSERT
- 완전성 점수 -20% 이상 하락 → `pending_replace` 보류 (라이브 교체 차단, ERR-KUL-safe-replace)

→ 사장님이 같은 원문을 두 번 붙여넣어도 안전. 자동 SKIP.

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

#### B-2. 어셈블러 자동 부트스트랩 (🆕 P3 #1, 2026-04-27 도입)

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
- **[W-final F3]** raw_text 50자 이상 + raw_text_hash 일치 강제 (ERROR — INSERT 차단)

---

## 🧠 Step 6.5: Agent Self-Audit (MANDATORY, 제로-코스트)

> **목적**: Gemini 유료 호출 없이 Claude Code 세션(Agent 본인)이 파싱 직후
> self-audit 을 수행한다. **확증 편향을 막기 위해 반드시 Reflection + CoT 강제**.
>
> **시점**: 파싱 완료 → validatePackage 통과 → **Agent self-audit** → INSERT
>
> **비용**: 0 (이 세션의 Claude 사고 능력 사용)
>
> **왜 이게 효과적**: 원문을 가장 잘 아는 건 지금 세션에서 파싱한 Agent 본인.
> 외부 API로 재감사하는 것보다 같은 컨텍스트에서 self-check 하는 것이 정확하고 빠름.

### 🔒 확증 편향 방지 — 반드시 지킬 것

AI 가 "내가 쓴 답이 맞냐?" 라고 자문하면 99% 합리화합니다. 이를 막기 위해:

1. **raw_text 직접 인용 강제**: "원문에 있다"고 답하기 전 **원문에서 해당 문구를 verbatim 복사**할 것
2. **Chain-of-Thought 강제**: 각 claim 마다 `<thinking>` 블록으로 단계별 검증 과정 기록
3. **근거 없으면 `supported: false`**: "아마 있을 것 같다" 금지. 원문에 **없으면 없다고** 답할 것

### Self-Audit 프로토콜 (Agent 가 따라야 하는 절차)

파싱된 pkg JSON 에서 아래 필드별로 **검증 대상 claim** 을 뽑고, 각 claim 마다:

1. **원문 인용** — raw_text 에서 claim 의 근거 문구를 verbatim 찾아 복사
2. **생각 사슬** — `<thinking>` 으로 "이 문구가 해당 claim 을 뒷받침하는가?" 검토
3. **판정** — `supported: true | false | null` (null 은 원문 모호할 때만)

검증 필수 필드:

| 필드 | 타겟 에러 | severity |
|---|---|---|
| `min_participants` | ERR-20260418-01 (템플릿 4 조작) | HIGH |
| `ticketing_deadline` | ERR-date-confusion (발권 vs 배포일 혼동) | HIGH |
| `inclusions` 중 **금액/등급/N박 토큰** | ERR-FUK-insurance-injection ("2억 여행자보험") | CRITICAL |
| `surcharges` 기간+금액 | ERR-20260418-03/14 | HIGH |
| `notices_parsed` 중 **PAYMENT 타입** | ERR-FUK-clause-duplication | CRITICAL |
| `itinerary_data.days[i].regions` | ERR-KUL-02/03, ERR-FUK-regions-copy (DAY 교차) | HIGH |
| `optional_tours[]` region 정합 | ERR-KUL-04 | MEDIUM |

### 출력 형식 (INSERT payload 의 `agent_audit_report` 필드에 저장)

```json
{
  "parser_version": "register-v2026.04.21-sonnet-4.6",
  "ran_at": "2026-04-21T12:00:00Z",
  "claims": [
    {
      "id": "min_participants",
      "field": "min_participants",
      "severity": "HIGH",
      "text": "최소 출발인원 10명",
      "evidence": "원문 3줄: '성인 10명 이상 출발 가능'",
      "supported": true,
      "note": null
    },
    {
      "id": "inclusions:2",
      "field": "inclusions",
      "severity": "CRITICAL",
      "text": "포함: 2억 여행자보험",
      "evidence": null,
      "supported": false,
      "note": "원문에는 '여행자보험' 만 있음. '2억' 표기 없음 — 금액 환각 의심"
    }
  ],
  "overall_verdict": "warnings",
  "unsupported_critical": 1,
  "unsupported_high": 0
}
```

### 판정 결과 → 액션

- **모든 claim supported: true** → `overall_verdict: "clean"`, 바로 INSERT 진행
- **CRITICAL 하나라도 `supported: false`** → `overall_verdict: "blocked"`, **INSERT 중단 + 재파싱**
- **HIGH `supported: false` 만 있음** → `overall_verdict: "warnings"`, INSERT 진행 하되 post-audit 가 warnings 로 승격
- **unclear(null) 만 있음** → `overall_verdict: "warnings"`, 사용자에게 원문 확인 요청

### 구현 메커니즘

- `db/templates/insert-template.js` 의 INSERT payload 에 `agent_audit_report` 필드가 추가되어 있음
- Agent 가 이 JSON 을 생성해서 pkg 객체에 얹어 `createInserter().run()` 호출
- DB 에 영속 → `post_register_audit.js` 가 이 보고를 읽어 warnings 로 승격 (Gemini 호출 없이)

### 🚫 금지 사항

- 외부 API 호출 (Gemini/OpenAI) — 이 단계는 순수 Claude 세션 내에서만
- "보통 이 정도 상품은 이럴 것이다" 라고 상식 추론 — 반드시 raw_text 만 근거
- claim 을 건너뛰기 — 위 표의 모든 타겟 필드를 반드시 처리

---

## 🚨🚨🚨 Step 7: 등록 후 자동 감사 (**MANDATORY — 절대 생략 금지**)

### 메타 규칙 (ERR-process-violation + ERR-process-violation-auto-approve@2026-04-21)
> **사용자가 명시적으로 지시하지 않아도, INSERT 성공 즉시 반드시 `post_register_audit.js`를 실행하고,
> `audit_status=clean` 이면 **자동으로 approve API 까지 호출해 `status='active'` 활성화 + 최종 결과값 도출까지 완수**한다.**
> **"어드민에서 직접 승인하세요" / "나중에 하세요" / "수동 단계" 안내 금지. 모든 단계를 Agent 가 완수한다.**
> **사장님은 원문만 붙여넣는다. 등록-감사-승인-결과값 전부 Agent 책임.**
> **이 규칙 위반 시 ERR-process-violation* 계열로 error-registry.md 에 기록.**

### 자동 실행 체크리스트 (Agent self-check — 전부 수행 필수)
- [ ] INSERT 성공 직후 `node db/post_register_audit.js <inserted-id-1> <inserted-id-2> ...` 호출했는가? (insert-template.js `run()` 이 자동 spawn)
- [ ] W1~W19 경고 결과를 사용자에게 보고했는가?
- [ ] 렌더 audit 결과(최저가/호텔/항공편 표시 여부)를 사용자에게 보고했는가?
- [ ] 경고가 있으면 자동 수정 가능한 것은 즉시 DB UPDATE 했는가? (meta 누락 / 과거 출발일 등)
- [ ] **[필수] audit_status=clean 상품은 Agent 가 `PATCH /api/packages/[id]/approve {action:'approve'}` 호출해 `status='active'` 활성화했는가?** (7-A 참조)
- [ ] **[필수] 활성화 후 DB에서 최종 결과값(status/price/판매 URL/A4 URL/출발일 수/호텔/항공편) 조회해 한 화면 리포트로 출력했는가?** (7-B 참조)
- [ ] **[필수] 방금 등록한 상품의 시각·텍스트 회귀 baseline 이 생성됐는가?** (7-D 참조 — dev 서버 켜져 있을 때만 자동 실행)
- [ ] audit_status=warnings 상품만 사장님께 "감사 리포트 확인 후 `force=true` 로 승인하시겠습니까?" 1회 질문. audit_status=blocked 는 수정 후 재감사 필수.

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

### 7-3. AI 감사 (E5/E6) — **opt-in 전용** (W-final 2026-04-21 최종)

**기본 정책: Gemini 는 호출하지 않음.** 감사는 Agent Self-Audit (Step 6.5) 가 제로-코스트로 수행.
Gemini 는 **두 번째 의견이 필요할 때만** 사용자가 명시적으로 켜서 호출.

**ON 강제** (유료 호출 수반):
- `--ai` 또는 `POST_AUDIT_AI=1`
- 월 비용 캡 (`POST_AUDIT_AI_MONTHLY_CAP_KRW` 기본 5000원/월) 도달 시 자동 OFF

**OFF 기본**:
- 명시 안 하면 OFF. Agent self-audit + E1~E4 구조 감사 + RAG + 렌더 검증만 수행

**언제 Gemini 를 켜는가**:
- Agent self-audit 결과가 의심스러울 때 (외부 교차검증 필요)
- 신규 지역 첫 등록 후 품질 샘플링
- 사장님이 "AI 감사 켜서" 명시

**비용**:
- E5 (렌더 cross-check) — 상품 1건당 ~0.5원, 90초
- E6 (CoVe claim 검증) — 상품 1건당 ~0.3원, 5~10초
- 월간 누적은 [scratch/audit_ai_usage.json](scratch/audit_ai_usage.json)에 기록
- 80% 소진 시 경고, 100% 도달 시 자동 OFF

**E5 vs E6 차이**:
- **E5** (ai_audit_helper.js) — 원문 ↔ **렌더링 HTML** 전체 대조. "송영비 경고 증발" 같은 축약 잡음.
- **E6** (cove_audit.js) — 원문 ↔ **DB 필드별 claim** 하나씩. "2억 여행자보험" 같은 구체 환각 타겟.

**타겟 에러 (W3)**:
- ERR-20260418-01 (min_participants 템플릿 기본값)
- ERR-20260418-02 (notices_parsed 예시 축약)
- ERR-KUL-02/03 (DAY 교차 오염)
- ERR-FUK-insurance-injection ("2억 여행자보험" 환각)
- ERR-FUK-regions-copy (Day별 regions 복사)
- ERR-date-confusion (ticketing_deadline 오매핑)

### 7-D. 시각·텍스트 회귀 Baseline 자동 생성 (ERR-HET-visual-regression-infra@2026-04-22)

등록된 상품의 모바일 랜딩 페이지가 **다음 코드 변경 시 렌더 회귀**로 깨지지 않도록 playwright 기반 baseline 을 즉시 생성.

**자동 실행**: `insert-template.js` Step 7-D 가 `db/generate_visual_baseline.js` 호출.
1. `travel_packages` 에서 `short_code`, `title` 조회
2. `tests/visual/fixtures.json` upsert (product=short_code 기준 dedup)
3. `UPDATE_BASELINE=1 npx playwright test tests/visual --grep <short_code> --update-snapshots --workers=1`
4. baseline 파일 생성: `tests/visual/packages.spec.ts-snapshots/<product>-mobile-*.png` + `tests/visual/baselines/<product>-text.hash`

**실행 조건**:
- dev 서버(localhost:3000) 가 응답 중일 때만 실행 (2초 health check). 꺼져 있으면 자동 skip + 수동 재실행 안내.
- `SKIP_VISUAL_BASELINE=1` 로 명시적 스킵 가능.
- baseline 생성 실패가 등록 프로세스를 막지 않음 (status=active 유지).

**재발 방지 목적 — 오늘 호화호특에서 발견된 렌더 오류 시리즈**:
- ERR-HET-single-charge-misclass (싱글차지 "기간별 추가요금" 오분류)
- ERR-HET-attraction-global-dedup (관광지 카드 중복)
- ERR-HET-mobile-shopping-missing (모바일 쇼핑센터 섹션 누락)
- ERR-HET-a4-shortdesc-duplicate (A4 short_desc 반복)

baseline 있으면 위 오류들이 다음 코드 변경 시 **텍스트 해시/픽셀 차이** 로 자동 감지되어 회귀 차단.

**수동 실행** (dev 서버 재시작 후 등):
```bash
npm run dev  # 다른 터미널
node db/generate_visual_baseline.js <insertedId1> <insertedId2>
# 또는 전체 재생성
UPDATE_BASELINE=1 npm run test:visual -- --workers=1
```

---

### 7-4. 감사 게이트 (자동 blocking)

`post_register_audit.js` 결과에 따라 `audit_status` 자동 결정:
- **clean** (🟢): 즉시 승인 가능
- **warnings** (🟡): 어드민이 `force=true` 로 승인해야 고객 노출
- **blocked** (🔴): 수정 후 재감사 필수. 승인 API 자체가 409 반환

게이트 우회 불가:
- `/api/packages/[id]/approve` PATCH가 audit_status 체크
- 고객 노출 쿼리(`getApprovedPackages`, `/packages`, `/packages/[id]`)가 `audit_status.neq.blocked` 이중 가드

### 7-A. 자동 승인 (CLEAN 전용, MANDATORY) — **ERR-process-violation-auto-approve@2026-04-21**

**post-audit 결과 `audit_status === 'clean'` 인 모든 상품에 대해 Agent 가 즉시 수행.**
**`insert-template.js` run() 이 post-audit 성공 시 자동으로 `db/approve_package.js` 를 spawn** — Agent 별도 호출 불필요.

```bash
# insert-template.js 가 자동 실행하는 것 (수동으로는 이렇게):
node db/approve_package.js <id1> <id2> ...             # CLEAN 만 active 로 승격
node db/approve_package.js --force <id1> <id2> ...     # warnings 강제 승인
```

- **`db/approve_package.js` 는 Supabase 직접 UPDATE** → dev 서버(localhost:3000) 다운 중이어도 작동 (2026-04-21 호화호특 등록 시 사고 재발 방지).
- **(2026-04-22 보강 — ERR-process-violation-dump-after-approve)** `approve_package.js` 는 승격 성공 건에 대해 내부에서 자동으로 `dump_package_result.js` 를 spawn 해 **active 상태 풀덤프**까지 수행. Agent 가 `approve --force <ids>` 한 줄만 부르면 `UPDATE + 풀덤프` 가 원자적으로 끝남 — 별도 재덤프를 기억할 필요 없음. 우회: `SKIP_DUMP_RESULT=1`.
- **blocked** 상품은 자동으로 skip. 수정 → 재감사 → 재승인 수동 루프.
- **warnings** 상품은 기본 skip. 사장님에게 감사 리포트 핵심 3줄 요약 + `--force` 여부 1회 질문 후 재실행.
- `/api/packages/[id]/approve` REST 엔드포인트는 여전히 유효 (어드민 UI 에서 사용).

### 7-B. 최종 결과값 도출 (MANDATORY)

승인 후 DB 에서 방금 등록한 상품들의 **실제 판매 상태값**을 조회해 사장님이 한눈에 확인 가능하게 출력.

```sql
SELECT short_code, title, status, price, commission_rate,
       jsonb_array_length(price_dates) AS date_count,
       accommodations,
       itinerary_data->'meta'->>'flight_out' AS flight_out,
       itinerary_data->'meta'->>'flight_in'  AS flight_in,
       audit_status
  FROM travel_packages
 WHERE id IN (<inserted-ids>);
```

### 7-C. 최종 리포트 사용자에게 출력 (한 화면)

위 7-A, 7-B 를 마친 **후** 다음 형식으로 출력:

```
✅ 상품 등록·활성화 완료
   - 이번 경로: A (어셈블러 사용) / B-1 (수동 등록) / B (B-1 + B-2 어셈블러 자동 생성)
   - AI 감사: OFF (디폴트) / ON (POST_AUDIT_AI=1)

📦 판매 상태 (auto-approved)
   ┌────────────────┬───────────────┬────────┬──────────┬────────┬──────────────────┐
   │ short_code     │ 최저가        │ 출발일  │ 항공편    │ audit  │ status           │
   ├────────────────┼───────────────┼────────┼──────────┼────────┼──────────────────┤
   │ BA-TXN-04-01   │ 849,000원     │ 3건     │ BX3615   │ 🟢clean│ ✅ active (판매중)│
   └────────────────┴───────────────┴────────┴──────────┴────────┴──────────────────┘

🔗 고객 노출 URL
   - 모바일: http://localhost:3000/packages/<id>
   - A4 포스터: http://localhost:3000/admin/packages/<id>/poster

🔍 감사 결과 (E1~E4 + 렌더):
   ✅ prices · hotels · flights · days 전부 통과

💰 AI 감사 비용: 0원 / 5,000원 월캡 (E5 0회, E6 0회)
```

**사장님께 "어드민 가서 승인해주세요" 안내 금지.** 이미 Agent 가 승인 완료한 상태로 보고.
warnings 가 있는 경우에만 감사 리포트 요약 + `force=true` 여부 질문.

**다음 등록을 빠르게 만드는 한 줄 안내** (사장님이 알아야 함):
- 같은 지역 추가 등록 시 그냥 `/register`만 다시 부르면 됨 (Agent 자동 라우팅)
- 같은 원문 두 번 → 자동 SKIP (토큰 0)
- 의심 상품에만 AI 감사 켜기: `--ai` 또는 `POST_AUDIT_AI=1`

### 7-5. Visual Regression 베이스라인 (대표 상품만, 선택)
상품이 대표 상품 라인업에 포함되면 Playwright 스냅샷 추가:
1. `tests/visual/fixtures.json` 에 `{ id, title, product }` 항목 추가
2. `npm run test:visual:update` 한 번 실행하여 베이스라인 생성
3. 이후 코드/데이터 변경 시 `npm run test:visual` 자동 회귀 탐지
