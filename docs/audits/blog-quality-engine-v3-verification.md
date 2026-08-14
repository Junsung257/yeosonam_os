# Blog Quality Engine V3 검증 — 2026-08-11 기준

이 문서는 운영 배포나 운영 DB 쓰기 없이 수행한 구현 검증 기록이다. 기준일은 미션에서 지정한 2026-08-11(Asia/Seoul)이며, 최종 로컬 검증은 2026-08-12 15:59 KST까지 이어졌다.

## 1. source of truth

- `origin/main`, 격리 worktree 시작 HEAD, 운영 Vercel commit: 모두 `2ab65ef05b4a0f9fff8564a9685de0047bc08860`
- package manager/lockfile: npm / `package-lock.json`
- Next.js: `15.5.21`
- 작업 branch/worktree: `codex/blog-quality-engine-v3-20260811` / `C:/dev/yeosonam-os-blog-quality-engine-v3`
- 원래 worktree의 미커밋 변경은 수정하거나 삭제하지 않았다.

운영이 feature branch 이름을 배포 source로 남기는 재발을 막기 위해, production은 `main`에 포함된 immutable commit만 promote하고 배포 전 `git merge-base --is-ancestor <production-commit> origin/main`을 확인하도록 runbook에 고정했다.

## 2. 근본 원인과 적용 구조

기존 시스템은 coverage gap만으로도 큐를 만들고, 생성 실패 시 결정론적 템플릿을 공개 후보로 복구하며, 최소 이미지·FAQ·체크리스트·키워드 밀도 보정을 품질로 오인했다. 공개 자격도 TypeScript와 SQL view가 별도로 진화했고, 최근 100개 중심 exact signature 검사와 포화 점수는 코퍼스 수준 중복과 사실 위험을 놓쳤다. 목록은 큰 catalog 조회와 DB 장애를 사용자 경로로 전파했고, `analytics_server_events`의 `generate_lead` 타입은 존재했지만 실제 리드 API에서 호출되지 않았다.

```text
observed demand
  -> research packet / source versions / claim ledger
  -> intent + evidence 기반 12 archetypes
  -> model generation (결정론적 fallback 공개 금지)
  -> claim + diversity + explainable quality + review gates
  -> draft_only | reviewed_only | live
  -> 단일 public eligibility SQL/TS 정책
  -> catalog/detail/RSS/sitemap/related/indexing
  -> durable DB snapshot -> bundled catalog fallback
```

기존 evidence repository, claim publish gate/ledger, representative, review workflow, generation research를 재사용했고 ERP·재무·CRM 로직은 수정하지 않았다.

## 3. 자동발행 동작 변경

- `BLOG_AUTOPUBLISH_MODE`가 없거나 잘못되면 `draft_only`다.
- `draft_only`는 `published` 전환, indexing outbox, IndexNow, sitemap revalidation을 호출하지 않는다.
- `reviewed_only`는 `review_status=approved`와 모든 gate를 동시에 요구한다.
- `live`도 demand, risk/evidence, duplicate, daily/weather/archetype cap을 우회하지 못한다.
- 기본값: 일 1건, 30일 날씨 비중 0.20, 최근 10건 같은 archetype 최대 2, demand signal 필수.
- 모델·연구 실패와 결정론적 fallback은 공개하지 않고 draft/pending review/quarantine 경로에 둔다.
- keyword-density 문장 삽입, 범용 FAQ/공식 링크/분량 채우기, 최소 이미지 3장 강제, `(2편)` suffix를 공개 경로에서 제거했다.
- 최종 공개 결정과 V3 차원별 품질 evidence를 각각 DB audit row로 남기도록 구현했다. migration은 작성만 했고 적용하지 않았다.

## 4. 공개 자격과 기존 코퍼스

공개 금지 상태는 `pending_review`, `in_review`, `rejected`, `changes_requested`다. 비자·입출국·ESTA/ETA/ETIAS·여권·세관/면세·보험·법률/규제·안전·건강/의료는 `approved`가 없으면 공개할 수 없다. 목록, 상세, destination, angle, related, prev/next, sitemap, RSS, JSON-LD, indexing 경로가 동일 정책을 사용하며 SQL/TS parity fixture를 공유한다.

읽기 전용 disposition 270건:

| action | 건수 |
|---|---:|
| KEEP | 38 |
| REFRESH | 2 |
| MERGE | 147 |
| QUARANTINE | 23 |
| NOINDEX | 60 |

redirect 후보는 147건이다. 미적용 preview일 뿐 운영 row는 변경하지 않았다. SQL preview의 `image_duplicate_count`는 pHash를 다시 계산하지 않아 0이며, URL/host 중복 감사와 향후 media registry backfill을 함께 봐야 한다.

## 5. canary 결과

offline labeled canary는 24개 초안, 24개 목적지, 12 intent, 12 archetype으로 실행됐다.

- exact duplicate title 0
- normalized title skeleton 최대 2
- opening duplicate 0
- unsupported numeric claim 0
- stale HIGH claim 0
- cross-destination image reuse 0
- FAQ 12.5%, checklist 4.17%
- broken Korean 0

이는 구조·gate fixture 검증이며 실제 모델 문장 품질이나 실제 source 진위를 증명하지 않는다. 운영 전 승인된 provider/evidence로 별도 live canary가 필요하다.

## 6. 실행한 테스트와 결과

| 검증 | 결과 | 증거 |
|---|---|---|
| 측정/리드 targeted | PASS | 4 files, 16 tests |
| 최종 blog suite | PASS | 176 files, 1,320 tests, `--maxWorkers=4` |
| 첫 무제한 blog suite | 재실행 필요 | 1,319/1,320 후 해당 smoke 단독 6/6 PASS; 4-worker 전체 재실행 1,320/1,320 PASS |
| TypeScript | PASS | `tsc --noEmit`, 49.8초, 오류 0 |
| ESLint | PASS | 전체 `src`, 155.8초, 경고/오류 0 |
| migration prefix CI | PASS | 총 448, 기존 historical collision 16, 신규 collision 0 |
| production build | PASS(artifact 검증) | 첫 실행은 memory fan-out으로 incomplete; `experimental.cpus=4` 후 새 BUILD_ID와 prerender/routes manifest 생성, `npm run postbuild` PASS |

