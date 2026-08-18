# Blog Orchestrator V4 Production Rollout

기준일: 2026-08-17, Asia/Seoul

이 런북의 목표는 “배포 성공”이 아니라 안전한 실제 운영 증거다. 코드, DB, 공개 화면, 검색 수집, 분석, 스냅샷, 색인이 한 묶음으로 통과하기 전에는 `live`를 켜지 않는다. 이 문서는 배포 절차를 정의하지만 문서 실행 자체가 운영 변경을 승인하지 않는다.

## 고정된 릴리스 단위

- Release manifest: `supabase/release-manifests/blog-orchestrator-v4-20260816.json`
- Exact-set verifier: `npm run verify:blog-release-bundle-v4`
- Isolated release workdir: `npm run prepare:blog-supabase-release-workdir-v4 -- --output=.tmp/blog-v4-supabase-release`
- Supabase dry-run verifier: `npm run verify:blog-supabase-dry-run-v4 -- --input=<dry-run.txt> --allow-empty`
- Emergency rollback: `supabase/rollbacks/blog-orchestrator-v4-release-rollback.sql`
- Protected workflow: `.github/workflows/blog-v4-production-release.yml`
- Production evidence collector: `npm run collect:blog-production-evidence-v4 -- ...`
- Fail-closed decision: `npm run verify:blog-production-readiness-v4 -- --evidence=<json>`
- Read-only activation probe: `npm run verify:blog-autopublish-activation-v4 -- --base=https://www.yeosonam.com --strict`

Manifest에는 운영 기준선에서 누락된 migration 11개의 경로와 SHA-256이 고정된다. 여기에는 운영에서 이력과 실제 함수 본문이 드리프트한 medication HIGH-risk 정책 복구 및 Next.js 15 스트리밍 전 hard-404 slug registry 권한 복구가 포함된다. dry-run 결과는 아직 적용되지 않은 manifest 부분집합이어야 하며, 재실행 시 이미 모두 적용되어 0개여야 한다. manifest 밖 migration이 섞이면 중단한다.

운영의 기존 migration 이력에는 현재 저장소에서 합쳐진 과거 버전이 포함되어 있다. 따라서 저장소 루트에서 직접 `db push`하거나 remote migration history를 `repair`하지 않는다. 준비 스크립트는 운영 이력을 SELECT로 읽고 `.tmp` 아래에만 임시 Supabase 프로젝트를 만든다. 이미 적용된 과거 버전은 SQL 본문이 없는 자리표시자로 재현하고, manifest의 11개 파일만 실제 SQL과 고정 SHA로 복사한다. 이 임시 폴더는 커밋하지 않으며 dry-run과 승인된 apply에 동일하게 사용한다.

## 필수 보호 환경

GitHub `blog-production` environment에 배포 승인 규칙과 다음 secret을 둔다.

- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- `VERCEL_AUTOMATION_BYPASS_SECRET` (보호된 unaliased candidate를 실제 앱 응답까지 검증)
- `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN` (CI의 link 및 read-only migration inventory용)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`

애플리케이션 production 환경은 아래 계약을 사용한다.

```text
BLOG_AUTOPUBLISH_MODE=draft_only
BLOG_GENERATION_CRON_ENABLED=false
BLOG_PRODUCTION_ALLOWED_GIT_REF=main
BLOG_PRODUCTION_ALLOWED_COMMIT_SHA=<승인된 main 40자리 SHA>
BLOG_DAILY_PUBLISH_CAP=30
BLOG_PUBLICATION_RAMP_STAGE=max_30
BLOG_AUTO_RAMP_ENABLED=true
BLOG_AUTO_ROLLBACK_ENABLED=true
BLOG_DAILY_AI_COST_CAP_USD=2
BLOG_DAILY_CANDIDATE_CAP=30
BLOG_REQUIRE_DEMAND_SIGNAL=true
BLOG_MAX_WEATHER_SHARE_30D=0.20
BLOG_MAX_SAME_ARCHETYPE_IN_LAST_10=2
DB_RESOURCE_SAVER_ALLOW_CRITICAL_CRONS=1
```

`BLOG_PRODUCTION_ALLOWED_COMMIT_SHA`는 workflow 입력 `release_commit`과 동일한
40자리 SHA로만 설정한다. runtime Vercel 값과 build snapshot이 모두 존재할 때
ref 또는 SHA가 서로 다르면 provenance를 `mixed`로 기록하고 자동발행을 차단한다.
허용 SHA가 누락·형식 오류·불일치인 경우에도 production 정책은 `draft_only`로
강등된다. 따라서 환경값만 먼저 `live`로 바꾸는 운영 절차는 허용하지 않는다.

DB rollout state는 migration에서 `pilot_3`으로 시작한다. 따라서 환경 ceiling을 30으로 열어도 첫 실효 공개량은 슬롯별 `[1,1,2,2,3]`, 일 최대 3건이다.

## 활성화 상태 확인 (읽기 전용)

`verify:blog-autopublish-activation-v4`는 `/api/cron/blog-generate`와 `/api/cron/blog-publication-controller`를 조회만 한다. `CRON_SECRET` 또는 `BLOG_CRON_SECRET`이 현재 셸에 있을 때만 보호된 응답을 읽으며, secret·본문·DB를 변경하거나 출력하지 않는다.

- `generation_cron_disabled`: `BLOG_GENERATION_CRON_ENABLED`가 꺼져 있어 DeepSeek 생성이 시작되지 않음
- `deployment_provenance_failed`: production 런타임이 허용된 `main` ref와 build commit을 증명하지 못해 정책이 자동으로 `draft_only`로 강등됨
- `autopublish_not_live`: `BLOG_AUTOPUBLISH_MODE`가 `draft_only` 또는 `reviewed_only`라서 공개·색인 경로가 의도적으로 멈춤
- `configured_but_not_due`: 환경은 켜져 있으나 현재 KST 슬롯이 아직 도래하지 않음
- `READY`: 두 엔드포인트가 모두 인증·런타임·정책상 실행 가능한 상태

이 점검이 `BLOCKED`인 상태에서 운영 환경값을 임의로 바꾸지 않는다. 먼저 V4 readiness 여섯 scope와 forward migration을 통과시키고, 승인된 change window에서 generation을 켠 뒤 `live`를 별도로 전환한다.

## 정확한 실행 순서

1. 리뷰된 `main`의 40자리 commit SHA를 확정한다. 운영 source는 branch 이름만이 아니라 이 SHA와 같아야 한다.
2. release bundle, targeted V4 tests, typecheck를 통과한다.
3. 격리 workdir를 생성한 뒤 `db push --workdir .tmp/blog-v4-supabase-release --include-all --skip-vault --dry-run` 결과를 exact-set verifier로 확인한다. 운영 migration history를 수정하는 `migration repair`는 금지한다.
4. 승인된 change window에서만 forward migration을 적용한다. seed와 Vault 갱신은 포함하지 않는다.
5. `audit:blog-corpus-reconciliation-v4` 기본 dry-run을 확인한다. 운영 disposition 기록이 승인된 경우에만 `BLOG_CORPUS_RECONCILIATION_CONFIRM=APPLY_REVIEWED_DISPOSITIONS_V4`와 `--apply`를 함께 쓴다. 이 작업은 글 status, queue, redirect, index를 바꾸지 않는다.
6. `refresh_blog_public_snapshots_v3`를 실행하고 public eligible slug와 current snapshot slug의 정확한 parity를 확인한다.
7. catalog/detail snapshot을 동일 시각에 생성한다. URL 파일명에 본문 SHA-256을 포함하고, 상세 parity가 하나라도 비면 artifact를 만들지 않는다.
8. 정확한 `release_commit`을 checkout한 동일 빌드에서 production 환경을 `draft_only`, generation disabled로 바꾼 후 `--prod --skip-domain` candidate를 만든다. candidate가 runtime/build provenance를 증명하지 못하면 promote하지 않으며, 아직 운영 도메인에 연결하지 않는다.
9. candidate에서 `/blog`, 실제 상세, 존재하지 않는 상세의 hard 404, sitemap, RSS, image sitemap을 확인한다. `BLOG_DATABASE_UNAVAILABLE` 고객 문구, soft-404, review-blocked URL 노출이 없어야 한다. 후보 URL 호출은 Vercel protection bypass secret을 사용한다.
10. `blog-ai-model-canary`로 DeepSeek Flash, Pro high, Pro max를 각각 최소 토큰으로 실호출한다. 세 호출 모두 정확한 `OK`, 정상 stop, 모델·provider·thinking 설정과 usage 영수증이 일치해야 한다. 이 canary는 글과 DB를 쓰지 않는다.
11. `blog-analytics-canary`를 실행한다. synthetic row가 재조회되고 external delivery job이 0이어야 한다.
12. `rank-tracking`을 실행한다. 최근 7일 재수집과 90일 chunk cursor가 저장되며 실패 날짜가 있으면 cursor가 전진하지 않아야 한다.
13. candidate 로그의 `BLOG_DATABASE_UNAVAILABLE`를 배포 시점 이후로 집계하고 production evidence JSON을 생성한다.
14. V4 readiness가 source, schema, delivery, corpus, measurement, rollout 여섯 scope 모두 통과할 때만 다음 단계로 간다. 자연 전환 0건은 warning이지만 합성 analytics canary 부재는 blocker다.
15. `BLOG_AUTOPUBLISH_MODE=live`, `BLOG_GENERATION_CRON_ENABLED=true`로 바꿔 두 번째 unaliased candidate를 배포한다.
16. live candidate의 blog/data-readiness를 확인한 뒤에만 promote한다.
17. 운영 도메인에서 catalog, sitemap, analytics canary, data-readiness를 다시 확인하고 10분 로그에서 DB unavailable 0건을 확인한다.

대표 글 자동 갱신 canary는 신규 URL canary와 분리한다. 먼저 `draft_only`에서 기존 canonical ID/slug/`published_at`과 공개 수, indexing outbox가 변하지 않는 shadow draft를 증명한다. 이후 `live`의 `pilot_3`에서 새로 생성한 LOW/MEDIUM run 한 건만 UUID-targeted controller로 실행한다. 기존 `draft_only` shadow draft를 나중에 자동 승인으로 재사용하거나 `review_status`를 임의 변경하지 않는다. 성공 증거는 canonical 행의 material fingerprint 변경, ID/slug/원래 `published_at` 불변, shadow archive, `blog_information_automated_replacements` 1건, 선택 attempt 동일성, `URL_UPDATED` outbox, 공개 surface 200과 sitemap/RSS canonical-only다.

보호 workflow는 위 순서를 구현한다. `release_commit`, migration apply, disposition apply, candidate deploy, live promote를 각각 명시해야 하며, SHA가 현재 `origin/main`과 다르면 시작하지 않는다.

## 스냅샷 장애 대응

공개 catalog는 live DB → durable DB snapshot → immutable remote artifact → bundled artifact 순으로 stale-safe fallback한다. 상세도 같은 원칙을 사용하지만 HIGH-risk 콘텐츠는 짧은 만료와 review gate를 우회하지 않는다. 존재하지 않는 slug와 DB 장애를 같은 404로 처리하지 않는다.

스냅샷 갱신 명령은 기본 read-only다.

```text
npm run refresh:blog-public-snapshots-v3
npm run refresh:blog-public-snapshots-v3 -- --write-bundled --write-detail-bundled --all-details --artifact-dir=<release-dir>
```

DB 갱신은 `BLOG_SNAPSHOT_APPLY_CONFIRM=PUBLIC_ELIGIBILITY_REVIEWED`와 `--apply-db`가 동시에 있어야 한다. artifact는 catalog/detail 각각 8 MiB를 넘거나 slug parity가 깨지면 생성하지 않는다.

## GSC와 성과 학습

- 최근 7일: 매일 재수집하여 Search Console의 지연 수정값을 반영한다.
- 과거 90일: 한 실행당 최대 7일씩 역방향 보강한다.
- 수집 예외: 실패 날짜를 `failedDates`에 남기고 이전 cursor를 유지한다.
- 28일 노출 0: 새 URL 생성이 아니라 index·수요·intent 재검토 대상이다.
- 4~20위 + 노출: 기존 representative material refresh 대상이다.
- 같은 query의 여러 URL: merge/canonical/internal-link 수정 대상이다.

## 동결·강등·롤백

아래는 즉시 `frozen` 및 `pilot_3` 복귀다.

- review-blocked 또는 HIGH-risk 공개
- public eligibility surface leak
- `selected_attempt_id` 없는 발행
- 일일 cap 또는 신규 duplicate 위반
- 15분 blog 5xx 2건 이상
- 원자적 AI 비용 상한 초과

controller 성공률, indexing parity, DB fallback, snapshot lag, GSC/analytics freshness 중 하나가 불건전하면 승격하지 않는다. 일반 불건전 관측 2회 연속은 한 단계 강등한다. 관측값 누락은 성공으로 간주하지 않는다.

배포 후 검증 실패 시 workflow는 production 환경을 `draft_only`, generation disabled로 바꾸고 같은 source를 새로 배포·promote한다. DB rollback은 앱이 fail-closed로 복귀하고 backup/export를 확인한 후에만 실행한다. rollback SQL은 기존 published 글을 변경하지 않지만 V4 원장 테이블을 제거하므로 최후 수단이다.

## 완료 판정

다음 증거 없이는 “완료”나 “완벽히 운영”이라고 보고하지 않는다.

- production branch와 immutable SHA 일치
- forward migration 11개와 semantic capability 전부 존재
- public eligible/current snapshot 정확한 parity
- public surface 실패 0, candidate DB unavailable 0
- review-blocked disposition 100%, demand 없는 due queue 0
- 최근 3일 안의 GSC 관측, engagement/RUM 7일 데이터 존재
- 24시간 이내 analytics canary와 dead outbox 0
- rollout state active/not frozen, 비용 상한 양수, hard incident 0
- 실제 일일 발행·색인·검색 노출 데이터

field data가 아직 없으면 목표 달성으로 추정하지 않고 “관측 대기”로 보고한다.
