# Blog Autopublish Contract

> 2026-09-02 Autopilot V4 completion override: `publishing_policies` 전역 행의 `posts_per_day=5`, `slot_times=09:00/12:00/15:00/18:00/21:00` 만 생성·발행량 SSOT로 사용한다. `BLOG_DAILY_PUBLISH_CAP`, 별도 30건 후보 상한 및 기존 3/10/30 단계는 발행량을 바꾸지 못하며, 내구성 원장의 frozen 상태만 비상 차단으로 유지한다. Inngest는 `blog_topic_queue` ID+콘텐츠 버전 이벤트를 `research → brief → draft → verify → edit → quality → preview → publish → indexing → observe` 체크포인트로 실행한다. `INNGEST_BLOG_AUTOPILOT_ENABLED` 플래그만으로는 실행하지 않고 Event/Signing 키와 후보 등록 introspection을 모두 확인한다. 여기서 `publish`는 승인 초안을 슬롯 큐에 확정하는 단계이며 즉시 공개하지 않는다. 원자 공개와 색인 아웃박스 생성은 09/12/15/18/21시 단일 `blog-publication-controller`만 수행한다. 연구 브리프 DB 저장, 주장 해시 보존, V4 품질 결정, 실제 공개 컴포넌트를 사용한 `noindex` Playwright 95점을 모두 통과하기 전에는 공개하지 않는다.

> 2026-09-02 demand-refill addendum: 일일 `blog-scheduler`는 큐 준비 전에 프로그램형 SEO 대기 풀을 순환 탐색한다. Naver Search Ads 검색량 또는 Naver DataLab 추세가 양수인 키워드만 `blog_topic_queue`로 승격하고 같은 관측치를 `blog_demand_signals`에 30일 만료 근거로 저장한다. 검색량·추세가 모두 0/null이면 계속 대기시키며 후보 수를 맞추기 위해 수요를 제조하지 않는다. `topical-rebuild`는 일요일 18:20 UTC의 단일 Vercel 주간 스케줄로 매트릭스와 클러스터를 갱신한다. 보호 릴리스의 1건 shadow는 후보 배포의 `blog-scheduler`를 먼저 실행한 뒤에만 `blog-generate?force=1&limit=1`을 호출한다.
>
> 검색 생명주기는 `queued → submitted → received → discovered → crawled → indexed → ranking`이다. Sitemap·IndexNow 2xx는 `received`일 뿐 `indexed`가 아니다. 일반 `/blog` URL은 Google Indexing API를 절대 호출하지 않고 D+1/3/7 URL Inspection을 실행한다. D+3 미발견은 Sitemap 1회만 재제출하고, D+7 미색인은 기술/콘텐츠 보정 큐로 종료한다. 공급자 원본은 불변으로 보존하고 `classification_version` 기반 파생 판정만 append-only로 추가한다. CI 회귀 기준은 100건(72 safe, 12 product, 16 failure-edge) Promptfoo 골든셋이다.
>
> 사이트 전체 SEO 관측은 주 1회 공개 카탈로그·Sitemap·실제 HTML·GSC 56일·CrUX·PageSpeed를 같은 append-only 원장에 저장하고 metadata/render drift, query cannibalization, 28일 content decay를 분리 판정한다. 이 감사는 콘텐츠를 자동 수정하거나 비공개 전환하지 않는다. Crawl4AI는 기존 HTML 추출 실패, Docling은 기존 PDF/Office 추출 실패에만 사용하며 30건 벤치마크(추출 90%, 숫자·날짜·주장 보존 100%, SSRF 통과, p95 30초) 전에는 fail-closed다. 한국어 로컬 임베딩은 100건 precision/recall 각 0.90 통과 원장이 있을 때만 whole-corpus 중복 사전검사에 참여한다.
>
> `claude-blog`/`claude-seo`는 설치형 생성기나 프로덕션 모델 경로가 아니다. 라이선스가 허용하는 범위에서 키워드 브리프, people-first QA, canonical/schema/robots 기술 점검, 네이버 표면 QA 패턴만 독립 구현한 네 개의 repo Skill을 사용한다. DeepSeek가 작성자이고 Skill은 개발·검수 계약이다.

> 2026-08-11 V3 override: 자동발행의 fail-closed 정책은 `docs/runbooks/blog-publishing-v3.md`가 우선합니다. 누락/잘못된 `BLOG_AUTOPUBLISH_MODE`는 `draft_only`이고, coverage gap만으로 발행하지 않으며, deterministic fallback과 content-creating repair는 공개 불가입니다.
>
> 2026-08-13 safety addendum: `scripts/backfill-blog-quality.ts` is permanently dry-run-only. Historical `--write` examples below are incident records, not executable instructions. Use the V3 disposition preview and reviewed migration runbook for corpus changes.
>
> 2026-08-15 live-ops addendum (2026-09-01 volume rule superseded): `draft_only`는 오류가 아니라 공개 목표 0의 안전정지다. Keyword-family 두 테이블은 live readiness 필수 리소스이며, queue scope나 최신 실패가 관리자 첫 화면에서 숨겨져서는 안 된다. 발행량은 최신 V4 truth override를 따른다.
>
> 2026-08-16 DeepSeek-only V4 release addendum (volume stages superseded 2026-09-01): 검토된 공식 URL을 직접 fetch한 연구 자료만 DeepSeek Pro가 구조화한다. KST 01:05~06:05 계산 cron은 DeepSeek Flash 초안 → 규칙/claim/중복 평가 → DeepSeek Pro high/max 제한 재작성으로 동작한다. Gemini, GPT, Claude, generic provider cascade와 검색 snippet grounding은 이 발행 경로에서 금지한다. KST 09/12/15/18/21 공개 controller는 모델을 호출하지 않고 저장된 승인 증거를 다시 확인하며, 심각 사고의 내구성 frozen 차단은 유지한다. 발행량은 최신 V4 truth override를 따른다.

> 2026-08-17 decision-completion addendum: 모델·평균 점수는 archetype의 핵심 결정 요소를 대신할 수 없다. 일정 글은 시작/중간/마무리 순서, 검증된 이동 근거, 예약·공식 채널 재확인, 휴식 지점, 우천·휴무·지연 대안을 모두 포함해야 하며, 경로 글은 승차/중간 구간/하차, 검증된 이동 근거, 장애 대안을 포함해야 한다. 하나라도 빠지면 글자 수나 상위 점수와 무관하게 `decision_completion`과 `section_purpose_coverage`를 실패시킨다. 이 검사는 고정 글자 수·고정 H2 수를 요구하지 않으며, 재작성은 동일한 명령형 어미를 반복하지 않는 자연스러운 한국어와 evidence-bounded 판단 설명을 사용한다.

> 2026-08-17 controlled-retry addendum: 동일 canonical 교체 작업의 이전 비공개 shadow draft와 review queue는 감사 이력으로 보존하되 새 재시도의 corpus 경쟁자로 계산하지 않는다. 첫 재연구 뒤에도 모델 출력만 승인 claim과 어긋난 경우에는 검증된 research packet을 유지한 채 세 번째 DeepSeek Pro 정밀 재작성을 한 번 허용한다. `missing_evidence`, `stale_claim`, claim conflict, source-quality 실패, 허위 경험, unrelated corpus saturation은 이 예외를 사용할 수 없으며 즉시 격리한다. 일정·경로 재작성은 의사결정에 무관한 높이·길이 같은 치수 claim보다 검증된 이동·시간 claim을 우선하고, 승인된 숫자 사실은 본문에서 정확히 한 번만 사용한다.

> 2026-08-17 itinerary-research addendum: 출처 다양성은 정규화한 기관 호스트 기준으로 계산한다. `www.example.com`과 `example.com`은 한 기관이며 두 출처로 계산하지 않는다. 일정 연구 패킷은 명소와 실제 구간 이동시간 외에 운영시간·예약·입장·출입통제·계단/엘리베이터 같은 일정 결정 제약을 최소 1개 포함해야 한다. 높이·길이·면적 같은 물리 치수는 이 제약을 대신할 수 없으며, 조건을 충족하지 못한 후보는 모델 작성 전에 보류한다.

> 2026-08-30 People-First V5 addendum: 정보성 글은 prose보다 먼저 `blog-decision-artifact-v1`을 만든다. 제목 약속, 직접 답변, 공개 fact, 출처 등급, 계산식·피연산 claim fingerprint·가정, PII 없는 1차 집계, 근거 공백이 이 아티팩트에 없으면 writer가 보충할 수 없다. 자동발행은 결정론 편집 검사와 독립 DeepSeek Pro 편집 심사의 모든 차원이 통과해야 하며, 편집 실패는 주장 보존 재작성 1회 후 격리한다. 승인 attempt는 실제 렌더 prompt/brief/claim packet SHA-256과 template/git/model/stage trace가 없으면 DB에서도 차단한다. 운영 회귀 기준은 2026-09-01부터 100건 Promptfoo 골든셋이다.

> 2026-08-31 editorial-judge durability addendum: 편집 심사 호출은 생성 호출과 별도 원장에 기록하고 API의 JSON 응답 모드를 강제한다. 공급자 응답이 과금됐지만 JSON 파싱에 실패한 과거 text-mode attempt는 `editorial_judge_retry`, 이미 그 retry까지 소진한 attempt는 `editorial_judge_structured_retry`를 각각 최대 1회만 허용하며 일일 비용 상한을 그대로 적용한다. 구조화 JSON의 안전한 스키마 변형(중첩·배열·명시적 문자열 불리언)은 필수 5차원 판정을 유지한 채 정규화하고, 기존 구조화 호출까지 소진된 attempt는 `editorial_judge_normalized_retry`를 1회만 사용할 수 있다. 필수 5차원의 명시적 불리언이 최종 판정 SSOT이며, 중복 top-level `passed`가 세부 판정과 모순되면 5차원 판정을 따른다. 따라서 top-level true는 실패 차원을 숨길 수 없고 top-level false도 통과한 5차원을 뒤집을 수 없다. 통과한 심사 보고서는 공급자 receipt의 비밀 없는 audit 필드에 저장해 재실행 시 모델 호출 없이 재사용한다. 파싱 실패 시 응답 해시·제한된 진단 미리보기만 receipt에 남기며, 끝까지 계약에 맞지 않으면 자동발행은 계속 차단한다.

Last updated: 2026-09-02

This document defines the required contract for automatic blog generation, publishing, and indexing. Publishing and indexing must be treated as separate responsibilities. It exists because one-off repairs to already published rows do not prevent the same defect from recurring in live autopublishing.

## 2026-07-28 Slot, Quality, Learning, And Research Contract

- Publish approval must inspect the HTML produced by the real public renderer, not only stored Markdown or persisted component scores. `public_customer_quality` is a mandatory fail-closed gate with a minimum score of 95; broken tables, duplicate public sections, answer-intent mismatch, generated residue, unsupported internal claims, or excessive conversion pressure block publication.
- The public customer audit must page through the complete public API catalog and report the weakest score, pass rate, and issue counts for every stored category. A corpus or category is not “95 complete” when its average is 95 but any public row is below 95, when a row cannot be fetched, or when its category is unknown.
- The public customer audit defaults to the same 95-point floor as the publish gate. When the public catalog lacks a stored category, it must infer the canonical information intent from public title, destination, and content type instead of collapsing the corpus into an `unknown` bucket.
- Targeted private-regeneration runs are maintenance evidence, not daily-quota publisher runs. Their failures remain visible in the editorial backlog but must not replace the latest scheduled publisher health signal.
- A targeted private-regeneration request is parsed and eligibility-checked once at the targeted entrypoint, then the validated request is carried into generation. The generator must not independently reinterpret the same mutable queue contract after the entrypoint has accepted it.
- Evidence-insufficient candidates remain quarantined, but they do not block verified daily slots when publishable inventory already covers the remaining quota. Their research repair proceeds as separate backlog work.
- Monthly-weather generation must include the destination in at least one core H2 heading. Stable heading variants alone are not enough because a growing fleet eventually repeats the same five-heading signature.
- The public customer audit is hybrid by default. It may score the server HTML only when the article body is already materialized. If the Next.js response still contains pending React stream boundaries inside the article and no public body surface, the audit must hydrate that URL in a real browser before scoring it. A table of contents plus unresolved `<template id="P:*">` placeholders is not evidence that the published body is empty. `--html-only` is diagnostic only and cannot certify the corpus.
- The public customer audit normalizes encoded and decoded forms of the same
  Korean slug before merging API, listing, and sitemap targets. It uses bounded
  concurrency and retries only transient network, 408/425/429, and 5xx failures.
  A URL-encoding representation must never create a duplicate `unknown`
  category row.
