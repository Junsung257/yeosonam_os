# 상품 등록 오류 이력 (Error Registry)

> **목적**: 상품 등록 과정에서 발생한 오류를 append-only로 누적. `/register` 커맨드가 이 파일을 자동 참조하여 동일 오류 재발을 차단.
>
> **사용법**:
> - 오류 발견 → 아래 포맷으로 새 엔트리 append (ID는 `ERR-YYYYMMDD-NN`)
> - 오류 해결 → `상태: FIXED` + 방지 메커니즘 명시
> - `/register` 실행 시 Agent가 최근 10건 체크리스트로 self-check

---

## 엔트리 포맷

```markdown
## ERR-YYYYMMDD-NN: [한 줄 제목]

- **발견일**: YYYY-MM-DD
- **발생 상품**: [short_code] ([상품명])
- **원문 vs 결과**: 원문 "..." → DB/화면 "..."
- **카테고리**: AI 파싱 | 렌더링 | 데이터스키마 | 매칭 | 검증 | 중복감지
- **근본 원인**: ...
- **해결책**:
  - 즉시: ...
  - 구조적: ...
- **검증 규칙**: (validatePackage의 W번호)
- **상태**: OPEN | IN_PROGRESS | FIXED
- **재발 방지**: ...
```

---

## 초기 등록 오류 (9건)

### ERR-20260417-01: A4 포스터 요일 병합 환각 ("일-수")

- **발견일**: 2026-04-17
- **발생 상품**: 북해도 핵심알짜팩 2박3일 (투어폰)
- **원문 vs 결과**: 원문 일(0)+화(2) 요일 → 화면 "일-수" (연속 범위로 오표시)
- **카테고리**: 렌더링
- **근본 원인**: `groupForPoster()`의 sunToWed(0,1,2,3) 범위 내 2개 이상 요일 존재 시 무조건 "일-수" 라벨. 일(0)+화(2)만 있어도 "일-수"로 렌더링.
- **해결책**:
  - 구조적: `isConsecutive()` 헬퍼 추가 — 연속 요일이면 범위("일-화"), 불연속이면 열거("일,화")
- **검증 규칙**: 없음 (렌더링 로직)
- **상태**: FIXED (2026-04-17)
- **재발 방지**: `src/lib/price-dates.ts:194` `isConsecutive` 로직

---

### ERR-20260417-02: confirmed 플래그 하드코딩 false

- **발견일**: 2026-04-17
- **발생 상품**: 북해도 (투어폰)
- **원문 vs 결과**: 원문 "♥출확♥ 4/28" → DB `confirmed: false`
- **카테고리**: AI 파싱
- **근본 원인**: `tiersToDatePrices()`에서 `confirmed: false` 하드코딩. tier.note 정규식 매칭 없음.
- **해결책**:
  - 구조적: `tier.note`에 `/출확|출발확정/` 매칭 시 `confirmed: true` 설정
- **검증 규칙**: (향후 W 추가 검토)
- **상태**: FIXED (2026-04-17)
- **재발 방지**: `src/lib/price-dates.ts`, `db/templates/insert-template.js`의 `tiersToDatePrices()`

---

### ERR-20260417-03: 콤마 관광지 매칭 실패

- **발견일**: 2026-04-17
- **발생 상품**: 북해도 (투어폰)
- **원문 vs 결과**: "▶오타루운하, 키타이치가라스, 오르골당" → 첫 번째만 매칭, 나머지 미매칭
- **카테고리**: 매칭
- **근본 원인**: `matchAttraction()` 단일 활동만 처리. 콤마로 묶인 여러 관광지를 분리하지 않음.
- **해결책**:
  - 구조적 1: `splitScheduleItems()` — 등록 시 콤마 포함 activity를 개별 schedule item으로 분리
  - 구조적 2: `matchAttractions()` (복수형) 추가 — 렌더러에서도 콤마 분리 매칭
- **검증 규칙**: W12 (`splitScheduleItems` 필요성 경고)
- **상태**: FIXED (2026-04-17, 렌더러 전환은 P2c/P2d에서 진행)
- **재발 방지**: `db/templates/insert-template.js` `splitScheduleItems`, `src/lib/attraction-matcher.ts` `matchAttractions`

---

### ERR-20260417-04: 중복 감지 빈 배열 오판

- **발견일**: 2026-04-17
- **발생 상품**: 칭다오 쉐라톤 2박 3일 (투어폰)
- **원문 vs 결과**: 신규 상품(399,000원)이 기존 상품(269,000원)과 다른데도 SKIP 처리됨
- **카테고리**: 중복감지
- **근본 원인**:
  1. `isSamePrice()`가 `price_tiers: []` 빈 배열끼리 비교 시 `'' === ''` → true 오판
  2. `findDuplicate()`가 출발일 겹침을 확인하지 않아 다른 시즌 행사도 중복으로 처리
- **해결책**:
  - 구조적 1: `isSamePriceDates()` — price_dates 기반 비교 (date+price만, confirmed/note 무시)
  - 구조적 2: `findDuplicate()` 개선 — 출발일 집합 교집합 > 0일 때만 중복
  - 구조적 3: 로그에 겹치는 출발일 개수/목록 출력 (디버깅)
- **검증 규칙**: 없음 (중복감지 로직)
- **상태**: FIXED (2026-04-18)
- **재발 방지**: `db/templates/insert-template.js`, `db/assembler_xian.js`, `db/assembler_qingdao.js`의 `findDuplicate` + `isSamePriceDates`

---

### ERR-W-FINAL-2026-04-21: W-final 통합 패스 — 6개 구조적 강화 (Agent self-audit · CRC 확장 · Rule Zero hard-enforce · API hard-block · drift 감사)

- **발견일**: 2026-04-21 (Gemini 제언 + 사장님 지시 통합)
- **카테고리**: 아키텍처 (최종 디벨롭)
- **배경**: W1(CRC)·W3(instructor+CoVe) 완료 후에도 유료 API 의존·pkg 직접 접근 잔재·Rule Zero 미강제·신규 DB 컬럼 drift 가능성이 남음. 사장님 지시 "잔오류 근본 끊기 + 비용 0".
- **적용된 6가지 강화**:
  - **F1** Agent Self-Audit 프로토콜 — Gemini 자동 트리거 **제거**, `/register` Step 6.5 에서 Claude Code 본인이 Reflection + CoT 로 claim 검증 (확증 편향 방지: raw_text verbatim 인용 강제). Gemini E5/E6 는 `--ai` opt-in 으로 완전 복귀. 결과는 `travel_packages.agent_audit_report` JSONB 에 영속.
  - **F2** CRC 확장 — `parseFlightActivity` / `parseCityFromActivity` / `formatFlightLabel` 을 DetailClient 에서 `render-contract.ts` 로 이관. A4/Mobile 항공 파싱 단일 출처.
  - **F3** Rule Zero hard-enforce — `raw_text < 50자` 또는 `raw_text_hash` 불일치 시 INSERT **차단 (ERROR 승격)**. `parser_version` 컬럼 추가로 파서/프롬프트 버전 추적. Migration: `20260421000000_add_parser_version_and_enforce_hash.sql`.
  - **F4** `/api/packages` POST Zod hard-block — 기본 ON 으로 승격 (이전: `STRICT_VALIDATION=true` 필요). 프론트/외부 API 에서 들어온 데이터도 동일 검증. 실패 시 HTTP 400. 우회는 `STRICT_VALIDATION=false` (비권장).
  - **F5** API 필드 drift 감사 — `npm run audit:api-drift:ci` 가 DB 실제 컬럼 ↔ `PACKAGE_LIST_FIELDS` 동기화 검증. ERR-20260418-10(surcharges 사일런트 누락) 재발 방지.
  - **F6** ESLint 가드 유지 + 통합 검증 — CRC 위반 빌드 차단 (이미 W1 에 도입됨).
- **상태**: FIXED (2026-04-21)
- **재발 방지 체크리스트**:
  - [ ] Gemini 호출은 반드시 `--ai` 명시 시에만 (월 캡 5000원)
  - [ ] INSERT 전 Agent self-audit 의 `overall_verdict` 확인, CRITICAL 불일치 시 재파싱
  - [ ] `raw_text_hash` 미기재 시 자동 계산 저장 (hash mismatch 는 hard block)
  - [ ] 신규 DB 컬럼 추가 시 `npm run audit:api-drift` 실행
  - [ ] 외부 API 나 프론트에서 `/api/packages` POST 시 Zod 통과 필수
- **관련 파일**: `db/post_register_audit.js`, `db/templates/insert-template.js`, `src/app/api/packages/route.ts`, `src/lib/render-contract.ts`, `.claude/commands/register.md`, `db/audit_api_field_drift.js`

---

### ERR-20260418-01: min_participants 10명 → 4명 조작

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이 단수이 3박 4일 — 투어폰)
- **원문 vs 결과**: 원문 "성인 10명 이상 출발 가능" → DB `min_participants: 4`
- **카테고리**: AI 파싱
- **근본 원인**: Sonnet Agent가 insert-template의 템플릿 기본값(4)을 원문 대신 사용. 원문 명시 값이 있어도 덮어씀.
- **해결책 (W3 2026-04-21 구조적 완료)**:
  - 즉시: DB UPDATE `min_participants = 10`
  - 구조적 1: `/register` 커맨드에 Zero-Hallucination 프로토콜 추가 — "숫자는 1:1 매핑, 템플릿 기본값 금지"
  - 구조적 2: `validatePackage` W13 추가 — 원문에서 "N명 이상" 추출 → min_participants 대조
  - 구조적 3 (W3): **CoVe E6** `extractClaims` 에 `min_participants` claim 자동 포함. Gemini가 원문 대조하여 근거 없으면 `audit_status='warnings'` 승격
  - 구조적 4 (W3): `llm-validate-retry.ts` 의 `callWithZodValidation` — Zod 검증 실패 시 피드백을 담아 재프롬프트 (LLM 자기수정 유도)
- **검증 규칙**: W13 + E6 (CoVe)
- **상태**: FIXED (2026-04-21, W3 Pivot C)
- **재발 방지**: W13 + Zero-Hallucination 체크리스트 + E6 CoVe claim 검증

---

### ERR-20260418-02: notices_parsed 육류 예시 축약

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: 원문 "(라면스프, 소세지/햄, 육포, 소고기고추장볶음(튜브형 포함), 육류가 들어간 면 종류, 베이컨 등)" → DB "위반 시 벌금"으로 축약
- **카테고리**: AI 파싱
- **근본 원인**: Sonnet Agent가 "보기 좋게 정리"하려는 경향으로 구체 예시 5개를 한 단어로 압축. 대만은 라면스프 하나만 걸려도 수백만 원 벌금이 나오는 법적 리스크 직결.
- **해결책 (W3 2026-04-21 구조적 완료)**:
  - 즉시: DB UPDATE — notices_parsed[0].text에 원문 예시 복원
  - 구조적 1: `/register` 커맨드에 "예시 목록 축약 금지" 규칙
  - 구조적 2: `validatePackage` W14 — 원문 비고 길이 대비 notices_parsed 길이 비율 체크
  - 구조적 3 (W3): **E5 자동 트리거** — `notices_parsed.length >= 6` 시 AI cross-check 자동 ON. 축약/왜곡 발견 시 warnings 승격
  - 구조적 4 (W3): **E6 CoVe** — PAYMENT 타입 notices는 claim 검증 대상으로 포함 (원문 근거 확인)
- **검증 규칙**: W14 + E5 + E6
- **상태**: FIXED (2026-04-21, W3 Pivot C)
- **재발 방지**: W14 + Zero-Hallucination + E5 자동 AI 감사 + E6 CoVe

---

### ERR-20260418-03: A4 포스터 써차지 날짜 증발

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: 원문 "청명절 4/3~6, 노동절 5/1~3, 단오절 6/19~21, 로타리 세계대회 6/10~20" → A4 포스터 "$10/인/박"만 표시, 기간 증발
- **카테고리**: 데이터스키마 + 렌더링
- **근본 원인**: DB에는 `pkg.surcharges` 객체 배열(start/end/name/amount)로 정상 저장됨. 그러나 A4 포스터는 `excludes` 문자열 배열에서 정규식으로 파싱 — 객체의 날짜 필드 사용 안 함 (이중 스키마).
- **해결책**:
  - 구조적: A4 포스터가 `pkg.surcharges` 객체 배열을 직접 사용 (P2a)
- **검증 규칙**: W15 (surcharges 기간 누락 의심)
- **상태**: IN_PROGRESS (P2a + P3)
- **재발 방지**: Single Source of Truth (surcharges 객체 직접 사용)

---

### ERR-20260418-04: A4 포스터 전신마사지 $50 가격 누락

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: 원문 "전신마사지(1시간) $50/인" → A4 포스터에서 가격 미표시 (명칭만 나옴)
- **카테고리**: 데이터스키마
- **근본 원인**: DB에 `optional_tours[].price: "$50/인"` 문자열로 저장됨. A4 포스터는 `tour.price_usd: number` 숫자 필드 기대 — 필드명 불일치로 렌더링 누락.
- **해결책**:
  - 구조적: `optional_tours` 필드 통일 (문자열 `price` 또는 숫자 `price_usd` 중 하나로 표준화) — P2b
- **검증 규칙**: (향후 W 추가 검토)
- **상태**: IN_PROGRESS (P2b)
- **재발 방지**: 필드 스키마 통일

---

### ERR-20260418-06: 요일 강제 병합 환각 재발 ("일-수 2,9,10,...")

- **발견일**: 2026-04-18 (2차 검증)
- **발생 상품**: TP-TPE-04-01 (타이베이) — A4 포스터 6월 요금표
- **원문 vs 결과**: 6월 729,000원에 화(5건)+수(3건)+일(1건)+월(1건)이 있는데 "일-수 2, 9, 10, 16, 17, 23, 24, 28, 29, 30"으로 싹 묶임
- **카테고리**: 렌더링
- **근본 원인**: `groupForPoster()`의 `sunToWed = [0,1,2,3]` 자동 병합 로직이 남아 있었음. ERR-20260417-01의 `isConsecutive` 분기 수정은 병합 전략 자체를 제거하지 않음. 학술적으로 **Set Partitioning 위반** (서로 다른 속성을 같은 행에 두면 정보 손실).
- **해결책**:
  - 구조적: `sunToWed` 블록 **완전 삭제** — "1 요일 + 1 가격 = 1 행" Strict Grouping 적용
  - 결과 예시: "화 2,9,16,23,30" / "수 10,17,24" / "일 28" / "월 29" (개별 행)
- **검증 규칙**: 없음 (렌더링 로직)
- **상태**: FIXED (2026-04-18, `src/lib/price-dates.ts` 180~210행 교체)
- **재발 방지**: 요일 범위 라벨("일-수", "화-수") 생성 코드 없음. 각 요일은 반드시 개별 행.

---

