# Blog Quality Engine V3 검증 — 2026-08-11 기준

이 문서는 운영 배포나 운영 DB 쓰기 없이 수행한 구현 검증 기록이다. 기준일은 미션에서 지정한 2026-08-11(Asia/Seoul)이며, 최종 로컬 검증은 2026-08-12 01:08 KST까지 이어졌다.

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

- 4개 migration과 rollback/backfill SQL
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
- bundled snapshot은 catalog metadata만 포함한다. 상세 full-body의 cold-start DB 전면 장애 fallback은 후속 운영 snapshot export가 필요하다.
- 첫 production build는 high-core worker fan-out으로 실패했다. 4-worker build artifact는 통과했지만 전체 빌드 시간이 15분을 넘으므로 CI timeout/캐시 정책을 확인해야 한다.
- 과거 검색엔진 캐시의 review-blocked 문서는 운영 disposition 적용과 Google/Naver removal 절차가 끝날 때까지 남을 수 있다.

## 13. 정확한 배포·검증 순서

1. branch diff와 migration SQL을 review하고 `draft_only` 환경 변수를 준비한다.
2. staging DB 백업/restore point를 만들고 rollback SQL을 별도 보관한다.
3. migration을 staging에 순서대로 적용한다: policy -> demand/evidence -> snapshots/media -> measurement.
4. backfill dry-run과 SQL/TS parity fixture를 실행하고 row count/review 분포를 baseline과 비교한다.
5. public snapshot을 staging에서 생성하고 catalog/detail/RSS/sitemap/image sitemap을 검증한다.
6. 24개 이상의 provider-backed canary를 `draft_only`로 생성해 claim citation, duplicate, image license/pHash, review UI를 수동 확인한다.
7. corpus disposition과 301/410 계획을 편집자·SEO 담당자가 승인한다. 승인 전 운영 row를 변경하지 않는다.
8. production migration change window를 열고 migration -> backfill -> snapshot 순으로 실행한다.
9. 앱을 production에 배포하되 mode는 `draft_only`로 유지한다. `/blog`, known slug, DB fault injection, sitemap/RSS/indexing exclusion, analytics consent를 검증한다.
10. 24~72시간 오류율·field RUM·server event 유입을 관찰한다. 데이터가 0이면 성공이 아니라 readiness 오류로 처리한다.
11. approved high-risk fixture와 실제 demand import가 통과한 뒤에만 `reviewed_only`를 검토한다. `live`는 별도 변경 승인 없이는 사용하지 않는다.
