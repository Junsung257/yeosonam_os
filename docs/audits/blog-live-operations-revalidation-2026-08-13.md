# 블로그 운영 전수 재검증 — 2026-08-13

기준 시각은 2026-08-13 16:20 KST다. 운영 Supabase에는 `SELECT`만 실행했고, 운영 배포·환경 변수 변경·migration apply·콘텐츠 상태 변경은 하지 않았다.

## 결론

현재 블로그는 **열리기는 하지만 V3 계획대로 운영되지 않는다.** 자동화는 실행 중이나 운영 코드는 구형 엔진이며, V3 운영 전환 판정은 `BLOCKED`다.

- 운영 배포: `main@2718bc37fc6c0ee382624ea0d7dfd722ef878ed2`
- 검증된 V3 브랜치: `codex/blog-quality-engine-v3-20260811@6c1afd5782362360701808d20ad922eaf541bc16`
- V3는 운영보다 20커밋, 156개 변경 파일 앞서 있지만 운영에 배포되지 않았다.
- V3 필수 migration 5개가 운영 DB에 없다.
- 운영 정책은 하루 5건이며, V3 기본 상한 하루 1건과 다르다.
- 최근 30일 발행 52건 중 날씨 글이 50건(96.2%)이다. 계획 상한 20%의 4.81배다.
- 현재 대기 10건 모두 검증된 수요 신호가 없는 `coverage_gap` 날씨 글이다.

따라서 “자동발행이 처리됐는가”에 대한 답은 **cron은 돌지만 안전한 V3 자동발행은 작동하지 않는다**이다.

## 1. 소스 오브 트루스

Vercel 운영 배포는 feature branch가 아니라 `main`의 immutable commit을 사용한다. 이 부분은 정상이다. 다만 V3 작업은 아직 별도 브랜치에만 있다.

| 항목 | 운영 | V3 검증 브랜치 |
|---|---:|---:|
| commit | `2718bc37` | `6c1afd57` |
| Next.js | 15.5.21 | 15.5.21 |
| V3 자동발행 모드 | 없음 | 있음 |
| V3 DB migration | 미적용 | 5개 + rollback 준비 |
| durable public snapshot | 없음 | 구현·테스트됨 |
| GSC/Naver V3 저장 모델 | 없음 | migration 준비 |

운영 코드는 여전히 `repairKeywordDensityToTarget`, `limit(2000)`, `blog-public-catalog-v2`를 사용한다. V3 브랜치의 빌드와 테스트가 통과해도 운영 동작을 증명하지 않는 이유다.

## 2. 자동발행과 대기열

운영 `publishing_policies.global`은 `enabled=true`, 하루 5건, 09/12/15/18/21시, 목적지별 하루 2건, 상품 비율 40%다. V3 계약의 기본값은 `draft_only`, 하루 1건, 최근 30일 날씨 비율 20% 이하, 최근 10건 동일 archetype 최대 2건, demand signal 필수다.

실제 최근 30일:

- 발행 52건
- 날씨 50건(96.2%)
- `coverage_gap` 50건
- queue에서 발행 처리된 67건 중 65건은 검색량·트렌드·GSC/Naver·고객 질문·상품·편집 승인 신호가 모두 없다.
- 발행 글 200개 모두 archetype 메타데이터가 없다.

현재 queued 10건은 코펜하겐·제네바·뮌헨·브뤼셀·베를린·더블린·크라쿠프·마드리드·취리히·바르샤바의 8월 날씨/옷차림이다. 10건 모두 `monthly_search_volume=null`, `trend_score=null`, `product_id=null`이며 다른 검증된 demand signal도 없다.

최근 14일 cron:

| 작업 | 실행 | 성공 | 비성공 | 판정 |
|---|---:|---:|---:|---|
| blog-publisher | 344 | 45 | 299 | 성공률 13.1%, 비정상 |
| blog-scheduler | 184 | 184 | 0 | 실행은 정상이나 수요 없는 후보 공급 |
| blog-daily-summary | 20 | 5 | 15 | 비정상 |
| blog-indexing-worker | 90 | 90 | 0 | 전달 성공과 실제 색인은 별개 |