- Release and corpus-quality decisions must use the audit's `--browser` mode.
  Next.js can defer article HTML in its Flight stream until Chrome materializes
  `.prose-blog`; static HTML mode is only a fast transport smoke check and must
  not classify an article as body-empty.
- `broken_table_surface` requires actual compact row evidence: at least three
  distinct leaf paragraphs or list items with at least three numeric cells, or
  leaked Markdown table syntax. Parent containers, ordinary numeric prose, and
  standalone horizontal rules are not table failures by themselves.
- The nightly stored-body preflight and the public page must share
  `sanitizePublicBlogBodyHtml`. Exact repeated long paragraphs and list items are
  removed from the customer surface, while similar sentences with different
  numbers or meaning are preserved. Three or more decorative horizontal rules
  are removed; one or two intentional separators remain.
- The page-title/body-title deduplication helper is also shared by the public
  page and stored-body preflight. Browser and preflight headline counts must
  match before a recovery release is accepted.
- Public collection surfaces and the public list API must reuse one compact cached catalog. The catalog excludes `blog_html`, `quality_gate`, and `generation_meta`, performs no exact-count query, and is filtered and paginated in memory. `/blog`, destination pages, angle pages, the public API, and sitemap must not independently fan out full-corpus list/count reads during a crawler burst.
- A cached blog detail with no usable body is not a valid stale response. The
  detail cache key must be versioned when its row shape or eligibility contract
  changes; if a fresh read also fails, return the explicit database-unavailable
  surface instead of a `200` article shell containing only a table of contents.
  Editorial quality failure is not cache staleness and must not trigger a fresh
  database read on every page request.
- Legacy repair must separate presentation-only cleanup from factual replacement. A presentation repair may remove duplicate/generated residue or normalize rendering only when it introduces no new claim. Price, visa, entry, weather, transport, lodging, itinerary, or current-condition defects require reviewed destination/intent evidence and the atomic in-place upgrade contract; changing a score or adding generic prose is not remediation.
- The nightly published-post recovery job evaluates every public body with the
  same production renderer and public-customer 95 gate. It prioritizes current
  public failures first, lowest score first, then mature Google zero-click and
  missing-research candidates. The queue records the score and issue codes, but
  research capability, high-risk review, representative ownership, cooldown,
  and atomic replacement gates still decide whether a rewrite may proceed.
- A legacy article without verified research is an explicit recovery backlog item even when its persisted SEO/readability fields are high. Stored scores are historical evidence, not proof of current public quality. A blocked automatic upgrade remains public and unchanged until a fully gated replacement succeeds, unless an authorized review separately decides to unpublish it.
- The global five-post policy is a cumulative KST slot contract: 09:00 permits at most one post for the day, 12:00 permits two, 15:00 permits three, 18:00 permits four, and 21:00 permits all five. A normal or workflow retry may fill only the quota due at the current slot. The final slot may catch up every remaining daily post.
- `dailyQuota.remainingAfterRun` means quota still due at the current time and therefore controls same-window retries. `remainingDailyAfterRun` is the total daily remainder for monitoring. A forced scheduler refill does not authorize early publication.
- Every scored publish component has a hard floor of 95. Aggregate scores, rounding, or an underlying checker's lower pass flag cannot hide an SEO, readability, evidence, rendering, image, or customer-quality component below 95. The stricter Engine V2 100-point category contract remains unchanged.
- A destination-scoped article with a destination recognized by the shared slug registry must include that destination in its canonical slug. A missing destination is a critical publish failure, not a warning. A live canonical-slug repair must update the creative and representative in one transaction, enqueue the corrected URL for indexing, and preserve the old public URL through a permanent redirect.
- Adaptive thresholds are read from and written to the global `publishing_policies.meta.adaptive_thresholds` object. A missing row, read error, or persistence error must return learning as not applied; it must never be reported as successful learning.
- An editorial backlog row may be requeued once per recheck version. If the same row fails again under the same version, the system keeps it blocked with `repeat_suppressed` instead of creating an endless retry loop. A later repair release requires a new version and new regression evidence.
- Reviewed secondary sources may support low-risk budget, transport, lodging-area, itinerary, shopping, or family-planning estimates only when the fetched page contains the claim and the claim is corroborated as required by its intent contract. Crowdsourced cost data, route aggregators, and collaborative travel guides are checked-date estimates, not official guarantees. Entry, visa, immigration, and insurance lanes retain official-source and human-review requirements.
- Methodology review alone does not make a secondary source operationally usable. The production worker must be able to download the page directly; repeatable 403 or blocked retrieval revokes the registry entry until a permitted path is reviewed. Search snippets from a revoked or unreachable source are not evidence.
- Model-produced JSON is not the final authority for stable structured facts. Guam weather, GRTA route times and fares, Guam Airport ground-transport modes, Kakao T Guam taxi baggage/flight-delay conditions, hotel-area nightly samples, currency/payment, and reviewed meal or snack menu samples use fail-closed deterministic parsers that require exact source phrases or schema fields. The Kakao conditions come from its public machine-readable customer FAQ endpoint, not a search snippet or client-rendered shell. A parser returns no bundle when a required phrase, area, price, date scope, or second source domain is absent.
- A research-ready local-transport article must be rebuilt as a deterministic evidence article before its quality gate. The final article and typed claim ledger may use only approved claims and their linked official sources, and must materialize at least two distinct route or usage rows with verified prices, two verified duration or wait-time rows, schedule checks, ticket/reservation guidance, service limits, source links, the research check date, and evidence-derived FAQ entries for structured data. Model-draft factual residue is discarded rather than merged into the evidence article. Missing evidence must leave the public article unchanged; it must never be filled with an invented timetable, headway, fare direction, or pass price. Current official transport-operator policies assessed below high risk can complete automatic claim validation, while entry, insurance, customs, or explicitly high-risk claims still require human approval. An SEO block must persist the full component scorecard in `meta.last_seo_score`, not only the aggregate score, so repeat failures are diagnosable without regenerating the article.
- A passed research preflight must expose only deduplicated official-authority source URLs in compact `information_research_preflight.official_source_urls`. Engine V2 consumes those server-reviewed public HTTPS URLs as source-support evidence, including official transport operators that do not use a government TLD. A failed or unversioned preflight, unsafe/local URL, arbitrary Markdown link, or image URL never earns source-support credit. This engine signal does not replace the registry-backed claim publication gate.
- Engine V2 and the publish-time SEO scorer must use the same compact verified-source reader. SEO authority credit may include a reviewed operator URL only when the exact URL is present in a passed, versioned preflight; widening static hostname hints is not an acceptable substitute. Deterministic local-transport copy must also cover route, fare, schedule, reservation, lodging-location, and preparation-checklist decision vocabulary naturally enough to make the semantic-longtail detail itself pass without keyword stuffing.
- Every final quality boundary must normalize model-emitted literal `\n` and `\r\n` escape tokens into real line breaks before render validation. The repair count is stored in `generation_meta.literal_newline_repair`; a render gate must still fail closed if any literal newline escape survives.
- A newer reviewed official operator document supersedes conflicting secondary-source values for the same decision. The research sanitizer removes competing bus fare and pass claims after a current GRTA fare sheet is present; this precedence also applies to family-budget research.
- Intent readiness requires semantic coverage, not only claim counts. Hotel research needs named areas and checked-date nightly prices; family budgets need lodging, meal, transport, and child/family evidence; itinerary research needs family suitability, attraction evidence, and route durations; shopping needs products, purchase locations, and customs; currency needs cash/currency and card use; insurance needs medical, disruption/baggage, and claim-document evidence.
- Curated reputable-source documents must be filtered by both intent and destination before the direct-fetch cap is applied. An unrelated reviewed document must never displace a required meal, lodging, transport, or attraction source merely because it appears earlier in registry order.
- The strict live research suite must pass all eleven supported intents before a release: food budget, monthly weather, airport transport, local transport, hotel areas, family budget, itinerary, shopping/souvenirs, currency/payment, entry requirements, and travel insurance. High-risk entry and insurance results remain human-review candidates even after research readiness passes.
- Daily research preparation must attempt every supported information intent, with one candidate per distinct intent before a second candidate from the same intent. A full numeric buffer is not sufficient until at least five distinct information intents are research-ready. Research runs in bounded batches of at most three candidates, then rechecks both targets before claiming another batch; this is part of the 180-second cron runtime contract. Unattempted rows remain queued; the scheduler must not bulk-skip them merely because a request budget or runtime budget was consumed. Weather-only preparation is a contract failure even when the five-post quota is met.
- `audit:blog-quality` is fail-closed on `qaReport.passed`. An intent-contract failure cannot be relabeled as a minor issue because a legacy critical counter is zero. Its `categoryScorecard` uses each category's weakest dimension: publish-ready rate, research coverage, three-image coverage, minimum SEO, minimum readability, minimum Engine V2, and minimum quality-component score. A category passes only at 95 or higher.
- Informational SEO descriptions must come from the classified eleven-intent contract, not a category fallback that inserts unrelated cost, itinerary, preparation, or reservation language. Each description retains the planned title/primary keyword, stays inside the 70-160 character scoring boundary, and summarizes the reader decisions and official checks that the article actually contains.
- Search-performance collection must not inherit the generic 45-second cron wrapper when the route declares a longer serverless budget. `gsc-index-rank` and `rank-tracking` receive a 285-second handler guard, while `serp-rank-snapshot` receives 55 seconds. Each has an independently scheduled GitHub retry so an absent Vercel Cron invocation cannot silently stop `rank_history` growth.
- Query-level GSC metrics must be grouped by the database conflict key `(slug, query, date, source)` before upsert. Duplicate www/apex or repeated page rows are summed, CTR is recalculated from total clicks and impressions, position uses an impression-weighted average, and the stored page URL is the canonical www URL. A repeated input key must never abort the entire daily search-data batch.
- Rank-decay observations belong in `rank_alerts`; collectors must never patch `content_creatives.generation_meta`. Measurement-only writes must not change an article row's `updated_at`, invalidate its current public snapshot, or imply a material content update.
- Published-article recovery remains active when recent `rank_history` is empty. The daily recovery route prioritizes true zero-click posts only from Google sources (`gsc`, `gsc-page`) and only after the article has matured for at least 14 days, then falls back to the oldest published informational rows without verified research. Naver/Serp rank snapshots store zero impressions by design and must never be treated as Google zero-impression evidence. The route may enqueue at most two in-place upgrades per day and must reuse the same explicit-intent, content-brief, high-risk, active-upgrade, and representative-ownership gates as the operator recovery script. Missing or ambiguous evidence never authorizes a public rewrite.
- Blog Quality V3's complete operating chain is critical under resource-saver
  mode: `rank-tracking`, `blog-data-readiness`, `blog-publisher`,
  `blog-indexing-worker`, `blog-ai-model-canary`, `blog-analytics-canary`, and
  `analytics-delivery`, together with the existing scheduler, daily summary,
  and zero-click recovery jobs. Every one remains
  fail-closed unless `DB_RESOURCE_SAVER_ALLOW_CRITICAL_CRONS=1`. Allowing only
  the publisher is invalid because it would publish without fresh demand or
  silently stop indexing and measurement delivery.
- `blog-regenerate-zero-click` keeps its 60-second route budget, audits at most
  500 rows, and queues at most two private upgrades.
