# Blog DeepSeek Orchestrator V4 Verification

기준일: 2026-08-15 (Asia/Seoul)

## 결론

로컬 구현과 정적·회귀 검증은 통과했다. 운영 배포, 운영 migration, 운영 DB write, 실제 DeepSeek/Naver 호출은 수행하지 않았다. 따라서 이 문서는 production 품질을 보장하는 증명서가 아니라 preview canary 진입 조건을 충족했다는 로컬 release evidence다.

## Source of truth

- worktree: `C:\dev\yeosonam-os-blog-deepseek-v4`
- branch: `codex/blog-deepseek-orchestrator-v4-20260815`
- base/`origin/main`: `3d721592a3aba3e0b5c1b26926dbb3e0361341bf`
- original dirty worktree는 수정하거나 정리하지 않았다.

## 구현된 계약

- 후보 처리 상한: `BLOG_DAILY_CANDIDATE_CAP=30`
- 공개 상한: `pilot_3 → ramp_5 → ramp_10 → max_20`; 부족분을 억지로 채우지 않음
- 초안: DeepSeek V4 Flash, thinking disabled
- 75~89점: DeepSeek V4 Pro, thinking/high
- 75점 미만의 재작성 가능 실패: DeepSeek V4 Pro, thinking/max
- 90점 이상 + hard blocker 0 + failure 0만 `approved_for_slot`
- 한 후보 최대 3 model call; 2회차 후 80점 미만 또는 개선폭 5점 미만은 조기 격리
- 사실·수요·claim 문제는 재작성으로 덮지 않고 1회 재연구 후 격리
- HIGH risk는 사람 승인 없이 자동 공개 불가
- KST 01:05~06:05 생성, KST 09:05/12:05/15:05/18:05/21:05 무모델 공개
- 낮 publication controller 응답은 `modelCalls: 0`
- Naver API HUB 우선, Developers Search API 보조; credential 부재/양쪽 실패를 성공으로 기록하지 않음
- 본문 판매 링크 생성 대신 기존 intent 기반 중앙 CTA 사용

## 영속화·DB

미적용 migration: `supabase/migrations/20260815120135_blog_deepseek_orchestrator_v4.sql`

- `blog_generation_runs`: queue별 durable state와 공개 slot
- `blog_generation_attempts`: append-only model output hash, gate evidence, token/cost receipt
- `ai_model_price_catalog`: effective-dated DeepSeek 가격 근거
- service-role 전용 RLS/ACL
- FK·slot·일별 count 접근 경로 인덱스 포함
- historical content UPDATE 없음
- dry-run backfill 및 수동 rollback SQL 포함

## 실패 안전성

- attempt 원장 저장 실패 시 공개 승인하지 않고 run을 `failed`로 종료한다.
- 같은 attempt 번호 재시도는 output hash가 동일할 때만 idempotent 성공이다.
- 공개 commit 후 run/queue bookkeeping만 실패한 경우 공개 글을 `quarantine`으로 오분류하지 않고 `published_state_sync_error`로 복구 표시한다.
- daytime controller는 승인된 최신 attempt, 90점 이상, blocker/failure 0을 재검증한다.
- GitHub backup workflow는 공개 상한 미달을 이유로 daytime generation을 호출하지 않는다.

## 실행 결과

| 검증 | 결과 |
|---|---|
| targeted V4/cron/publisher/monitoring tests | 16 files, 117 tests passed |
| full blog Vitest suite (`vitest run blog`) | 212 files, 1,494 tests passed |
| standard typecheck (`npm run type-check`, 8GB heap) | passed, 0 type errors |
| changed TS/TSX ESLint | passed, 0 warnings/errors |
| production build (`npm run build`, Next.js 15.5.21) | passed; 390 static pages generated; build output verified |
| Vercel function audit | 26/50 explicit entries, passed |
| Vercel cron count | 94, below 100 |
| migration prefix audit | 459 migrations; 16 known collisions; 0 new collisions |
| documentation automation contract | passed |
| `git diff --check` | passed |

참고: 생성된 Next 타입까지 포함한 임시 `npx tsc` 기본 4GB 실행은 heap OOM이 발생했다. 저장소 표준 8GB 명령은 성공했고 동일 8GB로 production build도 성공했다.

## 아직 운영에서 증명하지 않은 것

- DeepSeek V4 Flash/Pro 실제 응답 schema와 token usage 필드
- Naver API HUB 운영 credential/할당량/429 fallback
- migration apply와 RLS role contract
- preview에서 30개 후보 처리량과 실제 비용
- preview `draft_only` canary와 live slot 1건
- 7/28/56일 GSC·engagement·conversion 성과

이 항목들이 확인되기 전에는 `max_20` 또는 “완벽하게 운영된다”라고 판정하지 않는다.

## 정확한 반영 순서

1. preview DB에 migration 적용 및 rollback rehearsal
2. preview server-only secrets 설정, `draft_only`, `pilot_3`, cap 3
3. off-peak `blog-generate?force=true` 1회로 Flash/Pro/격리 fixture 확인
4. controller를 draft-only로 호출해 공개 0·model call 0 확인
5. preview live에서 승인 초안 1건만 공개하고 sitemap/RSS/IndexNow 확인
6. production migration → code → secrets → draft-only canary
7. 명시 승인 후 production live/pilot_3
8. 단계별 최소 관찰 기간과 runbook 조건 충족 시에만 5→10→20 승격