마지막 publisher는 118.4초 동안 2건을 처리하고 0건을 발행했다. 코펜하겐 글은 SEO 94점, 포르토 글은 중복 slug로 실패했다. 같은 시점 scheduler는 새 후보 4건을 모두 `coverage_gap`에서 추가했다. 구형 진단기는 이 후보들을 “publishable”로 보지만 V3 demand gate라면 전부 차단 대상이다.

## 3. 전체 코퍼스

`content_creatives`의 블로그 slug 보유 행은 270개다: published 200, archived 45, draft 25. published는 정보성 198, 상품 연결 2다.

| 검사 | published 200 | 전체 270 |
|---|---:|---:|
| exact title 중복 | 16그룹 / 34행 | 19그룹 / 42행 |
| normalized title skeleton 3+ | 15그룹 / 149행 | 20그룹 / 187행 |
| normalized H2 tree 중복 | 19그룹 / 43행 | 29그룹 / 69행 |
| intro signature 중복 | 14그룹 / 158행 | 22그룹 / 187행 |

추가로 published 200/200에 checklist H2와 FAQ H2가 있고, 143개에 범용 도입부가 있다. published 1개(`athens-weather-packing`)는 `title=null`이며 `seo_title` fallback으로 공개된다.

기존 점수는 평균 SEO 96.74, 95점 이상 191개, readability 100점 200개다. 그러나 실제 고객 화면 검사에서는 173개 중 33개가 실패했다. 점수가 포화되어 실제 품질을 분리하지 못한다.

## 4. 공개 자격과 고위험 문서

DB view는 192개를 공개 가능으로 반환한다. canonical catalog/API/sitemap에는 redirect source 19개가 빠져 173개가 노출된다. redirect 표본은 실제 308을 반환해 이 부분은 정상이다.

`changes_requested` 8개는 API·sitemap·RSS에서 제외된다. 하지만 직접 상세 URL은 410 또는 301이 아니라 다음과 같이 응답한다.

- HTTP 200
- robots `noindex`
- canonical `https://www.yeosonam.com`
- 404 본문

이는 soft-404다. 검색엔진 캐시 정리와 명확한 삭제/대체 신호라는 계획을 충족하지 않는다. `blog_information_replacements`에는 현재 replacement가 0건이다.

반대로 `summer-travel-insurance-coverage-guide-2026`은 고위험 보험 글인데 `review_status=none`으로 API와 sitemap에 포함되고 상세는 `index, follow`다. V3 정책이라면 사람 승인 전 공개 금지다.

## 5. 고객 화면, SEO, 이미지

브라우저로 canonical 공개 글 173개를 모두 검사했다.

- 통과 140, 실패 33
- 자동 조립형 과도한 구조 69
- 공개 섹션 중복 26
- 근거 없는 내부 주장 11
- 검색 의도 불일치 2
- 임시 문구 노출 2

동일 URL에 대한 기술 SEO 검사는 172/173을 통과시켜 99점을 냈다. 평균 H2 9.4개, 평균 이미지 3개다. canonical/metadata 검사는 대부분 통과하지만 콘텐츠 중복과 정보 이득 부족을 발행 차단 사유로 보지 않는다는 뜻이다.

이미지 로딩 감사도 173/173을 통과시켜 100점을 냈지만 실제 데이터는 다르다.

- 공개 렌더 이미지 522회, 고유 408개, 중복률 21.8%
- DB inline 이미지 602회 중 Pexels 588회
- 범용 alt 289회
- 중복 URL 81그룹 / 227회
- 서로 다른 3개 이상 목적지에 사용된 URL 7개
- 한 Pexels URL은 서로 다른 14개 목적지에 사용
- 운영 `SafeCoverNextImg`는 실제로 plain `<img>`이고, 프록시는 기본 960px WebP 한 장을 사용한다. 검사 표본의 `srcset`은 비어 있다.

`/blog/image-sitemap.xml`은 HTTP 200이지만 `text/html` 404 fallback이며 image entry가 0개다. 유효한 image sitemap이 아니다.