### ERR-20260418-07: A4 포스터 일정 하단 잘림 (4일차 16:40 이후 증발)

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: 4일차 "타이페이 공항 출발 16:40" 이후 "부산 도착 19:55" / 써차지 상세 / 육류 반입 안내 전체 증발
- **카테고리**: 렌더링
- **근본 원인**: `YeosonamA4Template.tsx`의 `estimateDayHeight()` 함수가 활동 높이를 `28px/활동`으로 과소 추정. 실제로는 관광지 매칭 시 short_desc/배지가 추가되어 40~45px/활동. + `PAGE_STYLE: { overflow: 'hidden' }` 조합으로 페이지 경계 초과 시 침묵 잘림.
- **해결책**:
  - 구조적: `actH = activities * 42` (보수적 실측), `routeH: 40`, `flightBarH: 50`, `hotelMealH: 45`
  - `PAGE_CONTENT_HEIGHT: 980 → 950` 안전 마진 확보
- **검증 규칙**: (향후 시각 검증 툴 추가 검토)
- **상태**: FIXED (2026-04-18, `src/components/admin/YeosonamA4Template.tsx` 197~207행)
- **재발 방지**: 보수적 높이 추정 + 페이지 분배 여유 공간

---

### ERR-20260418-08: OptionalTours Page 1 + 마지막 페이지 중복 렌더링

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: 선택관광 3개 블록이 **Page 1과 마지막 페이지 두 곳**에 중복 노출 (하단 잘림과 겹쳐 한 번만 보이는 것처럼 보였음)
- **카테고리**: 렌더링
- **근본 원인**: `YeosonamA4Template.tsx` 279행(Page 1) + 325행(마지막 페이지)에 동일 `<OptionalTours />` 호출. 초기 설계에서 조건부 분기 누락.
- **해결책**:
  - 구조적: 마지막 페이지 호출 제거. Page 1에만 표시 (고객이 가장 먼저 보는 자리).
- **상태**: FIXED (2026-04-18)
- **재발 방지**: 각 섹션은 단일 위치에서만 렌더링

---

### ERR-20260418-10: PACKAGE_LIST_FIELDS에 surcharges 누락 (써차지 기간 증발 근본 원인)

- **발견일**: 2026-04-18 (3차 검증, 사용자 스크린샷)
- **발생 상품**: TP-TPE-04-01 (타이베이) A4 포스터
- **원문 vs 결과**: 원문 "청명절 4/3~6, 노동절 5/1~3, 단오절 6/19~21, 로타리 6/10~20" / DB 정상 / A4 포스터에는 "• 써차지 ($10/인/박)" 껍데기만
- **카테고리**: 데이터스키마 + API
- **근본 원인**: `src/app/api/packages/route.ts`의 `PACKAGE_LIST_FIELDS` SELECT 문자열에 `surcharges` 필드가 **빠져 있었음**. DB 객체 배열이 있어도 API 응답에 포함되지 않아 `pkg.surcharges = undefined` → IncludeExcludeInfo가 `excludes` 문자열 fallback 사용 → "껍데기" 표시.
- **해결책**:
  - 구조적: `PACKAGE_LIST_FIELDS`에 `surcharges`, `country`, `nights`, `accommodations` 추가
- **검증 규칙**: (향후 API 응답 검증 레이어 검토)
- **상태**: FIXED (2026-04-18, `src/app/api/packages/route.ts:98~109`)
- **재발 방지**: DB 컬럼 추가 시 PACKAGE_LIST_FIELDS 동기화 원칙. 신규 필드는 반드시 API 노출.

---

### ERR-20260418-34: 🚨 신규 지역 어셈블러 자동 생성 누락 (register.md 경로 B 무시)

- **발견일**: 2026-04-18 (사용자 지적)
- **발생 상품**: 타이베이(TP-TPE-04-01), 쿠알라룸푸르(TP-KUL-05-01, TP-KUL-06-01)
- **증상**: 신규 지역 상품을 등록하고도 **지역 전용 어셈블러(`db/assembler_XXX.js`)를 생성하지 않음**
- **register.md 명시 지시**: "경로 B-2. 어셈블러 자동 생성 (다음부터 사용)"
- **내가 한 일**: Agent 프롬프트에 "어셈블러는 생성하지 않음 (생략 가능)" 임의 지시 → 프로세스 우회
- **근본 원인**: ERR-33과 동일 유형 — **기존 프로세스 지시 사항을 "이건 생략해도 되겠지"라고 추측 우회**
- **영향**:
  - 다음에 같은 지역 상품 등록 시 어셈블러 없어서 또 경로 B (insert-template) 사용 → 비효율
  - 지역별 BLOCKS/TEMPLATES 패턴이 축적되지 않음 → 품질 일관성 저하
  - 상품 2번째부터 자동 조립 불가
- **해결책 (확정)**:
  - **N=3 자동 트리거 규칙 도입**: 해당 지역 상품이 3개 이상 쌓였을 때만 어셈블러 자동 생성
  - 이유: 1~2개 상품만으로는 공통 블록 vs 차별 블록 구분 불가 → 과도한 엔지니어링
  - register.md Step 3-1에 COUNT 쿼리 기반 분기 추가
  - 타이베이(1개)·쿠알라(2개)는 현재 임계값 미달 → 다음 상품 등록 시 자동 생성
- **재발 방지**:
  - [ ] Step 3-0: 어셈블러 존재 여부 확인
  - [ ] Step 3-1: 없으면 COUNT 쿼리로 상품 수 확인
  - [ ] 상품 수 ≥ 3이면 B-1 + B-2, 미만이면 B-1만
  - [ ] "생략 가능" 임의 판단 금지
- **상태**: FIXED (2026-04-18, register.md Step 3 업데이트 + N=3 트리거 규칙)

---

### ERR-20260418-33: 🚨 기존 프로세스 무시하고 임의 구현 (메타 규칙 위반)

- **발견일**: 2026-04-18 (쿠알라룸푸르 상품 등록 중 사용자 지적)
- **발생 영역**: 관광지(attractions) 관리 파이프라인
- **증상**: Agent가 `db/seed_kul_attractions.js` 같은 **임시 시드 스크립트를 자동 생성**해서 18개 관광지를 마음대로 INSERT
- **기존 프로세스 (이미 완성되어 있던 것)**:
  1. `/admin/attractions` — 관광지 CRUD + CSV 업로드/다운로드 + Pexels 자동 수집
  2. `/admin/attractions/unmatched` — 미매칭 관광지 수동 처리 (별칭 연결, DB 추가, CSV export)
  3. `/api/attractions` — 완전한 API (GET/POST/PATCH/PUT/DELETE)
  4. `register.md` Step 5: "없으면 **시드 필요 플래그**" (플래그만, 자동 생성 아님)
- **근본 원인**:
  - **CLAUDE.md의 Zero-Hallucination Policy 직접 위반**
  - Agent가 작업 전 `src/app/admin/attractions/`, `/api/attractions` 등 **기존 구현을 탐색하지 않음**
  - "이렇게 하면 되겠지" 추측으로 신규 스크립트 생성
  - 세션 중 **"엑셀 업로드 기능 구현해드릴게요"** 제안도 같은 위반 (이미 있음)
- **피해**:
  - 18개 관광지가 AI 환각 설명(짧고 부정확)으로 시드됨
  - "마담투소 싱가포르", "포트캐닝 공원" 등 오매칭 유발 관광지 대량 생성
  - 이후 4회에 걸쳐 삭제 + STOP_WORDS 추가로 땜질
- **해결책**:
  - 구조적 1: `.claude/commands/manage-attractions.md` **신규 생성** (관광지 작업의 유일한 진입점)
  - 구조적 2: `register.md` Step 0에 "관광지 자동 시드 금지" 명시
  - 구조적 3: Agent 프롬프트에 "관광지 관련 작업 전 `manage-attractions.md` 필수 Read" 규칙
- **재발 방지 체크리스트**:
  - [ ] 관광지 관련 작업 시작 전 `manage-attractions.md`를 Read했는가?
  - [ ] 새 스크립트/코드 만들기 전 기존 `/admin/attractions` 및 `/api/attractions`를 확인했는가?
  - [ ] AI로 short_desc/long_desc 자동 생성해서 INSERT하려 하는가? → 중단, 사용자 CSV 편집으로 남겨둘 것
  - [ ] "이 기능 제가 구현해드릴게요" 말하기 전 Glob/Grep으로 기존 코드 확인했는가?
- **상태**: FIXED (2026-04-18, `.claude/commands/manage-attractions.md` + register.md Step 0)
- **영구 방지**: Zero-Hallucination Policy 적용 + 메타 규칙 "기존 프로세스 탐색 후 구현"

---

### ERR-20260418-14: 가이드경비 $40 증발 (surcharges 병합 로직 부재)

- **발견일**: 2026-04-18 (4차 검증, 사용자 A4 포스터 확인)
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: excludes에 "기사/가이드경비 $40/인 (현지지불)" 정상 저장 / A4 포스터 추가요금 섹션에 **증발**
- **카테고리**: 렌더링 + 병합 로직
- **근본 원인**: `IncludeExcludeInfo`에서 `surcharges` 객체 배열이 있으면 `excludes`에서 추출한 문자열을 **완전히 무시**. "써차지 4건"만 표시되고 "가이드경비 $40"은 사라짐.
  - **수익 누수 리스크**: 고객이 "안내 못 받음"며 현지 가이드경비 지불 거부
- **해결책**:
  - 구조적: 객체 배열 + excludes 문자열을 **병합**. 단, 객체 배열에 이미 있는 일반 "써차지" 단순 문구만 중복 제거. 가이드경비/싱글차지 등 구체적 항목은 유지.
- **상태**: FIXED (2026-04-18, `YeosonamA4Template.tsx` IncludeExcludeInfo)
- **재발 방지**: 데이터 병합 시 "Subset 삭제"가 아닌 "Union" 원칙

---

### ERR-20260418-15: 요금표 페이지 낭비 (4개월 상품이 4페이지로 분산)

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (4개월, 31행)
- **원문 vs 결과**: Page 1 요금표 6행 고정 → 타이베이 4달치가 **4개 페이지**로 분산. Page 1 하단 빈 공간 낭비 + 추가 페이지 헤더 반복 스팸.
- **카테고리**: 렌더링 + 알고리즘
- **근본 원인**: Gemini 기여 임계값(6/16)이 과도하게 보수적. 핵심특전+선택관광이 차지하는 공간을 과대평가. 실제로 Page 1 main 영역은 18행까지 안전 수용 가능.
- **해결책**:
  - 구조적: `PRICE_ROWS_PAGE1: 6 → 18`, `PRICE_ROWS_OTHER: 16 → 24`
  - 타이베이 재분배 결과: Page 1(4+5월=18행) + Page 2(6+7월=17행) = **2페이지**
  - "(계속)" 라벨 제거 — 월 헤더가 자동 분리 역할
- **상태**: FIXED (2026-04-18)
- **재발 방지**: 페이지 용량 실측 확인 필요 시 A4 고정 높이(1131px) 기준으로 재튜닝

---

### ERR-20260418-16: 월 헤더 단일 월 청크에서 미표시

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 추가 요금표 페이지
- **원문 vs 결과**: Page 2가 "5월 전용"일 때 월 헤더 없이 날짜만 나와 몇 월인지 불명
- **카테고리**: 렌더링
- **근본 원인**: `PriceTable`이 `monthGroups.length > 1`일 때만 월 헤더 렌더. 청크 필터 후 단일 월이면 헤더 사라짐.
- **해결책**:
  - 구조적: 월 헤더 항상 표시 (단일/다중 무관)
- **상태**: FIXED (2026-04-18, `PriceTable` price_dates + tiers 모드)

---

### ERR-20260418-17: 항공 배지 괄호 중복 "BX793(BX(에어부산))"

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 일정 페이지 헤더
- **원문 vs 결과**: `pkg.airline = "BX(에어부산)"` → 헤더 "BX793(BX(에어부산)) 부산 → BX793 부산(김해) 출발 → 타이페이"
- **카테고리**: 렌더링 + 정규식
- **근본 원인**: 
  1. `getAirlineName`이 "BX(에어부산)" 같이 괄호 있는 값을 코드로 parse 못해 null 반환 → fallback으로 airline 원본 노출
  2. `arrivalCityName` 추출 정규식 `^(.+?)\s*(국제)?공항?\s*(도착|입국)`가 greedy하게 전체 문자열 매칭 → "BX793 부산(김해) 출발 → 타이페이"가 arrivalCity로 설정
- **해결책**:
  - `getAirlineName`: 괄호/공백/파이프로 split, 맨 앞 단어만 코드로 처리. 괄호 안 한글은 fallback.
  - `arrivalCityName`: "→ X 도착" 패턴 우선, fallback으로 단어 경계 제한
- **상태**: FIXED (2026-04-18)
- **재발 방지**: 정규식은 항상 non-greedy + 단어 경계 명시. 필드 포맷 다양성 고려.

---

### ERR-20260418-13: A4 포스터 항공 표기 장황함

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이) 일정 페이지 헤더
- **원문 vs 결과**: "✈️ BX(에어부산) | 부산출발 ↔ BX793 부산(김해) 출발 → 타이페이" (장황)
- **카테고리**: 렌더링
- **근본 원인**: `ItineraryPageHeader` 컴포넌트가 airline/depCity/directCity만 나열. 항공편 번호(flight_out) 미활용.
- **해결책**:
  - 구조적: `flightOut` prop 추가. 표기: `"BX793(에어부산) 부산 → 타이페이"`
- **상태**: FIXED (2026-04-18, `src/components/admin/YeosonamA4Template.tsx:1306,1326`)
- **재발 방지**: 간결한 항공 헤더 표기 원칙

---

### ERR-20260418-12: 요금표 적응형 청크 분할 (Universal 알고리즘)

- **발견일**: 2026-04-18 (4차 검증)
- **발생 상품**: TP-TPE-04-01 (31행) — 별도 페이지로 옮겼으나 그 페이지에서도 4월 779원/799원+7월 잘림 재발
- **카테고리**: 렌더링 + 알고리즘
- **근본 원인**: 이전 ERR-20260418-11 해결책("요금표 전용 페이지")이 임계값(15행) 단일 분기로 **한 페이지에 모든 행 몰아넣기** 시도 → 또 초과. "어떤 크기 상품이든" 대응하는 알고리즘 부재.
- **해결책 (3단 방어)**:
  1. **Page 1 예산(12행)** + **이후 페이지 예산(22행)**로 적응형 청크 분할
  2. 월 그룹 단위로 누적, 예산 초과 시 새 청크 시작
  3. 극단 케이스(단일 월 > 22행)에서는 해당 월을 **가격 그룹별로 재분할** (fallback)
