# Blog Publishing V3 운영 런북

## Legacy repair write guard

- `npm run audit:blog-quality` and `npm run backfill:blog-quality` may be used only as legacy read-only diagnostics.
- `scripts/backfill-blog-quality.ts --write` and `--apply` terminate before any database update.
- The removed `backfill:blog-quality:write` package command must not be restored.
- Use `audit:blog-quality-v3`, disposition previews, reviewed SQL, and the stale-content/removal runbook for corpus changes.

## 목적과 안전 기본값

V3는 발행량보다 검증된 수요, claim 근거, corpus 다양성, human review를 우선합니다. `BLOG_AUTOPUBLISH_MODE`가 없거나 잘못되면 `draft_only`이며, 이 모드에서는 `content_creatives.status=published`, indexing outbox, IndexNow worker, public cache revalidation을 실행하지 않습니다.

## 환경 변수

| 변수 | 기본값 | 의미 |
|---|---:|---|
| `BLOG_AUTOPUBLISH_MODE` | `draft_only` | `draft_only`, `reviewed_only`, `live`만 허용 |
| `BLOG_PRODUCTION_ALLOWED_GIT_REF` | `main` | production 배포 ref가 다르거나 commit SHA가 없으면 effective mode를 `draft_only`로 강등 |
| `BLOG_DAILY_PUBLISH_CAP` | `1` | Asia/Seoul 일일 공개 상한 |
| `BLOG_MAX_WEATHER_SHARE_30D` | `0.20` | 최근 30일 날씨 archetype 최대 비중 |
| `BLOG_MAX_SAME_ARCHETYPE_IN_LAST_10` | `2` | 최근 10개 중 같은 archetype 상한 |
| `BLOG_REQUIRE_DEMAND_SIGNAL` | `true` | 관측·검증 demand signal 필수 |

`reviewed_only`는 `review_status=approved`이고 demand/evidence/claim/quality/diversity gate를 모두 통과한 글만 발행합니다. `live`도 human approval이 필요한 HIGH risk를 우회하지 않습니다. `coverage_gap`은 demand signal이 아닙니다.

### Naver-first 운영값과 슬롯

생성 입력은 `docs/runbooks/blog-serp-research-v3.md`의 Naver-first 계약을 사용합니다. 코드 기본값은 계속 `draft_only`, cap 1입니다. migration·snapshot·provider-backed canary와 public surface 검증이 끝난 운영 change window에서만 `BLOG_AUTOPUBLISH_MODE=live`, `BLOG_DAILY_PUBLISH_CAP=3`을 함께 승인합니다.

cap 3의 KST 누적 공개 허용량은 09시 1건, 12시 1건, 15시 2건, 18시 2건, 21시 3건입니다. 기존 5회 cron은 유지합니다. LOW/MEDIUM만 자동발행하고 HIGH-risk는 다른 안전 후보로 슬롯을 넘깁니다. 같은 실행에서 후보를 최대 8개까지 순서대로 시도합니다.

## 발행 흐름

```text
observed demand → research packet → flexible brief/archetype → writer
  → claim ledger + source expiry/conflict gate
  → whole-corpus duplicate gate → explainable quality gate
  → autopublish mode/risk/review/portfolio caps
  ├─ blocked: draft + pending_review, public side effect 없음
  └─ passed: canonical publish → snapshot refresh → cache tag → indexing outbox
```

생성 실패나 연구 실패는 고정 checklist 글로 대체하지 않습니다. 결정론적 fallback은 진단 artifact로만 허용되며 public 상태가 될 수 없습니다. 발행 직전 repair는 줄바꿈, 위험 HTML, 명백히 깨진 Markdown URL, trailing whitespace만 정리합니다.

## 배포 전 검증 순서