첫 타입 검사 호출은 184초 도구 제한으로 미판정됐고 중복으로 남은 해당 PID를 정리한 후 단일 재실행으로 PASS를 확정했다. 첫 production build는 `export-detail.success=false`, `prerender-manifest.json` 누락으로 명시적으로 실패했다. Next 15가 고코어 Windows 호스트 CPU 수를 worker 수로 사용한 것이 원인이어서 `experimental.cpus: 4`로 제한했고, 재빌드는 도구의 15분 호출 한도를 넘긴 뒤 자식이 정상 완료했다. 공식 `verify-next-build-output.cjs`와 `npm run postbuild`는 모두 `.next`를 검증했다.

## 7. 기존 운영 글 감사 스크립트

- render audit, 운영 표본 12건: 12/12 PASS, 평균 artifacts 0, 평균 inline image 3.0. 표본 12건 중 11건이 날씨 패턴 URL이었다.
- SEO audit, 운영 표본 12건: 12/12가 100점, 평균 title 33.8자, description 95.3자, text 2,938자, H2 10개, image 3개. 기존 점수 포화를 재현했다.
- image audit, 운영 표본 12건: 기존 audit 점수는 12/12가 100점이지만 36회 출현 중 unique URL 23개, URL duplicate ratio 0.361이었다.
- 로컬 corpus script는 기본 dry-run으로만 호출했다. 암호화 placeholder인 `.env.prod` 때문에 REST 호출은 `Invalid API key`로 쓰기 전 실패했다. preview 산출물은 연결된 Supabase의 read-only SQL 결과로 생성했다.

## 8. 성능·장애 구조 변경

- 목록: DB cursor pagination, 서버 필터, facet aggregate, durable/bundled last-known-good catalog fallback.
- 상세: public snapshot을 primary query로 사용하고 related/product/citation/prev-next를 비핵심 경로로 분리했다. DB 장애를 존재하지 않는 slug의 404와 구분한다.
- image: Next 15 `next/image` loader + Sharp proxy, 480/768/960/1280/1600, AVIF/WebP, hero만 priority, 본문 lazy, image sitemap.
- cache refresh 실패 시 stale snapshot을 제공하고 `BLOG_DATABASE_UNAVAILABLE` 문자열을 고객 응답으로 전파하지 않는다.
- RUM: 동의가 있을 때 route/device/connection/navigation type과 LCP/INP/CLS/TTFB를 저장한다.

현장 90일 p75는 LCP 3,552ms(목표 실패), INP 80ms, CLS 0.00755, TTFB 262.2ms다. 변경 후 field data가 없으므로 성능 목표 달성을 주장하지 않는다. cold cache와 DB 전체 장애가 동시에 발생했을 때 상세 본문을 제공할 bundled full-body snapshot은 아직 없고, 명시적 unavailable surface를 보여 404 오판만 막는다.

## 9. 검색·비즈니스 측정

블로그 참여 API는 동의가 없으면 DB write를 하지 않는다. 동의 시 60초 참여, scroll 50%, source/related/destination/product/consultation click과 RUM 차원을 기록한다. 24시간 이내 blog assist ID를 상품 문의 payload와 booking attribution snapshot으로 넘긴다. 리드 생성은 기존 `analytics_server_events.generate_lead`를 idempotent하게 기록하며, 검색어 원문은 서버 이벤트에서 제거하고 SHA-256 hash만 보존한다. 예약 확정 이벤트도 assisting content와 hash를 이어받는다.

운영 baseline의 `analytics_server_events=0`은 코드는 있었지만 리드 API 호출이 없었던 문제다. migration과 코드가 아직 운영 반영 전이므로 운영 데이터가 생겼다고 주장하지 않는다.

## 10. 운영 반영이 필요한 환경 변수

```text
BLOG_AUTOPUBLISH_MODE=draft_only
BLOG_DAILY_PUBLISH_CAP=1
BLOG_MAX_WEATHER_SHARE_30D=0.20
BLOG_MAX_SAME_ARCHETYPE_IN_LAST_10=2
BLOG_REQUIRE_DEMAND_SIGNAL=true
```

초기 배포는 반드시 `draft_only`다. migration/backfill/snapshot dry-run, parity SQL, canary와 수동 승인 검증 전에는 `reviewed_only`나 `live`로 바꾸지 않는다.

## 11. 아직 운영에 적용하지 않은 작업

- 5개 migration과 rollback/backfill SQL
- public snapshot refresh RPC 및 최초 snapshot 생성
- corpus quarantine/noindex/redirect/status 변경
- Naver/GSC search performance import
- Vercel 환경 변수와 production deployment
- `reviewed_only`/`live` 전환
- IndexNow 삭제/redirect 알림

## 12. 남은 위험

- migration 미적용 상태에서는 새 snapshot/media/search/claim/quality/measurement column을 사용하는 코드가 배포되면 안 된다.
- 운영 200건의 147건 merge 후보는 자동 적용할 수 없고, 대표 문서 및 301/410을 편집자가 확인해야 한다.
- pHash/embedding threshold는 labeled fixture로 시작했지만 실제 코퍼스 label로 재보정해야 한다.
- 모델 credential 없이 실행한 offline canary는 source 진위와 실제 문장 품질을 보증하지 않는다.
- 상세 full-body 번들은 운영 공개 뷰를 읽기 전용으로 조회해 공개 가능 192건 전체를 생성했다. artifact는 2,711,758 bytes이며 본문 200자 미만 항목은 0건이다. 이 번들은 가용성 fallback이지 기존 콘텐츠 품질 승인으로 간주하지 않는다.
- 최초 build의 high-core worker fan-out 문제는 `experimental.cpus=4` 제한으로 해소했다. 최종 cold production build는 641.7초에 통과했으므로 CI timeout은 15분보다 길게 유지하고 build cache hit/miss를 별도로 관찰해야 한다.
- 과거 검색엔진 캐시의 review-blocked 문서는 운영 disposition 적용과 Google/Naver removal 절차가 끝날 때까지 남을 수 있다.

## 13. 정확한 배포·검증 순서