## 6. claim과 evidence

운영 저장소에는 claim 6,700개, evidence 11,621개, 연결 11,666개가 있다.

- claim 상태: supported 6,502 / review_required 137 / pending 61
- 위험도: LOW 5,902 / MEDIUM 788 / HIGH 10
- HIGH 10개 모두 승인자·승인시각이 없다.
- MEDIUM/HIGH evidence 103개에 만료일이 없다.
- published 145개에는 creative ID로 직접 연결된 claim이 없다.
- evidence는 published 200개 모두 creative ID 직접 연결이 없다.

최근 글 일부는 `content_key`와 generation metadata로 근거를 연결하므로 “근거가 전혀 없다”는 뜻은 아니다. 다만 article → claim → evidence를 한 번에 감사할 수 없는 추적성 결함이다. 최근 월별 날씨 글은 WMO 한 원문을 12개월 claim으로 나눠 evidence gate를 통과하지만, 수요·구조 다양성·사람 승인과는 연결되지 않는다.

## 7. Search Console과 수요 데이터

사용자가 제공한 GSC UI의 2026-05-11~2026-08-10 기간에는 검색어 299개가 있다. 운영 DB의 동일 기간 실검색어는 75개뿐이며 수집 범위는 약 25.1%다. DB query 수집 시작일도 6월 20일로 늦다.

| query | GSC UI | 운영 DB |
|---|---:|---:|
| 몽골 7월 옷차림 | 8클릭 / 172노출 | 0 / 50 |
| 발리 7월 날씨 | 1 / 324 | 0 / 28 |
| 7월 몽골 여행 준비물 | 15 / 88 | 0 / 3 |

페이지 단위 수집은 346클릭·21,032노출을 `query='__page__'`에 넣는다. 이를 query demand로 사용하면 안 된다. 같은 날 한 GSC 작업은 125건을 가져와 64건을 저장했지만 rank-tracking은 0건을 가져오며 “GSC 데이터 없음”으로 끝났다. Naver source 139행도 노출·클릭이 전부 0이다.

현재 데이터는 자동 주제 선정에 신뢰할 수 없다. 대량 신규 발행보다 다음 기존 승자/기회 문서의 canonical refresh가 우선이다.

- 몽골 7월 준비: 68클릭 / 2,065노출 / CTR 3.29% / 평균 5.93위
- 몽골 7월 날씨: 29 / 2,207 / 1.31% / 7.04위
- 비상약: 15 / 4,404 / 0.34% / 9.29위
- 황산: 6 / 1,122 / 0.53% / 6.91위
- 태국 입국 문서는 55 / 1,155이나 `changes_requested`이므로 먼저 공식 근거로 교정한 replacement를 만들고 기존 URL의 301 대상을 확정해야 한다.

## 8. 색인과 측정

공개 view 192개 중 최신 URL Inspection verdict가 있는 것은 63개다. PASS 10, NEUTRAL 53이며, NEUTRAL 중 43개는 “발견됨 - 현재 색인이 생성되지 않음”, 10개는 “Google에는 아직 알려지지 않은 URL”이다. 나머지 129개는 inspection verdict가 없다. IndexNow/작업 성공은 실제 색인 성공으로 해석하면 안 된다.

최근 30일 field data:

| 지표 | 표본 | p75 | 목표 | 결과 |
|---|---:|---:|---:|---|
| LCP | 1,052 | 4,312ms | 2,500ms | 실패 |
| INP | 46 | 48ms | 200ms | 통과, 표본 적음 |
| CLS | 773 | 0.023 | 0.1 | 통과 |
| TTFB | 2,955 | 233ms | 별도 목표 없음 | 참고 |

`analytics_server_events=0`, `analytics_delivery_jobs=0`이라 query → article → product/consultation의 서버측 성과 연결은 작동하지 않는다. 기존 engagement 로그는 30일 1,635세션 중 60초 도달 35, scroll 50% 60, CTA click 1이다. 측정 정의와 전달 파이프라인이 불완전하므로 실제 전환율로 단정하지 않는다.

## 9. 장애와 fallback