1. `git merge-base --is-ancestor <candidate-commit> origin/main`이 성공하는지 확인합니다.
2. migration 다섯 개를 staging/local clone에서 순서대로 검증합니다. 운영에는 아직 적용하지 않습니다.
3. `npm run test -- <V3 tests>`, blog suite, `npm run type-check`, `npm run lint`, `npm run build`를 실행합니다.
4. `npm run canary:blog-quality-v3` 결과와 failure evidence를 검토합니다.
5. `npm run audit:blog-serp-v3`로 24개 query와 상세 fetch 실패 사유를 검토합니다. Naver 표본을 Google/Naver 통합검색 순위로 해석하지 않습니다.
6. `npm run audit:blog-quality-v3`와 `npm run plan:blog-disposition-v3`를 read-only로 실행합니다.
7. production env는 먼저 `draft_only`로 설정하고 preview deployment에서 발행 cron을 dry-run 검증합니다.
8. main의 immutable commit만 Vercel production으로 promote합니다. feature branch 이름을 production source로 직접 사용하지 않습니다.
9. DB migration 적용 후 `select * from refresh_blog_public_snapshots_v3();`를 1회 실행하고 count/checksum을 확인합니다.
10. `draft_only` 상태에서 목록, 상세, RSS, sitemap, image sitemap, related, invalid destination, DB 장애 fallback을 검증합니다.
11. LOW/MEDIUM provider-backed canary가 모두 통과한 승인 change window에서만 `live`/cap 3을 켭니다. HIGH-risk human approval은 계속 필수입니다.

## snapshot 갱신과 rollback

- 기본 확인: `npx tsx scripts/refresh-blog-public-snapshots.ts`
- bundled catalog 갱신: `--write-bundled` (로컬 artifact만 변경)
- DB snapshot 갱신: `BLOG_SNAPSHOT_APPLY_CONFIRM=PUBLIC_ELIGIBILITY_REVIEWED`와 `--apply-db`가 모두 필요합니다.
- checksum이 바뀐 snapshot만 version이 증가하고 이전 row는 history에 보존됩니다.
- 장애 시 현재 snapshot을 유지하고 새 refresh를 중단합니다. 잘못 갱신했다면 history checksum을 대조한 후 명시적 복원 SQL을 작성하며 자동 rollback하지 않습니다.

### 상세 본문 last-known-good 번들

- DB snapshot은 전체 공개 본문을 보관하고, 정적 번들은 장애 시 반드시 살아 있어야 하는 핵심 URL만 최대 20개 보관합니다.
- 생성 예: `npx tsx scripts/refresh-blog-public-snapshots.ts --detail-slugs=slug-a,slug-b --write-detail-bundled`
- 번들은 `public_blog_content_creatives`가 아니라 공개 자격이 반영된 `blog_public_snapshots`에서만 읽습니다.
- 본문 200자 미만, 누락 slug, 8MB 초과 번들은 생성 실패합니다. LOW risk 기본 최대 수명은 720시간(30일)이며 HIGH risk는 24시간, MEDIUM risk는 48시간으로 더 짧게 제한합니다.
- DB가 정상이며 slug 조회 결과가 0건이면 번들로 되살리지 않고 진짜 404로 처리합니다.

## 분석 이벤트 내구성과 데이터 readiness

- 리드 INSERT trigger가 같은 트랜잭션에서 `analytics_server_event_outbox`에 `generate_lead`를 기록합니다. API의 기존 직접 기록과 outbox는 `lead:<uuid>` idempotency key를 공유합니다.
- `/api/cron/analytics-delivery`가 10분마다 outbox를 처리하고, 15분 넘은 processing lease를 회수하며 최대 8회 지수 backoff 후 dead로 전환합니다.
- `/api/cron/blog-data-readiness`는 매일 검색성과 30일, 참여/RUM 7일, 서버 전환 30일, 현재 snapshot, outbox dead/backlog를 검사합니다.
- 필수 데이터가 0이거나 query가 실패하면 성공으로 간주하지 않고 HTTP 503과 Sentry critical signal을 냅니다. outbox ready가 100건을 넘으면 warning입니다.

## pHash 감사

