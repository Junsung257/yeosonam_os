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

### ERR-20260418-01: min_participants 10명 → 4명 조작

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이 단수이 3박 4일 — 투어폰)
- **원문 vs 결과**: 원문 "성인 10명 이상 출발 가능" → DB `min_participants: 4`
- **카테고리**: AI 파싱
- **근본 원인**: Sonnet Agent가 insert-template의 템플릿 기본값(4)을 원문 대신 사용. 원문 명시 값이 있어도 덮어씀.
- **해결책**:
  - 즉시: DB UPDATE `min_participants = 10`
  - 구조적 1: `/register` 커맨드에 Zero-Hallucination 프로토콜 추가 — "숫자는 1:1 매핑, 템플릿 기본값 금지"
  - 구조적 2: `validatePackage` W13 추가 — 원문에서 "N명 이상" 추출 → min_participants 대조
- **검증 규칙**: W13
- **상태**: IN_PROGRESS (P1 + P3 + P4에서 해결)
- **재발 방지**: W13 + Zero-Hallucination 체크리스트

---

### ERR-20260418-02: notices_parsed 육류 예시 축약

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: 원문 "(라면스프, 소세지/햄, 육포, 소고기고추장볶음(튜브형 포함), 육류가 들어간 면 종류, 베이컨 등)" → DB "위반 시 벌금"으로 축약
- **카테고리**: AI 파싱
- **근본 원인**: Sonnet Agent가 "보기 좋게 정리"하려는 경향으로 구체 예시 5개를 한 단어로 압축. 대만은 라면스프 하나만 걸려도 수백만 원 벌금이 나오는 법적 리스크 직결.
- **해결책**:
  - 즉시: DB UPDATE — notices_parsed[0].text에 원문 예시 복원
  - 구조적 1: `/register` 커맨드에 "예시 목록 축약 금지" 규칙
  - 구조적 2: `validatePackage` W14 — 원문 비고 길이 대비 notices_parsed 길이 비율 체크
- **검증 규칙**: W14
- **상태**: IN_PROGRESS (P1 + P3 + P4)
- **재발 방지**: W14 + Zero-Hallucination

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
- **해결책 (부분)**:
  - 구조적 1: `src/lib/itinerary-render.ts` 공통 헬퍼 모듈 도입 (Layer 3)
  - 구조적 2: `normalizeOptionalTourName`, `formatDepartureDays` 등 **좁은 범위의 shared helper**부터 도입 (거대한 어댑터 한 번에 만들지 않음)
  - 구조적 3: `.claude/commands/validate-product.md` 신규 — 등록 후 3자 대조 검증 단계 공식화
  - 향후: 일정 타임라인, 관광지 매칭, 미매칭 수집도 점진적으로 이관
- **상태**: IN_PROGRESS (2026-04-18 Layer 3 착수)
- **재발 방지**: "렌더러가 pkg 필드를 직접 해석하지 않는다. 공통 헬퍼/어댑터 출력만 소비한다." 원칙. 새 렌더링 로직은 `src/lib/itinerary-render.ts` 에 추가.

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