1. branch diff와 migration SQL을 review하고 `draft_only` 환경 변수를 준비한다.
2. staging DB 백업/restore point를 만들고 rollback SQL을 별도 보관한다.
3. migration을 staging에 순서대로 적용한다: policy -> demand/evidence -> snapshots/media -> measurement -> reliability follow-up.
4. backfill dry-run과 SQL/TS parity fixture를 실행하고 row count/review 분포를 baseline과 비교한다.
5. public snapshot을 staging에서 생성하고 catalog/detail/RSS/sitemap/image sitemap을 검증한다.
6. 24개 이상의 provider-backed canary를 `draft_only`로 생성해 claim citation, duplicate, image license/pHash, review UI를 수동 확인한다.
7. corpus disposition과 301/410 계획을 편집자·SEO 담당자가 승인한다. 승인 전 운영 row를 변경하지 않는다.
8. production migration change window를 열고 migration -> backfill -> snapshot 순으로 실행한다.
9. 앱을 production에 배포하되 mode는 `draft_only`로 유지한다. `/blog`, known slug, DB fault injection, sitemap/RSS/indexing exclusion, analytics consent를 검증한다.
10. 24~72시간 오류율·field RUM·server event 유입을 관찰한다. 데이터가 0이면 성공이 아니라 readiness 오류로 처리한다.
11. approved high-risk fixture와 실제 demand import가 통과한 뒤에만 `reviewed_only`를 검토한다. `live`는 별도 변경 승인 없이는 사용하지 않는다.

## 14. 2026-08-12 reliability follow-up

- 리드 분석 이벤트 손실 지점을 `analytics_server_event_outbox`와 lead INSERT trigger로 보강했다. 1차 타깃 테스트는 7 files / 22 tests가 통과했다.
- 상세 페이지는 DB 장애 때 공개 가능 본문의 full-body bundle을 사용할 수 있다. 번들이 비어 있거나 risk별 HIGH 24시간/MEDIUM 48시간/LOW 720시간 freshness budget을 넘으면 fail-closed한다.
- 기존 64-bit image dHash를 사용하는 dry-run backfill/중복 리포트 도구를 추가했다. 실제 pHash DB backfill은 실행하지 않았다.
- zero-data readiness는 search 30d, engagement/RUM 7d, server event 30d, current snapshot, outbox를 검사한다. 0건과 query 실패는 critical이다.
- Supabase CLI 2.113.0을 확인했다. `supabase status`는 Docker Desktop Linux engine이 실행 중이지 않아 실패했으므로 local migration reset/pgTAP은 실행하지 않았다.
- migration rehearsal 스크립트는 local-only이며 `--linked`, `--db-url`, `--apply`를 거부한다. 이 follow-up에서도 운영 배포, 운영 DB write, migration apply는 0건이다.
- working tree의 V3 migration 5개를 migration safety checker에 직접 입력한 결과 5 files / 0 issues였다. 결과는 `docs/audits/blog-quality-v3-migration-safety-report.json`에 저장했다.
- 최종 regression은 blog 관련 184 files / 1,346 tests 전부 PASS, `npm run type-check` 오류 0, 전체 `npm run lint` 경고·오류 0이었다.
- production build는 Next.js 15.5.21에서 재배치 전 672.8초, 최신 main 재배치 후 675.3초에 각각 PASS했고 389 static pages 생성 및 `.next` manifest/postbuild 검증까지 통과했다.
- offline canary 재실행은 24 drafts, 24 destinations, 12 intents, 12 archetypes, duplicate title/opening 및 unsupported numeric/stale HIGH claim 모두 0으로 PASS했다.
- pHash read-only 실행은 `.env.prod`의 placeholder key 때문에 `corpus_read_failed:Invalid API key`로 중단됐다. 따라서 실제 이미지 hash 수와 duplicate cluster는 아직 측정하지 않았고 DB update는 0건이다.
- 작업 중 `origin/main`은 시작 commit `2ab65ef0`에서 finance 변경을 포함한 `8543d6d2`로 전진했다. blog 파일 직접 변경은 없었고, 5개 블로그 커밋을 최신 main 위에 충돌 없이 재배치했다. 재배치 후 typecheck, 1,346 tests, 전체 lint, production build를 모두 다시 통과했다.

## 15. 2026-08-12 runtime/browser hardening follow-up