- 기본 실행 `npm run audit:blog-image-phash`는 media registry를 읽고 로컬 JSON/CSV preview만 만듭니다.
- 전체 검사는 `npm run audit:blog-image-phash -- --limit=1000 --concurrency=12`로 실행합니다. `--limit`은 출현 횟수가 아니라 고유 이미지 URL 수이며 concurrency는 최대 16으로 제한됩니다.
- media registry나 corpus read가 실패하면 실패 원인을 숨기지 않고 `source_read_error`에 기록합니다. 이때 같은 날 생성된 bundled public-detail snapshot이 있으면 공개 가능 글 범위만 감사하고 `source_scope=last_known_good_public_eligible_posts`로 표시합니다. 이 결과를 전체 draft/queue 감사로 간주하지 않습니다.
- JSON에는 URL·양쪽 목적지·pHash distance·동일 원본 여부가 저장됩니다. exact URL, 동일 source URL variant, 서로 다른 source asset 후보를 구분하며 후보만으로 자동 삭제하지 않습니다.
- DB 반영은 `BLOG_IMAGE_PHASH_APPLY_CONFIRM=DRY_RUN_REVIEWED`와 `npm run backfill:blog-image-phash`가 동시에 있어야 합니다.
- URL redirect마다 public DNS를 재검사하고 private/local 주소, 비-image content type, 12MB 초과 파일을 거부합니다.
- 이 작업에서는 운영 DB backfill을 실행하지 않습니다.

## migration staging rehearsal

1. Docker Desktop과 Supabase local stack을 준비합니다.
2. `npm run verify:blog-migration-bundle-v3`로 release manifest에 고정된 migration 5개와 rollback SQL의 SHA-256, 파일 집합, 실행 순서를 확인합니다. 한 파일이라도 검토 후 변경됐다면 manifest도 별도 review로 갱신하기 전까지 진행하지 않습니다.
3. `npm run rehearse:blog-migrations`로 위 검증된 migration 5개와 실행 명령을 dry-run 확인합니다.
4. 일반 개발용 `project_id = "yeosonam-os"`에서는 reset을 실행하지 않습니다. 별도 clone/worktree의 `supabase/config.toml`에 `blog-quality-v3-rehearsal`처럼 `rehearsal`, `ephemeral`, `scratch`가 포함된 고유 project id와 충돌하지 않는 로컬 port를 지정합니다.
5. 해당 별도 프로젝트를 `npx supabase start`로 기동한 뒤 project id와 loopback DB URL을 모두 확인합니다.
6. PowerShell에서는 `$env:BLOG_LOCAL_MIGRATION_REHEARSAL_CONFIRM='LOCAL_EPHEMERAL_DB'; $env:BLOG_LOCAL_MIGRATION_REHEARSAL_PROJECT_ID='blog-quality-v3-rehearsal'; npm run rehearse:blog-migrations:local`을 실행합니다. bash에서는 두 환경 변수를 명령 앞에 지정합니다.
7. 스크립트는 확인한 project id가 현재 config와 정확히 일치하고 `127.0.0.1`, `localhost`, `::1` DB일 때만 reset을 허용합니다. 일반 로컬 업무 데이터와 linked/임의 DB URL은 거부합니다.
8. 스크립트는 `db reset --local --no-seed`, `db lint --local`, V3 pgTAP만 실행합니다.
9. local rehearsal이 통과한 뒤에만 staging clone에서 사람이 migration 적용을 승인합니다. 운영 DB는 별도 승인 전까지 변경하지 않습니다.

## 배포 후 관찰

Vercel에서 `/blog`의 database-unavailable 발생률, stale snapshot 제공 수, snapshot age를 확인합니다. RUM은 동의가 있는 비식별 이벤트만 저장하며 p75 목표는 LCP 2.5s, INP 200ms, CLS 0.1입니다. 표본이 없으면 달성으로 보고하지 않습니다.

## 2026-08-12 production readiness addendum

### Fail-closed environment