- `blog_regenerate_log.reason` must accept both automatic selection signals, `zero_click` and `quality_gap`. A partial unique index over `(slug, created_day_utc)` covers both values so concurrent or repeated runs cannot enqueue the same published article twice through different recovery signals. The producer contract and database constraint must be changed together.
- A monthly climate row is one composite evidence claim, not a highest-temperature scalar. WMO and other weather adapters must persist `highest temperature|lowest temperature|rainfall|rain days` with unit `월별 기후 지표`. Research readiness upgrades legacy scalar bundles in memory before validation and persistence so old queued recovery work cannot repeatedly fail the final claim gate.
- A reviewed climate URL is not coverage by itself. Registration requires a live deterministic parse of the exact destination, a declared climatological-normal period, all twelve months, and every required temperature, rainfall, and rain-day field. A forecast-only city page or an empty/incomplete climate table remains blocked. When an official authority splits temperature and precipitation into separate tables, the composite monthly claim must reference both immutable source versions; either table alone is insufficient. JMA rain days use the explicitly labeled `>=1.0 mm` column.
- PAGASA climate coverage is station-exact. A destination may use only an explicitly reviewed station alias, and the adapter must read the `PERIOD` and `STATION` values from the PDF body. A directory name, nearby island, or similarly named airport cannot widen the destination scope.
- Singapore monthly-weather recovery uses only the Meteorological Service Singapore `Climate of Singapore` station-means table. The deterministic adapter must confirm the 1991-2020 reference period and join all 12 Changi Climate Station rows for mean daily maximum, mean daily minimum, monthly rainfall, and mean rain days. A current forecast bulletin or climate map is supplementary and cannot replace the complete normals table.
- `monthly_weather` owns one 1-12 month representative per destination, audience,
  and locale. Its title and primary keyword must therefore say `월별` or
  `1~12월`; an input month is a secondary long-tail and opening emphasis, not a
  second canonical article identity. A specific-month title may not wrap a
  twelve-month evidence article.
- Automatic published-post recovery must resolve the most specific reviewed destination present in the public topic and confirm destination-scoped direct research coverage before queueing. A broad country label must not cause unrelated regional evidence to be reused.
- A published legacy URL that resolves to another active representative is not
  regenerated as a second article. It may receive a server-side permanent
  redirect only after live verification that the target is published, owns the
  same representative identity, and passes the public customer gate at 95 or
  higher. Redirect sources stay out of collection pages, API pagination,
  sitemap output, and recovery scoring; the stored row is retained for rollback
  and audit. Redirect chains must resolve directly to the terminal canonical
  URL.
- Published legacy upgrades must target the existing creative ID and canonical slug. The publisher may auto-research a `replace_published_after_quality_gate` request, but it must keep the current public row unchanged until research, claim, quality, SEO, image, render, representative, and atomic-publication gates all pass. The upgrade preserves the original `published_at`, generates a fresh contextual image set, and reports `upgraded` separately from the five-new-post quota. A failed claim gate is blocked without changing the live article. A claim-valid high-risk candidate becomes a separate private `reviewed_published_replacement_v1` draft with a durable evidence review case; it never overwrites the public row before explicit approval. Once the five-new-post daily quota is complete, a normal publisher invocation may process one due atomic upgrade so quality work cannot starve behind quota completion.
- Zero-click and quality-regeneration producers must enqueue that in-place upgrade contract with `content_creative_id` and `expected_slug`; they must not create a second article for the same topic. `enqueue:blog-quality-upgrades` is the bounded corpus recovery entrypoint. Dry-run is mandatory before `--write`, active upgrade rows are deduplicated by creative ID, and deployment of the matching publisher code must precede a production write.
- Publishable-duplicate cleanup must recognize a valid atomic published upgrade by its target `content_creative_id` and `private_regeneration` contract. An upgrade is allowed to overlap its own published target and wins over a normal refill candidate with the same writer/destination/micro-angle key, regardless of the refill row's numeric priority. Missing target IDs or incomplete atomic flags receive no exemption. This prevents routine queue cleanup from discarding the only safe in-place repair or publishing a second canonical topic instead.
- Legacy quality upgrades are fail-closed on topic meaning. An automatic candidate needs an explicit supported intent in its public slug or SEO title, and the classified intent must equal the generated content brief. Conflicting slug/title signals, general guides, comparisons, listicles, packages, and unsupported preparation topics stay in manual review. Within one run, the highest-priority candidate in the deterministic public-quality and publication-time ordering wins each destination/intent/audience/locale representative key; later same-run duplicates are not enqueued.
- Corpus recovery has two supported execution modes: `monthly_weather` may follow the deterministic upgrade path, while `entry_requirements` and `travel_insurance` may only create a private `human_review` replacement when reviewed research coverage exists. Korean entry-requirement recovery must set the traveler nationality explicitly to South Korea before planning. Human review is a routing requirement, not a candidate-rejection reason; no high-risk replacement reaches the public row without approval.
- Slug duplicate protection distinguishes global exact collisions from destination-scoped fuzzy similarity. Generic availability fallbacks (`travel-{intent}-...`) never establish fuzzy topic identity across destinations; otherwise a newly introduced destination that is not yet in the romanization registry can consume a due slot without publication. Stable mapped destination slugs remain the required SEO path, while the fallback only keeps the queue recoverable until the registry is extended.
- Quality recovery persists that representative key in `meta.quality_upgrade.representative_key`. An invocation-scoped selected-key set rejects a second candidate in the same run, and a partial database unique index blocks cross-invocation races while rows are `queued`, `generating`, or `pending_review`. A unique race is an observable safe skip, not a queue failure.
- Normal refill candidates are checked against the active representative ledger both when the publishable buffer is counted and immediately before generation. The representative ledger is not limited by the rolling multi-angle gap, so an older canonical article cannot consume a due slot and fail only after an expensive writer run. A versioned in-place quality upgrade targeting that canonical creative is the only exception.
- A failed or research-quarantined informational row may be retried only by the versioned `recheck:blog-information-research` workflow after the eleven-intent live suite passes. A skipped row is eligible only when it has durable `research_failed_at` and `research_issues` markers plus a research-specific error code. Product rows, unsupported intents, generic quality skips, active/published duplicates, and same-version repeats stay blocked. A queue row marked `published` whose linked creative is missing or no longer published must be reconciled to `skipped`; it must not be counted as live inventory.
- Airport arrival and destination-local mobility are separate reader tasks. `airport_transport` covers airport-to-city or airport-to-accommodation decisions and may require luggage and late-arrival handling. `local_transport` covers named routes between local bases and attractions and requires fares, route durations or frequency, operating schedule, ticket/reservation method, service limitations, and an official operator or government source. A generic public-transit or rental-car topic must never inherit airport-only slots.
- Transport research readiness must prove the same decisions that the final structure gate requires. Airport packs need at least two transport modes plus operating hours, luggage handling, and late-arrival evidence; local-mobility packs need named routes, frequency or schedule, ticket/reservation method, and service limitations. Price and duration counts alone are not publishable research.
- A private atomic upgrade must spend its bounded generation window on the evidence-backed writer pass. It reuses the existing canonical topic and verified HTTPS cover/inline assets, and therefore skips optional SERP enrichment, Chain-of-Density rewriting, and duplicate image generation. The normal inline-image stage fills only a real shortfall. A separate image-quality workflow may refresh assets, but it must not hold the atomic content replacement open until the serverless timeout.
- Every publisher AI provider call has its own network deadline inside the larger writer deadline. The primary Gemini attempt gets 55 seconds and the DeepSeek fallback gets 30 seconds; SDK retries are disabled for these bounded attempts. The grounded writer receives an 8,192-token output cap and Gemini 2.5 thinking budget `0`, because reviewed evidence transformation must not spend up to 24,576 dynamic thinking tokens. A stalled primary must be aborted so fallback can run, and the configured policy provider must not be called a second time when that same provider already failed in the cascade.
- Quality-gate database reads have a four-second deadline. A normal new candidate fails closed when duplicate verification is unavailable. A private atomic replacement that already passed representative ownership, canonical target, and existing-creative validation skips the repeated duplicate queries in every repair round; the atomic replacement RPC remains the final write boundary.
- AI writer output is bounded to 16,000 characters at a recent paragraph boundary before regex-heavy editorial, structure, and rendering repairs. The publisher records original/final character counts and truncation in `generation_meta.writer_output_boundary`. Server-owned evidence structure, official links, images, and all publish gates run after this boundary; truncation never grants a publish bypass.
- Concurrent research candidates share identical in-flight reviewed-page downloads within the same worker invocation. Guam shopping research deterministically derives the official Made in Guam authenticity marker and a named Chamorro Village purchase location from the reviewed Guam Visitors Bureau article; model omission cannot lower the required factual-claim floor.
- Intent-suite success is not destination readiness. A destination/intent pair may enter regeneration only when directly reviewed documents cover that scope. Cebu weather uses the PAGASA Mactan 1991-2020 station normals. Bohol weather uses the Tagbilaran-Dauis PDF's body period, 1991-March 2013, even though its folder name says 1991-2020. Cebu/Bohol itinerary and Bohol transport context use destination-scoped Philippine Department of Tourism or Bohol Provincial Tourism Office pages. These documents must never support another destination.
- Every reviewed direct-research document stores `destinations`. Empty scopes are reserved for genuinely destination-global rules; local weather, transport, tourism, price, and activity documents need explicit aliases. The auto-research loader filters documents by destination before applying its page cap, so database row order can never substitute another city's sources.
- Search-quality audits must evaluate the same exact-five cumulative KST slot contract as the scheduler, publisher, and daily summary. Source audits must verify `remainingDueNow` slot enforcement instead of legacy variable names or the retired three-to-four-post policy. The daily wrapper gives browser-backed image checks a 180-second default hard timeout because the measured 30-post production audit can exceed 60 seconds; an audit timeout is an operational error, not a content-quality failure.
- Monthly-weather fleet variation is a versioned contract. New queue rows use SHA-256-based stable assignments for reader scenario, opening angle, and actual section order so small modulo bias cannot collapse a destination batch into one template. A backfill may migrate marked evidence-backed weather posts by changing only the evidence-safe opening, recognized H2 labels, and the order of their intact sections; it must preserve every researched claim, table row, source URL, image, and publication identity.

## Evidence Base

Official and implementation references:

- Google sitemap guidance: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Google sitemap ping deprecation: https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping
- Google URL Inspection API: https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
- Google Search Console API limits: https://developers.google.com/webmaster-tools/limits
- IndexNow protocol documentation: https://www.indexnow.org/documentation
- Vercel Cron duration guidance: https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Server-side sitemap implementation reference: https://github.com/iamvishnusankar/next-sitemap
- IndexNow batch/retry/cache implementation reference: https://github.com/viv1/indexnow-submitter
- Free search-intent fallback: Google Suggest autocomplete via `suggestqueries.google.com` is allowed as keyword/intent guidance when paid or keyed SERP providers are unavailable. It must not be represented as ranking proof.
- Gemini native image generation: https://ai.google.dev/gemini-api/docs/image-generation
- Google people-first content guidance: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google generative AI content guidance: https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- Gemini 2.5 thinking budgets and disabling dynamic thinking: https://ai.google.dev/gemini-api/docs/generate-content/thinking
- Google scaled-content abuse policy: https://developers.google.com/search/docs/essentials/spam-policies#scaled-content
- Google image SEO guidance: https://developers.google.com/search/docs/appearance/google-images
- Prompt/evaluation regression reference: https://github.com/promptfoo/promptfoo
- Prompt versioning and trace reference: https://github.com/langfuse/langfuse
- Metric-driven prompt optimization reference: https://github.com/stanfordnlp/dspy

Local code references:

- Live publisher: `src/app/api/cron/blog-publisher/route.ts`
- Topic fit gate: `src/lib/blog-topic-fit-gate.ts`
- Content brief gate: `src/lib/blog-content-brief.ts`
- Information intent/required-slot contract: `src/lib/blog-information-contract.ts`
- Information planner: `src/lib/blog-information-planner.ts`
- Grounded automatic researcher: `src/lib/blog-auto-research.ts`
- Human review workflow: `src/lib/content-review-workflow.ts`
- SERP/free intent analyzer: `src/lib/serp-analyzer.ts`
- Shared publish evaluator: `src/lib/blog-publish-quality.ts`
- Customer-facing quality evaluator: `src/lib/blog-customer-quality.ts`
- Final customer-surface repair: `src/lib/blog-final-customer-surface.ts`
- Final rendered SEO gate: `src/lib/blog-rendered-seo-quality.ts`
- Public render normalizer: `src/lib/blog-public-render-normalizer.ts`
- Reading-time SSOT: `src/lib/blog-reading-time.ts`
- Named fixture evaluator: `src/lib/blog-informational-engine-v2-eval.ts` (`npm run eval:blog-info-v2`)
- Existing-post dry-run auditor: `src/lib/blog-informational-existing-audit.ts` (`npm run audit:blog-info-v2`)
- Owner handoff: `docs/blog-informational-engine-v2-owner-runbook.md`
- Editorial/structure repair: `src/lib/blog-editorial-repair.ts`
- SEO scorer: `src/lib/blog-seo-scorer.ts`
- Indexing client: `src/lib/indexing.ts`
- Blog canonical URL helper: `src/lib/blog-canonical-url.ts`
- Backfill/audit tool: `scripts/backfill-blog-quality.ts`
- Manual indexing worker runner: `scripts/run-blog-indexing-worker.ts`
- Publish preflight evaluator: `src/lib/blog-publish-preflight.ts`
- Canary candidate preflight evaluator: `src/lib/blog-canary-preflight.ts`
- Generated canary quality evaluator: `src/lib/blog-canary-generated-quality.ts`
- Fleet phrase-drift evaluator: `src/lib/blog-fleet-phrase-drift.ts`
- Product dry-run generated canary builder: `src/lib/blog-product-generated-canary.ts`
- Current-day publisher health evaluator: `src/lib/blog-current-day-publisher-health.ts`
- Slug redirect map: `src/lib/blog-slug-redirects.ts`
- Slug migration dry-run/write tool: `scripts/migrate-blog-slugs.ts`

## Required Publish State Machine

Every automatic blog must follow this state machine:

1. `queued`
2. `generating`
3. `generated_draft`
4. `prepared_for_publish`
5. `quality_checked`
6. low-risk: `published` or `gate_failed`; human-review-required information: private `draft` + queue `pending_review`
7. `indexing_queued`
8. `indexing_submitted`
9. `visibility_observed`

No path may write `status='published'` unless it has current evidence for:

- `quality_gate`
- `generation_meta.content_brief`
- `seo_score`
- `readability_score`
- `readability_issues`
- final `slug`
- final `seo_title`
- final `seo_description`
- final `blog_html`

## Required Pre-Publish Pipeline

Before the first publish gate:

1. Run `evaluateBlogTopicFit()` before inserting any automatic topic into `blog_topic_queue`.
2. Build `generation_meta.content_brief` with `buildBlogContentBrief()` before LLM writing. The information planner must resolve `intent`, `destinationId`, `audience`, `locale`, `primaryQuestion`, `requiredSections`, `requiredFacts`, `plannedTables`, `faqQuestions`, `riskLevel`, and `missingInputs` before the writer is called. Any non-empty `missingInputs` list blocks generation.
   For ordinary information candidates, missing or invalid research must trigger `researchBlogInformationAutomatically()` before the writer is called. Google Search is URL discovery only. The system resolves discovered locations, keeps only safe HTTPS URLs on an intent-approved official or reputable registry hostname, directly downloads the reviewed page, and gives the structuring model only those downloaded extracts. Search snippets and unverified model digests never enter the evidence bundle. HTML, text, JSON, XML, and PDF inputs are bounded by redirect, byte, text, and timeout limits. The resulting source/evidence/claim graph uses stable keys and exact normalized snapshot spans, is persisted, and must pass a second `evaluateBlogGenerationResearchReadiness()` check. Failure or timeout is classified as `evidence_insufficient`; the writer is not called.
   Official trust requires a matching active `blog_information_official_source_registry` row and an active, intent-matched URL in `blog_information_official_research_documents`. Non-official automated web evidence requires a matching active `blog_information_reputable_source_registry` row for the same intent and source type. A registry match grants source authority, not permission to invent facts absent from the downloaded page. Entry/visa and travel-insurance topics retain mandatory human review even after research passes.
   A live-fetch failure may use an immutable `blog_information_source_versions` snapshot only when the URL is still an exact active research-document URL, the official registry id matches, `metadata.acquisition='reviewed_registry_snapshot'`, `valid_until` is in the future, and `retrieved_at` is no older than 30 days. The evidence and source metadata must retain `reviewed_registry_snapshot`; the fallback must never be reported as a live direct fetch. An absent, stale, revoked, or host-mismatched snapshot keeps the writer blocked.
3. For information posts, build one of the eleven explicit intent contracts: `food_budget`, `monthly_weather`, `airport_transport`, `local_transport`, `hotel_areas`, `family_budget`, `itinerary`, `shopping_souvenirs`, `currency_payment`, `entry_requirements`, or `travel_insurance`. Persist the planner-selected intent and reuse it at the final required-slot gate so title repair cannot silently change the contract.
4. Treat raw queue topics as seeds only. The brief is the source of truth for final title, primary keyword, secondary keywords, search intent, required sections, forbidden angles, source policy, and human-review policy.
5. Run `analyzeSerp()` for eligible keywords. If Naver keys are missing or no results are returned, use the free Google Suggest fallback only as keyword/search-intent guidance.
6. Build the LLM prompt from the same visual/content contract used by gates: no `==...==`, no `<mark>`, no highlight-style emphasis, and tables must be valid GitHub Flavored Markdown with a separator row and no blank lines inside table rows. Information posts must use the dedicated `blog_info_writer_guide` domain and `BLOG_INFORMATION_PROMPT_VERSION`; they must not inherit product-sales, fixed character-count, keyword repetition-quota, mandatory product-link, hashtag, or CTA-writing rules from `blog_style_guide`. An active database information prompt may override Prompt-as-Code only when its semantic version is current and it passes `isValidInformationalWriterGuide()`. Empty, malformed, stale, or contract-incomplete rows fall back to the repository guide and persist `generation_meta.prompt_source='repository_fallback'`.
   Information writer v2.2 also reserves the final five-to-nine H2 budget for deterministic evidence sections, requires one natural reader-question H2, and permits an FAQ only when its answers can be assembled from preflight-approved claims. The deterministic AI-readable repair must preserve the question and FAQ while demoting surplus ordinary H2 headings; it must never invent FAQ facts to satisfy a score.
7. Assemble information prompts through `buildInformationalWriterPrompt()`. The composer must fail closed on missing priority/evidence/output/brief/claim-ledger blocks or known legacy instruction conflicts. Persist only the version, source, SHA-256 digest, size, section ids, and warnings in `generation_meta.prompt_manifest`; never persist the raw prompt or evidence pack in that manifest.
8. Normalize or reject the slug.
9. Ensure internal CTA links.
10. Ensure official reference links.
11. Insert or verify inline images.
12. Run `repairBlogEditorialQuality()`.
13. Run `repairBlogStructureQuality()`.
14. Run `runQualityGates()`, including `topic_fit`, `editorial_quality`, `accent_density`, `table_integrity`, and `cta_destination_integrity`.
15. Run `inspectBlogCustomerQuality()` through `evaluateBlogPublishQuality()` so customer-visible writing defects are scored with the same publish decision as render/SEO gates.
16. Run `computeSeoScore()`.
17. Run `computeReadability()` on the final post-gate body.
18. Render information Markdown through the public renderer and sanitizer. Block publication unless the final surface has exactly one page H1, aligned title/H1/description intent, no raw Markdown or literal `\n`, valid non-empty headings and tables, no placeholder, self-consistent canonical/index state, valid JSON-LD, answer-first CTA placement, and no duplicate CTA.
19. Persist `quality_gate.rendered_reading_time_minutes` from that final rendered body. Public list and detail views must read the same persisted value; legacy rows may use the existing fallback calculation.

Entry/visa/immigration and travel-insurance information always require human review. Even after automated gates pass, the publisher must store these candidates as `content_creatives.status='draft'`, set `review_status='pending_review'`, create a fingerprinted `blog_information_review_cases` row, enqueue a high-risk review with no timed auto-approval, and set `blog_topic_queue.status='pending_review'`. A generic content-review queue row without the evidence review case is not a valid high-risk handoff. This branch must return before public cache revalidation, advertising mapping, publish logging, sitemap/indexing enqueue, or any public count increment. Human approval only unlocks a later explicit publish action; that action must rerun current publish QA.

For a published high-risk repair, the generated draft uses a private shadow slug and records its public target, canonical slug, original publication time, and queue ID in `generation_meta.reviewed_published_replacement`. The approval publish action renders and scores the candidate against the canonical slug, then `replace_blog_information_reviewed_draft_atomically()` locks the review case, draft, public target, and representative. It revalidates the approved fingerprint, supported claims, official evidence, quality gate, and representative ownership before copying the reviewed body and metadata into the existing public creative. The public creative ID, canonical slug, and original `published_at` remain unchanged; the shadow draft is archived, the evidence ownership and canonical review fingerprint move to the public target, an indexing outbox job is created, and `blog_information_replacements` stores both pre-change and replacement snapshots. Any exception rolls back the whole transition and leaves the old public article untouched.

The SEO score is not allowed to mask missing policy evidence. Entry/visa/immigration and travel-insurance content requires a passed versioned research preflight, at least one reviewed official HTTPS source, non-empty supported claims and evidence with at least 90% claim-source coverage, a passed claim validation result that still requires human review, and automated research completed within the last 45 days. The publisher must copy the queue's persisted `auto_research.completed_at` into generation metadata, validate the post-QA claim ledger before computing SEO freshness, and run the same claim validation again after all SEO/publish-quality body mutations before persistence. If any of these are missing, `information_freshness` is a critical SEO failure and the visible aggregate score is capped at 79. Passing this freshness gate never replaces human approval.

Reviewed entry-source documents are destination scoped. The current registry includes the Vietnam MFA embassy visa-exemption list, the EU ETIAS portal, CBP ESTA fee and validity pages, Japan MOFA visa exemptions, and the Royal Thai Embassy plus Immigration Bureau TDAC manual. A source reviewed for Vietnam, Europe, the United States, Japan, or Thailand must never satisfy another destination's research preflight.

If a repair mutates body content after any gate failure, `repairBlogStructureQuality()` must run again before the next gate check.

`engine_v2` must expose category scores, not just a single average. Required categories are search/reader task completion, customer language, AI-template naturalness, evidence/faithfulness, sales-pressure control, and for product-backed posts product decision helpfulness. A post is not a true 100-point candidate unless every category passes. Weak category scores must feed `repairBlogEngineCategoryGaps()` before publish: information posts get answer-first/source support repairs, product posts get missing decision blocks from product evidence, and naturalness/customer-language/sales-pressure issues go through the editorial repair path before the next gate check. Category repair must re-evaluate and retry up to three rounds or until every category reaches 100, and write repair round evidence when it mutates the post. If `official_sources_required=true`, information posts need an external official-source candidate link; SERP intent, internal notes, arbitrary websites, and Markdown image URLs are not enough. This candidate check does not replace final trust: factual publication still requires the server-managed registry and claim-evidence gate.

The live publish gate must use the same 100-point category definition. Do not allow near-pass exceptions for `ai_naturalness` or `sales_pressure`: if any `engine_v2.category_scores` item is below 100 after repair rounds, the candidate remains a repair/fallback candidate and must not be written as `published`.

`evaluateBlogEngineV2()` itself must use the same 100-point contract as the publish gate. A score in the 80-99 range is repairable evidence, not a pass. `engine_v2` failures caused by reader-task incompleteness, customer-language defects, AI-template naturalness, sales-pressure control, or product decision helpfulness are self-heal eligible because the current category repair loop can mutate and re-evaluate them. Evidence insufficiency, product open-contract failure, topic-fit failure, and candidate pre-publish contract failure remain non-self-heal blockers.

Daily quota recovery must distinguish repairable post defects from unsafe seeds. Deterministic quality failures such as `length`, `links`, `keyword_density`, `structure_integrity`, `table_integrity`, `render_integrity`, `intent_quality`, `seo_score`, and `engine_v2` are self-heal candidates after the shared repair path is deployed. They should be retried without an artificial two-hour delay and, after the normal attempt limit, routed to the editorial recovery backlog instead of hidden terminal failure. Unsafe seeds still do not self-heal: duplicate content, missing context, insufficient evidence, product open-contract failure, topic-fit failure, candidate pre-publish contract failure, and invalid linked drafts must be skipped, quarantined, or repaired at the source before requeueing.

