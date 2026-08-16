# Blog Orchestrator V4 Production Verification

> 2026-08-16 추가 결정: 이 문서의 Gemini rescue 관련 모델 라우팅은 더 이상 현재 계약이 아니다. DeepSeek-only 전환 결과는 `blog-orchestrator-v4-deepseek-only-verification-2026-08-16.md`가 우선한다. 나머지 운영 데이터·배포 차단 증거는 이 문서에 그대로 유효하다.

기준일: 2026-08-16, Asia/Seoul

## 판정

후보 코드는 전체 테스트, 타입 검사, 린트, Next.js 15.5.21 프로덕션 빌드, 실제 로컬 HTTP 경계, 4개 AI 모델 연결, 격리된 Supabase migration dry-run을 통과했다. 그러나 현재 운영은 V4 release migration과 코드가 반영되지 않았고 코퍼스·snapshot·검색성과·분석 canary가 미정리 상태다.

따라서 현재 판정은 **후보 코드 검증 PASS / 운영 live 전환 BLOCKED**다. 이번 검증에서 운영 배포, 운영 DB migration, 기존 글 UPDATE/DELETE, indexing 요청은 수행하지 않았다.

## 1. Source of truth 확인 결과

- 작업 worktree: `C:\dev\yeosonam-os-blog-deepseek-v4`
- 작업 branch: `codex/blog-deepseek-orchestrator-v4-20260815`
- 검증 시작 HEAD: `4745dde09d0bd4f29a7723302a20348925f0c68a`
- lockfile: `package-lock.json`; package manager는 npm
- 운영 Vercel project: `os`
- 운영 deployment: `dpl_426L8iTmMHs4EWvgena1UnUEFuzD`, `READY`, 생성 시각 `2026-08-15T11:03:07.782Z`
- 운영 alias에는 main이 표시되지만 `vercel inspect`가 immutable `gitSource`/commit metadata를 제공하지 않았다. 따라서 배포 SHA 일치 여부는 증명되지 않았고 readiness가 이를 차단한다.
- 원 작업공간과 다른 작업자의 변경은 삭제·reset하지 않았다.

## 2. 근본 원인

1. 생성과 공개가 한 경로에서 섞여 있어 모델 오류·부분 응답·비용 예약 실패가 공개 경계로 전파될 여지가 있었다.
2. 초안 메타데이터의 임의 first-party ID가 실제 검증 자료 없이 경험 문장을 허용할 수 있었다.
3. 2차 재작성 실패가 3차 정밀 재작성 전에 격리될 수 있었다.
4. 공개 snapshot 장애 시 DB 지연과 실제 404를 확실히 구분할 durable 경로가 부족했다.
5. rollout 상한은 있었지만 자동 승격·동결·강등을 저장하는 운영 원장이 부족했다.
6. 운영 Supabase migration history 509건과 후보 migration을 일반 `db push`로 비교하면 무관한 migration이 섞일 수 있었다.
7. 신규 AI/analytics canary route는 처음에 미들웨어 public 경계에 등록되지 않아 API 대신 HTML을 반환했다. 이번에 회귀 테스트와 함께 수정했다.
8. 현재 운영 데이터 자체도 공개 가능 191건 대비 durable snapshot 186건, review-blocked published 8건, demand 없는 due queue 13건으로 live 전환 조건을 만족하지 않는다.

## 3. 변경 파일과 기능

주요 변경은 다음 묶음이다.

