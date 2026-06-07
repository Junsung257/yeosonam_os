# Common Errors

Last updated: 2026-06-07

문서 운영, lint, 프레임워크 업그레이드, 공통 UI/렌더링, 운영 절차 반복 오류 상세.

## ERR-regression-coverage-gap@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:980`

- [ ] **ERR-regression-coverage-gap@2026-04-27** (인프라 — 회귀 fixture 커버리지 가시화 부재): error-registry.md 에 67개 ERR 누적되어 있으나 회귀 fixture 가 어느 ERR 를 보호하는지 / 어느 ERR 가 변환 후보인지 가시화 불가. 사장님/Agent 가 "다음 fixture 작성 우선순위" 판단 어려움. **해결** (P3 #4): ① [tests/regression/err-coverage.js](../../tests/regression/err-coverage.js) 추가 — error-registry.md 파싱 + fixture `@case` 헤더 추출 + 매칭 + 카테고리별 변환 후보 추천 (UX/구조적/데이터 적합도 휴리스틱). ② 5건 신규 fixture 추가 (ERR-arrival-line-overmatch / ERR-meal-empty-render / ERR-dump-string-toLocaleString / ERR-fixed-commission-format / ERR-W21-internal-keywords) — 70개 테스트로 확장. ③ npm scripts: `test:regression:coverage`, `test:regression:uncovered`. **결과** (2026-04-27): 커버리지 0% → 12% (8/67) + 7건 다음 후보 식별. **재발 방지**: 신규 fixture 작성 시 `@case` 헤더 명시 + ERR 코드는 registry 와 동일 — coverage 스크립트가 자동 매칭.

---

## ERR-regression-coverage-batch2@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:981`

- [ ] **ERR-regression-coverage-batch2@2026-04-27** (인프라 — 회귀 커버리지 21% 도약): P3 #4 1차(12%) 후 사장님 "한번 싹 다" 지시로 변환 후보 6건 일괄 추가. **해결**: 6건 신규 fixture (ERR-HSN-render-bundle / ERR-isr-revalidate-manual / ERR-notice-card-flat-tone / ERR-calendar-month-discoverability / ERR-fixed-commission-column / ERR-bootstrap-manual-toil) — 125개 테스트. ERR-graybox-existing-data 는 **사장님 지시로 제외** (등록 상품 데이터 의존, 곧 일괄 아카이브 예정이라 의미 없음). **결과** (2026-04-27 batch2): 커버리지 12% → **21%** (14/68) + 회귀 테스트 70 → **125개**. **재발 방지**: 코드 안전망(데이터 의존 X) 우선 변환 — 데이터 의존 ERR 은 fixture 화 부적합으로 명시적으로 제외.

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
- **관련 파일**: `db/post_register_audit.js`, `db/templates/insert-template.js`, `src/app/api/packages/route.ts`, `src/lib/render-contract.ts`, `.claude/skills/register/SKILL.md`, `db/audit_api_field_drift.js`

---


> Original source before 2026-06-07 split: `db/error-registry.md:236`

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


> Original source before 2026-06-07 split: `db/error-registry.md:653`

---

## ERR-audit-severity-flat@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:967`

- [ ] **ERR-audit-severity-flat@2026-04-27** (UX — info ↔ warnings 혼동): post-audit 의 audit_status 가 `clean / warnings / blocked` 3단계라서 **W12 같은 안내성 경고**(splitScheduleItems 자동 분리 알림 — 데이터 무결성 영향 없음)가 환각·축약 의심(W14 등 진짜 위험)과 동일한 `warnings` 로 분류됨. 결과: clean 상품인데 `--force` 가 매번 필요 → 사장님 등록 마찰 + Agent 가 매번 사장님께 force 여부 질문. **해결** (P0 #2): ① [post_register_audit.js](../../db/post_register_audit.js) `INFO_RULES = new Set(['W12'])` + `isInfoOnly()` 헬퍼로 안내성 W-code 만 있으면 audit_status='info' 분류. ② [approve_package.js](../../db/approve_package.js) 가 `info` 는 자동 승인 (warnings 만 force 필요). ③ register.md Step 7 안내 4단계로 갱신. **재발 방지**: 신규 W-code 추가 시 INFO_RULES 분류 검토 — "데이터 무결성 영향 있는가?" 를 명시.

---

## ERR-self-audit-gate-bypass@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:978`

- [ ] **ERR-self-audit-gate-bypass@2026-04-27** (구조적 — Agent 자가감사 INSERT 차단 부재): `agent_audit_report` 가 `pkg` 에 첨부되어 INSERT 후 post-audit 단계에서 warnings 추가됐지만, INSERT 자체는 verdict=blocked / unsupported_critical>=1 이어도 그대로 진행됨. 환각·축약 의심 상품이 일단 DB에 들어간 후 사장님이 archive 해야 하는 단방향 흐름. **해결** (P3 #2): [insert-template.js](../../db/templates/insert-template.js) `validatePackage` 호출 직후 게이트 추가 — `verdict=='blocked'` 또는 `unsupported_critical>=1` 면 `validationErrors` 에 추가해 기존 skip 로직으로 차단. `unsupported_high>=3` 은 기본 warnings, `STRICT_AUDIT=true` 시 차단. report 누락은 STRICT_AUDIT 시에만 차단(기본 통과). 회귀 테스트 — `tests/regression/cases/ERR-self-audit-gate-bypass.test.js` 8개 케이스. **재발 방지**: pre-INSERT 게이트가 SSOT — post-audit 의 warnings 승격은 그 이후 단계 보조 검증으로만 활용.

---

## ERR-graybox-existing-data@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:979`

- [ ] **ERR-graybox-existing-data@2026-04-27** (구조적 — 정책 변화 이전 등록분 회색지대): customer_notes/internal_notes 분리, commission_fixed_amount, FIELD_POLICY 강화 등 P0~P2 정책 도입 이전에 등록된 112개 상품의 회색지대 데이터 식별 부재. 사장님이 "어떤 상품이 위험한지" 일괄 파악 불가. **해결** (P3 #3): [db/audit_existing_packages.js](../../db/audit_existing_packages.js) 추가 — 7개 룰 점검(SPLIT-NOTES / CUSTOMER-LEAK / FIXED-COMMISSION-MISSING / SHOPPING-NOT-SPECIFIED / AUDIT-STATUS-NULL / NOTICES-EMPTY / NUMBER-COMMA-RESIDUE) + 한 화면 리포트(심각도/코드별 분포) + JSON 출력(작업 큐) + `--fix-split-notes` 안전 자동 수정. **결과** (2026-04-27 1차 실행): 112건 중 17건 clean, 95건 이슈 — high 0건 / medium 69건(SHOPPING 미설정 레거시) / low 95건(AUDIT-STATUS null 레거시). 즉시 위험 없음 확인. **재발 방지**: 정책 변경 시 기존 데이터 점검 스크립트를 함께 만들어 회색지대 가시화 — 구조 변경 후 "보이지 않는 잔여 위험" 패턴 차단.

---

## ERR-windows-prerender-chunk@2026-04-26

> Original source before 2026-06-07 split: `db/error-registry.md:982`

- [ ] **ERR-windows-prerender-chunk@2026-04-26** (인프라 — Next.js 14.0.4 Windows chunk race 빌드 실패): `feature/card-news-v2` 브랜치 `npm run build` 가 12개 client component page (`/login`, `/admin/*`, `/`) 에 대해 `Cannot read properties of undefined (reading 'call')` / `Cannot find module './chunks/vendor-chunks/next.js'` 로 prerender 실패. 원인: Next.js 14.0.4 + Windows + 한글 경로(`여소남OS`) 환경에서 webpack pack 파일 rename race + 'use client' page 의 `export const dynamic` 무시 버그 결합. **해결** (2026-04-26): ① cover-critic.ts `product_context.nights?: number` 타입 추가 + caller select 동기화. ② API drift 5건 — `avg_rating, review_count` PACKAGE_LIST_FIELDS 추가, `*_md` 3건 INTERNAL_ONLY 분류. ③ `src/app/admin/layout.tsx` 에 `export const dynamic = 'force-dynamic'` — 12개 admin 자식 페이지 일괄 처리. ④ `src/app/login/page.tsx` 를 server wrapper 로 변환, client 로직을 `LoginForm.tsx` 분리(Next.js 14.0.4 의 'use client' page dynamic export 무시 버그 회피). ⑤ `src/app/page.tsx` 는 `process.platform === 'win32'` 분기로 Windows 로컬은 force-dynamic, Vercel(Linux) 는 ISR 5분 유지. ⑥ `import dynamic from 'next/dynamic'` 사용 페이지 2개에서 `nextDynamic` 으로 alias (export 충돌 방지). **검증** (2026-04-26): `npm run build` EXIT 0, 234/234 페이지 생성, regression 125/125 PASS. **재발 방지**: 신규 admin client page 추가 시 layout 의 force-dynamic 자동 propagate — 페이지 자체에 `export const dynamic` 직접 선언 금지(`import dynamic from 'next/dynamic'` 와 충돌). client page 가 server-only 처리 필요할 때 server wrapper 패턴 (login 참고).

---

## ERR-lint-cleanup-batch@2026-04-26

> Original source before 2026-06-07 split: `db/error-registry.md:983`

- [ ] **ERR-lint-cleanup-batch@2026-04-26** (인프라 — lint 30 Error / 32 Warning → 0 일괄 처리): typescript-eslint plugin 정식 설치 후 surfaced 된 30 error + 32 warning 일괄 정리. **해결**: ① `react-hooks/rules-of-hooks` 14건 (실제 코드 버그) — `ChatWidget`, `JarvisFloatingWidget`, `lp/[id]/page` 의 hooks 호출 순서 정정 (early return 을 hooks 뒤로 이동). ② `prefer-const` 6건 — `let → const`. ③ `react/no-unescaped-entities` 10건 + `@next/next/no-img-element` 19건 — 노이즈 룰 disable (`.eslintrc.json` 의 rules). ④ `react-hooks/exhaustive-deps` 12건 — inline `// eslint-disable-next-line` + 의도 코멘트 (mount/id-trigger-only intentional). ⑤ `@typescript-eslint/eslint-plugin@^7` + `parser@^7` 설치 (legacy-peer-deps). **검증**: lint 0건, build EXIT 0, regression 125/125. **재발 방지**: lint 룰 변경 시 영향 범위를 `.eslintrc.json` 의 `rules` 객체로 명시적 관리 — 노이즈 룰은 disable, 실제 버그 룰은 유지.

---

## ERR-nextjs-14.2-upgrade@2026-04-26

> Original source before 2026-06-07 split: `db/error-registry.md:984`

- [ ] **ERR-nextjs-14.2-upgrade@2026-04-26** (인프라 — Next.js 14.0.4 → 14.2.20 minor upgrade): Windows chunk race 영구 해결 시도. **결과**: ✅ 빌드 통과 (retry 1회 후), regression 125/125 PASS, lint 0건. ⚠️ Windows chunk race 는 14.2 에서도 동일 (Next.js 14.x 시리즈 전체 한계). Vercel(Linux) 영향 없음 — production 배포 시 chunk race 미발생. ⚠️ 14.2 신규 메시지: `request.headers` 사용 cron routes (publish-scheduled, sync-engagement, agent-executor) 가 Dynamic Server Usage 로그 출력 — 정상 동작. **재발 방지**: Windows chunk race 영구 해결은 Next.js 15.x 업그레이드 필요. 14.x 시리즈에서는 retry + cache wipe 워크어라운드 유지.

---

## ERR-W32-verbatim-substring-gate@2026-04-29

> Original source before 2026-06-07 split: `db/error-registry.md:986`

- [ ] **ERR-W32-verbatim-substring-gate@2026-04-29** (예방 — 환각 변환·보강 INSERT 전 사전 검출): ERR-FUK-camellia-overcorrect@2026-04-28 의 6건 사고 중 4건 (schedule "다자이후→태재부" 변환 + inclusions "왕복 훼리비 (카멜리아)" 보강 + notices "쇼핑센터 1회 (면세점)" 보강 + D3 "안녕히→해산" 의역) 가 모두 Agent self-audit verdict='clean' 통과. claim 검증이 "원문에 있는가" 만 확인하고 "원문 그대로인가" 는 검증 안 함 → fix_verbatim 사후 처리로 해결할 수밖에 없었음. **해결** (2026-04-29): [insert-template.js:381+](../../db/templates/insert-template.js) `validatePackage` 의 W32 룰 추가 — schedule activity (▶ 마커) + inclusions 의 normalize(공백제거) substring 이 raw_text normalize 의 substring 이 아니면 warnings 추가. notices_parsed 는 의역 허용 (검증 제외 — false-positive 회피). 회귀 검증: 정상 4건 (TB-FUK-03-01/02/04-01/04-02) 모두 W32 0건 (false-positive 없음), 사고 시뮬레이션 데이터 (다자이후+왕복훼리비카멜리아) 정확히 2건 검출. 이제 같은 사고 발생 시 INSERT 시점에 audit_status='warnings' 로 분류 → 사장님 검토 후 force 또는 수정. **재발 방지**: schedule + inclusions 텍스트 변형은 INSERT 전 자동 차단. notices_parsed 는 사장님 의역 정책 (REMARK 통합·정제) 존중하되 별도 룰 (P3) 검토 필요.

---

## ERR-W11-warning-misclass@2026-04-28

> Original source before 2026-06-07 split: `db/error-registry.md:998`

- [ ] **ERR-W11-warning-misclass@2026-04-28** (분류 — 안내성 콤마 경고가 warnings 로 분류돼 자동 승인 막힘): validatePackage W11 ("콤마 포함 ▶ activity 감지 → splitScheduleItems 자동 분리") 메시지가 `[W11]` 접두사 없이 텍스트만 푸시됨. post-audit 의 INFO_RULES 정규식 `/\[(W\d+)/` 매칭 실패 → audit_status='warnings' 분류 → 자동 승인 차단 → 매번 force 필요. TB-FUK-04-02 등록 시 발견. ERR-audit-severity-flat@2026-04-27 의 INFO_RULES 도입 의도와 어긋남. **해결** (2026-04-28): ① [insert-template.js:367](../../db/templates/insert-template.js) W11 메시지에 `[W11]` 접두사 추가 + 메시지 정확화 ("splitScheduleItems 자동 분리 또는 W31 휴리스틱이 단일 명소로 보호 — 안내성"). ② [post_register_audit.js:462](../../db/post_register_audit.js) INFO_RULES 에 W11 추가 (W12 와 함께). ③ [post_register_audit.js:559+](../../db/post_register_audit.js) audit_status 출력 배지에 'info' 케이스 추가 (`⚪ INFO (안내성 경고만 — 자동 승인 OK)`) — 기존엔 info 도 BLOCKED 로 잘못 표시. ④ [dump_package_result.js:103](../../db/dump_package_result.js) notices_parsed 출력에 `n.text` 폴백 추가 (기존엔 `n.title` 만 봐서 "[INFO] undefined" 표시). **재발 방지**: 신규 W-code 추가 시 ① 메시지 `[Wnn]` 접두사 강제 ② INFO_RULES 분류 검토 ("데이터 무결성 영향 있는가?") ③ register.md 의 self-check 목록에 추가.

---

## ERR-FUK-camellia-overcorrect@2026-04-28

> Original source before 2026-06-07 split: `db/error-registry.md:1000`

- [ ] **ERR-FUK-camellia-overcorrect@2026-04-28** (verbatim — Agent self-audit 통과한 6건 회색지대 수정): 투어비 카멜리아 후쿠오카 시내숙박 2박3일 (TB-FUK-03-01) 등록 후 사장님 원문 재대조에서 6건 회색지대 발견. ① **schedule SSOT 정상화 위반** — 원문 "▶학문의 신을 모신 태재부 천만궁" 을 "다자이후 천만궁" 으로 자의 변환. register.md 3-4 절 "schedule = 원문 verbatim, attractions aliases 가 흡수" 정책 위반. ② **W30 휴리스틱 부족** — splitScheduleItems 가 괄호 없는 단일 명소 서술문("▶높이 234M, 8000장의 유리로 단장한 후쿠오카 타워 관광") 의 콤마를 분리할 위험. Agent 가 사전 방어로 "·" 변환 → 원문 verbatim 손실. ③ **regions 오인** — D1 의 "지역" 컬럼은 "부산", "교통편" 컬럼이 "카멜리아" 인데 둘 다 regions 에 포함시킴. ④ **inclusions 환각 보강** — 원문 "왕복훼리비" → "왕복 훼리비 (카멜리아)" (괄호 추가). ⑤ **notices_parsed 환각 보강** — 원문 "쇼핑센터 1회" → "쇼핑센터 1회 (면세점)". ⑥ **D3 의역** — 원문 "안녕히~" → "해산". Agent self-audit 11 claims 가 모두 supported=true 로 통과 (verdict=clean) — claim 이 "원문에 있는가" 만 검증하고 "원문 그대로인가" 는 검증 안 함. **해결** (2026-04-28): ① 6건 즉시 DB UPDATE (`db/fix_tourbi_fuk_camellia_verbatim.js`). ② attractions "다자이후텐만구" aliases 에 ["다자이후 천만궁","태재부 천만궁","태재부 텐만구","태재부","다자이후","학문의 신","Dazaifu Tenmangu","太宰府天満宮"] 8개 적립 — 다음 등록부터 자동 매칭. ③ **시스템 보강 — splitScheduleItems W31 룰 추가** — 괄호 없는 일반 콤마 case 에서도 DESCRIPTIVE_KW 검사 적용 (단장한·모신·자리잡은·위치한·유명한·꽃놀이·명소·풍경 키워드 + 콤마 직전 서술 어미 한/된/는/의 검출). 6/6 회귀 테스트 통과 (후쿠오카 타워·미야지다케·마이즈루·태재부 보호 + 오타루 콤마 분리·하카타 단일 정상). ④ register.md self-check 에 W31 항목 추가 (별도 문단). **재발 방지**: ① schedule activity 의 ▶ 명사는 raw_text substring 으로 verbatim 검증 — Agent self-audit claim 에 `evidence_is_verbatim_substring: true/false` 필드 추가 검토 (P3). ② regions 정의 명문화 — register.md 에 "지역 컬럼만 regions, 교통편 컬럼은 schedule[].transport" 명시 (P2). ③ "단어 추가 (괄호 보강)" 패턴은 Agent self-audit 에서 별도 룰로 검출 — 원문 substring 비교 후 추가 토큰 발견 시 supported=false 강제 (P2).

---

## ERR-NHA-multi-airline-catalog@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:1004`

- [ ] **ERR-NHA-multi-airline-catalog@2026-04-27** (절차 — 원문 내부 모순 사전 검출 부재): 사장님 W투어 나트랑 카탈로그 등록 시도 중, 한 원문에 **두 항공편 옵션(BX-에어부산 BX781/782 + 베트젯 VJ919/918)이 동시 묘사** 되고 가격표가 1개만 있는 케이스 발견. 헤더 타이틀은 `[BX-에어부산]`, 본문 가격표 위는 BX781(19:30 출발) 명시, 본문 가격표 아래는 `[VJ]` 헤더 + 일정표는 VJ919(10:55 출발)/VJ918(03:10 출발) 사용. 출발시간이 BX 19:30 vs VJ 10:55 로 완전 다르고 도착시간도 BX 06:20+1 vs VJ 09:50 로 다름 → **가격표가 어느 항공 기준인지 모호**. 추가 모순 5종: ① 호텔 등급 표기 변동 (`(5성특급)` vs `5성)`) ② 유류할증료 "(4월)" 만 포함 → 5~8월 출발 시 별도 청구 여부 불명 ③ 인원 조건 (헤더 "최대투숙인원 성인3+아동1" vs 본문 "2명부터 출발 가능") 동시 명시 ④ "4/29 발권조건" 헤더 vs 가격표에 4/29 출발 + 5~8월 출발 다수 존재 → 발권기한 4/29 의 적용 범위 모호 ⑤ "매너 팁" 불포함 + "가이드" 불포함 동시 명시 → 가이드 없는데 누구에게 팁? 추가로 랜드사 "W투어" 가 `db/land-operators.json` 미등록 (23개 등록 중 W로 시작하는 곳 없음). 영향: 기존 register.md 절차에는 **원문 자체의 내부 모순을 INSERT 전 검출하는 단계가 없음**. Step 6.5 self-audit 은 "DB 필드 vs 원문" 대조라 원문 내부 모순(다항공/다호텔/다기간)은 잡지 못함. 사장님이 먼저 발견하지 않으면 한쪽 항공 임의 선택 → 환각 등록 위험. **해결**: ① register.md `Step 1.5: 카탈로그 일관성 사전 검증` 신규 섹션 추가 — A. 항공편 정체성 충돌 (단일/다중시간/다중항공사 분류) / B. 가격표 출처 검증 (가격표 인접 8줄 항공·호텔 라벨 일관성) / C. 신규 랜드사 검출 (`land-operators.json` lookup → 미등록 시 사장님 명시 Y 후만 INSERT) / D. 적용기간 ↔ 발권기한 모순 / E. 호텔 등급 표기 변동. 1개라도 실패 시 등록 중단 + 사장님 4개 질문 (가격표 어느 항공 기준? 어느 항공 등록? 일정표는 한 쪽 기준이면 다른 쪽은 시간만 교체? 발권기한 항공별 다른가?). ② 향후 `db/audit_raw_text_consistency.js` 자동 검증기 P3 추가 예정 — 현재는 Agent self-check. **재발 방지**: ① 다항공 카탈로그는 항상 STOP → 사장님 결정 후만 진행. 임의 선택 금지. ② 신규 랜드사 발견 시 자동 INSERT 금지 — 정산·세금 마스터 누락 방지. ③ 원문 내부 모순 검출은 IR 파이프 진입 전에 끝내야 함 (LLM 호출 비용 절감 + 사장님 의사결정 빠른 우회).