- `BLOG_AUTOPUBLISH_MODE=draft_only`로 배포를 시작합니다.
- `BLOG_PRODUCTION_ALLOWED_GIT_REF=main`을 설정합니다.
- production에서 `VERCEL_GIT_COMMIT_REF`, `VERCEL_GIT_COMMIT_SHA`가 없거나 ref가 허용값과 다르면 요청 mode가 `live`여도 effective mode는 `draft_only`입니다.
- publisher는 V3 publish 및 delivery resource의 실제 column probe가 모두 통과하기 전에 queue row를 변경하지 않습니다.

### 운영 migration history가 local과 다를 때

2026-08-12 읽기 전용 점검에서 일반 `db push --linked --include-all --dry-run`은 `LegacyDbPushMissingLocalError`로 차단됐습니다. CLI가 제안하는 대규모 history repair를 실행하지 않습니다.

1. production clone/staging branch에서 다음 SQL 5개를 파일 순서대로 실행하고 rollback SQL, function 권한, RLS, SQL/TS eligibility parity, snapshot refresh를 검증합니다.
   - `20260811132017_blog_quality_v3_policy.sql`
   - `20260811132023_blog_quality_v3_demand_evidence.sql`
   - `20260811132031_blog_quality_v3_snapshots_media.sql`
   - `20260811132037_blog_quality_v3_measurement.sql`
   - `20260811210920_blog_quality_v3_reliability_followup.sql`
2. production change window에서는 일반 `db push`가 아니라 검토된 5개 SQL만 같은 순서로 선택 적용합니다. 각 파일 직후 object/column/function probe를 실행하고 실패하면 다음 파일로 진행하지 않습니다.
3. SQL 적용과 object 검증이 모두 끝난 뒤에만 정확히 위 5개 version을 migration history에 `applied`로 표시합니다. 선기록하거나 unrelated version을 repair하지 않습니다.
4. `select * from public.refresh_blog_public_snapshots_v3();` 실행 후 `current snapshot count = public eligibility count`를 확인합니다.
5. 검수 차단 published row와 수요 없는 queue disposition을 승인된 dry-run plan대로 처리합니다.
6. 아래 strict gate가 통과하기 전에는 `reviewed_only` 또는 `live`를 켜지 않습니다.

```powershell
npm run verify:blog-production-readiness-v3 -- `
  --production-branch=main `
  --production-commit=<immutable-sha> `
  --database-errors-7d=<vercel-observed-count>
```

코드 배포를 DB migration보다 먼저 해야 할 경우에도 publisher는 schema gate에서 중단되고 catalog/detail은 bundled last-known-good를 사용합니다. 이때도 mode는 계속 `draft_only`여야 합니다.

### 전체 공개 corpus detail bundle

DB 장애 시 공개 가능 글 전체를 보존하려면 아래 명령으로 공개 뷰를 읽고 local artifact만 갱신합니다. DB에는 쓰지 않으며 최대 500건, 8MB를 넘으면 실패합니다.

```powershell
npx tsx scripts/refresh-blog-public-snapshots.ts `
  --all-details `
  --write-bundled `
  --write-detail-bundled
```

HIGH/MEDIUM/LOW risk 본문의 fallback 최대 수명은 각각 24/48/720시간입니다. LOW risk의 30일 허용은 DB 장애 중 이미 공개 검증된 글의 false-404를 줄이기 위한 것이며, HIGH/MEDIUM risk에는 적용되지 않습니다. bundle refresh가 이 만료를 우회하지 않습니다.

## 원격 Supabase preview 리허설 계약

로컬 stack만으로 production schema drift를 재현할 수 없을 때는 production data가 없는 Supabase preview branch를 사용합니다.