Product-open blockers must not reduce the daily publish target. If product-backed rows are blocked by `pending_review`, customer-open contract failure, stale mobile proof, or missing product evidence, the scheduler/publisher must exclude them from `publishable_candidate_count` and refill or claim information candidates instead. Commercial posts may wait for source repair; the day still needs enough safe information candidates to meet the target without inventing product facts.

Deterministic information fallback is an operational recovery artifact, not publishable content. It may be used to diagnose missing slots or prepare a private repair draft, but it must never be written as `published`, revalidated as public, added to sitemap, or enqueued for indexing. A quota miss is preferable to publishing a generic fallback that does not satisfy the promised intent.

Image count and rewritten alt text are not proof of visual relevance. Publication never waits for a generated cover: the normal path first publishes a deterministic brand graphic, then a rollout-eligible `codex_builtin` job may asynchronously upgrade that managed fallback through the shared media ledger. The job is generated only by the signed-in Codex built-in ImageGen subscription surface, not an image API or `OPENAI_API_KEY`; the server normalizes and QA-checks the upload before atomically replacing the public cover. It must carry `AI 생성 참고 이미지` in both customer-visible caption and alt text and must never imitate a recognizable hotel, room, flight, meal, attraction, current condition, readable sign, menu price, factual chart, or identifiable person. The worker must not overwrite a supplier, official, manually selected, or concurrently changed cover. Blog inline shortfalls use deterministic summary/CTA graphics rendered from the verified article body under `media-assets/code_rendered/...`; text is code-rendered rather than generated inside a photograph. Failed, allowance-limited, disabled, or rollout-excluded generation leaves the deterministic brand graphic in place. Base64/data URLs are never publishable. Pexels is disabled in the normal path and is available only when both the legacy environment flag and an explicit recovery call-site opt-in are present. Generated visuals are illustrative context, never factual evidence.

Extra recovery claims must use the shared time-budget plan in `src/lib/blog-publisher-time-budget.ts`. When normal generation time remains, the publisher may claim the mixed publishable pool. When there is not enough time to complete research, generation, repair, and all gates, it must stop claiming publish candidates or keep the result private for later repair. Time pressure must not downgrade the information-content contract.

Information-writer prompts must not receive internal product inventory, active-product counts, booking counts, consultation signals, or internal price ranges. These operational values are neither research evidence nor customer-facing content. Product-backed writing remains governed by the separate product evidence contract and is outside this information-content rule.

## Informational Source, Evidence, And Claim Contract

Informational research uses the dedicated `blog_information_*` namespace. It must never write into or reinterpret product registration evidence, product snapshots, package parsers, or package publication tables.

- `blog_information_sources` stores the source type, HTTPS URL or internal identifier, publisher, retrieval time, validity window, destination/country, supported claim types, risk, and optional paired reviewer/review time.
- `blog_information_evidence` stores the captured source locator or excerpt for one information candidate. `content_key` allows research to exist before a `content_creatives` row is created; `creative_id` is attached when a draft exists.
- `blog_information_claims` stores normalized customer-visible claims and their validation state.
- `blog_information_claim_evidence` links each claim to supporting, contradicting, or contextual evidence.

The evidence tables are server-only: RLS is enabled, browser roles have no grants, and only the service role policy may access them. Application inputs must pass `validateBlogInformationResearchBundle()` before `persistBlogInformationResearch()` writes anything. Source and evidence keys make retries idempotent.

Migration order is additive: `20260715082549_blog_information_evidence_model.sql` must exist before the claim validator is enabled. The operating database was verified on 2026-07-24 with 12 active official registry rows, 16 active intent-scoped official documents, 6 active reputable registry rows, source 1, source versions 21, evidence 147, and claims 48. Information published before the V2 public contract cutoff remains eligible through an explicit legacy lane only when its persisted quality gate passed and it has no blocked review state, `noindex`, redirect, missing slug, or non-published status. It is not silently upgraded to V2 evidence and does not bypass the current contract for posts published on or after the cutoff. Do not drop the schema as an operational rollback; use a forward-only follow-up migration that preserves the audit trail.

Targeted private regeneration is research-first. Before `privateQueueId` processing can invoke a writer, `evaluateBlogGenerationResearchReadiness()` must validate the queue's `information_research_bundle` against the exact content key, destination, locale, source policy, freshness window, claim/evidence coverage, and intent-specific minimum claim set. A valid bundle is persisted through `persistBlogInformationResearch()` and attached to the replacement creative. Missing or invalid research, untrusted sources, or persistence failure leaves the queue row `skipped` and `self_heal_blocked`; it must not consume an AI generation attempt. The raw source snapshots and excerpts stay in the dedicated evidence store and queue research input, and must not be copied into `content_creatives.generation_meta`; only a compact preflight summary and stable source/evidence keys may be recorded there. Since 2026-07-24, the ordinary daily information publisher also blocks on the reviewed-source direct-fetch contract before writing.

For `entry_requirements`, research readiness must contain explicit supported claims for the permitted travel purpose, permitted stay duration, return/onward travel, lodging or stay details, financial means or travel expenses, and a named customs-declaration category before the writer can run. Missing semantic coverage triggers one bounded structured-research retry and otherwise remains blocked. For United States recovery, exact excerpts from the destination-scoped Korean consulate guidance and CBP Form 6059B are deterministically promoted into these supporting-document and declaration claims after successful direct retrieval; this prevents model omission without permitting a claim absent from the reviewed page. At the final research-structure boundary, one unambiguous destination shared by the passed source/evidence bundle may be rendered as `목적 국가: <destination>`, and omitted entry context may reuse only evidence-backed claims from that passed bundle. Conflicting or missing destinations and unsupported entry details remain blocked. Destination repair supplies structural context rather than a visa or policy claim; every reused claim is added to the writer claim ledger. All repairs must be idempotent.

Automatic research is successful only when the final persisted bundle passes the same intent, destination, locale, source-policy, freshness, coverage, and semantic readiness evaluation used by the publisher. A structurally valid bundle that still lacks a required semantic claim must return `passed=false` with those readiness issues and must not replace the queue's research bundle. For United States VWP research, the destination-scoped reviewed DHS program page supplies the explicit business-or-tourism purpose and up-to-90-day stay statement; generic ESTA eligibility or admission pages cannot substitute for that missing purpose evidence.

The targeted published-upgrade boundary must pass its already validated `PrivateBlogRegenerationRequest` into topic generation. Topic generation must use that same request when deciding whether an invalid or stale research bundle is eligible for automatic research refresh. It must not reparse mutable queue metadata and accidentally downgrade a validated published upgrade into a private flow that cannot refresh research.

Every quality-gate rerun must apply generic customer-surface and keyword-density cleanup before the final deterministic research-structure repair. The research repair is the last structural body mutation, so a generic lead rewrite cannot delete verified high-risk entry evidence. After research structure and image restoration, only the evidence-preserving `repairBlogFinalInlineSurface()` pass may correct Korean particles such as `입국신고을`, including when Markdown emphasis or a link separates the noun and particle. It may also convert a non-table prose line with three or more spaced pipe-delimited evidence segments into bullets in the same order. It must not delete or reorder paragraphs, valid tables, links, claim markers, or evidence blocks. Literal-newline normalization and quality evaluation follow that inline pass. This order applies to both ordinary and AI-readability reruns and is enforced by route contract tests.

Targeted private regeneration is a single-attempt verification path. It must not spend a second full writer attempt inside one server request. The replacement reuses its linked draft's unique HTTPS OG and inline image assets first and skips SERP analysis and Chain-of-Density rewriting. When exactly two unique reusable assets leave a one-image quality shortfall, it may make at most one relevance-filtered Pexels lookup and, only if that yields no safe result, one disclosed AI reference-image attempt. It must not start external image work when fewer than two reusable assets exist or generate multiple replacement images; optional enrichment is never a reason to exceed the server time budget or leave the queue stuck in `generating`.

For food-budget drafts, a research bundle that proves prices but contains no policy evidence must not tempt the writer or repair layer to invent restaurant fees. The deterministic research repair adds a visible evidence-gap section stating that outlet-specific tax, service-charge, and booking terms were not supplied, then tells the reader exactly which fields to confirm on the official menu or reservation screen. If approved policy claims do exist, it may quote only those approved claims before the same current-condition check. This section satisfies the required decision slot through honest uncertainty, not guessed values.

Food-budget tables are deterministic output, not trusted writer formatting. Before rebuilding them, the repair layer removes writer-authored pipe rows, canonical research headings that would collide with the rebuilt sections, empty headings, and literal `\\n` escapes. The two canonical tables contain only the approved extracted values; repeated full claim prose stays out of visible table cells and remains traceable through the claim ledger. During claim validation, each compact table value must map to exactly one persisted claim with the same type, normalized value, unit, and currency; missing or ambiguous matches fail closed. This prevents malformed one-cell rows, duplicate rendered headings, repeated evidence boilerplate, and claim-ledger drift from reaching the final quality boundary.

When that deterministic repair replaces a generated section, it must preserve unique existing HTTPS Markdown image blocks and their adjacent captions, then redistribute any displaced blocks below the rebuilt food-budget headings. This preservation step never fetches or generates a new asset. It prevents the final research repair from undoing the private regeneration path's already-reviewed image reuse and contextual alt text.

For `food_budget`, the research preflight accepts current reputable price aggregators as `reputable_price_source` in addition to official, field-research, and reputable local sources. Seven arbitrary prices are not sufficient: supported claims must explicitly cover budget, mid-range, and comfortable daily tiers plus breakfast, lunch, dinner, and a snack/coffee category. Source-displayed currencies must be preserved; the writer must not silently convert or invent local-currency values.

`extractBlogInformationClaims()` distinguishes ordinary travel narration from publish-verifiable claims. It extracts currency/price, movement time, percentages, climate values, customs/duty-free limits, entry/visa rules, insurance coverage/exclusions, policy statements, and measurable superlatives. Every extracted fingerprint must have a persisted claim row in `supported` or `approved` state and at least one current, same-type evidence link. Explicit `valid_until` is authoritative; otherwise the claim-type freshness window applies to the source retrieval time.

Customs, entry/visa, insurance, and policy claims require both an official source authority and `review_status='approved'`. Missing evidence, unsupported status, expired/revoked evidence, non-official high-risk sources, or missing human approval keeps the article private in draft/review. The same `evaluateBlogInformationClaimPublishGate()` runs for automatic publishing, direct blog POST/PATCH, content-hub publication, content-queue approval, force reindexing, and zero-click body replacement. Product-backed content exits this information-only gate unchanged.

## Informational Representative And Canonical Contract

## Future Generation Deduplication Contract (blog-generation-dedup-v1)

This gate applies to every newly generated blog row before it is inserted into
`content_creatives`, including direct generation, content-hub generation,
card-news generation, ranking generation, creative-factory generation, and the
automatic publisher. It is a future-generation guard only: it does not rewrite,
merge, redirect, delete, or backfill legacy articles. Image assets are outside
this contract.

- The candidate title is normalized deterministically with Unicode NFKC, case
  folding, whitespace/punctuation cleanup, and removal of non-intent year and
  format words. The resulting `blog-generation-dedup-v1` key is claimed in the
  service-only `blog_generation_dedup_claims` ledger before persistence.
- An exact slug, exact title, or exact normalized title collision with an
  active/draft generation is `BLOCK`. The route must not create a new creative
  row or public URL and returns a duplicate conflict for direct callers.
- A near title collision (similarity `>= 0.78`) within the same destination and
  content kind is `REVIEW`. It may be saved as private review inventory, but it
  must never be auto-published. A near match for a different destination is not
  blocked by this title gate; the normal evidence, representative, and quality
  gates still apply.
- The claim is a short-lived `reserved` lease during generation. Successful
  persistence binds it to the creative as `bound` (or `review`); failed writes
  release it. The database unique key and atomic RPC are the concurrency
  backstop for two simultaneous generation requests.