- `origin/main`의 후속 finance commit `32871161` 위로 기존 6개 블로그 커밋을 다시 충돌 없이 rebase했다. 이 검증 문서 갱신 commit을 포함한 최종 branch는 `origin/main` 대비 behind 0, ahead 7이다.
- catalog page, durable snapshot, facet, detail snapshot query를 hard deadline으로 묶었다. AbortSignal을 무시하는 adapter/socket도 `Promise.race`가 각각 2.5~6초 안에 종료해 bundled/durable fallback으로 전환한다.
- 상세 query의 PostgREST/schema/connection 오류를 `null`로 바꾸던 false-404 경로를 제거했다. cache에 남은 `null`도 fresh query로 재확인하며, 실제 0행만 404이고 query 오류는 last-known-good 또는 database-unavailable surface로 간다.
- V3 migration 직전/직후 rolling window에는 기존 `public_blog_content_creatives` view의 공개 자격 정책을 그대로 사용하면서 `content_modified_at`, `fact_checked_at` projection 부재(`42703`, `PGRST204`)만 legacy projection으로 재시도한다. 이때 `updated_at`은 modified fallback으로만 사용하고 fact-check 날짜는 만들지 않는다.
- Windows `next dev`에서 production manifest 보정 plugin이 `afterEmit`마다 `.next`를 다시 써 watcher를 재기동하던 문제를 막았다. 보정 plugin은 production compiler에서만 등록한다. 별도 dev dist에서 instrumentation cold compile 134.1초, `/blog` cold compile 249.5초였으나 반복 manifest write가 사라지고 `Ready`에 도달했다. cache 재사용 기동에서는 `Ready` 32초, `/blog` compile 22.5초였다.
- 사용자 Chrome 실화면 검증: `/blog` title `여행 매거진 | 여소남`, H1 `여행 매거진`, visible text 1,269자, 공개 count 173, error overlay 0, console warning/error 0, database-unavailable 문구 미노출. 카드 및 destination facet가 렌더됐다.
- 로컬 Supabase는 API/DB 전체를 기동해 read-only query를 확인했다. public table 384개, `content_creatives` 0행, migration history 0행이며 V3 테이블은 아직 없다. 따라서 상세 bundled artifact 0건과 함께 실제 slug 본문을 재현할 row는 없었다. 목록은 bundled snapshot으로 정상 제공되고 상세는 가짜 본문이나 false-404 대신 fail-closed surface를 제공했다.
- migration rehearsal은 일반 개발 project id `yeosonam-os`에서 확인값을 넣어도 의도적으로 거부됐다. 이제 `rehearsal`, `ephemeral`, `scratch`가 포함된 별도 project id, 정확한 project-id confirmation, loopback DB URL이 모두 맞아야만 local reset을 실행한다. 이번 검증에서 DB reset/migration apply는 0회다.
- 추가 targeted regression은 5 files / 19 tests PASS였다. 경로 기준 전체 blog suite는 Windows 명령행 제한을 피하기 위해 45/45/45/45/2 파일로 나눠 실행했고 182 files / 1,338 tests가 모두 PASS했다. `npm run type-check` 오류 0, 전체 `npm run lint` 경고·오류 0이다.
- 최종 production build는 Next.js 15.5.21에서 964.1초에 PASS했다. compile 5.9분, static pages 389/389, `.next` postbuild manifest 검증 PASS다. 긴 cold build 시간은 CI timeout/caching 운영 위험으로 남긴다.
- offline canary 재실행 결과 24 drafts, 24 destinations, 12 intents, 12 archetypes, normalized title skeleton 최대 2, FAQ 12.5%, checklist 4.17%, duplicate title/opening, unsupported numeric, stale HIGH, cross-destination image reuse, broken Korean 모두 0으로 PASS했다.
- migration safety는 5 files / 0 issues, prefix audit는 전체 451 files / 기존 collision 16 / 신규 collision 0이다.
- corpus read-only audit 재시도는 `.env.prod` placeholder key 때문에 `corpus_read_failed:Invalid API key`로 실패했다. 이를 성공으로 처리하지 않았고 운영 DB write는 0건이다.

## 16. 2026-08-12 production-connected final hardening

- 최신 운영 Vercel deployment는 feature branch가 아니라 `main`의 immutable commit `54043ebdc5e7b787b304de9a932ecd3d50d7bdc6`다.
- 운영 Supabase 최종 SELECT에서 published 200, public eligible 192, review-blocked published 8, queued 9, queued without verified demand 9를 확인했다. 대기열은 검증 중 8건에서 9건으로 증가했지만 운영 DB write는 수행하지 않았다.
- V3 migration 5개와 V3 runtime resource 18개는 운영에 아직 없으므로 새 readiness gate는 `safeToEnableLive=false`를 반환한다.
- 최근 7일 `BLOG_DATABASE_UNAVAILABLE`은 131 occurrences / 100 users였다. 7일 관찰 창이 0이 되기 전에는 live gate를 통과하지 않는다.
- publisher는 publish+delivery schema probe를 queue write 전에 수행하며, stored demand signal을 읽어 검증된 demand가 없으면 AI generation 전에 차단한다.
- detail cache는 outage를 cache rejection으로 던지지 않고 typed envelope로 저장한다. durable snapshot의 진짜 empty row만 404이고, table/schema/DB 오류는 legacy public view 또는 bundled full body로 간다.
- 운영 공개 뷰를 읽기 전용으로 사용해 192/192 usable full-body bundle을 생성했다. artifact는 2.72MB이고 DB write는 0건이다.
- publisher와 indexing worker 모두 public snapshot refresh 성공 후에만 cache/indexing side effect를 수행한다.
- local Chrome에서 `/blog`는 H1과 article link를 렌더했고 database-unavailable 문구 및 console warning/error가 0이었다. `/blog/fukuoka-3`은 canonical, H1, 본문 2,409자, JSON-LD 4개를 렌더했다.
- local HTTP 검증에서 sitemap, RSS, image sitemap은 모두 200이며 content type은 각각 XML, RSS XML, XML이었다. 현재 운영의 image sitemap은 아직 HTML이므로 후보 배포 후 재검증이 필요하다.
- production migration history와 repository가 크게 달라 일반 `db push --include-all --dry-run`도 실패한다. 대규모 history repair는 금지하고 검토된 V3 5개 SQL만 staging rehearsal 후 선택 적용한다.
- 전체 Vitest 재검증은 680 files / 5,153 tests가 모두 PASS했다. `npm run type-check` 오류 0, `npm run lint` 경고·오류 0, `git diff --check` 오류 0이다.
- 최종 production build는 Next.js 15.5.21에서 641.7초에 PASS했다. compile 93초, static pages 389/389, `.next` manifest 및 postbuild 검증이 모두 통과했다.
- migration safety는 V3 5 files / 0 issues, prefix audit는 전체 452 files / 알려진 historical collision 16 / 신규 collision 0이다.

## 17. 2026-08-12 isolated Supabase staging rehearsal

- production schema만 추출하고 data를 복사하지 않은 non-default preview branch `blog-quality-v3-final-rehearsal-20260812`에서 V3 migration 5개를 순서대로 적용했다. 운영 DB write와 production deploy는 0건이다.
- 최종 probe는 runtime resource 18/18, RLS 14/14, view `security_invoker=true`, eligibility function `security_invoker=true`, SQL/TS parity 9/9 PASS였다.
- synthetic fixture 3건 중 공개 가능 1건만 public view와 snapshot에 나타났고 `changes_requested`와 미승인 HIGH-risk 글은 0건이었다. 익명 public view와 snapshot refresh RPC는 모두 `42501`로 차단됐다.
- staging에서 발견한 view ordinal drift, safe-update RPC, ambiguous PL/pgSQL, preview default function privilege, duplicate hot-path index를 migration과 contract test로 수정했다.
- 민감한 blog `SECURITY DEFINER` RPC 4개의 ACL은 anon/authenticated false, service-role true다. Supabase Security/Performance Advisor의 블로그 warning은 각각 0건이다.
- targeted regression은 17 files / 89 tests, migration safety는 5 files / 0 issues로 PASS했다.
- 검증 종료 직전 최신 `origin/main` `cef59defd55ecfb9dea192a8863ede6ab471d81e`를 충돌 없이 merge했다. 이후 최종 전체 회귀는 682 files / 5,170 tests, TypeScript 오류 0, ESLint 경고·오류 0, production build 570.6초와 389/389 static pages/postbuild PASS였다.
- staging migration history에는 schema/API 검증이 끝난 후 정확히 V3 5개 version만 `applied`로 기록했고 다른 version은 repair하지 않았다.
- 상세 증거와 credential rotation 후속 조치는 `docs/audits/blog-quality-engine-v3-staging-rehearsal-2026-08-12.md`에 기록했다.