- **결과**: 짧은 상품(5-10행) → Page 1 내 완성. 중간 상품(20-30행) → Page 1 + 추가 페이지. 초대형 상품(50+행, "매일 출발") → 가격별 쪼개기로 안전.
- **상태**: FIXED (2026-04-18, `src/components/admin/YeosonamA4Template.tsx:260~320`)
- **재발 방지**: 데이터 크기 독립적 렌더링. 시각 테스트 시 극단 케이스 (1개월 30행+ 상품) 검증 필수.

---

### ERR-20260418-11: A4 포스터 Page 1 요금표 공간 초과로 일부 잘림

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이) — 요금표 31행 (4/5/6/7월)
- **원문 vs 결과**: 4월 "수 22,29 / 화 28" 이후 중단. 4월 779원(토 25), 4월 799원(목 23), 7월 전체 증발
- **카테고리**: 렌더링 + 페이지 레이아웃
- **근본 원인**: A4 Page 1에 핵심특전+요금표+선택관광을 모두 넣음. 요금표가 15행을 넘으면 Page 1 크기(1131px) 초과 → `PAGE_STYLE.overflow: hidden`에 의해 하단 잘림.
- **해결책**:
  - 구조적: 요금표 행 수가 15 초과면 **별도 전용 페이지**에 요금표 렌더링. Page 1에는 핵심특전+선택관광만.
  - 구현: `usePriceTableOwnPage = priceRowCount > 15` 플래그 + 조건부 `<article>` 추가
- **검증 규칙**: 없음 (렌더링 계산 기반)
- **상태**: FIXED (2026-04-18, `src/components/admin/YeosonamA4Template.tsx:260, 286~316`)
- **재발 방지**: 요금표 길이 동적 분배. 향후 35+ 행이면 추가 페이지 분할 필요.

---

### ERR-20260418-09: optional_tours 타입 스키마 불일치 (price vs price_usd)

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: DB `price: "$35/인"` 문자열 저장 / `YeosonamA4Props`는 `price_usd: number`만 허용 / `OptionalTours` 컴포넌트는 `price` 문자열도 지원. 타입 간 불일치로 렌더링 불확실성.
- **카테고리**: 데이터스키마
- **근본 원인**: `optional_tours` 필드 스키마가 3곳(Props 타입 / TravelItinerary 타입 / 렌더 컴포넌트)에서 제각각.
- **해결책**:
  - 구조적: `YeosonamA4Props.optional_tours` 타입을 `{ name, price?: string, price_usd?: number, price_krw?: number | null, note?: string | null }`로 통일.
- **상태**: FIXED (2026-04-18, YeosonamA4Template.tsx 101행)
- **재발 방지**: Props/TravelItinerary/Component 타입 일치

---

### ERR-20260418-05: 타이베이 관광지 매칭 100% 실패

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: 일정 13개 관광지 (국립고궁박물관, 야류, 지우펀, 스펀, 진리대학, 홍마오청, 단수이, 화산1914, 서문정거리, 중정기념당, 사림관저 등) → A4/모바일 매칭 0/13
- **카테고리**: 매칭 + 마스터데이터
- **근본 원인**: `attractions` 테이블에 타이베이/대만 관광지 **0건**. 매칭 함수가 아무리 정교해도 DB에 데이터가 없으면 매칭 불가.
- **해결책**:
  - 즉시: 타이베이 관광지 13개를 `attractions` 테이블에 시드 + Pexels 사진 수집
  - 구조적: 신규 지역 등록 시 미등록 관광지 감지 → 자동 시드 파이프라인 (P5)
- **검증 규칙**: (향후 W 추가 검토)
- **상태**: IN_PROGRESS (P5)
- **재발 방지**: 자동 시드 파이프라인 + `matchAttractions` (복수형) 사용 (P2c/P2d)

---

### ERR-KUL-01: A4 포스터 `출발: ["금"]` JSON 배열 문자열 노출

- **발견일**: 2026-04-18
- **발생 상품**: 쿠알라룸푸르 4박6일 (TP-KUL-06-01)
- **원문 vs 결과**: 원문 "(금)" / DB `departure_days: '["금"]'` → A4 배지 `"출발: ["금"]"` JSON 배열 그대로 노출
- **카테고리**: 렌더링 + 데이터스키마
- **근본 원인**: `departure_days` 가 JSON 배열 문자열로 저장됨. A4 템플릿이 문자열을 그대로 렌더 → 고객 신뢰도 저하.
- **해결책**:
  - 구조적 1: `src/lib/admin-utils.ts` `formatDepartureDays()` 헬퍼 — JSON 배열 / 배열 / 평문 모두 슬래시 구분 평문으로 정규화
  - 구조적 2: `src/lib/parser.ts` 양쪽 return 사이트에서 저장 시점에 `formatDepartureDays` 호출 → DB 평문 저장
  - 구조적 3: `YeosonamA4Template.tsx` 배지 렌더에 `formatDepartureDays` 적용 (레거시 데이터 방어)
- **검증 규칙**: W16 (JSON 배열 포맷 감지)
- **상태**: FIXED (2026-04-18)
- **재발 방지**: 저장/렌더 2단 방어 + W16 validator 경고

---

### ERR-KUL-02: 4박6일 DAY 4 "메르데카 광장" 오삽입 (교차 오염)

- **발견일**: 2026-04-18
- **발생 상품**: 쿠알라룸푸르 4박6일 (TP-KUL-06-01)
- **원문 vs 결과**: 원문 4박6일 4일차 "왕궁/국립이슬람사원/KLCC" 3개 / A4·모바일 "왕궁/국립이슬람사원/**메르데카 광장**/KLCC" 4개 (원문에 없는 랜드마크 삽입)
- **카테고리**: AI 파싱 (DAY 교차 오염)
- **근본 원인**: 같은 원문에 3박5일과 4박6일이 공존. AI가 3박5일 4일차의 "메르데카 광장"을 4박6일 4일차에 **복사**. "공통으로 있을 법한" 관광지 임의 추가 패턴.
- **해결책**:
  - 즉시: DB UPDATE — `itinerary_data.days[3].schedule` 에서 "메르데카 광장" 항목 제거
  - 구조적 1: `register.md` "§6. DAY 교차 오염 방지" 섹션 추가 — 원문 대조 필수 규칙
  - 구조적 2: W18 validator — 원문에 없는 랜드마크가 schedule에 있으면 경고 (whitelist 기반)
- **검증 규칙**: W18 (랜드마크 원문 부재 감지)
- **상태**: FIXED (2026-04-18, register.md + W18)
- **재발 방지**: 상품별 독립 파싱 컨텍스트 원칙 + 랜드마크 whitelist

---

### ERR-KUL-03: 4박6일 DAY 1 "쿠알라 야경투어" 오삽입 (교차 오염)

- **발견일**: 2026-04-18
- **발생 상품**: 쿠알라룸푸르 4박6일 (TP-KUL-06-01)
- **원문 vs 결과**: 원문 4박6일 1일차에는 추천선택관광 없음 / A4 "추천선택관광: 쿠알라 야경투어 $50/인" 삽입
- **카테고리**: AI 파싱 (DAY 교차 오염, ERR-KUL-02와 동일 패턴)
- **근본 원인**: 원문 3박5일 1일차에만 있는 야경투어 추천을 4박6일 1일차에 복사.
- **해결책**: ERR-KUL-02와 동일 구조적 방어 (register.md §6 + W18)
- **검증 규칙**: W18
- **상태**: FIXED (2026-04-18)
- **재발 방지**: 동일

---

### ERR-KUL-04: optional_tours "(싱가포르)" 지역 라벨 A4/모바일 불일치

- **발견일**: 2026-04-18
- **발생 상품**: 쿠알라룸푸르 3박5일 (TP-KUL-05-01)
- **원문 vs 결과**: 원문 `[싱가포르 선택관광]` 섹션에 "2층버스 US$45/인" / A4 "2층버스 ($45/인)" (지역 라벨 없음) / 모바일 "2층버스" (지역 라벨 없음) — 고객이 말레이시아 2층버스와 혼동 가능
- **카테고리**: 파싱 + 렌더링 (계약 분리)
- **근본 원인**:
  1. `optional_tours` 스키마에 `region` 필드 없음 → AI가 섹션 헤더 정보 유실
  2. A4와 모바일이 각자 이름만 렌더 → 라벨 일관성 부재
- **해결책**:
  - 구조적 1: `OptionalTour` 타입에 `region?: string | null` 필드 추가 (`src/lib/parser.ts`)
  - 구조적 2: AI 프롬프트에 "[X 선택관광]" 섹션 헤더 → region 주입 규칙 명시
  - 구조적 3: `src/lib/itinerary-render.ts` 신규 — `normalizeOptionalTourName()` 공통 헬퍼 (region + 괄호 추론 포함)
  - 구조적 4: A4 `OptionalTours` + 모바일 선택관광 렌더 둘 다 공통 헬퍼 사용
  - 구조적 5: 저장 시점 `enrichOptionalToursRegion()` — AI가 region 누락해도 이름에서 자동 추론
- **검증 규칙**: W17 (모호 이름 + region 누락)
- **상태**: FIXED (2026-04-18)
- **재발 방지**: 스키마 + 프롬프트 + 정규화 + 공통 헬퍼 4단 방어

---

### ERR-KUL-05: 렌더링 계약 분리 구조 (패턴 A 재발)

- **발견일**: 2026-04-18 (메타 분석)
- **증상**: A4(`YeosonamA4Template.tsx`)와 모바일(`DetailClient.tsx`)이 `pkg`에서 itinerary/optional_tours/attractions를 **각자 해석**. 동일 데이터를 두 렌더러가 다르게 표현 → 한 쪽에만 보이는 항목 / 라벨 불일치 / 필드명 불일치 반복.
- **이력 패턴**: ERR-20260418-03 (surcharges), -04/09 (optional_tours price), -08 (중복 렌더), -10 (PACKAGE_LIST_FIELDS), -14 (Union 병합) — **10건 이상 누적**
- **카테고리**: 아키텍처 (렌더링 계약)
- **근본 원인**: 단일 진실 공급원 부재. 데이터 해석이 렌더러 내부에서 각자 이루어짐.
- **해결책 (W1 CRC — 2026-04-21)**:
  - 구조적 1: `src/lib/render-contract.ts` 신규 — Canonical Render Contract v1 (`renderPackage(pkg) → CanonicalView`)
  - 구조적 2: 4 섹션을 CRC로 이관 — airlineHeader / optionalTours / surchargesMerged / excludes.basic / shopping (내부키워드 차단)
  - 구조적 3: A4·Mobile의 `classifyExcludes` / `formatSurchargeObject` / `SurchargeObject` / `AIRLINES` / `getAirlineName` 지역 복사본 **완전 제거** → render-contract.ts 단일 출처
  - 구조적 4: `.eslintrc.json` 에 `no-restricted-syntax` 가드 — 렌더러가 `pkg.excludes`·`pkg.surcharges` 직접 접근하면 **빌드 차단**
  - 구조적 5: CLAUDE.md 도메인 진입점 갱신 — "A4/모바일 렌더링 로직 추가·수정 → `render-contract.ts`"
- **상태**: FIXED (2026-04-21, W1 Pivot A 완료)
- **재발 방지**:
  - "렌더러는 `view.*` 만 소비. `pkg` 필드 직접 파싱 금지." ← ESLint가 AST 레벨에서 강제
  - 새 렌더 로직은 `render-contract.ts` 의 `renderPackage()` 출력에 필드 추가 후 view 소비
  - W2 예정: 일정 타임라인 / 관광지 매칭 / 미매칭 수집도 CRC로 단계 이관

---

### ERR-KUL-safe-replace: 중복 감지 시 자동 아카이브의 사일런트 사고 위험

- **발견일**: 2026-04-18 (Gemini 아키텍처 리뷰)
- **증상**: 기존 findDuplicate 로직은 가격/기한 변경 감지 시 기존 상품을 **무조건** archived + 신규 insert. AI가 필드를 대량 누락한 상태로 재등록되면 정상 라이브 상품이 죽고 불량 상품이 노출됨.
- **카테고리**: 아키텍처 + 안전장치
- **근본 원인**: Zod는 shape만 검증(숫자가 숫자?), content 퇴화(필드 누락) 감지 불가. audit_render_vs_source는 INSERT 후 실행 → 이미 늦음.
- **해결책**:
  - 구조적 1: `calcCompletenessScore(pkg)` 함수 도입 — 0~100점 (title/destination/duration/price/일정/포함/불포함/옵션/유의사항 가중치 합)
  - 구조적 2: 중복 감지 시 `degradationPct = ((dupScore - newScore) / dupScore) * 100` 계산
  - 구조적 3: `degradationPct > 20%` 이면 기존 **라이브 유지** + 신규는 `status='pending_replace'` 보류
  - 구조적 4: 새 status `pending_replace` 스키마(Zod + audit CLI)에 추가
- **검증 규칙**: 없음 (런타임 조건부 분기)
- **상태**: FIXED (2026-04-18, `db/templates/insert-template.js` `calcCompletenessScore` + 조건부 toArchive)
- **재발 방지**: 완전성 20%+ 하락 시 자동 교체 차단. 어드민에서 pending_replace 검수 후 수동 승인 필요.

---

### ERR-FUK-customer-leaks: 내부 메모 고객 화면 노출 + 숫자 콤마 split + 항공편 파싱 실패 (복합 4건)

- **발견일**: 2026-04-18 (FUK 골프 2건 등록 후 사장님 대조)
- **증상**:
  1. A4 "🛍️ 쇼핑센터" 섹션에 `[랜드사 커미션] ... commission_rate=0 저장은 스키마 제약 *...` 전체 노출 — **심각한 고객 신뢰 손실**
  2. A4 "불포함 사항"에 "본관 숙박 시 2,000엔" → "본관 숙박 시 2|000엔" (콤마 split)
  3. A4 "추가 요금 안내"에 surcharge 중복 6개 (객체 + excludes 문자열)
  4. 모바일 가는편 도착 시간 "—" / 오는편 출발지 "BX143 후쿠오카" (flight code 혼입)
- **카테고리**: 렌더링 + 데이터/코드 복합
- **근본 원인**:
  1. A4 템플릿이 `special_notes`를 `shoppingInfo` 폴백으로 사용. 내부 메모를 special_notes에 저장한 것이 잘못된 선택.
  2. `flattenItems()` 가 모든 top-level 콤마를 항목 구분자로 사용. "2,000엔"의 숫자 콤마까지 분리.
  3. surcharges 객체 배열이 있어도 excludes의 중복 문자열을 별도 표시.
  4. `parseCityFromActivity` 가 flight code prefix("BX143")를 도시명에 포함. `parseArrivalTime` 정규식이 "도착 HH:MM"만 처리하고 "HH:MM 도착" 못 잡음.