- Re-generating the same existing creative is allowed only when the caller
  supplies that creative ID. This prevents an in-place approved replacement
  from blocking itself while still rejecting a second creative.

Existing duplicate inventory remains read-only and operator-reviewed through
the existing dry-run tools. Do not solve historical duplicates by appending
numeric title suffixes or by silently changing canonical URLs.

Every new information article has one stable representative key: `destination_id + intent + audience + locale`. Title year, slug year, campaign wording, and publication date are deliberately absent from the key. `blog_information_representatives` owns the unique reservation and canonical creative/slug for that key.

Automatic publishing reserves the key before creating a `content_creatives` row. An existing active representative returns `UPDATE_EXISTING`; a reservation owned by another candidate returns `WAIT_FOR_EXISTING`; neither path creates another public URL. A private review draft keeps its reservation and attaches the draft creative ID. The registry becomes `active` only when the corresponding creative passes every gate and is explicitly published. Direct POST uses a private insert then activates the representative before changing the row to `published`; manual approval routes enforce the same registry.

New information rows persist `generation_meta.information_representative`. Sitemap inclusion requires that metadata to be `active` and its `canonical_slug` to equal the stored slug. Legacy rows without representative metadata and product-backed rows remain compatible. Existing duplicates are never redirected, merged, deleted, or rewritten automatically; `buildBlogInformationDuplicateDryRun()` only proposes the earliest published member as canonical and labels the others `MERGE_REVIEW` for M11 operator review.

If the publisher claims queue rows but exits for time budget before attempting all of them, every unattempted row must be released back to `queued` with an immediate `target_publish_at`. A claimed-but-unattempted row must not remain stuck in `generating`, because that silently removes publishable inventory from the next recovery run and can cause the daily target to miss again.

The final customer-surface pass must run after all structure, CTA, FAQ, and readability repairs. Both the live publisher and the backfill/audit tool must call the same `repairBlogFinalCustomerSurface()` implementation so a defect fixed in recent published rows cannot recur in new automatic posts. The same applies to `repairBlogEngineCategoryGaps()`: live publishing, shared publish preparation, and recent-post backfill/audit must use the category repair path so 100-point category weaknesses are fixed consistently before final evaluation. It must keep the H1 lead to one answer-first paragraph, split only true mobile paragraph walls, remove generated residue, deduplicate hashtags, repair broken Markdown URL fragments, convert destination placeholders such as `현지 날씨` to the concrete destination, and treat whitespace-only storage differences as audit-equivalent so fixed posts do not keep reappearing as changed.

Public customer-quality audit must evaluate the customer article body, not table-of-contents or related-post UI. Numbered itinerary headings such as `1일 차`, `2일 차`, and `3일 차` are distinct headings and must not be normalized into one duplicate signature. True repeated headings remain a major issue; slightly high heading counts are a warning unless they are clearly excessive or duplicate.

The daily policy target is exactly five new publications, assigned to 09:00, 12:00, 15:00, 18:00, and 21:00 KST. Publisher runs follow at 09:05, 12:05, 15:05, 18:05, and 21:05 KST. A separate 22:05 run is quota recovery only: it no-ops when the day has already reached five and attempts a researched replacement when a prior slot failed. The external `:07` publisher retries, `:27` indexing-worker backups, final 22:40 indexing drain, and 22:45 daily summary must finish in that order.

Queue inventory is not publishable inventory. An information candidate counts toward the daily buffer only when `evaluateBlogGenerationResearchReadiness()` passes for its exact content key, destination, intent, locale, source policy, freshness window, and claim coverage. The scheduler prepares a ten-candidate buffer before assigning slots. Unresearched, cancelled, or evidence-insufficient rows are quarantined with replacement metadata and must not be scheduled merely because their queue status is `queued`.

The deterministic recovery catalog uses only reviewed WMO city pages and machine-readable climate-normal feeds whose 12 monthly rows, temperature, rainfall, rain-day values, and reference period were verified. Research documents carry an explicit destination allowlist. The WMO payload builder must also match the feed's city name to the requested destination, including reviewed aliases such as Guam/Hagatna, Nha Trang/Nha Trang's Korean WWIS name, Bali/Denpasar, Okinawa/Naha, and Ho Chi Minh variants. A complete feed for a different city is still a hard failure.

## Publish Preflight Contract

Before expanding or manually forcing automatic publishing, the operator-facing preflight must pass:

- enough actually publishable candidates for the remaining daily slots;
- no evidence-insufficient or product-open-contract candidates blocking the ready pool;
- no actionable failed queue rows or stale `generating` rows;
- Product-backed rows linked to `pending_review`, `draft`, or `review_needed` packages are approval inventory, not publication failures. Publisher preflight moves them to `deferred`, and the recovery pass rechecks them on later publisher runs so they return to `queued` only after the package becomes customer-visible and the customer-open evidence contract passes.
- recent indexing outbox coverage at 100%;
- at least three recent published samples passing quality gate, content brief, SEO, and readability evidence.

The preflight may pass when overdue queued rows exist if the publishable candidate buffer is sufficient and publisher preflight can reschedule them. It must block when the issue changes publish safety, not when the row is harmless queue history.

## Current-Day Publisher Health Contract

Before the daily close window, reports may intentionally evaluate the previous KST day. That must not hide a current-day publisher failure.

- If the latest `blog-publisher` run is inside the current KST day and ran with remaining quota but published `0`, diagnostics must expose `current_day_publisher_failure`.
- The admin health summary must mark this as an active operating issue even when the closed-day SLA was already met.
- A quota-reached no-op with `remaining=0` remains healthy.

## Public Quota Truth and Frozen-Rollout Recovery

- Daily publication quota, daily summary totals, recent-public duplicate checks, and rollout publication observations must read `public_blog_content_creatives`. A raw `content_creatives.status='published'` row that is blocked by review, `noindex`, redirect, quality, claim, or representative policy is not a public publication and must not consume a slot.
- Incident detection still records the original unsafe event, but remediation is evaluated against the current public surface. Hiding or deleting an unsafe row does not itself unfreeze publication.
- A frozen rollout may return only to `pilot_3` through `recover_blog_publication_rollout_v1`. Direct state updates and the daily evaluator are not recovery paths.
- Recovery requires database-verifiable evidence: the incident creative is absent from `public_blog_content_creatives`, its `URL_DELETED` indexing job succeeded, and a post-freeze informational canary remains a private draft with an `approved_for_slot` V5 attempt, complete prompt trace hashes, a decision artifact, and a passing independent `blog-editorial-harness-v5.0.0` evaluation.
- Every successful recovery writes one immutable `blog_publication_rollout_recoveries` row with operator, reason, incident creative, canary run/attempt, hashes, and before/after state versions. State-version conflict, missing evidence, or a public incident row must fail closed.
- Research-failure recovery is allowed once only when `buildBlogInformationResearchRecheckDecision()` permits the intent and the queue still has a verified GSC, Naver, customer-question, active-product, verified operator, editor seed, search-volume, or trend signal. Missing demand, product-open-contract, duplicate, unsupported intent, or repeat recovery remains blocked.

## Canary Candidate Contract

Before widening automatic publishing after engine changes, `diagnose:blog-autopublish` and admin health must be able to identify at least three low-risk queued candidates without claiming or publishing them.

An authorized single-item publication proof uses `targetQueueId` only after the exact information queue row has `meta.controlled_publish_canary=true`. The endpoint rejects product rows, processes no other queue row, performs no quota refill or stale-row recovery, and still obeys research, quality, representative, human-review, publication, and indexing gates. Remove or consume the flag after the proof. This is an operating verification path, not a general quota bypass.

An update proof must modify the same canonical creative through the authenticated blog PATCH path with `status='published'`. The route reruns current preparation, quality, claim evidence, representative, and human-review gates. `publish_blog_information_atomically` must create a second `blog_information_publications` record for the new content fingerprint and a new indexing outbox job while retaining the same creative ID, representative key, and canonical slug. An edit that fails any current gate remains private or is rejected; a successful HTTP response alone is not proof until those database and public-page invariants are read back.

- The preferred canary set includes both `info_writer` and `product_consultant_writer`.
- `info_writer` canaries require a concrete destination unless the candidate is explicitly marked `intentionally_generic`. The common queue preflight may set that flag only for the existing deterministic `generic_unmarked` classification; missing or invalid destinations are skipped. Intentionally generic research uses the explicit evidence scope `해외여행 공통` instead of persisting an empty destination.
- Product canaries require a durable product dedup key using product, departure date, duration, and supplier evidence.
- Broad pillar rows, evidence-insufficient rows, duplicate rows, and topic-fit failures must be rejected before they consume publisher claim slots. A pillar coverage gap alone must never create a `queued` row; pillar generation requires the same durable verified-demand evidence as other V4 candidates.
- Candidate topics that already violate the pre-publish title/slug contract must also be rejected before they consume publisher claim slots. Current blockers include banned editorial cliches such as `총정리` and `완벽 가이드`, machine separators such as `|`, month/year-leading topics that generate numeric slugs, weak expected slugs, and destinationless broad recommendation topics without a concrete comparison brief.
- Queue/admin operational health must use the same candidate pre-publish contract. A blocked queued row must be counted as `candidate_pre_publish_contract` / `quarantine_candidate_contract`, not as `publish_ready` or merely overdue inventory. Legacy broad `pillar` rows are separate planning inventory and must be counted as `pillar_deferred`, not as candidate-contract failures; new pillar rows cannot enter `queued` until verified demand is durably stored.
- Editorial cliche blockers are `총정리`, `완벽 가이드`, `완벽 정리`, and similar title templates. If older mojibake text appears in historical evidence, interpret it as one of these Korean cliche blockers and do not use it as a literal prompt phrase.
- Candidate pre-publish contract failures are unsafe seeds, not manual rewrite backlog. Cleanup and publisher preflight should move them to `skipped` with durable `candidate_pre_publish_contract` metadata so they stop inflating failed/manual-review queue counts.
- A single non-blocking preflight warning scores 95. Blocking evidence, indexing, actionable-failure, stale-generation, or canary-quality checks keep their 25-point deduction and must never be masked by backlog scoring.
- Each selected canary must expose `quality_contract='customer_surface_100'` and writer-specific expectations. `info_writer` must prove answer-first Korean intent, official source support when changeable, valid table/checklist rendering, bottom-only soft CTA, and no AI-cliche opening. `product_consultant_writer` must prove product DB-only claims, price/departure/duration opening, included/excluded blocks, fit/not-fit blocks, risk notes, consult questions, no hard booking pressure, and clean rendered tables.
- Candidate canary is not enough after writer or repair changes. At least one generated canary sample must also pass `evaluateBlogGeneratedQualityCanary()`, which combines `evaluateBlogEngineV2()`, `inspectBlogCustomerQuality()`, and `inspectRenderedBlogIntegrity()`. A generated sample is pass only when all three are clean and the combined score is exactly 100.
- Generated canary proof must cover both writer paths. If recent published rows do not include a product-backed post, diagnostics and admin health must build a non-publishing dry-run sample from `blog_topic_queue.product_id` + the registered `travel_packages` row and run the same engine/customer/render checks. This prevents the system from claiming overall blog quality when only information posts have been proven.
- Generated canary volume should track the daily target, capped at five samples per run. For the current 5/day policy, diagnostics and admin health must request five generated samples rather than stopping at the old three-sample minimum.
- Product writer templates use `product-template-v4`. Customer-facing copy must be natural Korean, not prompt residue or encoded text. The product dry-run canary is expected to include price/from-city/duration opening, included/excluded, fit/not-fit, price-change risk, consult questions, official links, and bottom consultation links without inventing facts outside the product DB.
- Generated canary quality must include fleet phrase-drift checks across the selected recent/dry-run samples. Individual posts can pass engine/customer/render checks and still warn or block if the fleet repeats the same opening signature, H2 order, CTA sentence, or generic "first check budget/movement/local condition" formula. Repeated generic opening formulas are a block because they make the whole blog read like automated SEO copy.

## Blocking Rules

The post must not be published when any of these are true:

