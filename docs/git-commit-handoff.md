# Git 커밋 핸드오프 가이드 (AI/비개발자용)

> 한 줄 요약: 지금 변경량이 매우 크므로, "한 번에 1커밋"이 아니라 기능 묶음으로 쪼개 커밋해야 안전합니다.

## 왜 이렇게 하나요?

- 변경 파일이 수백 개라서 한 번에 커밋하면 문제 원인 추적이 거의 불가능합니다.
- 커밋을 묶음 단위로 나누면, 배포 사고 시 되돌리기(revert)가 빠르고 정확해집니다.
- AI가 이어서 작업할 때도 "어디부터 봐야 하는지"가 명확해집니다.

## 1) 먼저 제외할 파일(커밋 금지)

- 개발 중 생성 로그/리포트: `*.log`, `lint_output.txt`, `tmp-*`
- 브라우저/크롤링 임시 산출물: `.cursor-home-fetch.html`, `tmp-*.json`
- 빌드 산출물: `.next/`, `coverage/`, `build/`

위 항목은 `.gitignore`에 반영되어 있어야 합니다.

## 2) 권장 커밋 분할 순서 (안전한 순서)

### Commit A — 인프라/설정

- 대상: `package.json`, `package-lock.json`, `next.config.js`, `vercel.json`, `sentry*.config.ts`, `src/instrumentation.ts`
- 목적: 런타임/빌드/관측 기반 먼저 고정

### Commit B — 정책/보안/환경 변수

- 대상: `docs/env-variables-reference.md`, `docs/ai-policy-operations.md`, `src/lib/secret-registry.ts`, `src/lib/ai-provider-policy.ts`, `src/lib/api-auth.ts`
- 목적: 운영 토글/보안 규칙을 코드보다 먼저 명시

### Commit C — DB 마이그레이션

- 대상: `supabase/migrations/*.sql`
- 목적: 스키마를 애플리케이션 코드보다 먼저 확정

### Commit D — API 라우트 (백엔드)

- 대상: `src/app/api/**`, `src/lib/**` 중 API 의존 로직
- 목적: 화면보다 서버 동작을 먼저 안정화

### Commit E — 어드민 화면

- 대상: `src/app/admin/**`, `src/components/admin/**`
- 목적: 운영자 UI 변경을 묶어서 검증

### Commit F — 고객 화면/공통 컴포넌트

- 대상: `src/app/(customer)/**`, `src/app/packages/**`, `src/components/customer/**`, `src/components/ui/**`
- 목적: 최종 사용자 영향 범위를 별도 관리

## 3) AI가 찾기 쉬운 주석 태그 규칙

아래 태그를 코드/문서에 짧게 남기면, 다음 AI가 `rg "AI-"`로 바로 추적할 수 있습니다.

- `AI-CONTEXT`: 왜 이 코드/설정을 넣었는지 배경
- `AI-TODO`: 다음에 해야 할 후속 작업
- `AI-RISK`: 장애/보안/비용 위험 포인트
- `AI-VERIFY`: 배포 전 확인 방법(명령/URL/쿼리)

예시:

```ts
// AI-CONTEXT: 테넌트별 API 토큰 분리로 운영 계정 오염 방지
// AI-RISK: service role 키를 client 번들로 노출하면 보안 사고
// AI-VERIFY: POST /api/admin/tenant-tokens 호출 후 RLS 정책 확인
```

## 4) 비개발자용 실행 순서 (복붙용)

```bash
git status --short
git add -p
git commit -m "chore: isolate infra and runtime config changes"

git add -p
git commit -m "docs(security): update env and ai policy operation notes"

git add -p supabase/migrations
git commit -m "db: add migrations for tenant tokens, policies, and analytics"
```

## 5) 최종 푸시 전 체크

- 타입체크: `npx tsc --noEmit`
- 린트: `npm run lint`
- 주요 API 스모크: `/api/ops/cron-health`, `/api/qa/chat`, `/api/cron/marketing-rules`

문제 발생 시에는 마지막 커밋만 `git revert <hash>`로 되돌려 영향 범위를 최소화합니다.
