# Blog DeepSeek Orchestrator V4 Verification

기준일: 2026-08-15 (Asia/Seoul)

## 결론

로컬 구현·정적·회귀 검증과 격리된 Vercel/Supabase preview의 실제 DeepSeek canary는 통과했다. 운영 배포, 운영 migration, 운영 DB write, 실제 Naver 호출은 수행하지 않았다. 따라서 이 문서는 production 품질 보증서가 아니라 preview에서 생성·재작성·근거 검증·비공개 유지가 재현됐다는 release evidence다.

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
- 한 후보 최대 3 model call; 2회차가 미수렴이면 승인 claim만 사용하는 최종 Pro max 3차를 수행하고, 재작성 가능한 실패의 격리는 3회 완료 후에만 수행
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
| full blog Vitest suite (`vitest run blog`) | 215 files, 1,543 tests passed |
| standard typecheck (`npm run type-check`, 8GB heap) | passed, 0 type errors |
| changed TS/TSX ESLint | passed, 0 warnings/errors |
| production build (`npm run build`, Next.js 15.5.21) | passed; 390 static pages generated; build output verified |
| Vercel function audit | 26/50 explicit entries, passed |
| Vercel cron count | 94, below 100 |
| migration prefix audit | 459 migrations; 16 known collisions; 0 new collisions |
| documentation automation contract | passed |
| `git diff --check` | passed |

참고: 생성된 Next 타입까지 포함한 임시 `npx tsc` 기본 4GB 실행은 heap OOM이 발생했다. 저장소 표준 8GB 명령은 성공했고 동일 8GB로 production build도 성공했다.

## Preview 실제 호출 검증 — 2026-08-16 KST

- Vercel preview project: `yeosonam-vercel-staging-20260810153000`
- 검증 deployment: `dpl_GcnZ3JyrQdvMuEmwMMrhCFTvF9SE` (`Ready`)
- Supabase preview project: `ejknxxocstrmfptluejx`
- canary queue: `6fd9464c-cf2c-42c6-9ef4-1a9cd9fbe991`
- 재사용한 canonical creative: `76835fbe-f79c-4782-bd1b-a45ea22dd4b4`
- canonical slug: `danang-attractions-route-selector`
- preview 적용 migration: `20260606115000`, `20260815093943`, `20260815120135`, `20260816093000`, `20260816094500`

실제 흐름은 다음과 같았다.

1. 기존 research bundle을 제거한 새 queue row에서 공식 Vietnam Tourism 출처 3개와 claim 6개를 다시 수집했다.
2. attempt 1은 `deepseek-v4-flash`, `finish_reason=stop`; unsupported number를 발견해 공개하지 않고 `rewrite_pro_high`로 이동했다.
3. attempt 2는 `deepseek-v4-pro`; 6개 승인 claim은 정확히 사용했지만 독자 결정 문장 한 건을 사실로 오분류해 coverage `6/7`로 차단했다.
4. 해당 오분류를 회귀 수정하고 재배포한 뒤 attempt 3 `rewrite_pro_max`가 `approved_for_slot`에 도달했다.

최종 저장 검증:

| 항목 | 결과 |
|---|---|
| attempt / model / finish | 3 / `deepseek-v4-pro` / `stop` |
| orchestration route / score | `approved_for_slot` / 100 |
| claim ledger | declared 6, candidate 6, unclassified 0 |
| claim validation | passed, coverage 1.0, 6/6 |
| hard blockers / failure reasons | 0 / 0 |
| V3 quality / customer quality | 100 / 100 |
| publish quality | passed |
| queue / creative | `pending_review` / `draft` |
| publish reason | `autopublish_mode_draft_only` |
| `published_at` / `publish_scheduled_at` | null / null |
| public SQL view rows | 0 |
| indexing jobs / reports | 0 / 0 |
| HTTP detail | 404 |
| sitemap / RSS / image sitemap slug occurrence | 0 / 0 / 0 |

추가 회귀에서 삿포로 비용 연구 fixture가 claim의 `1인` 숫자와 evidence 적용 대상을 기록하지 않은 문제가 발견됐다. excerpt와 scope를 `1 traveler`로 맞춘 뒤 전체 블로그 suite 1,543/1,543, full lint, typecheck, Next.js 15.5.21 production build(390 static pages), `.next` output verification이 모두 통과했다.

## 아직 운영에서 증명하지 않은 것

- DeepSeek 장시간 장애·429·과금 상한에서의 재시도 운영
- Naver API HUB 운영 credential/할당량/429 fallback
- production migration apply와 production RLS role contract
- preview에서 30개 후보 처리량과 실제 비용
- preview `live` slot 1건과 production `draft_only` canary
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