- 생성·오케스트레이션: `src/lib/blog-ai-caller.ts`, `src/lib/blog-deepseek-orchestrator-v4.ts`, `src/lib/blog-generation-run-v4.ts`, `src/app/api/cron/blog-publisher/route.ts`
- 비용·완결성: `src/lib/blog-ai-budget-v4.ts`, incomplete/truncated response fail-closed, attempt별 receipt와 보수적 예약 정산
- 브리프 사실성: `src/lib/blog-content-brief-v3.ts`; 검증된 research packet의 first-party source만 경험 표현 허용
- 공개 단일 경계: `src/app/api/cron/blog-publication-controller/route.ts`, 기존 publisher는 생성 전용
- 점진 rollout: `src/lib/blog-publication-rollout.ts`, repository, daily summary 평가, `pilot_3 → ramp_10 → max_30`
- 공개 장애 대응: `src/lib/blog-public-remote-snapshot-v3.ts`, catalog/detail last-known-good fallback, snapshot parity
- 검색·분석: GSC collection plan, rank tracking, synthetic analytics canary, natural attribution 분리
- release 안전장치: `.github/workflows/blog-v4-production-release.yml`, exact migration manifest, isolated Supabase release workdir, candidate response verifier
- 공개 URL: middleware public slug registry, 404/410 경계, sitemap/RSS/image sitemap/public page contract
- 운영 도구: production evidence/readiness, corpus reconciliation, release bundle/dry-run 검증 스크립트
- 운영 문서: autopublish/AI/env SSOT 및 `docs/runbooks/blog-orchestrator-v4-production-rollout.md`

전체 변경 경로 목록은 해당 branch의 commit diff를 source of truth로 사용한다.

## 4. DB migration

release manifest에는 SHA-256으로 고정된 9개 migration만 있다.

1. `20260606115000_blog_keyword_families.sql`
2. `20260815093943_blog_keyword_families_service_role_rls.sql`
3. `20260815120135_blog_deepseek_orchestrator_v4.sql`
4. `20260815211325_blog_public_eligibility_rpc_contract.sql`
5. `20260816015102_blog_ai_budget_and_gemini_rescue.sql`
6. `20260816093000_add_danang_reviewed_research_sources.sql`
7. `20260816094500_blog_generation_attempt_finish_reason.sql`
8. `20260816120000_blog_publication_rollout_control_v1.sql`
9. `20260816123000_blog_public_slug_registry_v1.sql`

운영에는 현재 0/9가 적용돼 있다. 509개 remote applied version은 임시 release workdir에 빈 placeholder로만 구성하고, 원격 history repair 없이 `db push --dry-run`에서 위 9개만 pending임을 확인했다. rollback은 개별 SQL과 `supabase/rollbacks/blog-orchestrator-v4-release-rollback.sql`에 있다.

## 5. 자동발행 동작 변경

- 기본값은 계속 `draft_only`이며 잘못된 값도 `draft_only`로 닫힌다.
- 야간 생성은 model call과 품질 검사를 수행하지만 공개·IndexNow·sitemap revalidation을 하지 않는다.
- 낮 controller만 선택된 최신 attempt를 다시 확인하고 atomic 공개 commit을 수행한다.
- Flash 90점 이상은 blocker 0일 때만 slot 승인, 75~89는 Pro-high, 미수렴은 Pro-max, 허용된 rescue 조건만 Gemini 2.5 Pro로 간다.
- 한 후보는 최대 3회이며, claim conflict·unsupported number·수요 부재·HIGH risk 미승인은 점수와 무관하게 차단된다.
- provider 공백·잘림·비정상 finish reason은 부분 본문을 버리고 receipt만 기록한다.
- 이미지 0장은 brief가 `minImages=0`일 때 실패가 아니며, 이미지가 있으면 entity·alt/caption·중복 검사는 유지한다.
- 코드상 최대는 `pilot_3 → ramp_10 → max_30`이나, DB 상태 원장이 없거나 frozen이면 live 공개 0건이다.

## 6. 기존 글 dry-run disposition

`scripts/reconcile-blog-corpus-v4.ts`를 `--apply` 없이 실행했다.

| 항목 | 수치 |
|---|---:|
| review-blocked + published | 8 |
| 기존 disposition 존재 | 0 |
| 권고 QUARANTINE/410 | 8 |
| failed queue | 91 |
| 자동 재시도 가능 | 0 |
| 수동 검토 | 91 |
| 실제 DB write | 0 |

