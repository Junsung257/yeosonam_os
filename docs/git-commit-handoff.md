# Git 커밋 핸드오프 가이드 (AI/비개발자용)

> 한 줄 요약: 사용자는 Git 전문가가 아니므로, AI가 변경 범위 확인부터 커밋, 푸시, PR, 머지 가능 여부, 배포 확인까지 안전한 기본값으로 주도한다.

## 왜 이렇게 하나요?

- 변경 파일이 수백 개라서 한 번에 커밋하면 문제 원인 추적이 거의 불가능합니다.
- 커밋을 묶음 단위로 나누면, 배포 사고 시 되돌리기(revert)가 빠르고 정확해집니다.
- AI가 이어서 작업할 때도 "어디부터 봐야 하는지"가 명확해집니다.

## 0) AI 기본 책임

사용자가 "깃 정리", "커밋 푸시 PR 머지 배포", "다른 세션 작업도 반영"처럼 요청하면 AI는 아래를 기본 책임으로 본다.

- 현재 브랜치와 작업 파일 상태를 먼저 확인한다.
- 다른 작업 폴더와 열린 PR이 있는지 확인한다.
- 반영된 작업과 아직 남은 후보를 구분한다.
- 필요한 변경은 새 `codex/*` 브랜치에서 커밋하고 푸시한다.
- PR을 만들고 체크 결과를 본 뒤, 통과하면 머지와 배포 확인까지 이어간다.
- 사용자가 비개발자임을 전제로, "무엇을 선택해야 하는지"를 묻기보다 안전한 추천안을 먼저 실행한다.

단, 아래 작업은 사용자 승인 없이 하면 안 된다.

- 커밋된 작업을 삭제하거나 폐기하기
- `git reset --hard`, 강제 푸시, 브랜치 강제 덮어쓰기
- 오래된 브랜치를 현재 `main`에 그대로 머지하기
- 실패한 체크를 무시하고 머지하기

## 1) 왜 브랜치가 남아 보이나요?

작업이 사라진 것이 아니라도, Git에서는 아래 이유로 "아직 안 합쳐진 브랜치"처럼 보일 수 있다.

- PR을 스쿼시 머지하면 원래 브랜치의 커밋 번호와 `main`의 커밋 번호가 달라진다.
- 다른 세션이 오래된 `main`에서 시작하면, 그 브랜치를 그대로 머지할 때 최신 파일을 되돌릴 수 있다.
- 충돌 해결이나 리베이스 중 생긴 임시 커밋은 기록에 남지만, 같은 내용이 이미 `main`에 들어가 있을 수 있다.
- 빌드 산출물과 로컬 설정 파일은 작업 폴더에 보여도 커밋 대상이 아닐 수 있다.

그래서 AI는 "브랜치가 남아 있다"만으로 유실을 판단하지 않는다. 반드시 `main`과 실제 파일 내용을 대조한다.

## 2) 다른 세션 작업 확인 순서

1. 현재 작업 폴더에서 추적 중인 변경이 있는지 확인한다.
2. `git worktree`로 다른 세션 폴더를 찾는다.
3. 각 작업 폴더의 추적 중인 변경과 무시 대상 산출물을 분리한다.
4. 열린 PR이 있는지 확인한다.
5. 후보 브랜치를 `main`에 그대로 머지하지 말고, 패치 동등성과 실제 파일 내용을 비교한다.
6. 이미 반영된 브랜치는 "반영됨, 생머지 불필요"로 기록한다.
7. 미반영이지만 유효한 변경만 현재 `main` 기준 새 브랜치로 선별 반영한다.

## 3) 먼저 제외할 파일(커밋 금지)

- 개발 중 생성 로그/리포트: `*.log`, `lint_output.txt`, `tmp-*`
- 브라우저/크롤링 임시 산출물: `.cursor-home-fetch.html`, `tmp-*.json`
- 빌드 산출물: `.next/`, `coverage/`, `build/`

위 항목은 `.gitignore`에 반영되어 있어야 합니다.

## 4) 권장 커밋 분할 순서 (안전한 순서)

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

## 5) AI가 찾기 쉬운 주석 태그 규칙

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

## 6) 비개발자용 실행 순서

사용자가 직접 실행하지 않아도 된다. AI가 필요할 때 아래 흐름을 대신 수행한다.

```bash
git status --short
git add -p
git commit -m "chore: isolate infra and runtime config changes"

git add -p
git commit -m "docs(security): update env and ai policy operation notes"

git add -p supabase/migrations
git commit -m "db: add migrations for tenant tokens, policies, and analytics"
```

## 7) 최종 푸시 전 체크

- 타입체크: `npx tsc --noEmit`
- 린트: `npm run lint`
- 주요 API 스모크: `/api/ops/cron-health`, `/api/qa/chat`, `/api/cron/marketing-rules`

문제 발생 시에는 마지막 커밋만 `git revert <hash>`로 되돌려 영향 범위를 최소화합니다.

## 8) PR 이후 기본 처리

- 체크가 모두 통과하면 PR을 머지한다.
- 머지 후 `main`을 최신화한다.
- 배포 플랫폼의 프로덕션 배포가 완료됐는지 확인한다.
- 실제 운영 URL이 응답하는지 확인한다.
- 머지된 작업 브랜치는 삭제해도 되지만, 미확인 후보 브랜치는 삭제하지 않는다.

## 9) 사용자에게 설명할 때

비개발자에게는 Git 내부 용어보다 결론을 먼저 말한다.

- "반영됨": 현재 본점에 같은 내용이 들어와 있어 추가 머지는 필요 없음.
- "보존됨": 브랜치나 커밋은 남아 있지만, 아직 본점에 넣을지 선별이 필요함.
- "위험함": 오래된 브랜치를 그대로 머지하면 최신 코드가 되돌아갈 수 있음.
- "유실 의심": 현재 본점에도 없고, 후보 브랜치나 작업 폴더에도 없는 경우. 이때만 복구 조사를 진행함.