Vercel 최근 7일 블로그 관련 `BLOG_DATABASE_UNAVAILABLE`은 279회다. error group별 사용자 수 합은 183이지만 중복 제거된 사용자 수는 아니다. catalog revalidation 단일 그룹이 270회이며, 운영은 아직 최대 2,000행 DB 조회와 5분 cache를 사용한다. durable last-known-good snapshot은 운영에 없다.

현재 시점의 13개 핵심 공개 surface smoke test는 모두 200이었지만, 상세 표본은 최대 6.88초가 걸렸고 캐시 장애 이력은 계속 남아 있다. 한 번 열리는 것과 운영 신뢰성은 별개다.

## 10. 실행한 검증

| 검증 | 결과 |
|---|---|
| V3 targeted unit | 57/57 PASS |
| 전체 blog test suite | 191 files, 1,374/1,374 PASS (`--maxWorkers=4`) |
| TypeScript | PASS |
| ESLint | PASS, warning 0 |
| Next.js 15.5.21 production build | PASS, 389 static pages |
| V3 migration bundle checksum/rollback | PASS |
| 운영 SQL/TS eligibility parity | BLOCKED: 운영 RPC 없음 |
| 운영 production readiness V3 | BLOCKED: 8개 gate |
| public customer quality strict | FAIL: 33/173 |
| technical SEO strict | FAIL: warning 1/173 |
| public surface smoke | PASS: 13/13 |

초기 무제한 병렬 blog suite에서 상세 page test 1개가 20초 timeout이 났지만 단독 재실행 9/9, 제한 병렬 전체 재실행 1,374/1,374가 통과했다. 테스트 간 자원 경합으로 재현되지 않은 timeout으로 기록한다.

## 11. 운영 반영 순서

이번 감사에서는 아래 작업을 실행하지 않았다.

1. 현재 production deployment와 DB backup/PITR 시점을 기록한다.
2. V3 5개 migration을 staging 결과와 checksum으로 다시 대조한 뒤 운영에 순서대로 적용한다. 오류 시 제공된 rollback SQL을 사용한다.
3. 운영 환경 변수에 `BLOG_AUTOPUBLISH_MODE=draft_only`, `BLOG_DAILY_PUBLISH_CAP=1`, `BLOG_MAX_WEATHER_SHARE_30D=0.20`, `BLOG_MAX_SAME_ARCHETYPE_IN_LAST_10=2`, `BLOG_REQUIRE_DEMAND_SIGNAL=true`를 설정한다.
4. V3 브랜치를 최신 main 기준으로 검토·병합하고, main의 immutable commit만 production으로 배포한다.
5. current public snapshot을 생성하고 SQL/TS eligibility parity, snapshot parity, RSS/sitemap/image sitemap, stale fallback을 검증한다.
6. 10개 queued 날씨 글이 모두 demand gate에서 차단되고 `draft_only`가 indexing/revalidation/outbox를 호출하지 않는지 production dry-run으로 확인한다.
7. `changes_requested` 8개는 사람이 replacement/disposition을 확정한다. 교정 대체문서가 있으면 301, 없고 잘못됐으면 410, 재검토 예정이면 public 제외를 유지한다. soft-404 200은 제거한다.
8. 승인 없는 여행자보험 글은 사람 검토 전 public eligibility에서 제외한다.
9. GSC query/page 수집을 분리하고 `__page__`를 query 후보에서 배제한다. GSC UI 299개와 import row를 날짜·query·page 기준으로 reconciliation한다. Naver CSV도 0행 성공을 실패로 처리한다.
10. readiness가 모두 PASS가 된 뒤 `reviewed_only`로 하루 1건 canary를 운영한다. 7일 동안 demand·중복·claim·색인·LCP·오류를 확인하기 전 `live`로 올리지 않는다.

## 재현 명령과 핵심 SQL