## 18. 2026-08-12 post-rehearsal release hardening

- staging runtime 검증기는 public snapshot refresh RPC를 호출하므로 순수 read-only 도구가 아니다. 이제 정확한 confirmation, explicit server-only Supabase URL, preview project ref, production project ref를 모두 검사하고 production ref 또는 URL/ref 불일치는 네트워크 호출 전에 차단한다. 확인값 없는 실제 명령은 의도대로 `blog_staging_runtime_confirmation_missing`으로 종료됐다.
- V3 migration 5개와 rollback SQL을 `supabase/release-manifests/blog-quality-v3-20260811.json`에 실행 순서와 SHA-256으로 고정했다. `npm run verify:blog-migration-bundle-v3`와 dry-run rehearsal은 5/5 file, rollback 1/1 file을 검증했고 migration 본문 변조 fixture는 fail-closed 했다.
- rollback SQL에 reliability follow-up의 analytics outbox, lead trigger/function, 두 lead column과 constraint 정리를 추가했다. 사용 중인 public list index와 ambiguous representative key 수정은 되돌리면 장애를 재도입하므로 의도적으로 유지한다.
- DB pgTAP 계약을 10개에서 23개로 확장해 민감 RPC 4개의 anon/authenticated/service-role 권한, qualified function body, view ordinal 51/52/60, security invoker, 중복 index 제거와 snapshot refresh ACL을 고정했다. 이번 추가 작업에서는 삭제된 preview를 다시 만들거나 운영 DB에 접속하지 않았으므로 새 23개 pgTAP의 DB 실행은 운영 반영 전 새 staging clone에서 수행해야 한다. 기존 isolated staging에서 같은 object/ACL/ordinal 값은 SQL probe로 이미 확인됐다.
- 새 targeted unit/contract regression은 3 files / 10 tests PASS다. 최초 무제한 병렬 전체 회귀에서는 `src/app/sitemap.test.ts` 1건이 5초 timeout으로 실패했으나 단독 재실행은 0.52초에 PASS했고, 4-worker 제한 전체 재실행은 최종 수집 기준 684 files / 5,178 tests 모두 PASS했다. TypeScript 오류 0, 전체 ESLint 경고·오류 0, `git diff --check` 오류 0이다. 운영 DB write, migration apply, Vercel 배포, 환경 변수 변경은 모두 0건이다.
- 검증 중 전진한 `origin/main`의 finance-only commit `c5bec525`, `2718bc37`을 두 차례 충돌 없이 병합했다. 최종 검증 code baseline SHA `510c059227af57d6ca802239304e291d3ed6f619`은 확인 시점 `origin/main=2718bc37fc6c0ee382624ea0d7dfd722ef878ed2` 대비 behind 0, ahead 18이었다.
- 최종 병합 상태의 Next.js 15.5.21 production build는 580.1초, compile 2.5분, static pages 389/389, `.next` postbuild manifest 검증까지 PASS했다.

## 19. 2026-08-12 preview identity hardening

- 단순히 `preview ref != production ref`만 확인하면 다른 Supabase 프로젝트나 잘못 지정한 production parent를 staging으로 오인할 수 있었다. 공식 Management API의 database branch 응답을 snapshot mutation 전 필수 증거로 추가했다.
- verifier는 명시적 production ref, preview branch name, read-only Management API token을 요구한다. 응답의 branch name, `project_ref`, `parent_project_ref`, `is_default=false`, `persistent=false`, `with_data=false`가 모두 일치한 뒤에만 Data API client를 생성한다. token과 service-role key는 report에 포함하지 않는다.
- unsafe metadata 6종(default, persistent, with-data, wrong name, wrong parent, wrong project), Management API 403/invalid JSON, production ref/token 누락을 포함한 targeted regression은 3 files / 20 tests PASS, TypeScript 오류 0이었다. 삭제된 preview branch를 재생성하지 않았으므로 Management API 실연결 및 확장 pgTAP 23개 실행은 다음 data-free staging change window의 release gate로 유지한다.
- Supabase 2026-04-28 Data API 변경에 맞춰 V3 public table/function 권한은 migration에서 명시적으로 service-role에만 부여하고, anon/authenticated/public revoke를 유지한다. 운영 DB write, migration apply, 배포, production env 변경은 0건이다.
- 4-worker 전체 회귀에서는 기존 `/blog/[slug]` smoke 1건이 자원 경쟁 중 20초 timeout으로 실패했다. 해당 파일 단독 재실행은 9/9 PASS이고 문제 테스트는 2.746초였다. 사용자 프로세스를 종료하지 않고 2-worker로 재실행한 최종 전체 회귀는 수집 기준 684 files / 5,188 tests 모두 PASS했다.
- 최종 `npm run type-check`, 전체 ESLint, `git diff --check`는 오류 0이다. Next.js 15.5.21 production build는 411.9초, compile 77초, static pages 389/389, `.next` postbuild manifest 검증까지 PASS했다. 확인 시점 `origin/main=2718bc37fc6c0ee382624ea0d7dfd722ef878ed2` 대비 behind 0이었다.

## 20. 2026-08-13 전수 재검증과 fail-closed 보강