- The quality gate fails after repair rounds.
- `customer_quality` fails because the post still has AI-like generic openings, weak answer-first paragraphs, duplicated product price suffixes such as `원부터부터`, repeated consultation placeholders, placeholder destination copy, unsupported internal data claims, early hard CTA in information posts, or table render risk.
- `generation_meta.content_brief` is missing, failed, or contradicts the raw topic/search intent.
- The information intent contract has an invalid destination entity, a missing required slot, or customer-visible internal operational data.
- `generation_meta.content_brief.requires_human_review=true` and the item has not completed human review and a fresh explicit publish action.
- SERP/free-intent evidence is presented as ranking proof when it came from autocomplete fallback.
- `topic_fit` fails because the topic is a machine slug, placeholder, weak travel intent, or bad destination/intent combination.
- `editorial_quality` fails because the article contains placeholder text, visible prompt/writing-rule residue such as `규칙 A (감각 디테일)`, broken Korean particles, excessive highlights, generic image context, or machine-looking slug/title.
- SEO score fails after metadata repair.
- The slug is weak, generated-looking, numeric-leading, or hash-suffixed.
- Render integrity fails.
- Structure integrity fails.
- `accent_density` fails because highlight markup exists, numeric emphasis is excessive, heading counts are excessive, or paragraph walls remain.
- `table_integrity` fails because a Markdown table is missing a separator row, has inconsistent cells, or is too short to be useful.
- `cta_destination_integrity` fails because a package CTA has an empty or mismatched destination parameter.
- A product-backed post references a package whose unified `customer_open_contract` fails or whose `registration_evidence_pack_v1.downstream_eligibility.blog_publish` is false.
- Readability has repeated phrase spam that cannot be repaired.
- The article has no usable image path or missing image alt evidence.
- The article has no internal CTA and no official external reference.
- The candidate was produced by deterministic information fallback.
- Customer-visible copy contains active-product counts, product inventory counts, booking/consultation signals, or other internal operating values.
- Canonical URL, sitemap URL, and stored slug disagree.
- Public article links contain localhost, 127.0.0.1, 0.0.0.0, or any non-public HTTP origin. Product CTA links must use the blog canonical public origin.

SEO score alone is not a publish success signal. A post is complete only when topic fit, editorial quality, render integrity, image quality, SEO, readability, indexing enqueue, and later visibility observation all have durable evidence.

## Customer Writing Contract

Automatic publishing must optimize for a reader who is deciding what to do next, not for a template that only looks SEO-complete.

Required writer split:

- `info_writer`: answer the reader's search intent first. The first 120-200 characters must contain a concrete answer, question, comparison, price/time/weather/document trigger, or checklist direction. Product or consultation CTA appears only near the bottom and must be soft.
- `product_consultant_writer`: help the customer make a pre-inquiry decision. The post must show price/from-city/duration, included/excluded items, fit/not-fit, risk notes, price-change conditions, and questions to ask before consultation.
- Public-render table contract: information posts whose public title/body implies cost, budget, weather, itinerary, checklist, visa, currency, or expense must contain at least one renderable Markdown table with a separator row and three or more body rows before publish. Pseudo-table prose such as `식사 종류 / 비용 / 특징` is not enough because the public renderer will expose it as plain text and fail the customer scan task.

Forbidden customer-visible patterns:

- Generic openings such as "답부터 말하면, 20XX년 X월 기준..." or "먼저 볼 것은 예산 범위, 이동 순서, 현지 확인 사항입니다."
- Product copy that says only "상담에서 최종 확인" repeatedly instead of giving a useful condition to check.
- Duplicate price suffixes such as `1,369,000원부터부터`.
- Broken Korean/encoding residue such as mojibake characters (`�`, `媛`, `諛`, `留`) in customer-visible body must fail customer quality. A post that customers cannot read is never a near-pass, even when SEO, headings, and links look complete.
- Weather or packing guides that open with cost/reservation copy instead of temperature, rain, clothing, and packing decisions.
- Product posts that invent hotel names, fixed benefits, scarcity, or confirmed schedules not present in product evidence.
- Repeated answer-first hooks, duplicated CTA/FAQ blocks, duplicate hashtags, generic customer labels such as `여행 정보를 볼 때` when a destination is known, and placeholder surfaces such as `현지 관련 상품` or `상품 가격 변동_PKG`.

Backfill and live publishing must use the same customer contract. `scripts/backfill-blog-quality.ts` should repair customer-visible copy and then run the full publish evaluator; a dry run with `qualityGateFailed=0`, `publishBlocked=0`, and `minorOnlyIssues=0` is the target for "100점" recent-post evidence.

For recent-post stabilization, the stronger target is `changed=0`, `qualityGateFailed=0`, `publishBlocked=0`, indexing worker success for every changed row in write mode, and diagnostics that still report publish preflight pass, publishable candidate inventory, and indexing outbox coverage.

## Informational Related-Link Contract

New informational-engine articles use their persisted destination, intent, audience, locale, and editorial-cluster metadata for both publish-time interlinks and public related-post surfaces.

Ranking priority is:

1. same destination with the same or an adjacent intent;
2. same country, then same region, with the same intent;
3. the same non-general audience;
4. an explicit editorial pillar/cluster relationship.

Candidates must be published, indexable, non-redirecting, self-canonical, locale-compatible, and different from the current URL. Duplicate slugs and repeated anchor text are removed. When no candidate meets the relevance threshold, the correct result is no related link; unrelated recent posts must not be used as filler. Product-backed and legacy posts retain their current link behavior unless they carry a valid informational representative identity.

## Informational CTA Contract

Informational writers must not generate CTA sections, package links, consultation links, community links, or external CTA URLs in article Markdown. Publish preparation and the public renderer both strip legacy sales CTA anchors. The public renderer owns CTA selection through the typed keys `NAVER_CAFE`, `DEAL_ROOM`, `CONSULTATION`, `RELATED_ARTICLES`, and `OFFICIAL_SOURCE`.

- One primary CTA is allowed, with at most one secondary CTA. Bottom placement is the default; a mid-article placement, if explicitly selected later, is limited to one CTA.
- Selection uses persisted intent, destination, risk level, and locale. Entry/visa and insurance content puts a pinned official-source URL first when available, may show a related article second, and never shows a sales-oriented external CTA.
- External URLs are disabled unless they are HTTPS and pass the centralized host/provenance allow policy. `NAVER_CAFE_ID` alone is not treated as a proven public CTA URL.
- When every external URL is missing or invalid, only a contextual internal related-article CTA may render. If that route is also invalid, the CTA hub is absent.
- External links open in a new tab with `noopener noreferrer`; all CTA links remain keyboard reachable and mobile-safe.
- Informational CTA `impression` and `click` events use a dedicated same-origin endpoint. The browser sends only an ephemeral idempotency key, `article_id`, `event_type`, `cta_key`, and `placement`; the database derives representative dimensions and stores only a hash of the key. No session/user/visitor ID, URL, UTM, free-form metadata, IP, user agent, booking data, or product repository data is stored. Events are deduplicated and rate-limited, and telemetry failure never blocks navigation.

Runtime settings are `BLOG_NAVER_CAFE_URL`, `BLOG_DEAL_ROOM_URL`, and optional `BLOG_CONSULTATION_URL`; consultation may reuse a valid existing `KAKAO_CHANNEL_ID`. Missing settings mean disabled, never a guessed or hardcoded fallback.

## Indexing Contract

Publishing and external indexing submission remain separate responsibilities. For informational content, the durable indexing outbox row is created atomically with the public article state and representative activation.

Correct sequence:

1. Publish only after all gates pass; for informational content, the article, canonical representative, publication audit, and indexing outbox commit in one transaction.
2. Revalidate `/blog`, `/blog/[slug]`, and the blog list tag.
3. Product/legacy paths enqueue a durable `blog_indexing_jobs` row through their existing flow; informational atomic publication already guarantees this row before the public transaction commits.
4. Blog indexing URLs must be canonical `https://www.yeosonam.com/blog/{slug}` URLs. `BLOG_CANONICAL_ORIGIN` is the first-choice origin, and queued job URLs are canonicalized again before provider submission.
4a. Search Console performance collection must prefer the canonical `https://www.yeosonam.com/` URL-prefix property, then try configured/apex/domain-property fallbacks. A zero-row apex property must not be treated as zero blog traffic until canonical `www` has also been checked.
5. The existing `/api/cron/blog-publisher` schedule drains due indexing jobs through `processDueBlogIndexingJobs()`, and the GitHub external cron fallback calls `/api/cron/blog-indexing-worker` independently after publisher slots. Indexing must not depend on a successful publish run.
6. The worker submits sitemap through Google Search Console API or keeps it discoverable in `robots.txt`.
7. The worker submits changed URLs through IndexNow batch endpoints when `INDEXNOW_KEY` is configured.
   The same key must be publicly verifiable at `https://www.yeosonam.com/{INDEXNOW_KEY}.txt`; the app serves this only when the requested root `.txt` path exactly matches the configured key.
8. The worker records provider-specific results in `indexing_reports` and visibility snapshots.
9. Observe Google status through URL Inspection within quota.

IndexNow submissions must be duplicate-aware and provider-safe:

- The runtime caches recently submitted update URLs for 10 minutes by default (`INDEXNOW_RECENT_TTL_MS`) so repeated publisher/worker runs do not burn provider quota on the same canonical URL.
- `URL_DELETED` notifications bypass the recent-submit cache and must still be sent.
- Batch submissions are split by `INDEXNOW_MAX_URLS_PER_REQUEST` and provider calls are spaced by `INDEXNOW_PROVIDER_MIN_INTERVAL_MS`.
- If IndexNow responds with `Retry-After`, the worker must persist that evidence in `indexnow_retry_after_ms` and schedule the next durable outbox attempt no earlier than the provider's requested backoff.
- When `INDEXNOW_KEY` is configured, a failed IndexNow provider submission must not be hidden behind a successful Google sitemap hint. The outbox job remains retryable until IndexNow succeeds, is cached from a recent successful attempt, or exhausts `max_attempts`.

The durable blog outbox worker must not depend on legacy unauthenticated sitemap ping or WebSub calls for success. Those calls may exist only as explicit manual/backfill compatibility behavior, not as the normal `/blog` indexing success path.

Google sitemap submission is a hint, not a guarantee of indexing. Google no longer supports the old unauthenticated sitemap ping as the core path. URL Inspection is for status visibility and troubleshooting, not bulk indexing guarantees.

URL Inspection sampling must be quota-aware:

- The sampling cron must cap per-run inspection volume and also look at recent `indexing_reports` evidence before calling Google.
- Default internal caps stay below Google's public Search Console URL Inspection quotas: 25 per run, 100 per 10 minutes, and 1,500 per 24 hours.
- If the rolling budget is exhausted, the cron must skip URL Inspection and return `inspection_skipped_quota=true` with `inspection_quota` details instead of treating the skipped sample as publish/indexing failure.
- If Google returns a quota or rate-limit response during a run, the cron must stop additional URL Inspection calls for that run and surface `inspection_stopped_by_quota=true`.

Publishing routes must not call external indexing providers directly. They may only enqueue `blog_indexing_jobs`; retries and evidence persistence belong to the worker.

Every published slug must be observable in the indexing outbox. Treat these as separate failure classes:

- `indexing_outbox_missing`: a published slug never reached `blog_indexing_jobs`.
- `indexing_queue_error`: a durable job exists, but the worker/provider submission is pending, retrying, or failed.

Outbox coverage checks must compare recent published `content_creatives` rows with recent `blog_indexing_jobs` rows by `content_creative_id`, `slug`, or canonical `/blog/{slug}` URL. Queries over `blog_indexing_jobs` must be ordered by newest `updated_at` before applying a limit, otherwise large historical success tables can hide fresh jobs and create false alarms.

## Public Section Contract

The public blog is a topical cluster, not just a chronological list.

Required public surfaces:

- `/blog`
- `/blog/[slug]`
- `/blog/destination/[dest]`
- `/blog/angle/[angle]`
- `/sitemap.xml`

Rules:

- All public blog surfaces must use the shared canonical origin helper, `resolveBlogCanonicalOrigin()`.
- `/blog` destination guide cards must link to `/blog/destination/{dest}`, not the general `/destinations/{dest}` page. General destination pages can still exist, but blog destination pages carry the blog topical cluster.
- `/blog` destination sections should use site-wide active destination evidence (`active_destinations`) and only fall back to current-page posts when DB reads are unavailable.
- Destination and angle pages must use the same image display helper as the main blog list, so Supabase/remote images are normalized consistently.
- Sitemap must include blog destination and blog angle collection URLs when corresponding published posts exist.
- `/blog` list cache revalidation must not turn a transient DB timeout into a production error log or a silent empty list. If the primary list query times out, the page should serve last-good or Korean fallback content and record the event as degraded telemetry, not as a published-post count of zero.

## Decision-grade itinerary contract (2026-08-17)

- A published-article upgrade must preserve an explicit `N박M일` duration found in the existing title, slug, or body. The duration becomes part of the new queue topic and primary decision instead of being collapsed into a generic travel schedule.
- An explicit-duration itinerary must contain every numbered travel-day block (`1일차` through `M일차`). A durationless itinerary must contain at least two distinct named-place time blocks or route options.
- Each explicit travel day must have exactly one independent H2. Combined headings such as `1일차와 2일차` and duplicate alternatives such as a second `2일차 대안` fail the itinerary artifact gate even when every ordinal appears somewhere in the body.
- Every itinerary block must name an entity that exists in the validated research claim packet. `시작/중간/마무리`, booking reminders, rest reminders, or fallback reminders without named-place blocks are planning boilerplate and fail `concrete_itinerary_blocks_missing`.
- Itinerary research requires an actual schedule, booking/admission condition, stair/elevator access condition, seasonal restriction, closure, or service interruption. A bare ticket price, fare, physical dimension, or route distance cannot satisfy this semantic requirement.
- The writer may propose an editorial order for evidence-backed entities, but must not turn separate duration claims into an unsupported proximity, same-origin, compatibility, or official-route claim.
- These are expression/structure failures eligible for a bounded DeepSeek rewrite only when the persisted research packet and claim ledger remain valid. They never weaken factual, duplicate, language, or publication gates.

### Editorial-plan versus factual-claim boundary

- A query duration (`N박M일`), a numbered day heading, an article-scope sentence, an explicitly labelled proposed order, and a contingency heading are editorial structure, not external facts by themselves.
- A duration, fare, price, operating time, distance, availability statement, regulated condition, or other measurable assertion inside those same sections remains a factual claim and must match the structured claim ledger exactly.
- Risk classification is fail-closed at the deterministic boundary. Entry/visa, insurance, policy, and customs claims have a `HIGH` floor; price, currency, duration, schedule/time, climate, percentage, quantity, availability, requirement, and measurable-superlative claims have at least a `MEDIUM` floor. A research or writer model may raise this risk but may never downgrade it. A downgraded writer ledger is invalid rather than silently normalized.
- Korean place names in itinerary blocks may be recognized from validated claim subjects and the `에서/까지/으로` boundaries. The destination name alone never counts as a decision-grade entity.
- A normal rewrite may select at most six approved claims. An itinerary or route rewrite may select at most eight when the validated packet contains decision-relevant evidence; the extra allowance must be used for named daily stops, movement, operating constraints, booking checks, or fallback decisions rather than decorative dimensions.
- Standalone landmark dimensions such as bridge length, statue height, altitude, and road length are excluded from an itinerary rewrite when at least three movement/operation/access claims are available. Day blocks may contain at most one evidence-checking meta instruction; repeated `확인한 뒤/비교한 뒤 결정하세요`, `가장 안전`, `최적`, and generic completion conclusions are rewrite failures rather than information gain.
- A rest decision and a disruption fallback must exist in visible body sentences, not only headings. One named day/place block must explicitly leave rest time, drop an optional block, or shorten the sequence; a separate fallback sentence must name rain/closure/delay and the named block to remove, postpone, advance, or replace. A bare `체력` mention or `우천·휴무 대체 동선` heading does not satisfy the decision artifact.
- Every explicit day block must pair a research-backed named entity with a distinct reader action. Repeating a generic imperative or merely mentioning `체력` does not satisfy the rest requirement. The article must state a concrete rest, omission, shortening, or schedule-spacing decision.
- Flexible V3 articles may use descriptive sections instead of a table, FAQ, or checklist. Scanability is satisfied by short, meaningful sections; no evaluator may force a content asset solely to raise a legacy readability score.
- Comparison content still needs situation-to-choice criteria, but the criteria may be expressed as prose sections, cards, lists, or tables according to intent and evidence.
- A private candidate remains `pending_review` even after a high aggregate score when manual evidence inspection finds that it passed through shallow proxies such as a bare stamina word, under-classified dynamic facts, or incomplete use of an otherwise sufficient evidence packet. Aggregate score never authorizes a public replacement by itself.

## Daily Verification

### Evidence-asymmetric airport transport articles (2026-08-31)

- A route title may promise only the fields that the approved packet actually contains. When GRTA has fare/schedule evidence but the taxi packet has only luggage/delay handling, the title must name those asymmetric fields instead of promising a symmetric time/cost comparison.
- A route number is a numeric surface. Outside an exact approved claim sentence, editorial prose uses the operator name without the route number. Schedule words such as first/last service also stay out of headings unless the heading itself is evidence-backed.
- Operator-reported nonnumeric service statements such as flight-delay handling remain factual claims. They may enter a rewrite only when the exact sentence passed literal-source support and deterministic factual-type compatibility, and they must appear once in the visible body and ledger.
- Reader-owned instructions that begin from the choice, boarding, middle segment, or alighting action may remain source-neutral. They must not assign an unapproved property, status, advantage, fare, or duration to an operator.
- Informational duplicate checks must preserve `micro_angle` through the aggregate publish-quality boundary. A recent `food_budget` post must not block a distinct `airport_arrival` article merely because both use the broad `value` angle.
- A Guam `airport_transport` research run performs one focused second fetch for any missing critical reviewed URL: GRTA schedule, GRTA fare sheet, Guam Airport ground transportation, Guam Visitors Bureau transportation, and the Kakao T Guam taxi FAQ. The retry never expands beyond registry-approved URLs. Successful runs persist the requested/recovered retry counts and direct-fetch failure count.
- When all ten required route facts are approved, the public airport-route body is code-owned. It discards model-authored route prose and renders only the approved GRTA fares/durations/first departure, taxi meter and airport-counter facts, Tumon transit coverage, Kakao T luggage/delay facts, and explicit evidence gaps. Unapproved clock times, durations, pickup locations, and availability claims cannot survive this boundary.

Run:

```bash
npm run audit:blog-quality -- --limit=50
npm run audit:blog-search-daily:strict
npm run audit:blog-render:browser -- --base=https://www.yeosonam.com --json --strict
npm run audit:blog-public-customer-quality -- --base=https://www.yeosonam.com --limit=10 --browser --strict
npm run audit:blog-images -- --base=https://www.yeosonam.com --json
npm run audit:blog-seo -- --base=https://www.yeosonam.com --json
npm run audit:blog-public-surfaces -- --base=https://www.yeosonam.com --strict
npm run diagnose:blog-autopublish -- --json
```

Failure policy:

- Any non-slug quality failure blocks the “healthy” status.
- Any public customer-quality failure blocks healthy status even when DB quality, render integrity, SEO, and public URL checks pass. This audit catches reader-visible defects such as broken table surfaces, generated instruction residue, duplicate headings/sections, early hard CTA in information posts, unsupported internal-data claims, and AI-cliche tone.
- Any recent published post missing a durable indexing outbox job blocks healthy status as `indexing_outbox_missing`.
- Any public blog section with a missing/mismatched canonical URL, duplicate brand title, noindex, DB-unavailable fallback, or missing blog collection sitemap entry blocks healthy status.
- Indexing provider success below 80% creates an admin alert.
- `generating` rows older than 30 minutes must be recovered or quarantined.

## Remaining Hardening Work

Priority 1:

- Extract a shared `prepareBlogForPublish()` helper so every publish path uses the same repair/evaluation contract. Done for direct publish paths on 2026-06-15:
  - `src/app/api/blog/route.ts`
  - `src/app/api/content-queue/route.ts`
  - `src/app/api/content-hub/publish/route.ts`
  - `src/app/api/blog/mrt-hotel-ranking/route.ts`
  - `src/app/api/cron/blog-regenerate-zero-click/route.ts`
  - `src/lib/social-publishing/distribution-publisher.ts`
- Indexing outbox implemented on 2026-06-15:
  - Migration: `supabase/migrations/20260615150000_blog_indexing_jobs.sql`.
  - Enqueue helper: `src/lib/blog-indexing-outbox.ts`.
  - Worker core: `src/lib/blog-indexing-worker.ts`.
  - Independent endpoint: `src/app/api/cron/blog-indexing-worker/route.ts`.
  - Scheduler: existing `/api/cron/blog-publisher` drains due indexing jobs, and `.github/workflows/blog-external-cron.yml` runs `blog-indexing-worker` through the custom domain after publisher slots to avoid coupling indexing to publisher health.
- Slug migration and recent-post quality backfill completed on 2026-06-15 after redirects and indexing worker were live:
  - `npx tsx scripts/migrate-blog-slugs.ts --write`
  - `npm run audit:blog-quality -- --limit=50 --write`
  - `npm run audit:blog-quality -- --limit=50`
  - Final dry-run result: `changed=0`, `qualityGateFailed=0`.
  - Indexing outbox result: `active=0`, `succeeded=112`.
- Latest 10-post follow-up on 2026-06-15:
  - Five latest machine slugs were migrated to reader-facing slugs.
  - Nine repairable recent posts were backfilled and re-indexed.
  - `shijiazhuang-itinerary` was archived instead of repaired because `석가장 신혼여행` is a blocked destination/intent mismatch.
  - Final dry-run result: `changed=0`, `qualityGateFailed=0`.
  - Active indexing queue: `0`.

Priority 2:

- Split sitemap into blog/package/destination sitemap files if URL count or update cadence grows.
- Add canary generation: publish three low-risk topics to draft/preflight, verify gates, then publish.
- Add daily admin summary fields for non-slug failures, slug failures, indexing failures, and stuck queue rows.

Priority 3:

- Airport-transport research may use reviewed official-tourism sources in addition to airports and transport operators. For the Guam controlled canary, the source registry includes the Guam Visitors Bureau transportation page for regulated meter rates and Tumon transit coverage. Guam Airport remains the authority for the West Arrivals taxi-counter location; GRTA remains the authority for its own fares and timetable. Missing door-to-door duration or exact GRTA boarding location must remain an explicit evidence gap.
- URL Inspection sampling with quota-aware backoff was added on 2026-07-04:
  - Helper: `src/lib/gsc-url-inspection-quota.ts`.
  - Cron integration: `src/app/api/cron/gsc-index-rank/route.ts`.
  - Test: `src/lib/gsc-url-inspection-quota.test.ts`.
- IndexNow retry/cache/rate-limit behavior was hardened on 2026-07-04:
  - Runtime cache and provider spacing: `src/lib/indexing.ts`.
  - Provider `Retry-After` propagation: `src/lib/indexing.ts`.
  - Durable retry scheduling: `src/lib/blog-indexing-worker.ts`.
  - Tests: `src/lib/indexing.test.ts`, `src/lib/blog-indexing-worker.test.ts`.
- A dashboard card for publish health versus indexing health was added on 2026-07-04:
  - UI: `src/app/admin/blog/system/page.tsx`.
  - Contract test: `src/app/admin/blog/blog-admin-ops-ui-contract.test.ts`.
- Candidate pre-publish readiness was hardened on 2026-07-04:
  - Shared contract: `src/lib/blog-candidate-prepublish-contract.ts`.
  - Publishable inventory and canary preflight now exclude candidates with banned editorial cliches, machine separators, numeric-leading slug risk, weak expected slugs, or destinationless broad recommendation topics.
  - Publisher preflight can quarantine these rows with `failure_code='candidate_pre_publish_contract'` before claim.
  - Production-data dry run showed publishable candidates `67 -> 49`, `candidate_contract_blocked_count=18`, canary still mixed with one info writer and two product consultant writers, and indexing outbox coverage remained 100%.
