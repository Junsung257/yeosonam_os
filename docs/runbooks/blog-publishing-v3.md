# Blog Publishing V3 운영 런북

## 목적과 안전 기본값

V3는 발행량보다 검증된 수요, claim 근거, corpus 다양성, human review를 우선합니다. `BLOG_AUTOPUBLISH_MODE`가 없거나 잘못되면 `draft_only`이며, 이 모드에서는 `content_creatives.status=published`, indexing outbox, IndexNow worker, public cache revalidation을 실행하지 않습니다.

## 환경 변수

| 변수 | 기본값 | 의미 |
|---|---:|---|
| `BLOG_AUTOPUBLISH_MODE` | `draft_only` | `draft_only`, `reviewed_only`, `live`만 허용 |
| `BLOG_DAILY_PUBLISH_CAP` | `1` | Asia/Seoul 일일 공개 상한 |
| `BLOG_MAX_WEATHER_SHARE_30D` | `0.20` | 최근 30일 날씨 archetype 최대 비중 |
| `BLOG_MAX_SAME_ARCHETYPE_IN_LAST_10` | `2` | 최근 10개 중 같은 archetype 상한 |
| `BLOG_REQUIRE_DEMAND_SIGNAL` | `true` | 관측·검증 demand signal 필수 |

`reviewed_only`는 `review_status=approved`이고 demand/evidence/claim/quality/diversity gate를 모두 통과한 글만 발행합니다. `live`도 human approval이 필요한 HIGH risk를 우회하지 않습니다. `coverage_gap`은 demand signal이 아닙니다.

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
5. `npm run audit:blog-quality-v3`와 `npm run plan:blog-disposition-v3`를 read-only로 실행합니다.
6. production env는 먼저 `draft_only`로 설정하고 preview deployment에서 발행 cron을 dry-run 검증합니다.
7. main의 immutable commit만 Vercel production으로 promote합니다. feature branch 이름을 production source로 직접 사용하지 않습니다.
8. DB migration 적용 후 `select * from refresh_blog_public_snapshots_v3();`를 1회 실행하고 count/checksum을 확인합니다.
9. `draft_only` 상태에서 목록, 상세, RSS, sitemap, image sitemap, related, invalid destination, DB 장애 fallback을 검증합니다.
10. 승인된 운영 판단이 있을 때만 `reviewed_only`로 전환합니다. `live` 전환은 별도 승인 사항입니다.

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
- 본문 200자 미만, 누락 slug, 8MB 초과 번들은 생성 실패합니다. 기본 최대 72시간이며 HIGH risk는 24시간, MEDIUM risk는 48시간으로 더 짧게 제한합니다.
- DB가 정상이며 slug 조회 결과가 0건이면 번들로 되살리지 않고 진짜 404로 처리합니다.

## 분석 이벤트 내구성과 데이터 readiness

- 리드 INSERT trigger가 같은 트랜잭션에서 `analytics_server_event_outbox`에 `generate_lead`를 기록합니다. API의 기존 직접 기록과 outbox는 `lead:<uuid>` idempotency key를 공유합니다.
- `/api/cron/analytics-delivery`가 10분마다 outbox를 처리하고, 15분 넘은 processing lease를 회수하며 최대 8회 지수 backoff 후 dead로 전환합니다.
- `/api/cron/blog-data-readiness`는 매일 검색성과 30일, 참여/RUM 7일, 서버 전환 30일, 현재 snapshot, outbox dead/backlog를 검사합니다.
- 필수 데이터가 0이거나 query가 실패하면 성공으로 간주하지 않고 HTTP 503과 Sentry critical signal을 냅니다. outbox ready가 100건을 넘으면 warning입니다.

## pHash 감사

- 기본 실행 `npm run audit:blog-image-phash`는 media registry를 읽고 로컬 JSON/CSV preview만 만듭니다.
- DB 반영은 `BLOG_IMAGE_PHASH_APPLY_CONFIRM=DRY_RUN_REVIEWED`와 `npm run backfill:blog-image-phash`가 동시에 있어야 합니다.
- URL redirect마다 public DNS를 재검사하고 private/local 주소, 비-image content type, 12MB 초과 파일을 거부합니다.
- 이 작업에서는 운영 DB backfill을 실행하지 않습니다.

## migration staging rehearsal

1. Docker Desktop과 Supabase local stack을 준비합니다.
2. `npm run rehearse:blog-migrations`로 대상 migration 5개와 실행 명령을 dry-run 확인합니다.
3. 별도의 임시 로컬 DB임을 확인한 change window에서만 `BLOG_LOCAL_MIGRATION_REHEARSAL_CONFIRM=LOCAL_EPHEMERAL_DB npm run rehearse:blog-migrations:local`을 실행합니다.
4. 스크립트는 `db reset --local --no-seed`, `db lint --local`, V3 pgTAP만 실행하며 `--linked`, `--db-url`, `--apply`를 거부합니다.
5. local rehearsal이 통과한 뒤에만 staging clone에서 사람이 migration 적용을 승인합니다. 운영 DB는 별도 승인 전까지 변경하지 않습니다.

## 배포 후 관찰

Vercel에서 `/blog`의 database-unavailable 발생률, stale snapshot 제공 수, snapshot age를 확인합니다. RUM은 동의가 있는 비식별 이벤트만 저장하며 p75 목표는 LCP 2.5s, INP 200ms, CLS 0.1입니다. 표본이 없으면 달성으로 보고하지 않습니다.