```text
npm run verify:blog-production-readiness-v3 -- --production-branch=main --production-commit=2718bc37fc6c0ee382624ea0d7dfd722ef878ed2 --database-errors-7d=279
npm run diagnose:blog-autopublish -- --json
npm run audit:blog-public-surfaces -- --base=https://www.yeosonam.com --strict --json
npm run audit:blog-public-customer-quality -- --base=https://www.yeosonam.com --limit=500 --browser --strict
npm run audit:blog-seo -- --base=https://www.yeosonam.com --limit=500 --strict
npm run audit:blog-images -- --base=https://www.yeosonam.com --limit=500 --json
npm run audit:blog-gsc-domain -- --preferred-origin=https://www.yeosonam.com --strict --json
npx vitest run blog --maxWorkers=4
npx tsc --noEmit
npm run lint
npm run build
```

```sql
select status, count(*) from content_creatives
where channel='naver_blog' and slug is not null group by status;

select count(*),
       count(*) filter (where coalesce(title,seo_title,'') ~ '(날씨|옷차림)')
from content_creatives
where channel='naver_blog' and status='published'
  and slug is not null and published_at >= now() - interval '30 days';

select destination, topic, source, monthly_search_volume, trend_score, product_id, meta
from blog_topic_queue where status='queued' order by target_publish_at;

select source, count(*), sum(clicks), sum(impressions), min(date), max(date)
from rank_history group by source order by source;

select name, count(*), percentile_disc(0.75) within group (order by value)
from web_vitals
where created_at >= now() - interval '30 days'
  and (path='/blog' or path like '/blog/%')
group by name;
```

기계 판독용 전체 수치는 [blog-live-operations-revalidation-2026-08-13.json](./blog-live-operations-revalidation-2026-08-13.json)에 저장했다.

## 12. 같은 날 코드 보강 후 재판정

- 운영 대기열은 재조회 시 11건이며 모두 검증된 demand signal이 없다. 로컬 V3 진단 결과는 `publishable_candidate_count=0`, `demand_missing_count=11`이다. 과거 analytics event 안의 `publishable_candidate_count=10`은 이전 코드가 기록한 historical payload이며 현재 대기열 판정이 아니다.
- 운영에는 V3 migration 5개와 runtime resource 18개가 아직 적용되지 않았다. HEAD 요청의 false-ready 가능성을 제거한 실제 row probe는 18/18 missing을 확인했고, publisher는 queue mutation 전에 fail-closed한다.
- review 정책을 application과 bundled snapshot에도 중복 방어로 적용해 현재 안전 번들은 191건이다. 운영 view 192건과의 1건 차이는 승인되지 않은 여행자보험 문서를 코드가 선제 제외했기 때문이다.
- GSC read-only 3일 표본은 2026-08-08 24 impressions/1 click, 08-09 61/0, 08-10 65/0이다. 자동 주제선정에 사용할 만큼 충분하다고 판정하지 않았으며, 빈 import도 오류로 처리한다.
- 24개 canary는 필수 다양성·claim·한국어·이미지 기준을 모두 통과했다. 기존 corpus dry-run은 REFRESH 92, MERGE 155, QUARANTINE 23이며 자동 적용하지 않았다.
- 코드와 migration bundle은 로컬 검증 대상일 뿐 운영에 배포되지 않았다. 운영 readiness 8개 gate는 계속 BLOCKED이며 production DB write/deploy/env change는 0건이다.
- 로컬 production-start에서 승인 없는 여행자보험 URL은 200 soft-404에서 404+`noindex,nofollow`로 교정했고 tombstone은 410을 유지했다. 정상 목록/상세는 200이며 sitemap 283, RSS 50, image sitemap 191 어디에도 차단 slug가 없다. 검증 과정에서 image sitemap 예약 경로가 동적 slug 검사에 걸리는 회귀도 발견해 수정·fixture로 고정했다.
- Chrome 목록 이미지 12/12와 상세 이미지 11/11이 반응형 `srcset`·intrinsic size를 사용하고 hero만 eager였다. final blog suite 193 files / 1,395 tests, middleware 34 tests, typecheck, lint, Next.js 15.5.21 build(487.8초, static 390/390)가 통과했다. 이는 후보 코드의 로컬 결과이며 현재 운영 성능·field RUM 달성 증거가 아니다.