- 운영 DB를 SELECT로만 다시 조사했다. 현재 queued 11건은 모두 `coverage_gap` 계열이며 검색량·trend·GSC/Naver query·customer question·검증된 active product relation·editor approval가 모두 없어, 새 진단기 기준 `publishable_candidate_count=0`, `demand_missing_count=11`, `next_action=collect_demand`다. 운영 row는 변경하지 않았다.
- PostgREST는 존재하지 않는 relation에 대한 HEAD 요청도 성공처럼 보일 수 있었다. runtime readiness와 publisher 사전 검사를 실제 `select(...).limit(1)`로 교체했고, 운영에서 V3 resource 18/18이 아직 없음을 정확히 검출했다. 따라서 publisher는 queue claim·생성·상태 변경보다 먼저 중단한다.
- TypeScript public policy와 snapshot fallback 양쪽에 review/risk 판정을 적용했다. 운영 public view의 과거 정책에 의존하지 않고 unapproved 여행자보험 글도 제외해 bundled catalog/detail은 191건으로 재생성했다. `changes_requested`, `rejected`, `pending_review`, `in_review`와 승인 없는 HIGH-risk 문서는 직접 URL·목록·related·sitemap·RSS·image sitemap·indexing 대상이 아니다.
- 목록은 첫 화면 단위의 서버 cursor query와 5분 cache를 사용하며, 현재 운영 view에 아직 없는 V3 column 때문에 전체 요청이 실패하지 않도록 compact V3 select 뒤 legacy select로 호환 재시도한다. 상세는 authoritative public view를 우선하고, DB 장애일 때만 risk별 24/48/720시간 last-known-good bundle을 쓴다.
- GSC 실제 read-only 검증은 2026-08-08/09/10에 각각 18/21/36 row, 24/61/65 impressions, 1/0/0 clicks를 반환했다. importer는 date+page+query를 저장하고 25,000-row pagination과 `startRow`를 지원하며, 빈 결과는 성공으로 처리하지 않는다.
- 이미지 proxy는 480/768/960/1280/1600 variant, AVIF/WebP 협상, 최종 redirect host 검증, width별 cache key를 사용한다. 카드/본문은 `srcset`·`sizes`·고정 intrinsic size를 제공하고, deterministic repair가 목적지나 제목을 근거로 가짜 alt/caption을 만들지 않는다.
- offline canary는 24 drafts, 24 destinations, 12 intents, 12 archetypes, exact title 0, normalized skeleton 최대 2, 동일 opening 0, unsupported numeric claim 0, stale HIGH claim 0, cross-destination image reuse 0, FAQ 12.5%, checklist 4.17%, broken Korean 0으로 PASS했다.
- corpus dry-run disposition은 총 270건에 대해 REFRESH 92, MERGE 155, QUARANTINE 23이다. 직접 claim linkage가 부족한 기존 corpus에는 보수적인 unsupported-number 휴리스틱을 적용했으므로 이 결과는 자동 적용안이 아니라 human disposition preview다. 운영 DB write는 0건이다.
- release bundle checksum과 rollback dry-run은 통과했다. Docker/local Supabase가 이 환경에서 가동되지 않아 변경된 SQL의 실제 apply/pgTAP은 새 data-free staging clone에서 다시 통과해야 한다. 운영 readiness는 required migrations, runtime schema, snapshot parity, public surfaces, DB reliability, measurement, review-blocked legacy rows, queued demand의 8개 gate가 계속 BLOCKED다.
- 최초 production image pHash 감사는 같은 URL을 출현마다 직렬 다운로드해 184초 제한에서 끝나지 않았다. 감사기를 고유 URL 기준·bounded concurrency로 교체한 뒤, 2026-08-13 bundled public-detail snapshot의 이미지 766회 출현/478개 고유 URL을 6.623초에 전수 해시했고 실패 0, hash coverage 100%를 기록했다. 목적지별 중복 출현을 접은 518 visual uses에서 exact URL cross-destination 22그룹, 동일 원본 URL variant 21쌍, 서로 다른 source asset의 pHash 후보 7쌍을 찾았다. 후자 7쌍은 임계값 보정과 편집자 육안 검수 전 자동 제거하지 않는다. 로컬 `.env.prod` 키는 `Invalid API key`이므로 결과 scope는 `last_known_good_public_eligible_posts`이며 전체 draft/queue를 포함한 live registry 감사로 과장하지 않는다. 운영 배포, 운영 DB write, migration apply, production env 변경은 모두 0건이다.
- Chrome/HTTP 검증 중 승인 없는 HIGH-risk 문서가 화면상 not-found여도 streamed HTTP 200을 반환하는 soft-404를 발견했다. middleware의 동적 공개 판정이 public-prefix fast path 뒤에 있어 도달 불가능했던 것이 원인이었다. 공개 view row에 동일 review/HIGH-risk 정책을 적용하는 preflight를 fast path 앞으로 이동해 승인 없는 여행자보험은 404, 명시적 tombstone은 410으로 고정했고 둘 다 `X-Robots-Tag: noindex, nofollow`를 반환한다. DB 조회 실패는 page의 risk-bounded snapshot으로 넘겨 false-404를 만들지 않는다.
- 같은 변경에서 `/blog/image-sitemap.xml`을 article slug로 오인하는 회귀를 HTTP 검증으로 발견해 예약 경로 예외와 test fixture를 추가했다. 최종 production-start 결과는 `/blog` 200, `/blog/fukuoka-3` 200, unapproved insurance 404, tombstone 410, sitemap 283 entries, RSS 50 items, image sitemap 191 entries이며 세 index surface 모두 차단 slug 0건이다.
- 목록 첫 화면은 Chrome에서 이미지 12/12가 480/768/960/1280/1600 `srcset`, `sizes`, intrinsic size를 사용했고 eager image는 hero 1장뿐이었다. 상세 11/11도 반응형이며 기존 inline Pexels 3장은 1200x627, lazy, async decoding으로 보강됐다. 콘솔 warning/error는 0건이고 자체 `blog-assets` 480px 요청은 AVIF 31,823 bytes로 응답했다.
- 최종 blog 회귀는 193 files / 1,395 tests PASS다. middleware hard-404/reserved-route 회귀는 34 tests PASS, TypeScript·ESLint·`git diff --check` 오류 0이다. 마지막 Next.js 15.5.21 production build는 487.8초, compile 89초, static pages 390/390, `.next` postbuild 검증까지 PASS했다.