- **해결책**:
  - 즉시: DB 3건 수정 (special_notes=null / highlights.shopping 명시 / excludes surcharge 중복 제거)
  - 구조적 1: `YeosonamA4Template.tsx` `flattenItems()` 숫자 콤마 보호 — prev `\d` + next `\d{3}` 이면 split skip
  - 구조적 2: `DetailClient.tsx` `parseCityFromActivity` flight code prefix 사전 제거, `parseFlightActivity` 로 히어로 섹션 통합
  - 구조적 3: `parseArrivalTime` 정규식 "HH:MM 도착" 양방향 지원
  - (향후): A4 템플릿의 special_notes → shopping 폴백 제거. `itinerary_data.highlights.shopping` 만 사용.
- **상태**: FIXED (2026-04-18)
- **재발 방지**:
  - Insert 시 **운영 메모는 절대 special_notes에 저장 금지** — 해당 용도 컬럼 없음. 별도 DB 메모/주석 시스템 필요 시 신규 필드.
  - 숫자 형식(천단위 콤마) 보호 테스트 케이스 추가
  - 항공편 activity는 `parseFlightActivity` 단일 창구만 사용

---

### ERR-date-confusion: 원문 날짜 의미 혼동 (배포일 vs 발권기한)

- **발견일**: 2026-04-18 (랜드부산 나가사키 골프 등록 후 어드민 미표시)
- **증상**: 원문 헤더 "PKG ... 2026.4.1"을 `ticketing_deadline`으로 저장. 오늘(4/18) 기준 이미 만료되어 어드민의 `isExpired()` 필터로 자동 숨김 처리됨.
- **카테고리**: AI 파싱 (필드 의미 혼동)
- **근본 원인**: 원문의 `YYYY.M.D` 형식 날짜는 맥락에 따라 여러 의미 — 배포일/버전/발권기한/출발시작일 등. 단순 날짜 포맷만 보고 `ticketing_deadline`에 매핑하면 오류.
- **맥락 식별 규칙**:
  - **"X까지 발권/예약"** → `ticketing_deadline` ✓
  - **"X.Y 배포"** / **상품명 뒤 단순 날짜** → 버전/배포일 (DB 필드 없음 → null 또는 description)
  - **"X부터 출발"** / **매일 출발** → price_dates.start만 설정, deadline 없음
  - **"항공 블록 좌석 아님" 명시** → 발권기한 없음 (null)
- **해결책**:
  - 즉시: 해당 상품 `ticketing_deadline = null` 업데이트
  - 구조적: validator에 W20 추가 — 발권기한이 created_at 이후 30일 미만이거나 과거인 경우 의심 경고
  - 프롬프트 규칙: register.md에 "원문에 '발권' 키워드 없으면 ticketing_deadline=null" 명시
- **상태**: FIXED (2026-04-18)
- **재발 방지**: W20 validator + 프롬프트 명시

---

### PHASE-1.5-COMPLETE@2026-04-21: 3엔진 지원 + Admin UI + 역변환 감사 (50/50 pass) 완료

- **완료 내역 (오늘 세션 최종)**:
  1. `/api/register-via-ir` 에 **engine 3종** (`direct`·`gemini`·`claude`) 지원
     - `direct`: Claude Code 세션이 직접 IR JSON 작성 → LLM 호출 0원
     - `gemini`: Google Gemini 2.5 Flash (GEMINI_API_KEY 활용, ~0.003$/건)
     - `claude`: Anthropic Sonnet 4.6 (ANTHROPIC_API_KEY 필요, ~0.03$/건)
  2. `src/lib/normalize-with-llm.ts` — Claude tool use + Gemini responseSchema 분리 함수
  3. `db/register_via_ir.js` — `--engine=direct|gemini|claude` + `--ir=<file>` CLI 옵션
  4. `src/app/admin/ir-preview/page.tsx` + `IrPreviewClient.tsx` — HITL 승인/거절/diff UI (Phase 1.5-C)
  5. `src/lib/pkg-to-ir.ts` — pkg → NormalizedIntake 역변환기 (Phase 1.5-γ 기반)
  6. `src/app/api/audit-pkg-to-ir/route.ts` — 감사 배치 API
  7. `db/audit_legacy_pkg_to_ir.js` — 전수 감사 스크립트
  8. `.claude/commands/register.md` Step 2.5 — 3엔진 비교표 + Direct 워크플로우
- **감사 결과**: 레거시 50개 샘플 → **100% Pass** (pkg-to-ir Zod 검증). 주요 경고는 raw_text 미보존(34건) · price_tiers 누락(14건) 등 **데이터 품질 이슈**이지 스키마 불일치 아님.
- **Phase 1 잔업 처리 방침**: DetailClient/A4 완전 view.* 전환은 **Phase 2 로 정식 이관**. 현재 CRC 확장 + ERR-HSN 데이터·정규식 패치로 방어 완료. Golden Master 57/59 베이스라인 미세팅 + 회귀 위험으로 지금 강행 비추천.
- **Phase 1.5-β (어셈블러 어댑터)**: **현 시점 스킵**. 어셈블러 3개(XIY/TAO/DAD) 정상 작동 중. IR 파이프는 신규 지역/미어셈블러 대상.
- **사장님 운용법** (최종):
  ```
  기본:       /register <원문>  →  내(Claude Code 세션)가 IR 작성 → --engine=direct → 0원, 95%+ 품질
  자동화:     --engine=gemini (CLI 또는 외부)  → ~0.003$/건
  고품질:     --engine=claude (ANTHROPIC_API_KEY 갱신 후)
  감사:       node db/audit_legacy_pkg_to_ir.js --limit=N
  HITL 검토:  /admin/ir-preview
  신규 지역:  node db/bootstrap_attractions_from_assemblers.js --region=<지역> --insert
  ```
- **미완 (사장님 선택 사항)**:
  - `.env.local` ANTHROPIC_API_KEY 갱신 (claude engine 쓸 때만)
  - `npm run test:visual:update` 1회 실행 (Golden Master 57/59)
  - Phase 2: DetailClient/A4 완전 view.* 전환 (다음 큰 오류 발생 시)

---

### PHASE-1.5-IR-intake@2026-04-21: Intake Normalizer (IR) 레이어 도입 — 원문·pkg 사이 구조적 경계 확립

- **상태**: IMPLEMENTED (Canary 파일럿)
- **범위**: ERR-HSN-render-bundle · ERR-FUK-insurance-injection · ERR-KUL-02/03 · ERR-20260418-01/02/03 의 **구조적 근본 해결**
- **배경**: Phase 1 CRC (view 계약) 만으로는 "원문→pkg" 단계의 LLM 환각·축약·조작을 막지 못함. 매번 등록마다 사장님 육안 대조 → 땜질 루프. **"상수(관광지)와 변수(상품)를 분리하고 Zod 구조 강제 + HITL confirm"** 패러다임 전환.
- **구현 5개 파일 + 1 migration + 1 route**:
  1. `src/lib/intake-normalizer.ts` — NormalizedIntakeSchema (Zod). 7-kind segment(attraction/transit/note/special/meal/hotel-check/misc). SurchargeSchema 확장·priceGroups 3방식·rawLabel/rawDescription/canonicalLabel 3단 분리 (블로그 판매력 유지).
  2. `src/lib/normalize-with-llm.ts` — Anthropic Claude Sonnet 4.6 + tool use (input_schema = Zod JSON Schema). 환각 방지 10개 규칙 프롬프트 R1~R10. Zod 실패 시 재시도 루프.
  3. `src/lib/ir-to-package.ts` — IR → pkg 기계 변환 (LLM 호출 없음). attraction lookup (매칭 실패 허용·rawDescription fallback). terms-library auto 약관 병합.
  4. `src/lib/terms-library.ts` — 하드코딩 8룰 + DB terms_templates 4-level 동적 resolver. ctx {country, productType, airline, flightCodes, departureDate} 기반 자동 조립.
  5. `src/app/api/register-via-ir/route.ts` — Normalizer → normalized_intakes 저장 → ir-to-package → travel_packages INSERT → unmatched_activities 큐잉. `dryRun` 플래그로 LLM 호출만 검증 가능.
  6. Migration `20260421100000_phase1_5_ir_tables.sql` — normalized_intakes 신설 + unmatched_activities 9개 컬럼 확장. Supabase 적용 완료.
  7. `db/register_via_ir.js` — CLI 래퍼 (`/api/register-via-ir` POST).
  8. `db/bootstrap_attractions_from_assemblers.js` — 신규 지역 부트스트랩 (어셈블러 BLOCKS → attractions 시드, ERR-20260418-33 자동시드 금지 준수 — 이름·keyword 만).
- **해결 메커니즘 vs 기존 ERR**:
  - ERR-HSN W26 (콤마 inclusions) — Zod `inclusions: z.array(z.string())` 에 프롬프트 R4 제약 + ir-to-package 에서 그대로 패스
  - ERR-HSN W27 (하루 1 flight) — IR `days[].flight: FlightSegment | null` 단일 타입. 2개 분리 구조적 불가
  - ERR-HSN W28 (체크인/투숙 변형) — IR `hotel-check` kind 의 text 를 렌더러에 그대로 전달. 하드코딩 헤더 제거
  - ERR-FUK-insurance-injection — 프롬프트 R7 + rawText 원본 보존 + Rule Zero hash 강제
  - ERR-KUL-02/03 — 프롬프트 R6 "regions 원문 지역 컬럼 1:1"
  - ERR-20260418-01 — 프롬프트 R2 "minParticipants 원문 1:1 매핑"
- **Canary 정책**:
  - 신규 상품: `/api/register-via-ir` 사용 권장
  - 기존 362개 상품: 레거시 경로 유지 (lossless 역변환 검증 후 일괄 전환)
  - 어셈블러 3개 (XIY/TAO/DAD): 추후 IR 어댑터로 포팅 예정 (Phase 1.5-β)
- **미완 (사장님 Next Action)**:
  - [ ] `.env.local` 의 `ANTHROPIC_API_KEY` 유효성 확인 (현재 401 invalid x-api-key)
  - [ ] 신규 지역 추가 시 `node db/bootstrap_attractions_from_assemblers.js --region=<region> --insert` 1회 실행
  - [ ] 시드된 관광지 `long_desc`·사진은 `/admin/attractions` 에서 보완 (자동 생성 금지 원칙 유지)
  - [ ] Admin `/admin/ir-preview` diff 뷰 UI (Phase 1.5-C 예정)
  - [ ] Golden Master 베이스라인 57개 재촬영 (`npm run test:visual:update`)
- **하이브리드 전략 이행 체크**:
  - L0 (유사 상품 RAG): 미도입 (상품 50+ 누적 후)
  - ✅ L1 (IR Normalizer): 완료
  - L2 (Gemini Judge): `POST_AUDIT_AI=1` 켜면 post-audit 에서 자동 적용 (Phase 1 에서 이미 구축)
  - L3 (HITL Admin diff): Phase 1.5-C 로 지연
  - ✅ L4 (ir-to-package): 완료
  - L5 (Golden Master): 프레임워크 존재 (`tests/visual/`), 베이스라인 2/59 → 사장님 1회 실행 필요

---

### ERR-HSN-render-bundle@2026-04-21: 황산 송백CC 2건 렌더링 6가지 오류 한 번에 (데이터 컨벤션 + 렌더러 과포용 정규식)

- **발견일**: 2026-04-21 (사장님이 A4/모바일 실제 렌더 결과 직접 대조하여 지적)
- **발생 상품**: BA-TXN-04-01 / BA-TXN-05-01
- **카테고리**: 데이터 컨벤션 + 렌더링 (복합)
- **6가지 증상 및 근본 원인**:
  1. **A4 "포함 사항" 5개가 ✅로 묶임** (`택스, 한국어 가능한 상주직원, 무제한 그린피, 김해공항 샌딩, 중국연휴 서차지`): `getInclusionIcon()` regex(`/항공|TAX|유류/`)가 한국어 "택스" 미대응 + inclusions 배열에 `"항공료, 택스, 유류세"` 가 한 문자열로 들어감 → 분리 후에도 아이콘 매칭 실패.
  2. **모바일 히어로 도착 시간 "—"**: `parseFlightActivity()` 는 `→` 토큰이 있는 단일 activity 를 기대. 내가 Day1 에 `flight('10:30','부산 김해 국제공항 출발',...)` + `flight('11:50','황산 툰시 국제공항 도착',...)` 2개로 분리 등록 → 출발 activity 에서 arrTime 추출 시도 → null.
  3. **모바일 DAY1/DAY_last flight 이중 렌더**: DetailClient 스킵 조건 (DetailClient.tsx:718-724) 이 `item.type !== 'flight'` 이면서 "도착" 포함인 경우만 스킵 → **분리 등록된 도착-flight 는 스킵 대상에서 누락** → 두 번째 carousel 행으로 그대로 나옴 (도착 시간 자리에 `—`).
  4. **"호텔 체크인 및 휴식" → "호텔 투숙 및 휴식" 강제 치환**: DetailClient.tsx:851 이 호텔 카드 헤더를 **하드코딩 `<h3>호텔 투숙 및 휴식</h3>`** 으로 렌더. 원문 무시.
  5. **"라운드 후 석식 및 호텔 투숙" → "호텔 투숙 및 휴식" (앞 구간 소실)**: DetailClient.tsx:728 정규식 `/호텔.*투숙|호텔.*휴식|투숙.*휴식/` 이 매칭 시 **activity 전체를 스킵** + 복구는 `*(.+)$` 별표 시작만 → "라운드 후 석식" 부분 영구 손실.
  6. **"발권후(출발21일전**(2026.04.24)**) 취소시"**: standard-terms.ts:284 `formatCancellationDates` regex `/(\d+)일\s*전/g` 가 **"출발21일전" 의 21 도 매칭**하여 날짜 자동 주입 → raw_text 에 없는 토큰이 렌더 HTML 에 주입 (Zero-Hallucination 정면 위반).
- **기존 ERR 과의 관계**:
  - 재발: 2/3/5 — ERR-FUK-customer-leaks / ERR-20260418-22·25 (flight 파싱 계열) + ERR-20260418-07 (하단 잘림·정보 손실 계열)
  - 신규: 1/4/6 — 한국어 키워드 regex 누락 / 하드코딩된 렌더 헤더 / 자동 날짜 주입의 부작용
  - 메타: ERR-KUL-05 (렌더 계약 분리) 의 연장. CRC 는 surcharges/excludes/shopping/airlineHeader 4섹션만 통합했고 **schedule/flight 파싱·호텔 activity 스킵·notices 치환은 아직 CRC 밖**.
- **해결책 (2026-04-21 적용 완료)**:
  - 즉시 (데이터): `db/patch_huangshan_render_fix_20260421.js` — 인클루전 11개로 분리 / flight 출발·도착 단일 activity `"A 출발 → B 도착 HH:MM"` 병합 / "호텔 체크인 및 휴식" → "호텔 투숙 및 휴식" / "라운드 후 석식 및 호텔 투숙" → "라운드 후 석식"
  - 구조적 1: `src/lib/standard-terms.ts:284` regex 에 negative lookbehind `(?<!출발\s?)` 추가 → "출발N일전" 은 자동 치환 제외
  - 구조적 2: `src/app/packages/[id]/DetailClient.tsx:718` 스킵 로직에 `isArrivalFlightItem` 추가 (flight type 이면서 "도착" 만 있는 2번째 flight 스킵) — 레거시 데이터 방어
  - 신규 validator W26/W27/W28 예정: register.md 체크리스트에 기록