1. branch는 `with_data=false`, non-default, non-persistent로 생성하고 원격 Git branch와 다른 이름을 사용합니다. 같은 이름은 Git integration의 background migration과 수동 restore가 겹칠 수 있습니다.
2. production에는 schema dump와 SELECT만 실행합니다. `db dump --linked --dry-run`은 credential을 출력할 수 있으므로 사용하지 않습니다.
3. dump에 `COPY`, data `INSERT`, password, service-role key, `DATABASE_URL`이 없는지 확인합니다.
4. restore는 PowerShell string pipe가 아니라 read-only Docker bind mount와 `psql -f`를 사용합니다. schema restore에는 `ON_ERROR_STOP=1`과 `--single-transaction`을 함께 지정합니다.
5. `CREATE INDEX CONCURRENTLY`가 있는 V3 migration은 외부 transaction으로 감싸지 않고 파일 순서대로 하나씩 실행합니다.
6. `public_blog_content_creatives`의 기존 ordinal 1~51과 `security_invoker=true`, V3 resource 18/18, RLS 14/14를 확인합니다.
7. `npm run verify:blog-public-eligibility-parity-v3`를 preview URL/service-role/anon key로 실행합니다. runtime verifier는 snapshot을 갱신하므로 아래처럼 preview branch 이름과 ref를 명시하고 정확한 확인값까지 넣은 경우에만 실행합니다. `SUPABASE_URL`은 server-only 직접 project origin이어야 하며 `NEXT_PUBLIC_SUPABASE_URL`로 대체되지 않습니다. Management API token에는 read-only `environment:read`와 해당 production/development branch read 권한만 부여합니다.

```powershell
$env:BLOG_STAGING_RUNTIME_VERIFY_CONFIRM='STAGING_SNAPSHOT_REFRESH_ALLOWED'
$env:BLOG_STAGING_SUPABASE_BRANCH_NAME='<preview-branch-name>'
$env:BLOG_STAGING_SUPABASE_PROJECT_REF='<preview-project-ref>'
$env:BLOG_PRODUCTION_SUPABASE_PROJECT_REF='ixaxnvbmhzjvupissmly'
$env:SUPABASE_ACCESS_TOKEN='<read-only-management-api-token>'
$env:SUPABASE_URL='https://<preview-project-ref>.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY='<preview-service-role-key>'
$env:SUPABASE_ANON_KEY='<preview-anon-key>'
npm run verify:blog-staging-runtime-v3
```

   먼저 read-only Management API가 branch 이름, `parent_project_ref`, `project_ref`, `is_default=false`, `persistent=false`, `with_data=false`를 증명합니다. 이 검증이 실패하면 Data API client도 만들지 않으며 snapshot RPC를 호출하지 않습니다. 확인값 누락, production ref, URL/ref 불일치, path/query가 붙은 URL도 같은 방식으로 fail-closed 합니다. fixture 외의 production data를 복제하지 않습니다.
8. 네 개의 민감한 blog `SECURITY DEFINER` RPC가 anon/authenticated에 false, service-role에 true인지 확인하고 Supabase Advisor의 blog warning이 0인지 확인합니다.
9. preview fixture와 snapshot refresh는 staging에만 허용합니다. production snapshot refresh와 corpus write는 별도 change window 전에는 실행하지 않습니다.
10. 실패한 preview branch는 exact branch id와 `is_default=false`, `with_data=false`를 확인한 뒤 삭제합니다. production branch를 reset/delete/rebase/merge하지 않습니다.

최종 staging 증거는 `docs/audits/blog-quality-engine-v3-staging-rehearsal-2026-08-12.md`에 보존합니다.

## 공개 검수자 표기 조건

- `fact_checked_at`은 사실 확인 날짜이며 human review 시각이 아닙니다. 두 값을 서로 대체하지 않습니다.
- 공개 `reviewedBy`는 approved `content_reviews` row에 `reviewer_id`, `reviewed_at`, `review_scope`가 모두 있고, 공개 가능한 reviewer display name이 명시된 경우에만 snapshot에 포함합니다.
- 하나라도 없으면 review badge와 JSON-LD `reviewedBy`를 모두 생략합니다. “운영팀 검증” 같은 집단 배지로 대체하지 않습니다.
- snapshot refresh dry-run에서 review metadata가 새로 사라지는 row 수를 확인하고, 의도한 reviewer profile을 먼저 보강한 뒤 refresh를 승인합니다.