## 21. 2026-08-13 이미지 및 공개 경로 추가 hardening

- 이미지 프록시는 redirect를 자동 추적하지 않고 최대 3회까지 매 hop의 정확한 HTTPS allowlist를 요청 전에 검사한다. Wikimedia의 실제 media host인 `upload.wikimedia.org`만 추가했으며 credential URL과 non-standard port를 거부한다.
- 선언된 크기뿐 아니라 chunked body도 10MB를 넘는 즉시 읽기를 취소한다. same-origin active content가 될 수 있는 upstream SVG passthrough는 제거하고 415로 차단한다.
- 공개 블로그 middleware preflight는 anon/public key를 service-role보다 우선해 최소 권한으로 조회한다. review 상태를 즉시 반영해야 하므로 eligibility 결과를 캐시하지 않되, DB 장애가 상세 snapshot fallback 시간을 잠식하지 않도록 hard deadline을 1.5초에서 750ms로 줄였다.
- 추가 targeted regression은 5 files / 57 tests와 이미지 전용 3 files / 17 tests가 PASS했고, 전체 TypeScript 검사도 PASS했다. `docs/audits/blog-image-phash-preview.json`과 CSV는 dry-run 산출물이며 DB update는 0건이다.

## 22. 2026-08-13 최종 사용자 표면·운영 안전 재검증

### 자동발행과 레거시 쓰기 경로

- 레거시 `scripts/backfill-blog-quality.ts`는 영구 dry-run 전용으로 바꿨다. `--write` 또는 `--apply`는 DB client 생성이나 row 조회 전에 non-zero로 종료하며, `package.json`의 write alias도 제거했다.
- 기존 운영 가이드에 남아 있던 5건/일, SEO 100점, 키워드 밀도 보정, 범용 FAQ·체크리스트 append 절차는 V3 비활성 이력으로 표시했다. 현재 실행 계약은 `draft_only`, 일일 cap 1, 실측 demand 필수, 안전한 문법/HTML repair만 허용한다.
- `npm run audit:blog-revenue-funnel -- --strict`는 V3 일일 cap 계약 기준 15/15를 통과했다. 기존 5건/일을 성공 조건으로 판단하지 않는다.
- 운영 DB write, migration apply, production deploy, production env 변경은 모두 0건이다.

### 이미지 pHash dry-run

- bundled last-known-good 공개 snapshot 범위에서 이미지 출현 766건, audit 대상 visual use 518건, 고유 URL 478건을 6.623초에 해시했다. 계산 성공 478, 실패 0, hash coverage 100%였다.
- cross-destination exact URL cluster 22개, 동일 원본 URL variant 21쌍, 서로 다른 source asset pHash 후보 7쌍을 기록했다. 후보는 자동 삭제 대상이 아니라 라이선스·장소 확인이 필요한 편집 검토 대상이다.
- 결과는 `blog-image-phash-preview.json/csv`에 저장했다. 로컬 Supabase credential이 유효하지 않아 scope는 전체 media registry/draft/queue가 아닌 `last_known_good_public_eligible_posts`이며, 이 한계를 artifact의 `source_scope`와 `source_read_error`에 명시했다.

### 공개 표면 진실성 보강

- 상품 랜딩 hero의 `운영팀 검증`, `노팁·노옵션`, airline fallback `직항` 자동 배지를 제거했다. 화면에는 DB에 저장된 항공사·출발 공항·기간 사실만 중립 label로 표시한다.
- canonical H1 아래 DKI headline을 다시 H2로 출력하던 경로와 “맞춤 검색 결과” 표식을 제거했다. metadata title, H1, OG title은 URL 단위 저장 제목을 사용하고 방문자별 사실/제목 변형은 공개하지 않는다.
- 공개 상세 요청의 UTM parsing, `ad_landing_mappings` DKI lookup, `increment_alm_clicks` RPC 경로도 제거했다. 상세 요청은 광고 click count를 쓰지 않으며 stored landing subtitle만 사용한다.
- “여행 준비 장면”, “10초 판단”, “포함/불포함”, “일정 체감”처럼 실제 장면을 설명하지 않는 기존 inline alt는 공개 render에서 빈 alt로 바꿔 장식 이미지로 처리한다. 장면을 추측해 새 alt를 만들지 않는다.
- snapshot의 `reviewedBy`는 더 이상 `fact_checked_at`을 검토 시각으로 재사용하지 않는다. 최신 approved `content_reviews`의 `reviewer_id`, `reviewed_at`, `review_scope`와 명시된 reviewer display name이 모두 있을 때만 snapshot review metadata를 만든다. migration release SHA-256 manifest도 재검토 후 갱신했다.
- mobile breadcrumb는 제목을 숨겨 축약하고, 로고·breadcrumb·standalone 본문 링크·citation link의 touch area를 최소 44px로 맞췄다. hero의 중복 카카오 CTA는 제거하고 전역 mobile bottom navigation을 상시 상담 CTA로 유지한다.

### 최종 테스트와 build

| 검증 | 결과 | 증거 |
|---|---|---|
| Blog Vitest 전수 | PASS | 195 files, 1,413 tests |
| ERR-BLOG regression | PASS | 28 files, 88 tests |
| TypeScript | PASS | `tsc --noEmit`, error 0 |
| ESLint | PASS | 전체 `src`, warning/error 0 |
| migration release bundle | PASS | ordered migration 5개 + rollback SHA-256 일치 |
| revenue funnel strict | PASS | 15/15 |
| production build | PASS | Next.js 15.5.21, 565.0초, compile 113초, static pages 390/390, postbuild `.next` 검증 PASS |

### Chrome 실제 화면 검증