세부 대상과 사유는 `blog-corpus-reconciliation-v4-preview-2026-08-16.json/csv`에 있다.

## 7. Canary before/after

### 공개 경계

| 요청 | 현재 운영 | 후보 로컬 빌드 | 기대 |
|---|---:|---:|---:|
| `/api/cron/blog-generate` 무인증 | 200 HTML | 401 JSON | 401 JSON |
| `/api/cron/blog-publication-controller` 무인증 | 200 HTML | 401 JSON | 401 JSON |
| `/api/cron/blog-ai-model-canary` 무인증 | 200 HTML | 401 JSON | 401 JSON |
| `/api/cron/blog-analytics-canary` 무인증 | 200 HTML | 401 JSON | 401 JSON |
| 존재하지 않는 blog slug | 200 | 200, migration 미적용 | migration 후 404 |

### 실제 모델 연결 — DB write 없음

| stage | model | thinking | latency | finish | 결과 |
|---|---|---|---:|---|---|
| draft | `deepseek-v4-flash` | disabled | 605ms | stop | PASS |
| rewrite | `deepseek-v4-pro` | high | 2,708ms | stop | PASS |
| final rewrite | `deepseek-v4-pro` | max | 5,237ms | stop | PASS |
| rescue | `gemini-2.5-pro` | provider minimum | 1,836ms | STOP | PASS |

네 호출 모두 정확히 `OK`, expected provider/model, output token > 0을 만족했다. 실제 기사 품질은 기존 preview draft-only canary의 attempt 3, score 100, claim 6/6, hard blocker 0, 공개 0건 증거를 재사용한다. 오프라인 구조 canary는 24개 초안, 21개 목적지, 15 intent, 10 archetype, exact title duplicate 0, unsupported numeric claim 0이었다.

## 8. 실행한 테스트와 결과

| 검증 | 결과 |
|---|---|
| 전체 Vitest | 730 files, 5,466 tests passed, 0 failed |
| 마지막 middleware/model/evidence 회귀 | 3 files, 48 tests passed |
| `npm run type-check` | PASS |
| `npm run lint` | PASS, warning 0 |
| `npm run build` | PASS, Next.js 15.5.21, 390/390 static pages, `.next` verified |
| release bundle digest | PASS, exact 9 migrations |
| Supabase isolated dry-run | PASS, remote placeholders 509, pending 9, unexpected 0 |
| `git diff --check` | PASS |
| local public/API HTTP | 8 expected responses PASS; missing slug는 migration gate로 BLOCK |

기존 Edge runtime static-generation 안내 1건은 남아 있으나 빌드 실패는 아니다.

## 9. 성능·신뢰성 구조 변경

- 목록/상세는 DB 실패 시 durable last-known-good snapshot을 사용하고, refresh 실패가 사용자에게 `BLOG_DATABASE_UNAVAILABLE`로 직접 노출되지 않게 했다.
- 상세 핵심 snapshot과 부가 데이터 경로를 분리했다.
- snapshot parity를 release gate로 만들었다. 현재 191 eligible 중 186 snapshot으로 5건 부족해 자동 차단된다.
- 낮 발행 controller는 모델을 호출하지 않아 peak-time 생성비를 만들지 않는다.
- AI 비용은 일일 $2 기본 원장에서 원자적으로 예약·정산하며 unknown cost는 보수적 예약을 유지한다.
- RUM 7일 3,550건, engagement 1,478건은 수집 중이지만 field 목표 달성은 별도 p75 계산 전에는 주장하지 않는다.

## 10. 운영 반영이 필요한 환경 변수

최종 값과 secret 목록은 `docs/env-variables-reference.md`와 production rollout runbook이 SSOT다. 핵심은 다음이다.