- **검증 규칙**: W26 (inclusions 내 콤마 포함 → split 경고), W27 (하루 flight activity 2개 초과 → 통합 경고), W28 (activity 에 "체크인" 사용 → "투숙" 통일 경고)
- **상태**: PARTIAL-FIXED (2026-04-21) — 데이터 + 기본 코드 수정 완료. validator 3건은 insert-template.js 에 추가 예정 (다음 등록 시 재발 방지). DetailClient.tsx:851 하드코딩 헤더 구조적 리팩토링은 별도 작업 필요 (다른 상품 영향 테스트 후).
- **재발 방지**:
  - [ ] register.md Step 6 self-check 에 "flight 는 하루 최대 1개 activity + `→` 토큰 포함" 명시
  - [ ] register.md Step 6 self-check 에 "inclusions 는 콤마 없는 개별 토큰" 명시
  - [ ] register.md Step 6 self-check 에 "호텔 activity 는 `호텔 투숙 및 휴식` 고정 (변형 금지)" 명시
  - [ ] render-contract.ts 에 `parseFlightDepArrPair(dep, arr)` 추가 — 레거시 2-flight 데이터도 통합 파싱 가능하도록 (구조적 fix)

---

### ERR-process-violation-auto-approve@2026-04-21: /register CLEAN 상품 자동 승인·결과값 도출 누락

- **발견일**: 2026-04-21 (황산 송백CC 골프 2건 등록 후 사장님 지적)
- **증상**: audit_status=clean 으로 감사 통과한 BA-TXN-04-01 / BA-TXN-05-01 을 Agent 가 status=pending 상태로 두고 "어드민 가서 승인하세요 / http://localhost:3000/admin/packages?status=pending" 로 수동 단계 넘김. 사장님이 "업무 끝나고 바로 등록하고 결과값도출" 반복 지시했음에도 매번 누락.
- **카테고리**: 프로세스 위반 (메타)
- **근본 원인**: register.md Step 7 체크리스트 마지막 항목이 **"사용자에게 '마지막 수동 단계' 안내 (어드민 status 변경 URL) 제공했는가?"** 로 되어 있어 Agent 가 "여기서 책임이 사용자에게 넘어간다"고 해석. CLEAN 상품을 수동 승인 대상으로 오판.
- **피해**:
  - 사장님이 매 등록마다 어드민에 접속해 승인 클릭해야 하는 반복 노동
  - `/register` 의 본래 목적(원문 붙여넣기만으로 고객 노출까지) 무효화
  - 동일 지적 수 회 반복 → 신뢰 손상
- **해결책**:
  - 구조적 1: `register.md` 메타 규칙 강화 — "CLEAN 상품은 Agent 가 직접 `PATCH /api/packages/[id]/approve` 호출해 `status='active'` 활성화. '마지막 수동 단계' 금지"
  - 구조적 2: `register.md` Step 7 에 **7-A (자동 승인)** + **7-B (결과값 조회)** + **7-C (한 화면 리포트)** 3단 분리 추가
  - 구조적 3: self-check 체크리스트 2개 항목 신규 — `[필수] approve API 호출`, `[필수] 활성화 후 최종 결과값 조회·출력`
  - 구조적 4: warnings 상품만 사장님에게 `force=true` 여부 1회 질문. blocked 는 수정·재감사.
- **검증 규칙**: Agent self-check (제출 전 "approve API 호출 + 최종 결과값 출력했는가?" 확인)
- **상태**: FIXED (2026-04-21)
- **재발 방지**:
  - register.md Step 7 메타 규칙이 "등록-감사-승인-결과값 전부 Agent 책임" 으로 명시됨
  - 자동 승인 실패 감지: 최종 리포트에 `status: active` 문자열이 없으면 Agent 가 자체 self-check 실패로 간주하고 다시 승인 시도
  - feedback 메모리 `feedback_register_full_autocomplete.md` 로 영속

---

### ERR-process-violation: /register Step 7 자동 감사 누락 (Agent 절차 위반)

- **발견일**: 2026-04-18 (랜드부산 나가사키 골프 2건 등록 후 사장님 지적)
- **증상**: Agent가 INSERT만 실행하고 Step 7(post_register_audit)을 생략. 사용자에게 "나중에 수동으로 실행하세요"라고 안내.
- **카테고리**: 프로세스 위반 (메타)
- **근본 원인**: register.md의 Step 7이 "선택적"처럼 해석됨. Agent가 "사용자가 명시적으로 지시 안 했다"는 이유로 생략.
- **피해**: 
  - 경고 3건 (과거 출발일 17건 / meta 누락 / 콤마 관광지) 사용자가 모르는 상태로 pending 상품 됨
  - 사용자가 감사 단계를 매번 수동 실행해야 함 → 설계 목적(자동화) 자체 무효화
- **해결책**:
  - 구조적 1: `register.md` Step 7 "MANDATORY — 절대 생략 금지" 명시 + self-check 체크리스트
  - 구조적 2: `db/templates/insert-template.js` 의 `run()` 함수 끝에서 `spawnSync('node', ['post_register_audit.js', ...ids])` 자동 호출 (코드 강제)
  - 구조적 3: 신규 insert 스크립트 템플릿에 동일 훅 포함
  - 구조적 4: `SKIP_POST_AUDIT=true` 환경변수로만 스킵 가능 (CI/테스트용)
  - 구조적 5: `CLAUDE.md` 섹션 0 에 "프로세스 완수 메타 규칙" 추가 — "INSERT 성공 = 완료 아님"
- **검증 규칙**: Agent self-check (제출 전 "post_register_audit 실행했는가?" 확인)
- **상태**: FIXED (2026-04-18)
- **재발 방지**: 코드 레벨 강제 (spawnSync) + 프로세스 문서 레벨 강제 (MANDATORY) + 메타 규칙 (CLAUDE.md)

---

### ERR-audit-fuzzy: audit_render_vs_source 공백/괄호 차이로 인한 false alarm

- **발견일**: 2026-04-18 (Gemini 아키텍처 리뷰)
- **증상**: "머라이언공원" vs "머라이언 공원" 처럼 공백 한 칸 차이로 "렌더 누락" 경고. 결과: Alert fatigue — 사용자가 진짜 누락도 무시하게 됨.
- **카테고리**: 검증 + UX
- **근본 원인**: `setDiff()` 가 단순 Set 비교 — 문자열 literal 1:1 매치.
- **해결책**:
  - 구조적: `normalizeEntity()` 추가 — 공백/괄호내용/특수기호(·&) 제거 + 소문자 변환 후 비교
  - normalized 기반 Set 비교. 원본은 display용으로 유지
- **상태**: FIXED (2026-04-18, `db/audit_render_vs_source.js`)
- **재발 방지**: 감사 전 정규화 의무화. 향후 regex-기반 fuzzy 필요 시 별도 threshold 로직 추가.

---

## 📋 최근 10건 체크리스트 (/register 자동 주입용)

파싱 시 아래 각 항목이 재발하지 않는지 self-check:

- [ ] **ERR-20260418-01**: min_participants가 원문 숫자와 일치하는가? (템플릿 기본값 4 금지)
- [ ] **ERR-20260418-02**: notices_parsed 예시 목록이 원문 그대로 보존되었는가? (축약 금지)
- [ ] **ERR-20260418-03**: surcharges 객체 배열에 start/end/name/amount 모두 있는가?
- [ ] **ERR-20260418-04**: optional_tours의 price 필드가 일관된 형식인가?
- [ ] **ERR-20260418-05**: 일정 내 관광지가 attractions 테이블에 있는가? 없으면 시드 필요.
- [ ] **ERR-20260418-06**: 요일 범위 병합("일-수", "화-수")이 없어야 한다. Strict Grouping: 1 요일 = 1 행.
- [ ] **ERR-20260418-07**: A4 포스터 페이지 분배(estimateDayHeight) 보수적 추정 유지. 하단 잘림 시 즉시 보고.
- [ ] **ERR-20260418-08**: OptionalTours 같은 섹션은 한 위치에서만 렌더링 (Page 1 또는 마지막 페이지 택1).
- [ ] **ERR-20260418-09**: optional_tours 필드 스키마 일관성(price string + price_usd number 모두 지원).
- [ ] **ERR-20260418-10**: 신규 DB 컬럼 추가 시 반드시 PACKAGE_LIST_FIELDS에도 추가 (API 응답 누락 방지).
- [ ] **ERR-20260418-11**: 요금표 행 수가 많으면(>15) 별도 페이지 분리. Page 1 `overflow: hidden`에 의한 무성 잘림 방지.
- [ ] **ERR-20260418-14**: surcharges 객체 배열 + excludes 문자열 surcharge는 **Union 병합** (가이드경비/싱글차지 누락 방지).
- [ ] **ERR-20260418-15**: 요금표 페이지 임계값 18/24 유지. Page 1 공간 최대 활용.
- [ ] **ERR-20260418-16**: 월 헤더는 단일 월 청크에서도 항상 표시.
- [ ] **ERR-20260418-17**: 정규식 기반 필드 추출은 non-greedy + 단어 경계. "→ X 도착" 같은 명시 패턴 우선.
- [ ] **ERR-20260418-33 (메타 최상위)**: 관광지 관련 작업 전 `.claude/commands/manage-attractions.md` 필수 Read. 임시 시드 스크립트 생성 금지. 기존 `/admin/attractions`, `/api/attractions` 사용.
- [ ] **ERR-20260417-01**: 출발일 요일이 강제 병합되지 않았는가? (ERR-20260418-06으로 강화)
- [ ] **ERR-20260417-02**: "출확/출발확정" 문구가 confirmed 플래그에 반영되었는가?
- [ ] **ERR-20260417-03**: "A, B, C" 같은 콤마 관광지가 개별 schedule item으로 분리되었는가?
- [ ] **ERR-20260417-04**: 중복 감지 시 출발일 겹침 확인했는가? (isSamePriceDates 사용)
- [ ] **ERR-KUL-01 (W16)**: `departure_days`가 평문인가? `["금"]` 같은 JSON 배열 문자열 금지.
- [ ] **ERR-KUL-02/03 (W18)**: 각 DAY의 관광지가 **해당 상품 원문 블록에 실제 존재**하는가? 원문에 없는 랜드마크를 "공통으로 있을 법해서" 임의 삽입하지 말 것. 한 원문에 복수 상품이 있을 때 가장 빈번.
- [ ] **ERR-KUL-04 (W17)**: `optional_tours` 의 "2층버스" / "리버보트" 같은 모호 이름에 `region` 필드가 채워져 있는가? 원문 `[X 선택관광]` 섹션 헤더 주의.
- [ ] **ERR-KUL-05 (메타)**: 새 렌더링 로직을 추가할 때 `YeosonamA4Template.tsx` / `DetailClient.tsx` 내부가 아니라 `src/lib/itinerary-render.ts` 공통 헬퍼로 추가했는가? 렌더러는 헬퍼 출력만 소비.
- [ ] **ERR-KUL-safe-replace**: 중복 상품 감지 시 completeness score 비교했는가? 20%+ 하락 시 `pending_replace` 로 보류.
- [ ] **ERR-audit-fuzzy**: audit_render_vs_source 결과가 "공백 차이" 같은 false alarm 아닌가? `normalizeEntity()` 통과 여부 재확인.
- [ ] **ERR-FUK-rawtext-pollution@2026-04-19** (Rule Zero): `raw_text`에 **원문 원본 그대로** 저장했는가? 파서 요약/정규화 버전 금지. `raw_text_hash = sha256(raw_text)` 동반 저장. 증상: LB-FUK-03-01/02에서 raw_text가 1035자 요약본으로 저장되어 E1 감사가 오염된 기준을 사용, "2억 여행자보험" 주입 통과.
- [ ] **ERR-FUK-insurance-injection@2026-04-19** (E1): `inclusions`에 "2억/1억 여행자보험" 같은 원문 없는 금액을 임의 주입하지 않았는가? 일반 패키지 관행 차용 금지.
- [ ] **ERR-FUK-regions-copy@2026-04-19** (E2): 한 원문에서 파생한 복수 상품(정통/품격 등)의 `itinerary_data.days[].regions`를 서로 복사하지 않았는가? 각 상품 원문 "지역" 컬럼대로 개별 매핑.
- [ ] **ERR-FUK-date-overlap@2026-04-19** (E3): `excluded_dates`와 `surcharges` 기간에 **같은 날짜가 동시 존재**하지 않는가? 출발 불가 날짜에 추가요금 모순.
- [ ] **ERR-FUK-clause-duplication@2026-04-19** (E4): 특약 상품(notices_parsed에 PAYMENT 블록)에 표준약관 '30일 전까지 취소'가 같이 렌더되지 않는가? `mergeNotices()` 헬퍼 사용 필수.
- [ ] **ERR-FUK-ai-cross-check@2026-04-19** (E5): AI 의미 감사(Gemini 2.5 Flash)가 `post_register_audit.js`에 통합됨. CRITICAL/HIGH → audit_status 'warnings' 승격. E1~E4가 못 잡는 "송영비 경고 증발", "클럽식 조건부 포함 누락", "특약→표준약관 왜곡" 같은 축약형 오류 자동 탐지. `audit_report.ai.missing_from_render / distorted_in_render / hallucinated_in_render` 참조.
- [ ] **ERR-FUK-audit-gate@2026-04-19** (Gate): `travel_packages.audit_status` 컬럼으로 감사 결과 게이트 구축. blocked 상품은 `/api/packages/[id]/approve` 가 409 반환 + 고객 노출 쿼리 이중 가드(`audit_status.neq.blocked`). warnings는 `force=true` 로 수동 승인 필요.
- [ ] **ERR-LB-DAD-keyword-spillover@2026-04-20** (matcher): `attraction-matcher.ts`의 6단계 keyword split 매칭에서 도시명 단독("호이안")이 attraction 이름의 키워드로 분리될 때 stop-words가 아니면 모든 동일 도시 activity에 잘못 매칭됨. 증상: "호이안 야경 감상" / "호이안 특산 못주스" → "호이안 바구니배" 카드 5번 등장. 해결: MATCH_STOP_WORDS에 호이안·나트랑·달랏·하롱·치앙마이·쿠알라 등 추가. 신규 지역 attraction 등록 시 도시명도 stop-words에 동시 등록 필수.
- [ ] **ERR-LB-DAD-displayprice@2026-04-20** (render): `DetailClient.tsx` displayPrice가 `selectedDateInfo?.price`를 minPrice보다 우선 → 디폴트 selectedDate가 자동 설정되면 "최저가" 카드 자리에 임의 출발일 가격 표시. 증상: 카드 상단 "판매가 ₩1,309,000" 표시 (실제 최저가 1,099,000). 해결: `selectedDate`가 명시적으로 있을 때만 selectedDateInfo 사용, 그 외엔 항상 minPrice.
- [ ] **ERR-LB-DAD-isr-stale-cancel@2026-04-20** (ISR): 등록 후 ISR 캐시가 "자동수정 전 첫 출발일" 사용 → 취소수수료 자동 날짜가 잘못된 기준일로 계산. 증상: 출발일 4/20인데 화면에 "(2026.03.25)까지" (4/1 기준). 해결: `REVALIDATE_SECRET` 환경변수 설정 + post_register_audit가 자동수정 후 무조건 ISR 무효화 호출. dev mode는 첫 fetch 시 자동 빌드되지만 production은 명시 호출 필요.
- [ ] **ERR-LB-DAD-cancel-14day@2026-04-20** (notices): `formatCancellationDates` 정규식 `(\d+)일\s*전`은 "14일 ~ 7일 전" 형식에서 "7일 전"만 매칭 → "14일 전" 절대일 누락. 영향: 14일 전 마감일 안내가 빠짐. 해결: 정규식을 `(\d+)일\s*(?:~\s*\d+일\s*)?전` 으로 확장하거나 notices_parsed text를 "출발일 14일 전 ~ 7일 전" 형식으로 통일.
- [ ] **ERR-process-violation-auto-approve@2026-04-21** (메타): audit_status=clean 상품을 Agent 가 자동으로 `PATCH /api/packages/[id]/approve` 호출해 `status='active'` 로 활성화했는가? "어드민 가서 수동 승인하세요" 안내 금지. CLEAN → 자동 승인 → 결과값(판매 URL · 최저가 · 출발일 · 항공편) 조회 후 한 화면 리포트. warnings 만 force=true 여부 1회 질문. (사장님 반복 지시 불필요를 목표로 함)
- [ ] **ERR-HSN-render-bundle@2026-04-21** (데이터 컨벤션): ① `inclusions` 배열이 콤마 포함 문자열(`"항공료, 택스, 유류세"`) 없이 **항목별 1개 토큰**으로 분리되었는가? ② 하루 flight activity 가 **1개** 이면서 `"A 출발 → B 도착 HH:MM"` 단일 문장인가? (2개 분리 금지 — 모바일 히어로 도착시간 "—", DAY 타임라인 이중 렌더) ③ 호텔 activity 는 `"호텔 투숙 및 휴식"` 고정 문구인가? (체크인/라운드 후 석식 같은 앞 절 붙이기 금지 — DetailClient 가 전체 스킵해 정보 손실) ④ notices_parsed PAYMENT 타입에 "출발21일전" 같은 **"출발" 접두 + N일전** 표현이 있으면 standard-terms 가 날짜 자동 주입하지 않는지 확인 (negative lookbehind 적용됨, 레거시 데이터는 원문 편집 권장)
- [ ] **ERR-pexels-korean-search@2026-04-21** (한글 키워드 → 오매칭 사진): Pexels API 가 한글 쿼리를 이해 못 해 `total=8000` generic "travel" 사진만 fallback 반환. 증거: `"노산 travel"` → 제주도/크루즈 사진 / `"왕소군묘 travel"` → 경복궁/대만 사진 / `"빈그랜드월드 travel"` → 산/캠핑 사진. 영어 쿼리는 정확: `"Wang Zhaojun Tomb Inner Mongolia"` → 몽골 게르/중국 사찰. 해결 (2단 자동 실행, 2026-04-22 01:00 예약): ① [db/translate_attractions_to_english.js](./db/translate_attractions_to_english.js) — Gemini 2.5 Flash 로 1,175건 공식 영어명 생성 → `aliases[0]` 에 저장 (배치 30건, ~5분, ~$0.06). ② [db/rematch_pexels_photos.js](./db/rematch_pexels_photos.js) — 영어 alias 우선 Pexels 재검색 → `photos` 교체 (18초/req, ~6시간). ③ [src/app/api/attractions/photos/route.ts](./src/app/api/attractions/photos/route.ts) POST — `attractionId` 파라미터 지원, 서버가 aliases 에서 영어명 자동 선택. ④ [src/app/admin/attractions/page.tsx](./src/app/admin/attractions/page.tsx) autoGeneratePhotos + 수동 검색 기본 키워드 모두 영어 alias 우선. 실행: Windows Task Scheduler `YeosonamPexelsRematch` (2026-04-22 01:00 one-shot). 체크포인트(JSON) 로 중단·재개 가능. 재발 방지: 신규 관광지는 CSV 업로드 시 Gemini 자동 번역을 옵션으로 제공 예정 (Phase 2).
- [ ] **ERR-attractions-emoji-label-merged@2026-04-21** (이모지 컬럼 레이블 오염): 관광지 CSV 업로드 후 관리자 화면에 `"📍 관광 노산"`, `"💎 선택관광 트라이쇼"` 처럼 name 앞에 배지 라벨이 붙어 보이는 증상. 진단 결과 DB `name` 은 정상(`"노산"`, `"트라이쇼"`) 이지만 **`emoji` 컬럼에 `"📍 관광"` / `"💎 선택관광"` / `"🛍️ 쇼핑"` / `"⛳ 골프"` 같은 이모지+label 복합값**이 **142건** 저장됨 (패턴 분포: 📍관광 113 / 💎선택관광 11 / 🛍️쇼핑 10 / ⛳골프 8). UI 가 `<h3>{a.emoji} {a.name}</h3>` 렌더라서 복합 emoji + name 이 자연스럽게 `"📍 관광 노산"` 한 줄로 읽힘. 원인: 사장님이 외부 엑셀/AI 로 만든 CSV 의 emoji 칸에 표시용 복합값을 입력한 것으로 추정 (unmatched CSV 다운로드는 emoji=`""` 빈 값). 해결: ① [db/patch_attractions_emoji_pollution_20260421.js](./db/patch_attractions_emoji_pollution_20260421.js) 로 142건 즉시 정리 (첫 공백 앞까지만 유지 → "📍 관광" → "📍"). ② [src/app/api/attractions/route.ts](./src/app/api/attractions/route.ts) PUT·POST 에 `sanitizeEmoji()` + `sanitizeName()` 추가 — 업로드 시 자동 정제. ③ bullet 기호(▶·☆·-·•) 제거 + label prefix 제거도 함께. 재발 방지: CSV 업로드 API 는 모든 표시 필드(name·emoji) 에 sanitize 함수를 반드시 적용.
- [ ] **ERR-attractions-csv-badge-check@2026-04-21** (CSV 업로드 0건 반영): 사장님 CSV 업로드 시 "0건 반영 (총 146건)" 침묵 실패. 서버 로그: `[Attractions CSV] 배치 upsert 오류: new row for relation "attractions" violates check constraint "attractions_badge_type_check"`. 원인: DB `attractions.badge_type` CHECK 제약이 `[tour, special, shopping, meal, optional, hotel, restaurant, golf, activity, onsen]` 만 허용하는데, 엑셀 편집 과정에서 badge_type 칸이 **빈 문자열("")**, **한글 label ("관광"/"특전")**, **대소문자 변형("Tour")** 으로 들어가면 전체 배치 거부. 기존 API 코드 `(i.badge_type as string) || 'tour'` 는 빈 문자열이면 'tour' fallback 이지만 **엑셀에서 "관광" 같은 label 로 바뀐 경우 그대로 통과** → CHECK 실패. 추가로 API 는 배치 전체 실패를 "0건 반영" 으로만 반환해 사장님이 원인 파악 불가. 해결: ① [src/app/api/attractions/route.ts](./src/app/api/attractions/route.ts) PUT 에 `normalizeBadgeType()` 추가 — 한글 label → value 매핑(관광→tour, 특전→special 등) + 대소문자 무시 + unknown → 'tour' fallback. ② 배치 실패 시 **단건 fallback 루프**로 성공 건 최대화 + 실패 row 식별. ③ 응답에 `errors[]` + `totalErrors` + `skippedDuplicates` 포함. ④ [admin/attractions/page.tsx](./src/app/admin/attractions/page.tsx) alert 에 실패 상세(name + 사유) 상위 5건 노출. ⑤ 배치 내 name 중복 자동 제거 (ON CONFLICT DO UPDATE 2회 금지 사고 방지). 재발 방지: CSV 업로드 API 는 항상 ① 관대한 정규화 ② 단건 fallback ③ 응답에 per-row error 배열 — 3대 원칙.
- [ ] **ERR-unmatched-queue-middleware-401@2026-04-21** (대형 누락): 2026-04-10 ~ 2026-04-21 사이 등록된 **16개 상품 전체의 unmatched_activities 자동 큐잉이 침묵 실패**. 원인: `src/app/packages/[id]/page.tsx` SSR 에서 `fetch('https://yeosonam.com/api/unmatched', ...)` self-call 을 했으나 `/api/unmatched` 가 `src/middleware.ts` `PUBLIC_PATHS` 에 **없어서** middleware 가 `/login?redirect=%2Fapi%2Funmatched` 로 301 리다이렉트 → `.catch(() => {})` 로 실패 삼킴 → 침묵 누락. 영향: **142건의 미매칭 activity 가 관리자 UI 에서 영원히 사라짐** (호화호특 11개·칭다오 13개·북해도 15개·다낭 16개 등). 증상: `/admin/attractions/unmatched` "미매칭 200건" 이 실제 필요분 대비 과소 표시. 해결: ① `page.tsx` 의 fetch self-call 을 **`supabaseAdmin.upsert` 직접 호출**로 교체 (middleware 독립 — HTTP 오버헤드 + baseUrl 분기 + 인증 모두 제거). ② `db/backfill_unmatched_20260421.js` 로 누락 142건 일괄 백필 (중복 제거 → 96건 upsert → pending 203 → 294 증가). 재발 방지: ① **SSR → 내부 API self-call 패턴 금지**. 같은 서버 안에서는 supabaseAdmin 직접 사용. ② 신규 API route 추가 시 `PUBLIC_PATHS` 반영 규칙 재강조. ③ `.catch(() => {})` 로 에러 삼키는 패턴은 **로그라도 남기기** (`console.error`).
- [ ] **ERR-unmatched-limit-200@2026-04-21** (관리 API 하드코딩 LIMIT 잔재): `/admin/attractions/unmatched` 에 "미매칭 200건" 으로 고정 표시되지만 실제 `unmatched_activities` 테이블에는 **pending 203건 + ignored 4건 = 총 207건** 존재. 원인: [src/app/api/unmatched/route.ts](./src/app/api/unmatched/route.ts) GET 에 하드코딩된 `.limit(200)` 이 남아 있음 (초기 MVP 값이 그대로 배포). 해결: attractions 와 동일하게 1000 건 페이지네이션 루프. 영향: 3건 침묵 누락 + `bulkIgnore`·`downloadCSV` 일괄 작업이 누락 건을 못 처리. 재발 방지: 관리자 전용 API 전반에 하드코딩 LIMIT 검출 audit 필요 (다음 `grep '\.limit\([0-9]\+\)'` 으로 전수 조사).
- [ ] **ERR-attractions-limit-1000@2026-04-21** (PostgREST max-rows 침묵 cap): `/admin/attractions` 헤더에 "총 1000개"로 표시되지만 실제 DB에는 **1097건** 등록됨. 원인: `/api/attractions` GET 이 `.limit(5000)` 을 호출해도 Supabase PostgREST 기본 max-rows=1000 에서 서버 측 cut. UI 는 받은 배열 length 를 신뢰하므로 97건 침묵 누락 + "사진 미등록" 통계도 왜곡. 해결: [src/app/api/attractions/route.ts](./src/app/api/attractions/route.ts) GET 에 **1000 건 단위 페이지네이션 루프** 추가 (`range(from, from+999)` 반복, data.length<1000 일 때 종료). 검증: `curl /api/attractions` → attractions.length 1097 확인됨. 재발 방지: 다른 대용량 테이블 (bookings/customers) GET API 도 동일 패턴 검토 필요. 일반 원칙 — **PostgREST 기본 max-rows 초과 가능성이 있으면 반드시 `.range()` 루프 또는 `count: 'exact'` 헤더로 전체 수 비교**.
- [ ] **ERR-HET-render-over-split@2026-04-21** (splitScheduleItems 과다 분리): ▶+`,` activity 를 괄호 안까지 split 하는 로직이 **체험 리스트/부연 설명/연혁**을 **개별 ▶ 관광지**로 승격시키는 버그. 증상 (TT-HET-05-01/02): "▶유목민 생활 체험 (초원 오토바이, 활쏘기, ...)" → ▶초원 오토바이·▶활쏘기·▶밀크티 맛보기 6개로 분리 / "▶춘쿤산 관광 (2340M 높이의 구름 속 초원이라 불리는...)" → ▶2340M 높이의 구름 속 초원 개별 ▶ / "▶샹사완 사막 액티비티 (써핑카트, 낙타, ...)" → ▶써핑카트·▶사막낙타체험 4개 / "▶오탑사 (五塔寺, 460년 역사)" → ▶五塔寺·▶460년 역사 분리 / "▶왕소군묘 (2000년 역사, 중국 4대 미인...)" → ▶2000년 역사·▶중국 4대 미인 분리 / "▶내몽고민속용품공장 (중국 4A급, 명량관광)" → ▶명량관광 분리. 총 17개 ▶가짜 관광지 발생. 근본원인: ERR-LB-DAD-paren-split@2026-04-20 방어 로직 (괄호 안 CSV 분리)이 **지명 리스트 ↔ 설명/체험 리스트 구분 없이** 무차별 분리. 해결: `splitScheduleItems()` 에 **W30 휴리스틱** 추가 — 괄호 뒤 suffix 가 비어 있거나 괄호 안에 서술 키워드(년 역사/M 높이/체험/관람/상징/불리는 등)가 있으면 분리 skip. 호이안 케이스("▶호이안 구시가지 (풍흥의 집, 일본내원교, ...) 유네스코 지정 전통거리 관광")는 suffix "유네스코..." 가 있어서 기존 동작 유지. Agent 는 **애초에 괄호 안 콤마를 `·` 로 변환** 하여 INSERT 하는 것이 가장 안전. 재발 방지: ① [register.md W30](./.claude/commands/register.md) 체크리스트 ② [insert-template.js:splitScheduleItems](./db/templates/insert-template.js) heuristic ③ Gemini E5 `--ai` ON 고려 (렌더 HTML ↔ 원문 의미 대조).
- [ ] **ERR-HET-single-charge-misclass@2026-04-22** (싱글차지 "기간별 추가요금" 오분류): TT-HET-05-01/02 렌더에서 원문 `불포함: ..., 싱글차지(200,000원/인/전일정), ...` 이 모바일 "💲 기간별 추가 요금 • 싱글차지..." + "※ 위 기간 출발 시 1박당 해당 금액이 추가됩니다." 로 노출됨. 근본원인: [render-contract.ts:295](./src/lib/render-contract.ts) `SURCHARGE_RE = /...싱글차지.../` 패턴이 excludes 의 "싱글차지" 항목을 자동 써차지로 승격시키고, [DetailClient.tsx:624](./src/app/packages/[id]/DetailClient.tsx) 에 "1박당 해당 금액" 안내문구가 하드코딩 되어 있어서 싱글차지에 얹혀 오표기. 싱글차지는 기간 기반 써차지가 아니라 룸타입 기반 요금 → 고객 오해. 해결: ① SURCHARGE_RE 에서 "싱글차지"·"싱글비용"·"싱글발생" 제거 → excludes.basic 으로 유지 ② DetailClient 써차지 섹션을 `structured.start` 유무로 분기 — 기간 있으면 "기간별 추가 요금" + 안내문구, 없으면 "추가 요금" 만 표시. 재발 방지: `SURCHARGE_RE` 에 "room-based" 키워드 추가 금지 — 기간 기반만 허용.
- [ ] **ERR-HET-attraction-day-duplicate@2026-04-22** (DAY 내 관광지 카드 5중복): TT-HET-05-02 DAY1 에서 "시라무런 초원" 관광지 사진+설명 카드가 5번 연달아 렌더 (승마·유목민 체험·일몰·캠프파이어·별자리 감상 activity 각각에 매칭). 모바일 스크롤 5화면 분량 중복. 근본원인: [DetailClient.tsx:675+](./src/app/packages/[id]/DetailClient.tsx) `schedule.map()` 루프 내에서 매 activity 마다 `matchAttractions()` 호출 후 **dedup 없이** 카드 렌더. 해결: 각 DAY 시작 시 `seenAttractionIds = new Set<string>()` 선언, 첫 매칭 시 `add()`, 이후 같은 id 매칭 시 카드 skip 하고 activity 텍스트만 출력. 재발 방지: 동일 패턴의 선택관광/쇼핑 카드 루프도 dedup 검증 필요.
- [ ] **ERR-HET-price-table-desc-order@2026-04-22** (A4 가격표 월 내 날짜 역순): TT-HET-05-02 8월 가격표가 `8/26→8/19→8/12→8/5` 로 원문(8/5→8/26) 과 반대 순서. 근본원인: [price-dates.ts:220](./src/lib/price-dates.ts) `rows.sort((a, b) => a.price - b.price || ...)` 가 가격 오름차순 우선. 8월은 가격이 1,599→1,199 하락세라 날짜도 역순이 됨. 7월은 가격·날짜가 같이 증가해서 정상처럼 보임. 해결: 정렬 키를 **날짜 오름차순 우선 → 가격 tie-break** 으로 변경. 최저가는 `isLowest` 뱃지로 별도 강조되므로 시각 가이드 상실 없음. 재발 방지: 같은 월 내 복수 가격 라인이 있으면 원문 날짜 순서 유지.
- [ ] **ERR-HET-hotel-ger-star@2026-04-22** (게르에 성급 임의 부여): TT-HET-05-01/02 DAY1 호텔 "비즈니스 게르" / "궁전 게르" 에 ★★★★ 4개 별 자동 부여. 원문에 게르 등급 표기 없음 → Zero-Hallucination 위반. 근본원인: [DetailClient.tsx:880](./src/app/packages/[id]/DetailClient.tsx) `parseInt(card.grade) || 4` fallback 이 "게르" 처럼 숫자 없는 등급에서 4 를 강제. 해결: `grade.match(/(\d+)\s*성/)` 로 명시적 숫자 추출, 없으면 별 대신 라벨 배지(`<span>게르</span>`) + 아이콘도 🏨 → 🛖 로 차별화. "준5성급" 은 숫자 5 추출 + "준" 작은 글자 병기. 재발 방지: 숫자 포함 등급만 별 표기, 그 외는 텍스트 배지 — 임의 숫자 fallback 금지.
- [ ] **ERR-HET-cancel-date-pollution-double-paren@2026-04-22** (취소일 괄호 중복): 모바일 품격 취소약관에 `여행개시 45일전(2026.05.24)(~45)까지 통보시` 처럼 괄호 두 개 연속 붙어 어색. 근본원인: [standard-terms.ts:287](./src/lib/standard-terms.ts) `formatCancellationDates` 정규식 `(?<!출발\s?)(\d+)일\s*전` 이 매칭 위치 뒤에 독립 괄호 `(YYYY.MM.DD)` 를 삽입. 원문 `45일전(~45)까지 통보시` 에는 이미 `(~45)` 가 있으므로 중복. 해결: 정규식에 optional capture `(\s*\(([^)]*)\))?` 추가 — 기존 괄호가 있으면 그 **안쪽 끝** 에 `, YYYY.MM.DD까지` 병합 (`(~45, 2026.05.24까지)`), 없으면 기존대로 신규 괄호 삽입. 재발 방지: notices_parsed 텍스트에 날짜 자동 주입 규칙 추가 시 **주변 구두점 맥락 확인 필수**.
- [ ] **ERR-HET-attraction-global-dedup@2026-04-22** (관광지 카드 DAY 경계 중복): 시라무런 초원이 DAY1 숙박 + DAY2 아침 일출감상 둘 다에서 매칭돼 **같은 관광지 사진+설명 카드가 2일 연속 노출**. 1차 수정(ERR-HET-attraction-day-duplicate) 은 DAY 내 dedup 만 해서 연속 DAY 는 해결 못 했음. 해결: [DetailClient.tsx:663+](./src/app/packages/[id]/DetailClient.tsx) `seenAttractionIds = new Set<string>()` 를 **days.map 바깥** 으로 이동 — 전체 일정에서 첫 번째 매칭된 activity 에만 카드, 이후 같은 attraction 은 텍스트만. 추가 수정: [page.tsx:112](./src/app/packages/[id]/page.tsx) attractions select 에 `id` 필드가 빠져 있어서 dedup 키 (`attr.id`) 가 undefined → dedup 완전 실패 → `candidateKey = attr.id || attr.name` 폴백 추가 + select 에 id 추가. 재발 방지: 상품 SSR 에서 attraction lookup 데이터는 항상 id 포함 select.
- [ ] **ERR-HET-hotel-grade-ambiguity@2026-04-22** (호텔 별만 보고 정/준5 구분 불가): 모바일 호텔 카드가 ★★★★★ 5개만 보여줘서 "정5성급" 인지 "준5성급" 인지 고객이 혼동. 해결: [DetailClient.tsx:875+](./src/app/packages/[id]/DetailClient.tsx) 별 옆에 grade 원본 텍스트(`5성급`/`준5성급`/`4성급`) 를 작은 라벨로 병기. 숫자 없는 등급("게르") 은 별 대신 텍스트 배지 + 🛖 아이콘으로 완전 차별화. 재발 방지: 별 표시는 "숫자+성" 패턴이 있는 등급만, 그 외는 명시적 텍스트 라벨.
- [ ] **ERR-HET-activity-desc-duplicate@2026-04-22** (A4 괄호 내용 2번 노출): `"▶춘쿤산 관광 (2340M...전망대관람 포함)"` 이 A4 포스터에서 **전체 activity 한 줄 + 괄호 부연 또 한 줄** 총 2줄로 중복 노출. 근본원인: [YeosonamA4Template.tsx:1482+](./src/components/admin/YeosonamA4Template.tsx) `displayName = item.activity`(괄호 포함 전체) + `displayDesc = splitPoi(item.activity).poiDesc`(괄호 부분) 둘 다 렌더. attractions 매칭 실패한 경우 활동에서 발동. 해결: attr/특전이면 displayName 에 전체 쓰고 displayDesc=null, 일반 ▶관광지(매칭 실패)면 displayName=poiName(괄호 앞), displayDesc=poiDesc(괄호 안) 로 **중복 없이** 이름·설명 분리. 재발 방지: splitPoi 쓸 때 displayName 과 displayDesc 가 동일 소스에서 나오면 한 쪽만 남길 것.
- [ ] **ERR-HET-activity-badge-paren-leak@2026-04-22** (A4 괄호 내 키워드로 특전 오판): `"▶춘쿤산 관광 (2340M 높이의 구름 속 초원...전통카트왕복 및 **전망대**관람 포함)"` 에서 괄호 안 "전망대" 키워드 때문에 `getActivityBadge()` 가 "특전" 배지를 반환. 춘쿤산은 attractions 매칭 성공해야 하지만 A4 렌더 컨텍스트에서는 attr=null 이라 fallback 로직이 돌아 오판정. 해결: [YeosonamA4Template.tsx:1352+](./src/components/admin/YeosonamA4Template.tsx) 활동 텍스트에서 **괄호 안 부연을 제거한 core 텍스트에서만** "루프탑/크루즈/요트/스파/전망대/쇼" 특전 키워드 검사. 재발 방지: 특전 판정 키워드는 항상 괄호 제외 core 에서만 매치.
- [ ] **ERR-HET-mobile-shopping-missing@2026-04-22** (모바일에 쇼핑센터 섹션 누락): A4 포스터에는 `🛍️ 쇼핑센터 / 쇼핑 3회 (침향·찻집·캐시미어 등)` 가 잘 나오지만 **모바일 상세페이지에는 쇼핑센터 섹션 자체가 없음** → 품격 상품에서 고객이 쇼핑 3회 정보를 못 봄. 해결: [DetailClient.tsx:605+](./src/app/packages/[id]/DetailClient.tsx) 써차지 섹션 다음에 `view.shopping.text` 를 소비하는 섹션 추가 (노쇼핑 표기는 숨김). 재발 방지: A4·Mobile 이 `renderPackage()` 의 모든 view.* 필드를 동일하게 소비해야 함 — CRC 필드별 렌더 커버리지 체크리스트 필요.
- [ ] **ERR-HET-a4-shortdesc-duplicate@2026-04-22** (A4 attraction short_desc 반복 노출): A4 DAY1 에서 시라무런 초원 매칭된 5개 activity(승마·유목민·마상공연·일몰·캠프파이어·별자리) 모두에 `— 광활한 초원 산책과 승마 체험` 가 반복 노출. 근본원인: [YeosonamA4Template.tsx:1503](./src/components/admin/YeosonamA4Template.tsx) `{attr?.short_desc && <span>— {attr.short_desc}</span>}` 가 dedup 없이 매 activity 마다 렌더. 모바일은 이미 글로벌 dedup 적용했지만 A4 는 누락. 해결: `DailyItinerary` 함수 최상단에 `seenAttractionIdsForDesc = new Set<string>()` 선언, short_desc 렌더 시 attr.name 기준으로 첫 매칭에만 노출. 재발 방지: CRC 필드별 A4·Mobile 렌더 커버리지 체크리스트에 "관광지 dedup" 항목 추가.
- [ ] **ERR-process-violation-dump-after-approve@2026-04-22** (메타, 반복 사고): `insert-template.js` Step 7 흐름이 **감사 → auto-approve(Step 7-A) → dump(Step 7-C) → baseline(Step 7-D)** 순차 실행인데, `audit_status=warnings` 인 상품은 7-A 에서 skip 되어 `status=pending` 유지. 그 뒤 Agent 가 `approve --force` 를 호출해도 **재덤프 훅이 없어서** pending 시점 덤프만 사장님에게 보여지고 active 상태는 확인 안 됨. 보홀 솔레아 TC-BHO-05-01~06-02 등록 시 "force 승인했다" 한 줄만 보고하고 끝. 사장님: "등록완료했는데 또 결과값 도출 안함. 여러번 명령했음에도 계속 반복. 심각한오류발생". 해결: ① [db/approve_package.js](./db/approve_package.js) 끝에 `promoted[]` 배열 수집 + 성공 id 에 대해 `dump_package_result.js` 자동 spawn (`SKIP_DUMP_RESULT=1` 로만 우회 가능). 이제 `approve --force` 한 줄이 `active UPDATE + 풀덤프` 를 원자적으로 수행. ② register.md Step 7 체크리스트에 "warnings 상품 force 승인 후 dump 재실행" 명시적 요구. ③ feedback 메모리 `feedback_register_full_autocomplete.md` 에 "활성화 후 재덤프 필수" 보강. 재발 방지: approve 와 dump 는 한 스크립트에서 체이닝. Agent 가 dump 재실행을 "기억" 해야 하는 구조 자체가 취약 — 자동화로 제거.