- 목록 `/blog`: title `여행 매거진 | 여소남`, canonical `https://www.yeosonam.com/blog`, robots `index, follow`, 12/12 image가 `srcset`·`sizes`·intrinsic dimension을 사용하고 hero만 eager였다. console warning/error 0건이었다.
- 상세 `/blog/fukuoka-3`: H1 1개, 같은 제목 H2/H3 0개, canonical·OG title·H1 동기화, JSON-LD는 `BlogPosting`과 `BreadcrumbList`, 본문 image 3/3 responsive, article width 720px, 허위 `운영팀 검증`/`노팁·노옵션` 노출 0, console warning/error 0건이었다.
- mobile 390×844: horizontal overflow 0, article width 342.7px, 본문 17px/line-height 30.94px, TOC 기본 접힘, 점검 대상 touch target 미달 0건, H1 1개, 동일 제목 heading 0개였다.
- 첫 cold navigation에서는 local snapshot/DB fallback 초기화 동안 browser CDP 3초 deadline이 1회 초과했지만, 페이지 준비 후 DOM·console 검증은 정상 통과했다. field 성능 자료가 아니므로 LCP 목표 달성으로 보고하지 않는다.

### 아직 “운영 완료”라고 부를 수 없는 이유

- 선택 검증 글 `fukuoka-3`은 disposition preview에서 `REFRESH`, unsupported numeric claim 4건으로 남아 있다. 기존 본문의 slash-delimited 깨진 표와 범용 checklist 잔재도 보인다. deterministic repair로 내용·숫자·주장을 새로 만들지 않는 원칙 때문에 이번 코드 변경으로 원문을 덮어쓰지 않았다.
- 운영 queued 11건은 demand 0건이라 publishable candidate 0건이다. V3 runtime resource 18/18과 migrations는 운영에 아직 적용되지 않았다.
- 운영 public view와 bundled safe snapshot 사이의 수량 parity, review-blocked legacy row disposition, 301/410, GSC/Naver import, 실제 RUM·engagement event는 production change window에서 별도 검증해야 한다.
- 따라서 현재 결과는 “배포 가능한 fail-closed 코드와 검증 산출물”이지 “운영이 완벽하다”는 선언이 아니다. production 전환은 migration rehearsal → `draft_only` 배포 → snapshot parity → 24개 provider-backed canary → 사람 승인 순서를 유지한다.

## 23. 2026-08-14 Naver-first SERP generation engine

### 공급자와 실제 수집 결과

- 유료 Google SERP API를 생성 필수조건에서 제거했다. V3 기본 공급자는 Naver Search Ads Keyword Tool(월간 검색수), Naver DataLab(상대 추이), Naver Search API blog/web(editorial 구조 표본), GSC(여소남 실제 성과)다.
- `npm run audit:blog-serp-v3`를 production DB write 없이 실행했다. 24개 query에서 editorial 표본 240/240, query당 10개 24/24, 상세 구조 fetch 204/240(85.0%), `fetch_blocked` 35, 기타 실패 1, unavailable query 0을 기록했다.
- 양수로 관측된 demand가 있는 query는 20/24였다. 두 DataLab 요청은 timeout이 발생했으며 성공으로 숨기지 않았다. Search Ads `"< 10"` bucket은 숫자로 바꾸지 않고 exact monthly total을 null로 유지한다.
- 이 표본은 Google 상위 10개 또는 Naver 통합검색 순위의 대체값이 아니다. 경쟁사 본문 전체는 저장하지 않고 compact structure metric과 짧은 excerpt만 보관한다.

### 생성·발행 계약 변경

- V3 brief가 writer 호출 전에 확정되고 실제 prompt의 단일 작성 계약이 된다. 구형 brief는 공식 evidence 연구계획 adapter로만 남겼다.
- 고정 H2·12개월표·FAQ·checklist·이미지 최소 수·연도·power word·`여행 가이드` suffix를 기본값에서 제거했다. broad destination query는 새 URL 대신 representative refresh로 보낸다.
- 후보 선정 preflight가 Naver Search Ads/DataLab의 실제 양수 신호를 읽는다. Search API 결과 존재 자체는 demand로 인정하지 않는다. `coverage_gap`만으로는 계속 차단한다.
- 첫 운영 후보 우선순위는 `다낭 10월 날씨`, `다낭 가볼만한곳`, `세부 호텔 추천`이다. 하루 cap 3을 승인한 경우 KST 누적 slot은 09시 1, 12시 1, 15시 2, 18시 2, 21시 3이다. 한 슬롯에서 최대 8후보, 한 queue item은 최대 3 durable attempts다.
- HIGH-risk human approval, claim conflict/expiry, unsupported number, corpus duplication, malformed Korean, fabricated experience, competitor 12-token overlap gate는 SERP 장애와 무관하게 계속 차단한다.

### 카나리·정적 검증

| 검증 | 결과 |
|---|---|
| structured canary | 24 drafts, 21 destinations, 15 intents, 10 archetypes |
| 다양성 | exact title 0, normalized skeleton 최대 2, duplicate opening 0 |
| 사실/언어 | unsupported numeric 0, stale HIGH 0, broken Korean 0 |
| 구성 포화 | FAQ 12.5%, checklist 4.2% |
| blog/SERP/keyword Vitest | 200 files, 1,435 tests PASS |
| TypeScript | error 0 |
| ESLint | warning/error 0 |
| Next.js production build | 15.5.21, 539초, compile 2.8분, static pages 390/390, postbuild PASS |

카나리는 `offline_structured_canary_no_publication`이며 production evidence나 실제 모델 문장 품질을 증명하지 않는다. 실제 운영 전에는 승인된 provider와 공식 source로 LOW/MEDIUM live canary를 `draft_only`에서 다시 실행해야 한다.

### DB·운영 미적용 상태

- additive migration `20260813223117_blog_naver_first_serp_research_v3.sql`, rollback, service-role RLS contract test를 작성했지만 운영에는 적용하지 않았다.
- 구형 title-frequency snapshot은 V3 research로 자동 이관하지 않는다. read-only backfill 검토 SQL의 기본 승인 수는 0이고 fresh research를 요구한다.
- 운영 배포, production environment 변경, production DB INSERT/UPDATE/DELETE, migration apply, push, PR은 모두 0건이다.
- 코드 기본값은 계속 `BLOG_AUTOPUBLISH_MODE=draft_only`, `BLOG_DAILY_PUBLISH_CAP=1`이다. migration·snapshot parity·provider-backed canary·public surface 검증 뒤 승인 change window에서만 `live`와 cap 3을 함께 설정한다.