- 초기: `BLOG_AUTOPUBLISH_MODE=draft_only`
- `BLOG_DAILY_CANDIDATE_CAP=30`
- `BLOG_DAILY_PUBLISH_CAP=30` 단, DB rollout stage의 더 낮은 상한이 우선
- `BLOG_DAILY_AI_COST_CAP_USD=2`
- `BLOG_REQUIRE_DEMAND_SIGNAL=true`
- `BLOG_MAX_WEATHER_SHARE_30D=0.20`
- `BLOG_MAX_SAME_ARCHETYPE_IN_LAST_10=2`
- DeepSeek, Gemini, Naver, Supabase, cron secret은 protected secret으로만 설정
- GitHub release workflow용 `SUPABASE_ACCESS_TOKEN`도 protected secret 필요

운영 `live`는 환경 변수만 바꿔 켜지지 않는다. migration, canary, corpus, snapshot, GSC, rollout 원장이 모두 ready여야 한다.

## 11. 운영 DB에 아직 적용하지 않은 작업

- 9개 forward migration apply
- 5개 누락 snapshot backfill
- 8개 review-blocked published disposition 기록 및 410/redirect 처리
- 13개 due queue의 verified demand 보강 또는 quarantine
- 91개 failed queue 수동 분류
- analytics synthetic canary 저장·readback
- rollout state `pilot_3` 초기화

모두 dry-run 또는 migration 파일만 작성했으며 이번 작업에서 적용하지 않았다.

## 12. 남은 위험

- 운영 배포 SHA를 Vercel metadata에서 증명할 수 없어 immutable source gate가 막혀 있다.
- 운영은 V4 API route가 없어 네 protected endpoint가 200 HTML을 반환한다.
- GSC 최신 metric date가 2026-08-13이며 strict freshness gate를 통과하지 못한다.
- analytics canary는 아직 없고 자연 attributed conversion도 0이다.
- live에서 DeepSeek 429/장시간 장애, Naver quota/fallback, 30 candidate 처리 비용은 아직 관찰되지 않았다.
- DB public slug registry migration 전에는 존재하지 않는 URL을 middleware가 안전상 fail-open하여 200 shell로 남긴다.

## 13. 정확한 배포·검증 순서

1. 현재 변경을 review 가능한 로컬 commit으로 고정하고 main 최신 상태와 patch 동등성을 재확인한다.
2. protected release workflow에서 release manifest SHA와 build/test를 재실행한다.
3. isolated Supabase release workdir를 생성하고 `db push --dry-run` 결과가 정확히 9개인지 재확인한다.
4. production DB에 9개 migration을 순서대로 적용한다. 이 단계 전후 schema inventory를 저장한다.
5. review-blocked disposition 8건을 승인된 runbook으로 기록하고 공개 view, sitemap, RSS, indexing에서 0건인지 확인한다.
6. snapshot 5건을 chunked backfill하고 `191 = 191` parity를 확인한다.
7. demand 없는 due queue 13건을 보강 또는 격리하고 strict readiness를 재실행한다.
8. candidate code를 immutable SHA로 배포하고 네 protected route가 무인증 401 JSON인지 확인한다.
9. `draft_only` 상태에서 AI model canary 4/4와 analytics synthetic canary 저장/readback을 확인한다.
10. 생성 1건을 실행해 attempt receipt, claim ledger, 공개 0, indexing 0을 확인한다.
11. controller를 호출해 `modelCalls=0`, 공개 0을 확인한다.
12. GSC 수집을 복구해 최신 metric date를 strict window 안으로 넣는다.
13. production evidence/readiness 6개 scope가 모두 PASS일 때만 `live` + `pilot_3`을 활성화한다.
14. 첫날 최대 3건만 공개하고 24시간 동안 404/5xx, snapshot parity, sitemap/RSS/IndexNow, claim·언어·중복을 관찰한다.
15. 닫힌 관찰 window가 연속 통과할 때만 `ramp_10`, 이후 `max_30`으로 승격한다. 한 hard incident라도 발생하면 자동 freeze/demotion한다.

이 순서를 완료하기 전에는 “운영에서 완벽하게 돌아간다” 또는 “하루 30건 발행 준비 완료”로 보고하지 않는다.