- [ ] **ERR-special-notes-leak@2026-04-27** (구조적 — 컬럼 책임 분리 안됨): special_notes 한 컬럼이 **운영 메모 ↔ 고객 노출 fallback** 역할을 동시에 수행. CRC `resolveShopping()` 이 highlights.shopping 비어 있으면 special_notes 를 쇼핑센터 fallback 으로 노출. 캐슬렉스 GOLF 등록 시 운영성 메모(좌석조건/그린피 특가/캐디팁 등)가 모바일 🛍️ 쇼핑센터 섹션에 통째 노출됨. W21 키워드 검증은 "커미션·정산·스키마" 만 잡아 회색지대 텍스트 통과. **해결** (P0 #1): ① migration `20260427200000_split_customer_internal_notes.sql` — `customer_notes` (고객 OK) + `internal_notes` (운영 전용) 신규 컬럼 추가 + 기존 special_notes 데이터를 internal_notes 로 보수적 이관. ② [render-contract.ts](./src/lib/render-contract.ts) `resolveShopping()` fallback 출처를 `customer_notes` 로 교체, special_notes 경로 완전 제거. ③ [DetailClient.tsx](./src/app/packages/[id]/DetailClient.tsx) + [YeosonamA4Template.tsx](./src/components/admin/YeosonamA4Template.tsx) 의 special_notes fallback 렌더 모두 customer_notes 로 변경. ④ [insert-template.js](./db/templates/insert-template.js) W21 검증을 customer_notes 대상으로 강화. ⑤ `db/FIELD_POLICY.md` + `register.md` 에 신규 컬럼 사용 정책 명시. **재발 방지**: 컬럼이 두 책임을 동시에 갖는 패턴 금지. 신규 컬럼 추가 시 "이 컬럼은 고객 노출되는가?" 를 frontmatter 로 명시.
- [ ] **ERR-audit-severity-flat@2026-04-27** (UX — info ↔ warnings 혼동): post-audit 의 audit_status 가 `clean / warnings / blocked` 3단계라서 **W12 같은 안내성 경고**(splitScheduleItems 자동 분리 알림 — 데이터 무결성 영향 없음)가 환각·축약 의심(W14 등 진짜 위험)과 동일한 `warnings` 로 분류됨. 결과: clean 상품인데 `--force` 가 매번 필요 → 사장님 등록 마찰 + Agent 가 매번 사장님께 force 여부 질문. **해결** (P0 #2): ① [post_register_audit.js](./db/post_register_audit.js) `INFO_RULES = new Set(['W12'])` + `isInfoOnly()` 헬퍼로 안내성 W-code 만 있으면 audit_status='info' 분류. ② [approve_package.js](./db/approve_package.js) 가 `info` 는 자동 승인 (warnings 만 force 필요). ③ register.md Step 7 안내 4단계로 갱신. **재발 방지**: 신규 W-code 추가 시 INFO_RULES 분류 검토 — "데이터 무결성 영향 있는가?" 를 명시.
- [ ] **ERR-priceLabel-currency-prefix@2026-04-27** (UX — KRW prefix 어색 표기): CRC `mergeSurcharge` 의 priceLabel 생성 시 `${currency}${amount}` 패턴이 KRW 면 `KRW30000` 처럼 통화 코드 prefix 가 그대로 노출됨 (USD 만 `$` 변환). 캐슬렉스 GOLF 캡처에서 "💲 추가 요금 • 싱글차지: KRW30000/박/인" 으로 표시. **해결** (P0 #3): [render-contract.ts](./src/lib/render-contract.ts) priceLabel 포맷팅을 통화별 한국어 친화 표기로 교체 — KRW: `30,000원`, USD: `$30`, JPY: `¥3000`, CNY: `30元`, 기타: `${cur} ${amount}`. **재발 방지**: 통화 표기 정책은 render-contract 단일 출처 (renderer 별 자체 포맷 금지).
- [ ] **ERR-dump-string-toLocaleString@2026-04-27** (UX — 단위 충돌): `dump_package_result.js:51` 이 `(p.single_supplement || 0).toLocaleString()` + 강제 `원` suffix 호출. single_supplement 가 string("평일 30,000원/박/인 · 금토 40,000원/박/인") 일 때 `.toLocaleString()` 은 string 그대로 반환 → 끝에 `원` 붙어 "박/인" + "원" → `박/인원` 충돌. **해결** (P0 #3): typeof 분기 — string 이면 그대로, number 면 toLocaleString + `원`. **재발 방지**: 자유 텍스트 + 숫자 양쪽이 가능한 컬럼은 항상 type 분기.
- [ ] **ERR-calendar-price-round-up@2026-04-27** (UX — 가격 부풀림): `DepartureCalendar.tsx:153` 이 `Math.round(price/10000)만` 으로 표시 → 579,000원이 "58만" 으로 반올림 표기. 고객이 실제 가격보다 1,000원 비싸다고 인지하는 미세한 신뢰 손상. **해결** (P0 #3): floor + 1자리 정밀도 (`Math.floor(v*10)/10` → "57.9만" / 정수면 "57만"). **재발 방지**: 가격 표기는 항상 floor 또는 정확 표기 — round 금지.
- [ ] **ERR-meal-empty-render@2026-04-27** (UX — 귀국일 식사 섹션 잡음): DAY 마지막날(귀국일) 에 meals 객체가 모두 false + note 빈 상태로 저장되면 "조식 불포함 / 중식 불포함 / 석식 불포함" 3개 칸이 그대로 노출되어 시각 잡음. **해결** (P0 #3): [DetailClient.tsx](./src/app/packages/[id]/DetailClient.tsx) 식사 섹션 렌더 가드에 `hasAny = breakfast || lunch || dinner || any note` 조건 추가 — 모두 빈 경우 섹션 자체 숨김. **재발 방지**: 자동 렌더 섹션은 "내용 있을 때만" 표시 — 빈 상태에서 "불포함 ×3" 같은 정보 없는 표시 금지.
- [ ] **ERR-isr-revalidate-manual@2026-04-27** (UX — DB 직접 수정 후 production 캐시 stale): `db/approve_package.js` / 직접 supabase update 후 모바일 production ISR 캐시가 1시간 만료까지 stale 상태 유지. `/api/revalidate` 엔드포인트는 있지만 호출이 수동. .env.local 의 REVALIDATE_SECRET 이 placeholder 일 때 사장님 안내도 부재. **해결** (P1 #6): ① [db/_revalidate.js](./db/_revalidate.js) 헬퍼 추가 — placeholder 감지 + production·localhost 양쪽 best-effort 호출 + graceful skip. ② [approve_package.js](./db/approve_package.js) 가 active 승격 후 자동 호출. ③ skip 시 사장님께 1줄 안내(REVALIDATE_SECRET 미설정). **재발 방지**: 모든 DB 직접 수정 도구가 `_revalidate.js` 호출 — 매번 사장님이 "왜 화면 안 바뀌지?" 묻는 패턴 제거.
- [ ] **ERR-arrival-line-overmatch@2026-04-27** (UX — DAY 일정 행 누락): `DetailClient.tsx` schedule 렌더에서 `/공항 도착/.test(activity)` 정규식이 "**청도공항 도착 후 가이드 미팅 (미팅보드 \"캐슬렉스 골프\")**" 같이 도착 뒤에 추가 활동이 이어지는 행까지 잡아 `return null` → 가이드 미팅 정보가 화면에서 통째로 사라짐. 캐슬렉스 GOLF 등록 시 DAY1 [2] 행 누락 의심으로 발견. **해결** (P2): isSimpleArrival 가드 — 텍스트가 정확히 "X공항 도착" 으로 끝날 때만 skip, "도착 후 ...", "도착 - 가이드 미팅" 같은 추가 활동이 있으면 보존. `청도도착/가이드미팅` 슬래시 단일 행 케이스(기존 ERR-LB-DAD)는 호환 유지. **재발 방지**: schedule 행 skip 정규식은 항상 **anchor(`^...$`)** 또는 **negative lookahead** 사용 — 부분 매치로 텍스트 삼키기 금지. 회귀 테스트 — TBD.
- [ ] **ERR-notice-card-flat-tone@2026-04-27** (UX — type 차별화 부재): 유의사항 카드가 모두 동일한 회색 박스로 렌더되어 `[CRITICAL] 필수 확인` 과 `[INFO] 시즌 추가요금 안내` 가 시각적으로 구분 안 됨. 도트 컬러는 type 별이지만 작은 점이라 구분 약함. **해결** (P2): standard-terms.ts 에 `NOTICE_CARD_TONE` 추가 — type 별 좌측 4px border + 살짝 입힌 배경 색상. CRITICAL=red-50/border-l-red-500, PAYMENT=orange, POLICY=blue, INFO=white 등. 아코디언 닫혀 있어도 한눈에 우선순위 인지. DetailClient.tsx 적용. **재발 방지**: 신규 notice type 추가 시 NOTICE_CARD_TONE 에도 항목 추가 필수.
- [ ] **ERR-calendar-month-discoverability@2026-04-27** (UX — 다음 달 출발일 인지 부재): DepartureCalendar 가 가장 빠른 출발월에 자동 진입하지만, 그 이후 다음 달에 더 많은 출발일이 있어도 사장님/고객이 "다음 달" 버튼을 눌러야만 인지. 캐슬렉스 케이스(5월 3건 + 6월 6건)에서 5월 화면만 보고 6월 더 많다는 걸 못 봄. **해결** (P2): 캘린더 상단에 출발 가능 월 chip row 추가 — `5월(3) | 6월(6)` 같이 클릭 한 번에 점프. 2개월 이상 분포가 있을 때만 표시. **재발 방지**: 시간 분포 데이터는 항상 "현재 뷰 + 분포 미리보기" 동시 노출.
- [ ] **ERR-fixed-commission-column@2026-04-27** (구조적 — 정액 마진 워크어라운드 정리): 랜드부산(9만원/건) · 후쿠오카(10만원/건) 등 정액 마진 랜드사 정산 시 `commission_rate=0` + `special_notes`/`internal_notes` 메모 워크어라운드 사용. 메모 텍스트 누출 위험(ERR-special-notes-leak 트리거) + 정산 자동 합산 불가. **해결** (P1 #5, 사장님 명시 승인 후): ① migration `commission_fixed_amount` (NUMERIC) + `commission_currency` (TEXT default KRW) 추가. ② 기존 정액 4건(LB-FUK 2 + LB-TAO 2) 백필 — FUK 100,000원, TAO 90,000원. ③ `createInserter()` 에 `commissionFixedAmount`/`commissionCurrency` 파라미터 추가, 정액 모드 시 `commission_rate=0` 자동. ④ `dump_package_result.js` 가 정액일 때 "commission: 90,000원/건 정액" 통화별 한국어 표기. ⑤ FIELD_POLICY + register.md 사용 가이드 갱신. **재발 방지**: 신규 등록에서 정액 마진은 항상 컬럼에 명시 — `internal_notes` 에 메모 중복 기재 불필요. 회귀 — TBD.
- [ ] **ERR-bootstrap-manual-toil@2026-04-27** (구조적 — 어셈블러 신규지역 수기 생성): 신규 지역의 3번째 등록 시점에 Agent 가 수기로 어셈블러를 생성(BLOCKS 추출 + TEMPLATES + parseRawText 작성)해야 했음. 매번 60~120분 토큰·시간 소비 + Agent 가 BLOCKS 누락하거나 keywords 단순화로 향후 매칭 정밀도 손상. **해결** (P3 #1): [db/auto_bootstrap_assembler.js](./db/auto_bootstrap_assembler.js) 추가 — 등록된 N개 상품의 `itinerary_data` 에서 `▶...` 마커 활동 빈도 추출 → BLOCKS 자동 생성, accommodations → hotel_pool, airline → AIRLINES, 절반 이상 등장 inclusions/excludes → 공통 패턴. 출력은 `assembler_<slug>.stub.js` (덮어쓰기 방지) 로, Agent/사장님이 keywords 정제 + TEMPLATES 작성 + parseRawText 구현 후 `.js` 로 rename. register.md B-2 에 호출 명시. **검증**: 장가계 (DYG, 6건) 로 테스트 → BLOCKS 20개 / 호텔 3개 / 항공사 1개 / 공통 inclusions 8개 / excludes 2개 자동 추출 성공. **재발 방지**: 신규 지역 N>=3 도달 시 항상 부트스트랩 스크립트 우선 사용 — 처음부터 수기 작성 금지.
- [ ] **ERR-self-audit-gate-bypass@2026-04-27** (구조적 — Agent 자가감사 INSERT 차단 부재): `agent_audit_report` 가 `pkg` 에 첨부되어 INSERT 후 post-audit 단계에서 warnings 추가됐지만, INSERT 자체는 verdict=blocked / unsupported_critical>=1 이어도 그대로 진행됨. 환각·축약 의심 상품이 일단 DB에 들어간 후 사장님이 archive 해야 하는 단방향 흐름. **해결** (P3 #2): [insert-template.js](./db/templates/insert-template.js) `validatePackage` 호출 직후 게이트 추가 — `verdict=='blocked'` 또는 `unsupported_critical>=1` 면 `validationErrors` 에 추가해 기존 skip 로직으로 차단. `unsupported_high>=3` 은 기본 warnings, `STRICT_AUDIT=true` 시 차단. report 누락은 STRICT_AUDIT 시에만 차단(기본 통과). 회귀 테스트 — `tests/regression/cases/ERR-self-audit-gate-bypass.test.js` 8개 케이스. **재발 방지**: pre-INSERT 게이트가 SSOT — post-audit 의 warnings 승격은 그 이후 단계 보조 검증으로만 활용.
- [ ] **ERR-graybox-existing-data@2026-04-27** (구조적 — 정책 변화 이전 등록분 회색지대): customer_notes/internal_notes 분리, commission_fixed_amount, FIELD_POLICY 강화 등 P0~P2 정책 도입 이전에 등록된 112개 상품의 회색지대 데이터 식별 부재. 사장님이 "어떤 상품이 위험한지" 일괄 파악 불가. **해결** (P3 #3): [db/audit_existing_packages.js](./db/audit_existing_packages.js) 추가 — 7개 룰 점검(SPLIT-NOTES / CUSTOMER-LEAK / FIXED-COMMISSION-MISSING / SHOPPING-NOT-SPECIFIED / AUDIT-STATUS-NULL / NOTICES-EMPTY / NUMBER-COMMA-RESIDUE) + 한 화면 리포트(심각도/코드별 분포) + JSON 출력(작업 큐) + `--fix-split-notes` 안전 자동 수정. **결과** (2026-04-27 1차 실행): 112건 중 17건 clean, 95건 이슈 — high 0건 / medium 69건(SHOPPING 미설정 레거시) / low 95건(AUDIT-STATUS null 레거시). 즉시 위험 없음 확인. **재발 방지**: 정책 변경 시 기존 데이터 점검 스크립트를 함께 만들어 회색지대 가시화 — 구조 변경 후 "보이지 않는 잔여 위험" 패턴 차단.
- [ ] **ERR-regression-coverage-gap@2026-04-27** (인프라 — 회귀 fixture 커버리지 가시화 부재): error-registry.md 에 67개 ERR 누적되어 있으나 회귀 fixture 가 어느 ERR 를 보호하는지 / 어느 ERR 가 변환 후보인지 가시화 불가. 사장님/Agent 가 "다음 fixture 작성 우선순위" 판단 어려움. **해결** (P3 #4): ① [tests/regression/err-coverage.js](./tests/regression/err-coverage.js) 추가 — error-registry.md 파싱 + fixture `@case` 헤더 추출 + 매칭 + 카테고리별 변환 후보 추천 (UX/구조적/데이터 적합도 휴리스틱). ② 5건 신규 fixture 추가 (ERR-arrival-line-overmatch / ERR-meal-empty-render / ERR-dump-string-toLocaleString / ERR-fixed-commission-format / ERR-W21-internal-keywords) — 70개 테스트로 확장. ③ npm scripts: `test:regression:coverage`, `test:regression:uncovered`. **결과** (2026-04-27): 커버리지 0% → 12% (8/67) + 7건 다음 후보 식별. **재발 방지**: 신규 fixture 작성 시 `@case` 헤더 명시 + ERR 코드는 registry 와 동일 — coverage 스크립트가 자동 매칭.
- [ ] **ERR-regression-coverage-batch2@2026-04-27** (인프라 — 회귀 커버리지 21% 도약): P3 #4 1차(12%) 후 사장님 "한번 싹 다" 지시로 변환 후보 6건 일괄 추가. **해결**: 6건 신규 fixture (ERR-HSN-render-bundle / ERR-isr-revalidate-manual / ERR-notice-card-flat-tone / ERR-calendar-month-discoverability / ERR-fixed-commission-column / ERR-bootstrap-manual-toil) — 125개 테스트. ERR-graybox-existing-data 는 **사장님 지시로 제외** (등록 상품 데이터 의존, 곧 일괄 아카이브 예정이라 의미 없음). **결과** (2026-04-27 batch2): 커버리지 12% → **21%** (14/68) + 회귀 테스트 70 → **125개**. **재발 방지**: 코드 안전망(데이터 의존 X) 우선 변환 — 데이터 의존 ERR 은 fixture 화 부적합으로 명시적으로 제외.
