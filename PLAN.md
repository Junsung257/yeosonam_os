# 여소남 OS — 일괄 개선 실행 Plan (v3 최종)

> **생성일**: 2026-05-28 (목) 12:59 KST
> **근거**: 12회 웹 검색(AGENTS.md/RSC/Cursor Rules/Supabase/Idempotency/Docs Automation) + 6회 코드베이스 검증 + 3회 탐색 에이전트
> **총 예상 시간**: ~5시간

---

## Phase 1: Cursor Rules 마이그레이션 (30분)

### 이유
2026년 업계 표준에 따르면 `.cursor/rules/`의 `alwaysApply: true`는 **프로젝트 스택/언어 등 극소수(1-2개)**에만 사용해야 함. 현재는 5개 모두 `alwaysApply: true`여서 매 요청마다 ~2000+ 토큰 낭비 + Agent 모드에서 `.cursorrules` 레거시는 무시됨. 또한 `globs` 필드가 아예 없어 path-scoped 적용이 하나도 안 되어 있음.

### 할 일
1. `yeosonam-operating-model.mdc`: `alwaysApply: true` 유지 (1개만 남김) — 세션 전략은 항상 필요
2. `yeosonam-context.mdc`: `alwaysApply: false` + `globs: ["AGENTS.md", "CURRENT_STATUS.md", "docs/**"]`로 전환
3. `yeosonam-lessons-learned.mdc`: `alwaysApply: false` + `globs: ["src/**/*.ts", "src/**/*.tsx", "supabase/migrations/**"]`로 전환
4. `yeosonam-communication-ko.mdc`: `alwaysApply: false` + `description` 기반(agent-requested)으로 전환
5. `dev-server-discipline.mdc`: `alwaysApply: false` + `globs: ["package.json", "next.config.*"]`로 전환
6. **신규**: `api-routes-local.mdc` — `globs: ["src/app/api/**"]` — 응답 표준, 인증 패턴
7. **신규**: `mileage-gamification.mdc` — `globs: ["src/lib/mileage*", "src/lib/gamification*"]`
8. **신규**: `lib-utilities.mdc` — `globs: ["src/lib/**"]` — 주요 유틸 카탈로그

---

## Phase 2: 문서 하네스 대개혁 (50분)

### 이유
AGENTS.md "작업 성격" 표에 마일리지/게이미피케이션/API 추가 수정/크론/프론트엔드 행이 누락. CURRENT_STATUS.md가 25일 구식. 게이미피케이션 진입점이 어디에도 없음. docs/audits/가 AGENTS.md에 연결 안 됨.

### 할 일
1. AGENTS.md "작업 성격" 표에 5개 행 추가
2. AGENTS.md "docs/ 주제별" 표에 감사 결과 링크 추가
3. CURRENT_STATUS.md 갱신 (게이미피케이션, 마일리지 소멸, 챌린지 반영)
4. CLAUDE.md "도메인별 강제 진입점" 표에 게이미피케이션 추가
5. docs/gamification-runbook.md 생성

---

## Phase 3: RPC 불일치 + Cron 보안 (25분)

### 이유
`expire_mileage_batch` RPC가 미사용(데드코드). cron API 다수가 CRON_SECRET 검증 없음. Kakao 템플릿 ID가 하드코딩되어 있음.

### 할 일
1. `expire_mileage_batch` 통합 정리
2. CRON_SECRET 검증 누락된 cron route 보강
3. Kakao 템플릿 ID 중앙화 (kakao.ts 리팩토링)

---

## Phase 4: 성능 최적화 (35분)

### 이유
force-dynamic 160+개 → Next.js 16 PPR 무효화 버그 존재. mypage가 useEffect+Promise.all 클래식 패턴. api-response.ts 90% 미채택.

### 할 일
1. `src/app/mypage/mileage/page.tsx` RSC 전환 (async component + Suspense)
2. force-dynamic 제거 (파일럿: 마일리지/게이미피케이션 API 6개 우선)
3. milege API 6개 응답 포맷 표준화 (api-response.ts 파일럿 적용)

---

## Phase 5: 동시성 제어 + Idempotency (30분)

### 이유
마일리지 적립/사용에 낙관적 락이 없음. race condition으로 중복 적립 가능. Stripe 등 업계 표준은 Idempotency Key를 필수로 사용. 웹 검색 결과 PostgreSQL `INSERT...ON CONFLICT DO NOTHING` + `version` 컬럼이 표준.

### 할 일
1. `mileage_transactions` 테이블에 `idempotency_key` 컬럼 추가 마이그레이션
2. `useMileage()`, `earnMileage()`에 Idempotency Key 체크 로직 추가
3. `customers` 테이블에 `version` 컬럼 추가 (낙관적 락)
4. `increment_customer_mileage` RPC에 version 체크 추가

---

## Phase 6: DB 타입 안전성 (30분)

### 이유
`as any` 30+건. supabase gen types가 설정 안 됨. mileage API에서 다수 발견.

### 할 일
1. `supabase gen types typescript --linked` 실행
2. mileage/gamification API 30건 `as any` 제거
3. 타입 생성 스크립트를 package.json + CI에 추가

---

## Phase 7: 통합 + 정리 (40분)

1. `creditMileageForBooking` → `earnMileage` 통합
2. Analytics API 중복 제거
3. mypage mock 데이터 실제 연동
4. lib/ README.md 생성
5. 불필요 파일 정리

---

## Phase 8: 검증 (15분)

1. `npm run type-check` 
2. `npm run build`
3. curl로 마일리지 API 6개 테스트
4. Git commit + push
