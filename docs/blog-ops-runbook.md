# Blog Ops Runbook

> 2026-08-30 V5 override: 신규 정보성 후보는 `decision_artifact_v1`과 `editorial_harness_v5`가 모두 있어야 자동발행할 수 있다. 일일 운영자는 `npm run eval:blog-editorial:promptfoo`의 33/33, 새 승인 attempt의 prompt trace 완전성, queue-only 편집 평가 저장, generation/editorial_judge 비용 원장을 함께 확인한다. 심사 실패를 평균 품질 점수로 상쇄하거나 수동으로 `approved_for_slot`으로 바꾸지 않는다.

> 2026-08-16 release override: DeepSeek-only 연구 구조화·초안·재작성, 비용 예약, `pilot_3→ramp_10→max_30` 자동 승격/강등, immutable snapshot, 90일 GSC 보강, 분석 canary, 배포·롤백 순서는 `docs/runbooks/blog-orchestrator-v4-production-rollout.md`와 `docs/runbooks/blog-deepseek-orchestrator-v4.md`가 우선한다.

> 2026-08-15 V4 override: 신규 운영은 `docs/runbooks/blog-deepseek-orchestrator-v4.md`의 생성/공개 분리 계약을 따른다. `blog-generate`는 KST 01:05~06:05 계산 전용이고 `blog-publication-controller`는 KST 09:05/12:05/15:05/18:05/21:05 공개 전용이다. 아래 `blog-publisher` 직접 공개·22:05 catch-up 설명은 V4 이전 사고 기록이며 신규 스케줄 근거로 사용하지 않는다.

> 2026-08-13 V3 override: `backfill:blog-quality:write` was removed. The legacy backfill creates article text, so `--write` and `--apply` now fail before any database mutation. Commands below that include the old write flag are historical verification records only.

Last updated: 2026-08-30

This runbook defines how operators decide whether the Yeosonam blog automation is healthy. The durable publish contract remains `docs/blog-autopublish-contract.md`; this file explains the daily operating workflow shown in `/admin/blog`.

Information Engine V2 CTA setup, high-risk approval, fixture evaluation, existing-post dry-run, staging order, and rollback are handed off in `docs/blog-informational-engine-v2-owner-runbook.md`.

## People-First V5 daily checks

1. `npm run eval:blog-editorial:promptfoo`가 33/33인지 확인한다.
2. `blog_generation_attempts`의 새 `approved_for_slot` 행에서 `prompt_hash`, `brief_hash`, `claim_packet_hash`, `prompt_template_version`, `git_commit_sha`가 모두 존재하는지 확인한다.
3. `blog_quality_evaluations.evaluator_version='blog-editorial-harness-v5.0.0'`의 최신 행이 `passed=true`이고 다섯 semantic dimension이 모두 true인지 확인한다.
4. `blog_ai_budget_reservations`를 `call_kind`로 나눠 generation과 editorial_judge 모두 사전 예약·정산됐는지 확인한다.
5. `source_label_misleading`, `reader_task_unanswered`, `commodity_source_stitching`, `semantic_judge_missing`, `evaluation_persistence_failed`는 재작성 1회 뒤에도 남으면 quarantine이 정상이다.
6. HIGH risk는 편집 심사 통과 여부와 무관하게 사람 승인을 유지한다.

기존 공개 글 격리는 `docs/runbooks/blog-stale-content-and-removal.md`를 따른다. CSV의 정확한 creative ID·canonical·reason을 두 사람이 검토하고 PITR를 확인하기 전에는 `--apply`를 실행하지 않는다. 교정본이 공개 가능해진 뒤에만 색인 outbox를 enqueue한다.

V5 DB 릴리스는 저장소 루트의 migration history drift 때문에 직접 `supabase db push`하지 않는다. 다음 고정 경로만 사용한다.

```powershell
npm run verify:blog-editorial-release-v5
npm run prepare:blog-editorial-supabase-release-v5 -- --output=.tmp/blog-editorial-v5-supabase-release
npx supabase db push --workdir .tmp/blog-editorial-v5-supabase-release --linked --include-all --skip-vault --dry-run
npm run verify:blog-editorial-supabase-dry-run-v5 -- --input=<captured-dry-run.txt>
```

exact-set 결과가 `20260830011340` 한 개가 아니면 중단한다. 원격 migration history `repair`는 하지 않는다. 실제 apply는 리뷰된 main SHA와 change window를 확정한 뒤 동일한 격리 workdir에서만 실행한다.

## Future Blog Generation Duplicate Gate

As of 2026-08-29, all new blog-generation entry points use the
`blog-generation-dedup-v1` gate before inserting `content_creatives`. This is a
forward-only control; it does not mutate existing articles, and image handling
is intentionally unrelated.

- `BLOCK` means the normalized title, exact title, or slug is already claimed
  by an active generation/content row. Direct APIs return `409`; the automatic
  publisher records a non-retryable duplicate disposition. Do not retry the
  same payload unchanged.
- `REVIEW` means a same-destination, same-kind near-title collision. It may
  remain private review inventory, but it cannot be automatically published.
  Resolve it by changing the editorial intent or explicitly approving a
  genuinely distinct article; do not add a meaningless year/number suffix.
- A different destination can reuse general wording when its destination and
  evidence are genuinely different. It still must pass the information
  representative, research, quality, and SEO gates.
- The claim ledger uses a one-hour reservation lease. If a worker dies, the
  lease can be reclaimed; if content was persisted, the claim is bound to that
  creative. A failed insert releases the reservation. Concurrent attempts are
  settled by the database RPC, not by a best-effort application pre-check.
- Existing duplicate rows are only reported by the existing dry-run/audit
  tooling. No automatic rewrite, redirect, merge, deletion, or title suffixing
  is permitted as part of this rollout.

When diagnosing a new duplicate skip, inspect the generation metadata key
`generation_meta.blog_generation_dedup`, the route response reason, and the
claim owner before retrying. A stuck `reserved` claim older than its lease is
recoverable; an active `bound`/`review` claim should be resolved against its
linked creative rather than force-deleted.

## 2026-07-28 Root-Cause Controls

- Publishing is measured against cumulative KST slots, not the whole daily quota at the first invocation. With the five-post policy, the due totals are `09:00=1`, `12:00=2`, `15:00=3`, `18:00=4`, and `21:00=5`. `dailyQuota.remainingAfterRun` is the due-now retry signal; `remainingDailyAfterRun` is monitoring data.
- Exact slug collisions remain global because two public rows cannot own the same URL. Fuzzy slug-prefix duplicate checks are scoped to the same destination, and generic fallback prefixes such as `travel-preparation` are excluded from fuzzy matching. This prevents an unmapped new city from being skipped because an unrelated destination already used the same fallback family.
- When a destination first appears in the automatic queue, add its stable English form to `src/lib/slug-utils.ts`; the generic fallback is only an availability backstop, not the preferred SEO URL. A slot rejected by duplicate QA still leaves `dailyQuota.remainingAfterRun > 0` and must be replaced by the same-run claim loop or the next forced scheduler/publisher retry.
- A candidate is not publishable when any scored quality component is below 95. Do not normalize, average, or round a weak component into a pass. Engine V2 categories still require 100.
- For entry, visa, immigration, or travel-insurance posts, inspect the zero-weight `information_freshness` SEO component as a hard gate. Missing versioned research, reviewed official URLs, supported claims/evidence, 90% coverage, human-review-required claim validation, or a research completion time within 45 days caps the aggregate at 79. Do not raise the score manually; refresh official evidence and then complete human review.
- Bayesian learning uses `publishing_policies.scope='global'` and `meta.adaptive_thresholds`. Treat a database read/write error or a missing global row as `applied=false` and alert on it.
- The editorial backlog may requeue a row only once for one recheck version. `repeat_suppressed` means the source defect still exists and must be repaired before the recheck version is advanced.
- Reviewed secondary registries cover additional low-risk intents, but their values must be labeled as checked-date estimates and corroborated. They do not relax official-source or human-review rules for entry and insurance.
- A registry entry is not permanently trusted merely because editorial methodology was reviewed. Production direct-fetch availability is part of the contract: revoke a source after repeatable 403/blocked retrieval, record the failure in a forward migration, and do not feed its search snippet to the writer. On 2026-07-28 BudgetYourTrip was revoked for this reason; Wikivoyage food sections remain corroboration-only and require a second reviewed domain.
- The 2026-07-28 production audit found burst publishing after the first slot, weather-only recent output, repeated evidence failures in non-weather categories, and `publishing_policies.value` schema errors. These are distinct failures; meeting a raw count after a burst does not make the day healthy.
- Run `npm run verify:blog-auto-research:live -- --strict --concurrency 2` against the production registry before release. The suite now covers 11/11 supported intents, including destination-local transport separately from airport arrival. This proves current research readiness; it does not waive final writing, image, render, SEO, publication, or human-review gates.
- Read every live claim sample, not just the pass count. The 2026-07-28 review caught a stale secondary-source bus fare inside an otherwise passing family-budget row. The final control persists current GRTA family-budget documents, injects official fare samples, removes conflicting secondary transit fares, and preserves checked-date lodging, meal, transport, and child/family evidence within the 12-claim limit.
- Booking and restaurant prices are checked-date samples. They must state that dates, occupancy, taxes, inventory, menu availability, and final totals can change. They are never guaranteed quotes or destination averages.
- Scheduler research is intent-balanced: one row from each supported intent is attempted before repeated weather or budget rows. It must keep preparing until both the numeric buffer and a minimum of five distinct research-ready intents are present. Research runs in batches of at most three concurrent candidates and rechecks the targets after every batch. A network/time budget may limit attempts, but rows not attempted in that invocation remain queued. A `FUNCTION_INVOCATION_TIMEOUT` means the batching/runtime contract regressed; do not raise concurrency without a production proof.
- Run `npm run audit:blog-quality -- --limit=500` before any corpus write. Read `categoryScorecard`; a category below 95 is a regeneration backlog, not permission to beautify and republish unsupported facts. The 2026-07-28 full audit scanned 161 public rows: current `monthly_weather` passed at a 97-point floor, while nine legacy categories failed because their current research coverage was zero.
- The corpus audit must evaluate a passed, marker-backed research article from its stored public body, title, description, and generation metadata. Legacy repair helpers must not rewrite that article in memory, create a false category failure, or make it eligible for a backfill write; factual upgrades go through the atomic private-regeneration path.
- Recovery must select at most one row for a destination, intent, audience, and locale representative in each run. Every queued upgrade stores that representative key, and the active-row database index is the final concurrency backstop. If two legacy URLs represent the same monthly guide, upgrade the stronger canonical article, skip the duplicate queue row, and add a permanent redirect only after the target passes the live public audit.
- Preview the legacy recovery inventory with `npm run enqueue:blog-quality-upgrades -- --limit=500`. It should select only published informational rows missing a passed research preflight with non-empty source and evidence keys. Read `rejection_reasons`, `candidate_intent_counts`, `representative_duplicates_skipped`, and `same_run_duplicates_skipped`; a broad guide, conflicting slug/title, comparison, listicle, package, destinationless row, or high-risk intent must not enter automatic rewriting. Start a reviewed destination/intent batch with filters such as `--destination=보홀 --only=weather`; do not enqueue the whole corpus merely because it is topic-safe. Apply `--write` only after the same publisher version is deployed. Each row keeps its creative ID, slug, and original publication date; failed research or QA leaves the current public body intact, and a successful result is `upgraded`, not one of the five new daily publications. Once the five-post quota is already met, each regular publisher invocation processes at most one due upgrade.
- The eleven-intent live suite is an intent-contract test, not proof for every destination. Before releasing a destination batch, verify at least one current reviewed document for each destination/intent pair. On 2026-07-28 Cebu and Bohol gained destination-scoped PAGASA climate normals, Philippine Department of Tourism destination pages, and Bohol Provincial Tourism Office movement guidance. Parse the period inside a climate document: Mactan states 1991-2020, while Tagbilaran-Dauis states 1991-March 2013 despite its 1991-2020 folder path. Do not broaden those documents to nearby or similarly named destinations.
- Classify airport arrival separately from local mobility before research. Airport transport needs airport-to-city options plus luggage and late-arrival handling. Local transport needs named local routes, fares, duration or frequency, operating schedule, ticket/reservation method, seasonal or service limits, and official operator evidence. If a local-transit article fails an airport-only requirement, hold the queue row and repair taxonomy rather than asking the writer to fabricate airport sections.
- A live verification that observes another destination's reviewed URL is a source-routing failure even if the model returns valid JSON. Check `blog_information_official_research_documents.destinations`; local documents need explicit Korean and stable English aliases, while only genuinely global regulations may keep an empty scope.
- After `verify:blog-auto-research:live -- --strict` passes, preview a bounded recovery with `npm run recheck:blog-information-research -- --destination=괌 --limit=200`. Apply `--write` only after the matching code is deployed. The workflow requeues one row per dedup key and closes duplicates; it never requeues product evidence failures.
- The recheck scans both `failed` rows and scheduler-quarantined `skipped` rows. A skipped row is retryable only when `research_failed_at`, `research_issues`, and `evidence_insufficient` or `research_exception` agree; a generic editorial or quality skip remains blocked.
- Persisted `evidence_insufficient:auto_research_failed:*` variants, including `missing_sources` and `source_rejected`, are research failures for live-verified intents. The recheck may retry one representative per dedup key and must move all other active or published duplicates to `skipped`.
- When bounded concurrency is enabled, identical official-page downloads are shared only while they are in flight; completed pages are not cached across research runs. This prevents a three-candidate batch from tripling source load without turning a previous snapshot into current evidence. Shopping readiness must retain two official factual claims: the Made in Guam product seal and the named Chamorro Village purchase location.
- `npm run cleanup:blog-queue-health` also compares `published` queue rows with linked creative state. Review `linked_content_reconciled` in dry-run before `--write`; archived or missing creatives are changed to skipped queue history, not restored to public status.

## Daily Operating Standard

### Codex subscription cover worker

- Blog publication is never blocked by image generation. A deterministic managed cover is public first, and successful Codex work upgrades it later.
- The local Codex automation invokes `$blog-media-worker` at KST 09:15, 12:15, 15:15, 18:15, 21:15, and 22:00. One run claims at most one job.
- The worker uses signed-in built-in ImageGen allowance. It must not use `OPENAI_API_KEY`, the image API/CLI fallback, Pexels, or direct Supabase writes.
- The Codex app and the selected PC must be available at execution time. Missed runs are safe: the deterministic cover remains public and the durable job waits for a later run.
- Verify a run with `npm run media:codex-worker -- verify --job-id <uuid>` and confirm `approved` or `pending_review`, an HTTPS URL, provenance `codex_builtin`, and the public disclosure.
- Allowance exhaustion or missing artifacts must be recorded through the worker failure endpoint. Never change providers inside the same run.

A day is healthy only when all of these are true:

- `npm run audit:blog-public-customer-quality -- --base=https://www.yeosonam.com --limit=500 --min-score=95 --strict` completes the entire sitemap/API corpus with the hybrid public renderer. Review `categoryScores`: each category uses its minimum public score, so one weak article keeps that category below 95.
- A public customer audit failure is classified before repair. Rendering/duplication defects may use deterministic presentation cleanup; factual, freshness, intent, or evidence defects enter reviewed atomic replacement. Never raise a persisted score to close a public-render finding.
- The command uses fast server HTML for complete pages and automatically hydrates only unresolved streamed article bodies in Playwright. Review `hydratedFallbackCount`; do not replace this release check with `--html-only`, because raw Next.js stream placeholders can otherwise be misclassified as an empty article. Use `--browser` only when diagnosing a renderer discrepancy on every URL.
- The full public audit defaults to bounded concurrency 6 and two transient
  retries. Use `--concurrency=1` only for incident isolation; do not remove URL
  decoding before target deduplication. Confirm `checked` equals the unique API
  catalog count before accepting category results.
- Use `--browser` for release and corpus-quality decisions. Static HTML mode is
  only a fast transport smoke check because deferred Next.js Flight content can
  be absent from the parseable document until Chrome materializes the page.
- Do not classify a page as a broken table from horizontal-rule count or parent
  container text. Confirm three distinct compact row-shaped leaf blocks with at
  least three numeric cells, or visible leaked Markdown table syntax.
- Confirm the browser audit and nightly stored-body preflight agree on checked,
  passed, failed, and average score. Both must use the public body sanitizer.
  Exact long-block deduplication is safe presentation cleanup; near-duplicate
  factual sentences remain research/review work.
- Confirm both paths also share leading page-title/body-title deduplication. A
  one-row difference is a renderer-contract defect, not an acceptable margin.
- A detail page returning HTTP 200 with only its title or table of contents is a
  failure, not a healthy stale response. Check the versioned detail cache and
  `hasUsableBlogBody`; a low editorial score belongs to the recovery queue and
  must not force a database refresh on every reader request.
- If collection routes emit `BLOG_DATABASE_UNAVAILABLE`, compare the database execution time with request concurrency. A fast direct query plus clustered `/blog`, destination, angle, API, and sitemap misses indicates a catalog stampede. Verify every collection consumer uses `loadPublicBlogCatalog()` before increasing timeouts.
- `/admin/blog` shows the blog OS level as `정상` or an accepted `관찰`.
- Today's published count is at or above the global publishing policy target.
- `/admin/blog/queue` has no failed, overdue, or stale generating rows in `운영 필요`.
- `/admin/blog/system` shows `blog-publisher`, `blog-scheduler`, `blog-daily-summary`, `blog-indexing-worker`, `gsc-index-rank`, and `serp-rank-snapshot` as successful or explainably skipped.
- Published posts have current `quality_gate`, `seo_score`, `readability_score`, `generation_meta.content_brief`, final slug, title, description, and image evidence.
- New information candidates have `meta.auto_research.version='reviewed-source-direct-fetch-v2'`, a validated `information_research_bundle`, and persisted source/evidence/claim rows before the writer starts. Search discovers candidate URLs; only directly downloaded, intent-approved official or reputable source pages may become evidence. `evidence_insufficient:auto_research_*` is a research blocker, not a reason to publish fallback prose.
- For the Guam airport-to-Tumon canary, the reviewed packet must include GRTA Route 14 elapsed times and current fare rows, Guam Airport's ground-transport mode list, and Kakao T Guam taxi FAQ rows for baggage capacity and flight-delay handling. Fetch `https://service.kakaomobility.com/api/cs/v1/faqs/categories/44/contents?recordsPerPage=100&currentPageNo=1` directly as JSON. The visible `.../cs/faqs/content/?category=44` page is a client-rendered shell and is not the research document. Missing or changed source fields keep the candidate private.
- The source-complete airport-transport repair is recheck version `blog-information-research-recheck-20260831-v7`. V7 preserves the V5 GRTA-plus-Kakao multi-mode fallback, the V6 bounded rewrite queue fix, and adds a fail-closed recovery contract for an already-skipped controlled canary that still has its reviewed research bundle and explicit `rewrite_pro_high` state. Advance this value only with a newer deployed repair and matching regression evidence; the version change is what permits a previously exhausted canary to receive one bounded retry.
- When Engine V2 reports `evidence_faithfulness:35` even though a deterministic evidence article visibly contains approved operator links, inspect `generation_meta.information_research_preflight.official_source_urls`. It must be present only after a passed `r18-research-first-v1` preflight. Do not solve operator-domain gaps by widening the generic official-host heuristic; repair the reviewed research-preflight handoff and retain the final claim gate.
- If Engine V2 passes but `external_authority_links` still reports zero authority for the same deterministic article, verify that `computeSeoScore()` receives `generation_meta` in both publisher and shared publish-quality paths. The SEO scorer must consume the shared verified-source reader; do not add one-off operator domains to `AUTHORITATIVE_HOST_HINTS`.
- Public blog sections (`/blog`, `/blog/[slug]`, `/blog/destination/[dest]`, `/blog/angle/[angle]`, sitemap, blog API) return healthy titles, canonical URLs, indexability signals, and non-empty collection evidence.

## 2026-07-27 Publishable Buffer And Voice Rotation

- The publishable queue buffer is now three days of the daily target, not two. For the current five-post policy, operations should keep at least 15 evidence-ready publishable candidates.
- `blog-scheduler`, `blog-publisher`, `/admin/blog`, daily summary, and `diagnose:blog-autopublish` use the same buffer constant so operators do not see conflicting shortage states.
- Weather fallback candidates receive stable `editorial_variation` metadata with reader scenario, opening angle, and section-order variant. The information writer prompt must receive that block and keep the same evidence while varying the customer-facing opening and H2 order.
- Historical missed-day and timeout evidence remains visible, but it is not treated as an active critical blocker when the current KST day has met quota, the publisher is healthy, and publish preflight is not blocked. Candidate shortage remains a current warning instead of upgrading old SLA misses back to active risk.

## 2026-07-27 GSC Data And Improvement Loop

- Production defaults to DB resource-saver mode. The blog operating chain is
  not running merely because Vercel Cron returns HTTP 200: inspect the response
  for `skipped=true` and `reason=db_resource_saver_mode`. Set
  `DB_RESOURCE_SAVER_ALLOW_CRITICAL_CRONS=1` only for a verified release, then
  run `rank-tracking` → `blog-data-readiness` → `blog-publisher` →
  `blog-indexing-worker` → `analytics-delivery` and compare durable run logs and
  table counts. Keep `BLOG_AUTOPUBLISH_MODE=draft_only` for the first canary.
- Google Search Console search performance must prefer the canonical `https://www.yeosonam.com/` URL-prefix property, then fall back to the configured property, apex URL-prefix, and `sc-domain:yeosonam.com`.
- A zero-row response from `https://yeosonam.com/` is not proof that the blog has no traffic. Operators must compare the selected `siteUrl` returned by `rank-tracking` or `gsc-index-rank`.
- `rank-tracking` now writes query-level search rows and then runs the GSC longtail expander with a bounded timeout. This keeps the search-data -> topic-queue loop active without adding another Vercel cron.
- `rank_history` freshness is an operating dependency, not an optional dashboard detail. `serp-rank-snapshot`, `gsc-index-rank`, and `rank-tracking` have external retry schedules at 06:40, 11:40, and 12:10 KST. Their cron logging guards must remain below the route's serverless limit but above the measured handler runtime; a 45-second generic guard is invalid for the two five-minute routes.
- If `rank-tracking` reports `ON CONFLICT DO UPDATE command cannot affect row a second time`, the GSC response was not grouped by the durable key before upsert. The current route must aggregate duplicate `(slug, query)` rows, recalculate CTR, and store one canonical www row. Do not retry the unchanged batch.
- At 21:45 KST Vercel and 21:50 KST the external scheduler call `blog-regenerate-zero-click`. It is part of the critical-blog-cron allowlist and runs during DB resource-saver mode only when `DB_RESOURCE_SAVER_ALLOW_CRITICAL_CRONS=1`. The route queues no more than two published in-place upgrades. Google zero-click priority applies only to `gsc`/`gsc-page` rows and articles published at least 14 days ago; Naver/Serp rows are rank observations, not impression evidence. When mature Google data is absent the route falls back to missing-research legacy posts, while preserving explicit-intent classification, representative ownership, high-risk review, cooldown, and atomic replacement gates.
- Before applying those search fallbacks, the route renders the current public
  bodies with bounded concurrency and prioritizes any score below 95, lowest
  first. Read `public_quality_audited`,
  `canonical_redirect_candidates`, `public_quality_gap_candidates`, and the queue metadata
  `quality_upgrade.public_customer_quality` when diagnosing why a row was
  selected.
- `canonical_redirect_candidates` are published rows intentionally omitted from
  recovery because their public URL permanently resolves to a live-audited
  representative. Verify that every target still returns 200, has a
  self-canonical URL, and scores at least 95 before adding or retaining a
  mapping. The redirect source must not appear in `/api/blog` or `sitemap.xml`.
  Never redirect a month-specific article to a body that answers only another
  month; the accepted target must be the destination's researched 1-12 month
  representative.
- If every safe recovery candidate fails with `blog_regenerate_log_reason_check`, compare the producer's selection sources with the live check constraint before retrying. `quality_gap` is a valid automatic reason, and the automatic daily unique index must cover both `zero_click` and `quality_gap`; do not substitute a misleading legacy reason merely to bypass the database contract.
- If all 12 monthly weather claims fail with `normalized_value_mismatch,unit_mismatch`, inspect the stored weather bundle before retrying. A legacy WMO payload may have retained only highest temperature with unit `°C`; the current readiness path must normalize all four values to the composite climate contract before persistence and claim validation.
- `research_coverage_missing` is a healthy fail-closed result for published-post recovery. Add and live-review destination-scoped first-party documents before retrying; never broaden a regional document to an entire country merely to make generation proceed.
- `/api/content-analytics` enriches ROAS rows and fallback published rows with `search_clicks`, `search_impressions`, `search_ctr`, `search_position`, `search_opportunity_score`, and `improvement_action`.
- The improvement queue uses four actions: `title_meta_ctr_repair`, `intent_answer_refresh`, `expand_winner_cluster`, and `content_depth_refresh`. These are the first repair candidates before regenerating more generic topics.

## Prompt Change Standard

Information-writer prompt changes are release changes, not copy edits.

1. Run `npm run eval:blog-prompt-v2`. All 10 information intents must score 100 with no legacy instruction conflict.
2. Run `npm run eval:blog-info-v2`. All planner, evidence, structure, claim-ledger, render, and publish-eligibility fixtures must pass.
3. Run the focused prompt, editorial, image, and claim-ledger tests plus `npm run type-check`.
4. After deployment, generate only a private canary first. Confirm its `generation_meta.prompt_manifest.contract`, digest, size, warnings, and all normal content gates.
5. Do not publicize the canary merely because the prompt evaluation passed. Public release still requires the normal evidence, review, rendering, SEO, image, and indexing contracts.

The repository prompt is the safe baseline. A database override in `prompt_versions.domain='blog_info_writer_guide'` is accepted only when its semantic version is current and its required priority, factual-safety, people-first, output, and claim-ledger markers are intact. Invalid overrides automatically fall back to the repository version.
- New or changed published URLs are enqueued through `blog_indexing_jobs`; indexing provider calls are handled by the worker, not inline publish code.
- Google actual URL knowledge is tracked separately from IndexNow or sitemap request success.

## Operator Flow

1. Open `/admin/blog`.
2. Read `오늘 해야 할 일` first.
3. If the first action points to the queue, open `/admin/blog/queue` and stay on `운영 필요`.
4. Requeue only retryable failures. Hide rows that are stale historical noise or blocked by bad topic fit.
5. If the first action points to system, open `/admin/blog/system` and inspect the core cron table before manually running anything.
6. If publishing volume is wrong, open `/admin/blog/policy` and compare the global policy with current active queue pressure.
7. If indexing or exposure is weak, open `/admin/blog/rankings`; do not assume IndexNow, sitemap submission, or URL Inspection means actual ranking.

## Failure Policy

- Do not delete queue rows as the default cleanup action. Use `숨김` so the audit trail remains available.
- Do not mark autopublishing complete after a one-time backfill. Completion requires the live publisher, queue, indexing worker, and daily summary to remain healthy.
- Do not add new Vercel cron entries for blog work without removing or consolidating another cron; the project is already near the cron limit.
- Do not treat SEO score alone as quality. Topic fit, editorial quality, render integrity, image quality, readability, and indexing evidence must also pass.
- Do not requeue `self_heal_blocked` rows until the underlying generator or schema mismatch is fixed.
- Do not treat provider-specific search submission drift as a publish cron failure when publishing, queue health, and indexing outbox coverage are healthy. Keep it as a `watch` alert under search visibility so operators do not confuse indexing/ranking work with broken autopublishing.

## Escalation Rules

- `blog-publisher` failure: treat as blocked because new posts may not publish.
- `blog-daily-summary` partial failure: check whether daily count or indexing health failed.
- `gsc-index-rank` reports many unknown URLs: verify sitemap, canonical URLs, internal links, and Search Console property before reindexing in bulk.
- Repeated `topic_fit` failures: fix keyword/topic generation before requeueing.
- Repeated `editorial_quality`, `structure_integrity`, or `raw_directive_leak` failures: fix the publish preparation/repair path before regenerating more posts.
- Repeated `content_creatives_angle_type_check`: normalize queue `angle_type` to a valid content angle before publish.

## Private Replacement of Legacy Deterministic Fallback Posts

- Quarantine the linked `content_creatives` row as `draft` before requeueing it. Never leave the old fallback body public while replacement generation runs.
- The queue row must keep the same `content_creative_id` and set `meta.private_regeneration` to `{ "mode": "replace_existing_fallback_draft", "force_private_review": true }`.
- Before changing the row back to `queued`, attach a validated `meta.information_research_bundle` whose content key, destination, language, source freshness, exact evidence excerpts, and customer-visible claims match the target article. For a food-budget article this includes at least seven supported price claims covering three daily-budget tiers and four meal categories.
- If the targeted response says `private_regeneration_research_preflight` or `private_regeneration_research_persistence`, stop. Do not retry the writer. Repair or complete the research bundle first; the row is intentionally left `skipped + self_heal_blocked`.
- For a United States entry-requirements retry, confirm the direct-fetch report has no failures and contains all six decision groups: permitted purpose, permitted stay, return travel, lodging or U.S. stay details, travel funds, and customs declarations. The reviewed supporting-document page must be directly retrievable by the worker; a browser-only ESTA or CBP help page is not acceptable evidence. After generation, verify that the final customer body still contains these evidence-backed groups. If they appear in preflight but disappear from the body, inspect final repair ordering before adding another source or retrying the model.
- Official sources also require an active matching row in `blog_information_official_source_registry`. An empty registry is a setup blocker for official-source persistence, not permission to downgrade the source.
- The publisher fails closed unless the linked row is a `naver_blog` draft whose stored metadata still proves `deterministic_info_fallback` or `deterministic_fast_fallback`.
- A successful replacement updates the same creative ID and slug, then leaves the queue and creative in private review. It must not call atomic publication or indexing until a later explicit approval reruns current publish QA.
- For a controlled retry, an authorized operator may call `blog-publisher?force=true&privateQueueId=<queue UUID>`. This mode accepts only a queued row carrying the private-regeneration contract, processes exactly that row, bypasses daily quota refill, and still leaves a successful replacement in private review. Do not use the normal publisher endpoint for a one-row retry because normal quota recovery may add and process unrelated candidates.
- A controlled private call makes one writer attempt only. It reuses the linked draft's already-reviewed HTTPS images and skips SERP, Chain-of-Density, and new external/AI image acquisition so the proof remains inside the server time budget. A failed attempt stays private for diagnosis; do not loop a second full attempt in the same request.
- When a representative record exists, move it from `active` to a reservation owned by the same queue row before requeueing. This prevents a stale active representative from blocking the controlled in-place replacement.
- Verify the write by reading back creative status, review status, fallback flags, queue status, replacement metadata, and representative ownership. A fallback flag remaining on a `published` row is a release blocker.
- Verify generated cover and inline images in the public renderer. AI-created assets must visibly say `AI 생성 참고 이미지`; they are never evidence for prices, schedules, policies, weather, or current conditions.

## Reviewed Replacement of Published High-Risk Posts

- Enqueue the existing public creative with `private_regeneration.mode=replace_published_after_quality_gate`, `atomic_publish_replace=true`, and the exact `content_creative_id`. Do not unpublish or edit the public row while research and generation run.
- The publisher may create a private replacement only after the claim gate passes. The resulting draft must have `review_status=pending_review`, a `blog_information_review_cases` row with the same evidence content key, and `generation_meta.reviewed_published_replacement.mode=reviewed_published_replacement_v1`.
- In the information-review API, confirm `reviewedReplacement.targetCreativeId` and `reviewedReplacement.canonicalSlug` match the live article. Review the claim/source/excerpt/validity packet, not only the prose.
- Approval and publication are separate explicit actions. Approval revalidates evidence and locks the exact draft fingerprint. Publication reruns public QA against the canonical slug, then calls the atomic replacement RPC.
- After publication, verify that the original creative remains `published` with the same ID, slug, and `published_at`; its `review_status` is `approved`; the shadow draft is `archived`; the queue points to the public creative; and one `blog_information_replacements` audit row plus a pending indexing job exist.
- A missing review case, changed draft fingerprint, unsupported claim, stale or non-official high-risk evidence, representative mismatch, or indexing outbox failure must leave the previous public article unchanged. Repair the cause and repeat the explicit publish action; never copy the draft into the public row manually.

## Verification Commands

Run these after code changes that affect blog generation, rendering, indexing, or admin operations:

```bash
npm run type-check
npx vitest run src/lib/blog-editorial-repair.test.ts src/lib/blog-seo-scorer.test.ts src/lib/blog-structure-audit.test.ts src/lib/blog-topic-fit-gate.test.ts
npm run verify:blog-auto-research:live
npm run audit:blog-quality -- --limit=50
npm run audit:blog-public-customer-quality -- --base=https://www.yeosonam.com --limit=10 --browser --strict
npm run audit:blog-public-surfaces -- --base=https://www.yeosonam.com --strict
npm run audit:blog-search-daily:strict
```

For a controlled public proof, mark exactly one low-risk informational queue row with `meta.controlled_publish_canary=true`, then call the authorized publisher with `targetQueueId=<queue UUID>`. Do not select entry/visa or insurance. Verify the queue, creative, persisted source/evidence/claims, active representative, publication record, indexing outbox, public API, public page, canonical, citations, and images. Then update the same creative through authenticated blog PATCH with `status='published'` and verify a new publication fingerprint and indexing job without a new URL. Never invoke the unrestricted publisher merely to test one candidate.

When recovering an `evidence_insufficient` informational candidate, always select the one audited row explicitly: `npm run recheck:blog-information-research -- --queue-id=<queue UUID> --write`. Run the same command without `--write` first and require exactly one `requeue` decision. Never use an unscoped write for a controlled canary.

When the rollout is frozen, keep the controlled V5 canary private. Generate the exact flagged row, verify the selected attempt and editorial evaluation, then run `npm run recover:blog-publication-rollout` without `--apply`. The dry-run must report every check `true`. Only then run the same command with `--apply --canary-run-id=<UUID> --incident-creative-id=<UUID> --recovered-by=<operator> --reason=<20+ character reason>`. Read back the recovery audit and confirm the state is `active/pilot_3` before invoking the model-free publication controller for that exact run. Never update `blog_publication_rollout_state` directly.

If local Supabase environment variables are unavailable, use `/admin/blog` and `/api/admin/blog/ops-summary` against the authenticated deployed admin surface as the source of truth.

## Completion Definition

The blog system is complete only when the admin UI can answer these questions without reading raw DB rows:

- How many posts should publish today, and how many did?
- Which queue rows need action now?
- Which failures are retryable, hidden, or blocked by topic quality?
- Are indexing jobs pending or failing?
- How many inspected URLs are actually known to Google?
- Which cron broke the contract?
- Which document defines the contract and which checks currently fail?

## 2026-07-03 Ops Summary Breakdown Evidence

- `/api/admin/blog/ops-summary` now separates publish, queue, quality, indexing, and cron health under `health_sections`.
- Recent published-post quality is not treated as healthy just because `quality_gate.passed` is absent or not false. The summary checks durable evidence for content brief, SEO score, readability score, metadata, body, image evidence, quality gate failures, and the published info-destination contract.
- Slug-only cleanup is reported separately from non-slug quality failures. Non-slug quality failures block healthy status; slug-only cleanup is a watch item so operators do not confuse URL cleanup with broken article content.
- Queue failures are grouped into `slug_failures`, `non_slug_failures`, `indexing_failures`, and `stuck_queue_rows`.
- Indexing health exposes `outbox_missing`, `provider_failures`, `active_jobs`, and `google_unknown_urls` as separate buckets.
- `/admin/blog/system` and the sticky blog ops strip now surface this breakdown so operators can distinguish publish, queue, quality, indexing, and cron failures without reading raw DB rows.

## 2026-07-08 Daily Publish Count Reconciliation

- `diagnose:blog-autopublish` reports the selected-day `public_blog_content_creatives` count as the operating count. The compatibility field `selected_day_raw` means the same public-eligibility-view count, never the raw mutable `content_creatives.status` count.
- Closed-day `blog-daily-summary` and `blog-publisher.dailyQuota` values remain visible only as diagnostic evidence. They can never raise `published.selected_day` above the public eligibility view because a later-hidden or unsafe row is not a successful public publication.
- Do not suppress a `daily_publish_sla_miss` merely because stale daily-summary or publisher evidence says quota reached. Suppression requires the public-eligibility view itself to meet quota, preflight to pass, and current-day publisher health to be healthy.
- Treat this reconciliation as an operating-report correction only. If daily-summary or publisher evidence differs from the public-eligibility view, inspect the source query/date boundary separately instead of marking publishing broken.

## 2026-07-08 Customer Language Quality Hardening

- Recent 16-post backfill now targets `changed=0`, not merely `qualityGateFailed=0`. This prevents fixed posts from being rewritten repeatedly because of harmless storage formatting or non-idempotent repairs.
- Customer quality now blocks product DB evidence omissions, internal supplier/settlement term leaks, unsupported source-sensitive info guides, generated placeholder residue, duplicate hashtags, broken Markdown URL fragments, repeated answer-first hooks, and mobile paragraph walls.
- Final repair must normalize the H1 lead to one answer-first paragraph, preserve short answer leads, split only true long paragraphs, and run destination placeholder repair after CTA/FAQ/readability repairs.
- `src/lib/blog-final-customer-surface.ts` is the shared final customer-surface repair used by both `blog-publisher` and `backfill-blog-quality`; do not add a one-off published-row repair unless the live publisher also calls the same rule. The publisher must also run the text-preserving `repairBlogFinalInlineSurface()` after deterministic research structure and image restoration, before the final gates. This narrow pass may fix Korean particles but must not prune or reorder evidence content.
- `engine_v2.category_scores` is the operator-facing 100-point scorecard: reader task completion, customer language, naturalness, evidence/faithfulness, sales pressure, and product decision helpfulness for product posts. `engine_score` without per-category pass evidence is not enough to call a post 100점.
- Live publishing now uses the same scorecard as repair input. `repairBlogEngineCategoryGaps()` re-evaluates and repairs up to three rounds, then writes `generation_meta.engine_category_repair` with before/after score, repaired categories, `repair_rounds`, and repair actions so operators can see whether weak customer-facing categories were fixed before publish instead of only blocked.
- The final publish gate has no near-pass exception for `ai_naturalness` or `sales_pressure`. If any engine category remains below 100 after repair rounds, the candidate must be repaired, regenerated, or replaced by another publishable candidate rather than published as a weaker article.
- `evaluateBlogEngineV2()` now follows the same rule directly: 80-99 is not pass, it is repairable evidence. `engine_v2` failures are self-heal eligible when the cause is reader-task completion, customer language, naturalness, sales-pressure control, or product decision helpfulness. Do not self-heal evidence-insufficient, product open-contract, topic-fit, or candidate pre-publish contract blockers.
- Shared publish preparation and `backfill-blog-quality` also call `repairBlogEngineCategoryGaps()`. If a recent-post dry run shows `changed>0`, run the write audit and indexing worker, then rerun dry-run until `changed=0`, `qualityGateFailed=0`, and `publishBlocked=0`.
- `audit:blog-quality -- --json` exposes `engineCategoryScorecard` with checked count, perfect count, below-100 count, average score, weak category buckets, and samples. Recent-post stabilization now requires `engineCategoryScorecard.below100Count=0` in addition to the existing changed/gate/publish checks.
- `/admin/blog/system` recomputes and displays the recent-post engine category scorecard, including average category score, 100점 post count, below-100 count, and top weak categories. This keeps the scorecard visible even for older posts whose stored `generation_meta` predates the field.
- Public render integrity is the final source of truth for tables. If a cost/weather/checklist-style information post only contains pseudo-table prose, the editorial repair path must add a real Markdown decision table and the structure repair path must normalize it before publish or backfill write.
- Evidence-backed `monthly_weather:v2` sections are protected from the generic legacy backfill rewrite. The backfill must preserve the 12 reviewed climate rows and may only rebuild the clothing table from each row's verified minimum temperature, with rainfall used only for rain gear.
- Before adding a climate destination to the automatic fallback catalog, fetch the exact registered documents through the production direct-fetch path and run the deterministic adapter. The acceptance result must contain the exact destination, a normals period, 12 unique months, 12 composite claims, and either 12 complete single-source evidence rows or 24 paired temperature/precipitation evidence rows. Do not register a city because its page exists. The 2026-07-30 live review accepted WMO Xi'an (`cityId=239`), the JMA Nagasaki, Shizuoka, and Yufuin tables, PAGASA NAIA/Manila 1991-2020 normals, PAGASA Clark 1997-2020 normals, and the Meteorological Service Singapore Changi Climate Station 1991-2020 table. The Clark folder name says 1991-2020, so the PDF body period is authoritative. WMO Zhangjiajie and Boracay were rejected because their climate tables were empty.
- Markdown rendering must retain a blank boundary after the final table row. A following explanatory paragraph must render as `<p>`, never as a table row with empty cells.
- Public customer-quality is the final source of truth for reader-facing copy. If public pages contain generated residue, duplicate headings/sections, broken table surfaces, early hard CTA in information posts, unsupported internal claims, or AI-cliche tone, the system is not healthy even when internal DB audits and URL surface checks are green.
- Inspect the public `<meta name="description">` after each intent canary or atomic legacy upgrade. Weather copy must mention climate, clothing, observation period, or official forecast checks; it must not inherit generic cost, itinerary, or reservation language. Apply the same intent-alignment check across all eleven supported information intents.
- Verification on 2026-07-08:
  - `npm run audit:blog-quality -- --limit=16 --json --write` updated affected recent posts and queued indexing jobs.
  - `npm run run:blog-indexing-worker -- --json --limit=15` processed the queued jobs with `failed=0`.
  - Final `npm run audit:blog-quality -- --limit=16 --json` returned `changed=0`, `qualityGateFailed=0`, and `publishBlocked=0`.
  - `npm run type-check` passed.
  - `npx vitest run src/lib/blog-customer-quality.test.ts src/lib/blog-editorial-repair.test.ts src/lib/blog-product-consultant-writer.test.ts src/lib/blog-editorial-voice.test.ts` passed 68 tests.
  - `npm run diagnose:blog-autopublish -- --json` reported selected-day `4/4`, publish preflight score `100`, publishable candidates `49`, indexing outbox coverage `100`, and `buckets=[]`.
  - After wiring the shared final customer-surface repair into live publishing, `npx vitest run src/lib/blog-final-customer-surface.test.ts src/lib/blog-customer-quality.test.ts src/lib/blog-editorial-repair.test.ts src/lib/blog-product-consultant-writer.test.ts src/lib/blog-editorial-voice.test.ts` passed 72 tests; `npm run audit:blog-quality -- --limit=16 --json` returned `changed=0`, `qualityGateFailed=0`, and `publishBlocked=0`; `npm run diagnose:blog-autopublish -- --json` remained at publish preflight score `100`, publishable candidates `49`, indexing outbox coverage `100`, and `buckets=[]`.
  - `npm run audit:blog-quality -- --slug=clark-food --json --write` repaired the pseudo-table public render failure and queued indexing; the follow-up dry run returned `changed=0`, `qualityGateFailed=0`, and `publishBlocked=0`.
  - `npm run audit:blog-render:browser -- --base=https://www.yeosonam.com --json --timeout-ms=15000 --hard-timeout-ms=90000 --limit=30` passed with `score=100`, including `/blog/clark-food` where `tableExpected=true` and `tableCount=1`.
  - `npm run audit:blog-search-daily:strict` passed with `strict=100/100`, `fleet=100/100`, and all required checks passed.

## 2026-07-08 Quota Recovery and Generated Canary Evidence

- Daily target recovery must not stop at "blocked". If a candidate fails for deterministic quality issues that the shared repair path can fix, the publisher should retry it immediately and the external cron retry loop can pick it up in the same publishing window.
- Self-heal quality failures include `length`, `links`, `keyword_density`, `structure_integrity`, `table_integrity`, `render_integrity`, `intent_quality`, `seo_score`, and `engine_v2`. These are repair backlog when they exceed attempts, not hidden terminal noise.
- Unsafe seeds remain blocked until their source data is fixed: duplicate content, missing context, insufficient evidence, product open-contract failure, topic-fit failure, candidate pre-publish contract failure, and invalid linked drafts.
- `src/lib/blog-canary-preflight.ts` now labels every selected canary with `quality_contract='customer_surface_100'` and writer-specific expectations, so operators can see whether the canary proves info-guide quality or product-consult quality.
- `src/lib/blog-canary-generated-quality.ts` checks an actual generated sample across engine score, customer quality, and rendered Markdown integrity. This is the canary to run after changing prompts, product writer structure, final repair, or renderer behavior.
- Product generated canary must not rely only on recently published rows. If recent rows are all information posts, `src/lib/blog-product-generated-canary.ts` builds a non-publishing dry-run article from the queued `product_id` and the registered `travel_packages` row, then sends it through the same engine/customer/render checks.
- Generated canary volume follows the daily publish target, capped at five samples per run. With the current 5/day policy, the operating proof must show five generated samples.
- Product commercial copy is now `product-template-v4`: price/from-city/duration opening, included/excluded, fit/not-fit, risk notes, consult questions, official checks, and bottom CTA. It must use product DB facts only and must not invent hotel names, benefits, scarcity, or confirmed schedules.
- Customer quality now fails visible mojibake/encoding residue. A body containing broken Korean such as `�`, `媛`, `諛`, or `留` cannot pass as a "near 100" post.
- Verification on 2026-07-08:
  - `npx vitest run src/lib/blog-canary-generated-quality.test.ts src/lib/blog-canary-preflight.test.ts` passed 10 tests.
  - `npx vitest run src/lib/blog-product-generated-canary.test.ts src/lib/blog-canary-generated-quality.test.ts src/lib/blog-product-brief.test.ts src/lib/blog-product-consultant-writer.test.ts src/lib/blog-ops-summary.test.ts src/app/api/cron/blog-daily-summary/route.test.ts src/lib/blog-publish-preflight.test.ts` passed 25 tests.
  - `npm run diagnose:blog-autopublish -- --json` reported `generated_canary_quality.status=pass` with mixed proof: recent info sample plus product dry-run sample from the active queue and registered package data.

## 2026-07-09 Active vs Historical Failure Evidence

- `diagnose:blog-autopublish` now separates `active_buckets` from `historical_buckets`.
- Do not hide historical failures such as a missed prior KST day or old publisher timeout evidence. Keep them in `historical_buckets` so the incident remains auditable.
- Current operations should be judged from `operating_status`, `active_buckets`, today's published count, current-day publisher health, publish preflight blockers, and publishable candidate count.
- A prior-day `daily_publish_sla_miss` or old `publisher_timeout` becomes historical only when the current KST day has already met the daily target, current-day publisher health is healthy, preflight has no blockers, and candidate shortage is false.
- Superseded on 2026-07-19: low-time recovery may still create a deterministic information fallback as a private diagnostic or repair draft, but it must never publish it. `deterministic_info_fallback` and `deterministic_fast_fallback` are central publish blockers. When there is not enough time for normal generation and every current gate, release claimed rows back to `queued` and accept a quota miss instead of lowering the customer-content contract.
- Low-time claim ordering must prioritize candidates that can still complete normal generation and all gates within the remaining budget. The old fallback-eligible publish shortcut is retired; do not use `BLOG_PUBLISHER_FAST_FALLBACK_MIN_ITEM_START_MS` as authority to publish deterministic copy.
- The publisher now returns an attempted row to `queued` with `publisher_deferred_before_generation_time_budget` when the normal-generation window is no longer safe. This deferral restores the prior attempt count and must not be counted as a content failure. Deterministic fallback generation is available only behind the explicit private diagnostic flag `meta.private_diagnostic_fallback=true`; ordinary generation or quality failures retain their original reason for repair and review.
- If the publisher already claimed rows but stopped before attempting them, `timeBudgetClaimRelease` must return those rows to `queued` with an immediate publish time. Treat stale `generating` rows after a low-time publisher exit as a recovery defect, because they reduce the next run's publishable inventory.
- Daily summary now escalates `catchup_publishable_candidates_available` when the daily target was missed even though enough publishable candidates were available for the remaining slots. This is a publisher recovery failure, not a topic shortage: force scheduler, then rerun publisher until `remainingAfterRun=0` or a concrete blocker is reported.
- Product-backed blog eligibility now treats `source_verify_status='blocked'` as a customer-open blocker. A product post must not publish just because mobile proof and scorecard look pass-like when upload/source verification is still blocked.
- Generated canary quality now includes fleet phrase-drift detection. If individual generated samples pass but repeat the same opening formula, H2 order, or bottom CTA across recent posts, the diagnosis should report a phrase-drift warning/block instead of claiming the prompt set is fully healthy.
- Verification on 2026-07-09:
  - `npx vitest run src/lib/blog-autopublish-diagnosis.test.ts src/app/api/cron/blog-daily-summary/route.test.ts` passed.
  - `npm run type-check` passed.
  - `npm run diagnose:blog-autopublish -- --json` reported current day `4/4`, publishable candidates `15`, `operating_status=healthy`, `active_buckets=[]`, and historical evidence retained for the 2026-07-08 miss/timeout incident.
  - `npx vitest run src/lib/blog-publisher-time-budget.test.ts src/lib/product-registration/customer-open-contract.test.ts src/lib/blog-product-evidence-recheck.test.ts` passed.
  - `npx vitest run src/lib/blog-fleet-phrase-drift.test.ts src/lib/blog-canary-generated-quality.test.ts` passed after adding fleet phrase-drift to generated canary quality.
  - Follow-up `npm run diagnose:blog-autopublish -- --json` reported `generated_canary_quality.status=pass` with `requested=4`, `checked_count=4`, `pass_count=4`, and `fleet_phrase_drift.status=pass`.
  - `npm run audit:blog-quality -- --limit=16 --json` returned `changed=0`, `qualityGateFailed=0`, `publishBlocked=0`, and `engineCategoryScorecard.averageScore=100`.
  - `npx vitest run src/lib/blog-publisher-time-budget.test.ts src/lib/blog-autopublish-diagnosis.test.ts src/app/api/cron/blog-daily-summary/route.test.ts` passed after low-time fallback queue ordering was added.
  - `npm run recheck:blog-editorial-backlog -- --json` returned `scanned=0`, `requeue=0`, and no schema errors.
  - `npm run recheck:blog-product-evidence -- --json` returned `scanned=34`, `keep_blocked=34`, `write_recommended=false`; every blocker was `product_status_not_customer_visible:pending_review`.

## 2026-06-16 Live Ops Evidence

- Supabase project: `Yeosonam_OS` (`ixaxnvbmhzjvupissmly`) is active.
- Vercel project: `os` (`prj_QTQa2iUwEkBON4QczULxG1HPYLSE`) latest production deployment was `READY`.
- Live queue counts: `failed 9`, `queued 28`, `skipped 236`, `published 116`.
- 2026-06-16 KST publishing target was met: `published_today 4`.
- `blog-daily-summary` remained `partial_failure` because 2026-06-15 had `published=1`, `min=3`, and Google actual index rate was low.
- `blog-orchestrator` remained `partial_failure` due to overdue supporting cron checks.
- Google URL Inspection evidence is a separate risk from IndexNow: recent reports included many `Google에는 아직 알려지지 않은 URL입니다` states.
- Repeated DB publish failure found: product queue rows used Ad OS scenario angle values such as `safety`, `family`, `price_objection`, `differentiator`, but `content_creatives.angle_type` accepts the content-generator angle set. The live queued rows were repaired to `value`, and publisher code now normalizes angle values before quality gates and DB insert.
- Vercel runtime logs showed repeated `env-check` warnings. `instrumentation.ts` was deduplicated and `env-check` now logs readable messages once per process.

## 2026-06-17 Autopublish Hardening Evidence

- Root cause class: queue producers and the publisher did not share one data contract.
- `content_creatives.angle_type` only accepts `value`, `emotional`, `filial`, `luxury`, `urgency`, `activity`, and `food`.
- Several producers used producer-only labels such as `trend`, `longtail`, or programmatic SEO angles. These labels must be stored as context in `meta.raw_angle_type`, not as publishable `angle_type`.
- `programmatic-seo-generator`, `promotePendingTopics()`, and manual queue insertion previously sent `search_intent` as if it were a `blog_topic_queue` table column. It is not a table column. Search intent must live in `meta.search_intent`.
- Live DB repair applied on 2026-06-17:
  - normalized 17 queued/generating rows with empty publish angle to `value`;
  - reconciled 9 queue rows that were still `published` while their linked articles were already `archived`;
  - updated `blog_topic_queue_source_check` to allow the live `gsc_longtail` producer.
- Code hardening:
  - `src/lib/blog-queue-normalize.ts` is the single queue normalization contract;
  - queue producers must call `normalizeBlogTopicQueueRow()` before insert;
  - publisher calls `normalizeBlogAngleType()` before quality gates and DB write;
  - `blog-lifecycle` reconciles published queue rows whose linked article is no longer public.
- Publishing policy alignment:
  - `/admin/blog/policy` can set up to 8 posts per day;
  - `normalizeDailyPostTarget()` must not clamp that policy back to 4;
  - `blog-publisher` must read `getBlogPublishingPolicy('global')` before falling back to `BLOG_DAILY_PUBLISH_TARGET`.
- Verification:
  - `npm run type-check` passed;
  - `npx vitest run src/lib/blog-queue-normalize.test.ts` passed;
  - recent 14-day published posts all had `blog_indexing_jobs` rows;
  - after live repair, published queue rows matched public articles: `published queue 107`, `published article 107`, mismatch `0`.

### Queue Producer Rules

- Do not insert producer-only values directly into `blog_topic_queue.angle_type`.
- Do not insert unknown fields into `blog_topic_queue`; put non-schema fields under `meta`.
- Do not add a new queue `source` without updating the DB check constraint, admin labels, and this runbook.
- Do not mark the system healthy while `published_state_mismatch > 0`.
- Every automated producer must run the topic-fit gate before inserting queue rows. Current required blockers:
  - seasonal month topics must be weather, clothing, packing, rainy/dry season, or checklist led; lodging micro-topics such as air-conditioner/no-air-conditioner are not publishable;
  - unsupported honeymoon pairings such as Shijiazhuang + honeymoon are not publishable;
  - topics that repeat the destination prefix, for example `Destination Destination(...)`, are not publishable.
- The publisher must re-run topic-fit before generation so old bad queue rows cannot leak into publication even if they were inserted before the current producer rules.

## 2026-06-17 Topic Quality Cleanup Evidence

- Live cleanup skipped 8 queued rows before they could publish:
  - 7 rows with duplicate destination prefix such as `연길/백두산 연길/백두산(...)`;
  - 1 unsupported destination topic for `석가장`.
- After cleanup, active bad-topic candidates matching air-conditioner lodging tangents, unsupported Shijiazhuang topics, or duplicate destination prefixes: `0`.
- Queue counts after cleanup: `published 107`, `queued 14`, `failed 9`, `skipped 259`.
- Published queue/article mismatch remained `0`.
- Code prevention:
  - `evaluateBlogTopicFit()` blocks the above cases;
  - `blog-publisher` blocks failed topic-fit rows before AI generation;
  - `trend-topic-miner`, `programmatic-seo-generator`, and `promotePendingTopics()` filter failed topic-fit rows before queue insert.

## 2026-06-17 Google Inspection URL Evidence

- Root cause: `gsc-index-rank` used `GSC_SITE_URL` to build inspected blog URLs. When `GSC_SITE_URL` pointed to a non-www Search Console property, URL Inspection checked `https://yeosonam.com/blog/...` while public redirects, canonical tags, OG URLs, robots sitemap, and sitemap locs all used `https://www.yeosonam.com/blog/...`.
- Evidence:
  - `audit:blog-gsc-domain -- --json` passed with score 100;
  - redirect, canonical, OG URL, and sitemap all resolved to `https://www.yeosonam.com`;
  - recent URL Inspection reports with `Google에는 아직 알려지지 않은 URL입니다.` were stored against non-www URLs.
- Fix:
  - URL Inspection now builds inspected URLs from the canonical public origin (`BLOG_CANONICAL_ORIGIN`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_SITE_URL`, fallback `https://www.yeosonam.com`);
  - the Search Console property is tried separately through candidates: configured property, canonical URL-prefix, domain property, and non-www fallback;
  - `/api/admin/blog/ops-summary` counts Google unknown URLs only for canonical `https://www.yeosonam.com/blog/...` inspection records.
- Do not use the GSC property host to rewrite the URL being inspected. The inspected URL must stay equal to the public canonical URL.

## 2026-06-23 Daily Summary Timing Evidence

- The live policy assigns five posts at 09:00, 12:00, 15:00, 18:00, and 21:00 KST. `blog-publisher` runs five minutes after each slot, while 22:05 is a quota-only catch-up before the 22:45 daily summary.
- `blog-scheduler` runs at 08:50 KST after the 07:30 product-proof refresh. It must report at least ten research-ready information candidates before slot assignment; ordinary queued rows without a current research bundle do not count.
- The primary trend miner runs at 06:00 KST and the external fallback runs at 06:10 KST. Trend signals prioritize candidate research but never serve as factual evidence.
- `blog-daily-summary` previously ran at 09:10 KST, before the daily publish windows, so it was not a true post-publish operating report.
- The daily summary cron now runs at 22:45 KST (`45 13 * * *` UTC) and summarizes the current KST day after the final 22:05 catch-up publisher slot, the external 22:07 publisher retry window, the normal 22:27 indexing-worker backup, and the final 22:40 indexing drain. The GitHub daily-summary workflow also triggers `blog-publisher?force=true` with the same quota-fill retry contract immediately before the indexing drain, then triggers `blog-indexing-worker?force=true` before calling `blog-daily-summary`. This makes daily summary the last automatic recovery line, not just a passive report.
- The daily summary uses the global publishing policy target instead of a hardcoded minimum, and duplicate unresolved `admin_alerts` for the same report date/type are suppressed.
- 2026-06-23 live checks found the public `/blog` page reachable. Supabase REST later recovered enough to verify that 2026-06-23 KST had `published=0`, while `blog_topic_queue` still had due queued rows.
- Vercel logs showed `blog-publisher` requests reaching the protected `*.vercel.app` deployment URL with HTTP 200 from Deployment Protection instead of the app route. A protection-bypass query reached the app route and returned JSON 401, which confirms the publisher function itself is behind the protection layer.
- Do not treat an edge-middleware 200 from a protected deployment URL as publish success. Success requires a `blog-publisher` row in `cron_health`/`cron_run_logs` for the current KST day plus `content_creatives.published_at` rows meeting the policy target.
- The daily summary now includes a `Blog Ops Watcher` report and checks whether `blog-publisher` ran today. It writes deduped unresolved alerts by issue code, so repeat failures accumulate in `cron_run_logs` without spamming duplicate open alerts.
- Required production fix: allow Vercel Cron to reach the cron API route despite Deployment Protection. Prefer a secure Vercel-supported automation bypass or a protection setting scoped to production cron traffic; do not commit the bypass secret into `vercel.json`.

## 2026-07-01 Daily Diagnosis Window Evidence

- `blog-daily-summary` and `scripts/diagnose-blog-autopublish.ts` must use the same closed-day rule.
- If the current KST time is before 22:45, both tools report the previous KST publishing day. This prevents a midnight or early manual run from flagging the new in-progress day as `publisher_cron_not_observed`.
- `publisher_cron_not_observed` is only actionable when the selected report day is under the daily target. If the target was already met, a later KST-day cron-health row must not turn a healthy summary into a blocked one.
- If `--date=YYYY-MM-DD` is passed to `diagnose:blog-autopublish`, the script audits that explicit KST date instead of applying the closed-day default.
- The diagnosis JSON exposes `report_period_closed`, `used_previous_day_for_pre_close_run`, and `close_minute_kst` so admin/operator tooling can show why a previous day was selected.

## 2026-07-01 Product Candidate Preflight Evidence

- Product-backed blog candidates must not consume publisher claim slots when their package cannot pass the unified customer-open contract.
- `blog-publisher` preflight now checks due queued rows with `product_id` before `claim_queue_items`.
- Candidates blocked by stale or missing customer mobile proof, failed scorecard evidence, or downstream `blog_publish` eligibility are marked `failed` with `failure_code='product_open_contract'` and `quarantine_reason='product_open_contract'`.
- `countPublishableQueueCandidates()`, `blog-daily-summary`, and `diagnose:blog-autopublish` exclude these rows from publishable candidate counts and treat them as evidence collection work, not as ready inventory.
- `diagnose:blog-autopublish -- --json` includes `product_evidence_work` so operators can see the blocked product title, queue row, blocker categories, raw blockers, and next action without reading raw DB rows.
- If the product proof may have been repaired after the queue row failed, run `npm run recheck:blog-product-evidence -- --json` first. The JSON now includes `write_recommended`, `write_reasons`, and `metadata_refresh_available`.
- Use `--write` when `write_recommended=true`, especially when `write_reasons` includes `requeue_recovered_product_rows` or `skip_duplicate_product_rows`. Passing product rows are requeued; duplicate product candidates are moved to `skipped` so they stop inflating failed evidence work.
- If `write_recommended=false` but `metadata_refresh_available=true`, the remaining rows are still blocked by current product evidence. Do not keep rewriting them just to refresh timestamps; fix the linked package proof, then rerun the dry-run.
- Do not requeue these rows until the linked package has fresh customer mobile proof and its customer-open contract passes.
- `Blog Product Proof Refresh` (`.github/workflows/blog-mobile-proof-refresh.yml`) runs daily at 07:30 KST, 80 minutes before the 08:50 scheduler. It refreshes stale/missing `/packages` + `/lp` mobile proof for active products, then runs `recheck:blog-product-evidence -- --write` so recovered product-backed blog candidates can publish instead of staying blocked.
- If published product-backed blog posts fail `product_customer_open_contract_failed:mobile_proof stale`, run the same workflow manually or run `npm run prove:hwp-mobile -- --package-ids=... --base=https://www.yeosonam.com --apply-pass-only --continue-on-fail --json`, then rerun `npm run audit:blog-quality -- --limit=300`. Do not archive the posts before attempting proof refresh when the linked product is still active.

## Vercel Cron Bypass Fallback

- `.github/workflows/blog-external-cron.yml` is the Vercel-Cron-independent scheduler.
- It calls the custom domain, not the protected `*.vercel.app` deployment URL:
  - `https://www.yeosonam.com/api/cron/blog-scheduler?force=true` at 08:50 KST to replenish and research publishable queue candidates.
  - `https://www.yeosonam.com/api/cron/blog-publisher` at 12:07, 15:07, 18:07, 21:07, and 22:07 KST.
  - `https://www.yeosonam.com/api/cron/blog-indexing-worker?force=true` at 12:27, 15:27, 18:27, 21:27, 22:27, and 22:40 KST to drain pending indexing jobs even when publisher quality gates fail or late publisher retries finish after 22:27.
  - `https://www.yeosonam.com/api/cron/blog-daily-summary` at 22:45 KST.
- The workflow requires a GitHub Actions repository secret named `CRON_SECRET`, with the same value as the production Vercel `CRON_SECRET`.
- Scheduled workflow calls include `force=true`, because blog publishing, scheduling, and daily reporting are critical cron jobs and must not be silently skipped by `DB_RESOURCE_SAVER_MODE`.
- The workflow treats `blog-publisher` as failed when `remainingBeforeRun > 0` and `published=0`. HTTP 200 is not enough; the run must either publish or surface a concrete failure bucket.
- The workflow now attempts `blog-publisher` up to four total times when `dailyQuota.remainingAfterRun > 0`, calling `blog-scheduler?force=true` before each retry. After those retries, any remaining daily quota is a failed run, not a healthy partial success.
- The workflow treats `blog-indexing-worker` as failed when the response reports `failed > 0` or non-empty `errors`. `processed=0` is allowed because no due jobs is a healthy no-op.
- Before the daily summary endpoint is called, the workflow performs a pre-summary publisher catch-up. It calls `blog-publisher?force=true`, refills with `blog-scheduler?force=true`, and retries up to the same four-attempt contract. It then drains indexing before checking final publisher underfill, publisher/scheduler hard failures, or malformed publisher JSON, so partially recovered posts still enter the indexing worker even when the quota ultimately remains short. If `remainingAfterRun > 0` or the catch-up hard-failed, the summary job fails instead of closing the day as healthy.
- Before the daily summary endpoint is called, the workflow performs a pre-summary indexing drain. If this drain returns a non-2xx response, `failed > 0`, or a non-empty `errors` array, the summary job fails instead of reporting stale indexing coverage.
- This bypasses the Vercel Cron delivery problem, but it still depends on the Vercel-hosted app route being reachable through `www.yeosonam.com`.
- If Vercel hosting/functions are fully down, move the publisher worker itself to an external runtime such as a small VPS, Cloudflare Worker plus queue, or Supabase Edge Function; do not rely on HTTP calls into the Vercel app in that failure mode.
- `vercel.json` is also aligned to the same daily blog-scheduler and four publisher slots as a redundant path; keep GitHub Actions as the custom-domain fallback when Deployment Protection or Vercel Cron delivery is unreliable.

## 2026-07-02 Canonical Indexing URL Evidence

- Blog publishing, CTA links, indexing outbox jobs, and indexing worker submissions must use the same public canonical origin: `https://www.yeosonam.com`.
- Do not fall back to `https://yeosonam.com` for blog indexing or public blog CTA URLs. Non-www URLs redirect publicly, but indexing evidence, sitemap URLs, canonical tags, and visibility snapshots should stay on the www origin.
- `src/lib/blog-canonical-url.ts` is the shared helper for blog canonical origin and `/blog/{slug}` indexing URLs.
- `enqueueBlogIndexingJob()` canonicalizes newly inserted indexing jobs, and `processDueBlogIndexingJobs()` canonicalizes existing pending jobs before provider submission. If a queued job's stored URL and slug disagree, the slug is treated as the durable source of truth.
- Manual safe drain command:

```bash
npm run run:blog-indexing-worker -- --json --limit=15
```

- This command loads `.env.local` before importing the worker. Keep that order; importing the worker first makes Supabase configuration look missing because the Supabase client reads env at module load.

## 2026-06-24 Micro-Angle Publish Recovery

- Root cause after cron/auth recovery: the active queue was mostly stale duplicate candidates, especially broad `destination + value` topics. Keeping the duplicate gate is correct; the fix is to generate more specific candidates before publishing.
- `blog-scheduler` and `blog-publisher` now call `ensureDailyPublishableQueue()` to maintain at least 8-12 queued candidates.
- `blog-publisher` runs a preflight quarantine before claiming rows. Queued rows that already carry non-retryable duplicate/topic/context failures are moved to `skipped` or `failed` instead of being reclaimed on every run.
- If the publisher burns through candidates before meeting the remaining daily quota, it performs an emergency micro-angle refill and tries to claim again in the same run.
- Product keyword-density checks now use a short generated SEO keyword or `destination package` fallback. Compound destinations such as `Da Nang/Hoi An` are not collapsed to a single city, which prevents false stuffing failures.
- Daily publisher runs defer due `source='pillar'` queue rows by 7 days and lower their priority, because long-form destination hub generation should not consume the daily 3-4 commercial/info publishing slots.
- New generated candidates keep `angle_type='value'` for the content generator, but store specific `meta.micro_angle` values such as `budget_family`, `transport_cost`, `hotel_area`, `food_budget`, `weather_packing`, `first_day_plan`, `shopping_budget`, `kid_friendly`, `airport_arrival`, and `local_mobility`.
- The duplicate gate now uses `destination + micro_angle` for micro-angle candidates. Rows without `micro_angle` still use the older broad `destination + angle_type` protection.
- `cron_run_logs` are no longer skipped for critical blog crons while DB resource saver mode is on. This preserves the daily audit trail for publisher, scheduler, and summary runs.
- `npm run cleanup:blog-queue-health -- --json` is the safe dry-run for stale `generating` rows and failed-row metadata drift. Use `--write` only when the dry-run shows stale generating recovery or failure metadata repair; it does not delete rows or blindly requeue non-retryable failures.
- As of 2026-07-02, the same overdue queued-row rescheduler also runs automatically in `blog-publisher` preflight, so old but otherwise publishable `queued` rows are moved back to the current publish window before claim. Manual `cleanup:blog-queue-health` remains the safe audit/backfill command.
- As of 2026-07-02, strict SEO audits split info-guide and product-consult length expectations. Info guides keep the 2,500-character ideal warning, while product/package consult posts are checked for decision-help signals and only warn below the product-consult length floor.
- `queue_failed` in daily summary means retryable/actionable failed rows. Historical or quarantined failures remain visible as `queue_failed_total` and `queue_operational_health`, but they must not be treated as current publisher blockers unless `actionable_failed_count > 0`.
- Daily summary now records the publisher `failure_breakdown` and a reader-facing `next_action`, so repeated duplicate, structure, render, or candidate-shortage failures can be tracked without retrying the same skipped topics.
- As of 2026-07-02, `diagnose:blog-autopublish`, `blog-daily-summary`, and `/api/admin/blog/ops-summary` expose `editorial_backlog_work`. This groups quarantined quality backlog rows by reader intent, structure/table, keyword use, engine contract, topic fit, SEO metadata, and image evidence so operators can fix the generator contract instead of blindly requeueing old failed rows.
- As of 2026-07-02, repaired editorial backlog rows can be checked with `npm run recheck:blog-editorial-backlog -- --json`. If the dry-run reports `write_recommended=true`, run `npm run recheck:blog-editorial-backlog -- --json --write` to requeue only rows whose failure signatures are covered by the current repair contract and skip active duplicates before they can consume publisher claims.
- Product candidates whose linked package is still `pending_review`, `draft`, or `review_needed` belong in `deferred`, not `failed`. `recheck:blog-product-evidence` and publisher preflight move them there without consuming attempts; each later publisher recovery pass checks deferred product rows and requeues them only after customer visibility and the full customer-open evidence contract pass.
- As of 2026-07-07, `render_integrity` failures caused only by residual Markdown bold markers (`literal_markdown_bold` / `standalone_markdown_bold`) are recoverable after the current editorial repair contract strips decorative bold markers before render checks. Recheck should requeue those rows instead of leaving them in manual review.
- As of 2026-07-04, image backlog recheck distinguishes image shortage from unsafe image evidence. Rows that failed only with `image_count_below_minimum` may be requeued because the publisher now inserts inline images before quality gates. Rows with missing alt text, malformed URLs, duplicate URLs, or no contextual alt/caption remain blocked until the image selection or metadata source is fixed.
- As of 2026-07-02, the same backlog recheck also includes product-backed rows when the blocker is a generator contract issue such as `keyword_density` or `engine_v2`. It still keeps product proof failures such as `product_open_contract`, customer-open contract failures, and registration evidence failures blocked until the linked package proof is repaired.
- As of 2026-07-02, editorial backlog recheck parses named runtime failures instead of collapsing them into `other`. `blog_content_brief_failed:missing_primary_keyword` and stale generation quarantines are recoverable after the current generator contract is deployed. Legacy broad `source='pillar'` rows blocked by `context_missing` are retired to `skipped` instead of being requeued into daily commercial/info publish slots.
- Legacy `source='pillar'` rows with a `(Pillar)` topic and a durable `context_missing`, `non_retryable_failure`, or self-heal blocker are retired even when an older row omitted the explicit `self_heal_blocked` metadata flag.

## 2026-07-03 Indexing Outbox Coverage Evidence

- Root cause class: `blog-publisher` previously swallowed indexing enqueue failures, so `operational_checks.indexing_queued` could look healthy even if a published slug never entered the durable worker queue.
- Fix:
  - publisher enqueue results now preserve per-slug failures and append `indexing_enqueue_failed:{slug}:{error}` to the run errors;
  - `/api/admin/blog/ops-summary`, `blog-daily-summary`, and `diagnose:blog-autopublish` expose `indexing_outbox_coverage`;
  - admin health reports `indexing_outbox_missing` separately from provider/worker failures.
- Coverage queries over `blog_indexing_jobs` must order by newest `updated_at` and inspect the latest 1,000 rows. Do not use an unordered capped read; it can miss fresh jobs in a large historical success table.
- Verification on 2026-07-03:
  - `npm run type-check` passed;
  - `npx vitest run src/lib/blog-indexing-coverage.test.ts src/lib/blog-indexing-worker.test.ts src/lib/blog-editorial-repair.test.ts src/lib/blog-seo-scorer.test.ts src/lib/blog-structure-audit.test.ts src/lib/blog-topic-fit-gate.test.ts` passed;
  - `npm run diagnose:blog-autopublish -- --json` reported selected-day publish `4/4`, `indexing_outbox_coverage.coverage_rate=100`, and `buckets=[]`.
- If `diagnose:blog-autopublish` reports `publishability.next_action="quarantine_duplicates"` or `duplicate_candidate_count > 0`, run `npm run cleanup:blog-publishable-duplicates -- --json`, then apply with `--write` when `write_recommended=true`. This only skips duplicate active candidates; it does not delete queue history.
- Before applying that cleanup, verify that `duplicate_keep_id` points to a valid atomic quality-upgrade row when a normal refill and a published upgrade share a dedup key. The cleanup contract protects a complete `replace_published_after_quality_gate` request and skips the refill; a malformed upgrade without `content_creative_id` remains quarantinable.

## 2026-07-03 Publish Preflight Evidence

- `src/lib/blog-publish-preflight.ts` is the shared operator preflight evaluator for `/api/admin/blog/ops-summary`, `blog-daily-summary`, and `diagnose:blog-autopublish`.
- The preflight separates:
  - hard blockers: insufficient publishable candidates for remaining slots, evidence blockers, actionable failed/stale generating rows, missing indexing outbox jobs, or failed recent canary quality samples;
  - warnings: low candidate buffer, duplicate pressure, or manual-review backlog;
  - harmless queue history: overdue queued rows are not a warning when publishable inventory is already sufficient and publisher preflight can reschedule them.
- The recent canary baseline is three recent published posts with quality gate, content brief, SEO, and readability evidence.
- Verification on 2026-07-03:
  - `npx vitest run src/lib/blog-publish-preflight.test.ts` passed;
  - `npm run diagnose:blog-autopublish -- --json` reported `publish_preflight.status="pass"`, score `100`, `canary_ready=true`, and `buckets=[]`.

## 2026-07-03 Canary Candidate Readiness Evidence

- `src/lib/blog-canary-preflight.ts` selects safe queued canaries without mutating queue state or publishing.
- The canary set prefers a mixed writer sample so engine changes prove both info-guide and product-consult paths before expanding automation.
- Info canaries must have a concrete destination unless the candidate is intentionally generic. Product canaries must carry product-backed dedup evidence.
- Rejected canary reasons, including `info_missing_destination` and `pillar_deferred`, are reported as queue repair signals instead of hidden publisher failures.
- Verification on 2026-07-03:
  - `npx vitest run src/lib/blog-canary-preflight.test.ts` passed;
  - `npm run diagnose:blog-autopublish -- --json` reported `canary_preflight.status="pass"`, ready `3/3`, and mixed writer coverage.

## 2026-07-03 Current-Day Publisher Failure Evidence

- Closed-day diagnosis intentionally reports the previous KST day before 22:45. This must not hide an active same-day publisher failure.
- `src/lib/blog-current-day-publisher-health.ts` evaluates the latest `blog-publisher` `cron_health` row separately from the closed-day SLA window.
- If the latest current-day publisher run had remaining quota and published `0`, `diagnose:blog-autopublish` reports `current_day_publisher_failure` and `/admin/blog` marks the contract as failed.
- A quota-reached no-op with `remaining=0` remains healthy.
- A single slow AI writer or card-news bridge call must not consume the full Vercel function window. The publisher wraps those calls with local timeout guards (`BLOG_PUBLISHER_AI_TIMEOUT_MS`, `BLOG_PUBLISHER_AI_REWRITE_TIMEOUT_MS`, `BLOG_PUBLISHER_GENERATION_TIMEOUT_MS`, `BLOG_PUBLISHER_BRIDGE_TIMEOUT_MS`) so a bad candidate is recorded through queue failure handling and the cron can still write a useful summary before the 285s completion guard. Keep the outer generation timeout above the Pro rewrite timeout; the code defaults are 190s and 165s respectively.
- Verification on 2026-07-03:
  - `npx vitest run src/lib/blog-current-day-publisher-health.test.ts src/lib/blog-publish-preflight.test.ts src/lib/blog-canary-preflight.test.ts src/app/api/cron/blog-daily-summary/route.test.ts` passed;
  - `npm run diagnose:blog-autopublish -- --json` reported `current_day_publisher_health.status="risk"` and bucket `current_day_publisher_failure` for the current-day zero-published run.

## 2026-07-05 Publisher Time Budget Evidence

- Root cause class: a single slow candidate could start while there was still nominal time left, then consume the whole 285s cron completion guard before the publisher wrote a useful summary.
- The publisher now uses a shared time-budget helper:
  - `src/lib/blog-publisher-time-budget.ts`
  - `src/lib/blog-publisher-time-budget.test.ts`
- `blog-publisher` only starts another queue item when the remaining runtime is above `BLOG_PUBLISHER_MIN_ITEM_START_MS`.
- Generation is wrapped by a dynamic timeout that preserves `BLOG_PUBLISHER_ITEM_FINISH_RESERVE_MS` for gates, DB writes, and the final cron summary.
- Optional post-publish work such as keyword enrichment, RAG indexing, and inline indexing-worker draining runs only when `BLOG_PUBLISHER_OPTIONAL_WORK_MIN_MS` remains. Durable `blog_indexing_jobs` enqueue still happens before this optional split, so independent indexing workers can finish provider submission later.
- Publisher summaries include a `time_budget` object so operators can distinguish a graceful time-budget stop from a hard wrapper timeout.
### Information writer v2.2 private canary check

The Sapporo food-budget canary reports queue failure evidence, stored prompt manifest, H2/question/FAQ counts, and image count in dry-run mode. A private regeneration may proceed only when the target remains a draft, the research preflight passes, and the route is called once. The AI-readable repair keeps the final article within nine H2 headings, preserves a natural question H2, and builds the food-budget FAQ only from approved claims. Missing `CRON_SECRET` must fail before `--apply --run` changes the queue; operators without that secret use `--apply` and invoke the protected production route separately.

Count both image occurrences and unique image URLs. Three Markdown image tags backed by only two unique URLs are a one-image shortfall. In that exact case the private route may fetch at most one relevance-filtered Pexels asset, with one disclosed AI reference-image attempt only as its fallback; all other optional image expansion remains disabled.

If a food-budget canary fails only `fees_and_booking`, do not add a plausible tax or service-charge percentage. Confirm that the deterministic evidence-gap section states that those outlet-specific terms are absent from the supplied research and directs the reviewer to the official menu or reservation screen. Re-run only after that contract is covered.

If the next private canary reports `missing_header_separator`, `duplicate_rendered_heading`, repeated evidence boilerplate, `literal_newline_escape`, or `empty_heading`, treat those as one deterministic merge-boundary failure. Do not retry the model unchanged. Confirm that the food-budget repair removes model-authored pipe rows and conflicting canonical sections, rebuilds exactly two approved-value tables, maps every compact price to one unique persisted claim, and passes table, render, and claim-validator tests before preparing one new private attempt. An ambiguous value match is a blocker, not a reason to guess.

If those structural failures disappear but the same attempt reports zero images, verify ordering before calling an image provider. The final food-budget repair must carry forward the unique HTTPS image blocks and adjacent `figcaption` lines that were already inserted from the reviewed draft, and place them under the rebuilt headings. Reusing those blocks is the expected fix; a second Pexels or AI-image request is not.

If a later attempt preserves the images but again fails only `ai_readability`, inspect the final repair order. A generic quality repair can replace the article body after the first H2/FAQ normalization. The publisher must therefore finalize evidence-backed research sections first, then reapply the deterministic question-H2, FAQ, H2-cap, and keyword-density repair once more when AI readability still fails. The final quality decision must evaluate that post-repair body; do not solve this class with another model retry.

If every content, evidence, customer, image, and render gate passes but strict publish quality stops at 85 because of `seo.title`, `seo.heading_structure`, and `seo.structured_data`, reconcile the scorer with the rendered page contract. Repair non-passing title metadata even when the aggregate SEO threshold already passes, count the public template's `seo_title` H1 instead of inserting a duplicate H1 into Markdown, and run the evidence-backed FAQ normalization after the final editorial repair so the same FAQ that produces `FAQPage` JSON-LD is scored. Do not waive the 100-point publish boundary.

If that boundary reaches SEO 100 but exposes a duplicate deterministic heading and repeated source sentence, normalize conflicts across heading levels H2-H6 rather than only H2. A previous H2 cap may have demoted a canonical heading to H3 before the research block is rebuilt. The evidence-backed FAQ must point readers to the verified tables instead of copying all seven source claim sentences again; this keeps the FAQ useful, avoids repetitive AI-like prose, and introduces no new number.

If the remaining strict failure is `empty_heading` plus excessive total heading count, preserve heading hierarchy semantics. An H2 FAQ parent followed immediately by H3 questions is not empty; rendered inspection must search through child headings until the next heading at the same or higher level. Independently cap the final H2-H6 total at 20 by converting surplus, non-protected subheadings to emphasized lead-ins. Preserve question H2, FAQ questions, and deterministic evidence headings.

If total heading count passes but rendered inspection still finds one genuinely empty named section, remove only heading lines whose section contains no paragraph, list, table, image, or populated child section before the next same-or-higher-level heading. HTML prompt/version comments do not count as reader content. Run this cleanup at the final AI-readable boundary so later repair stages cannot recreate the empty section.

If a non-checklist article is blocked only because incidental body prose says "checklist", do not weaken checklist shape validation. Infer checklist intent from title, slug, angle, primary keyword, or a real H1-H3 checklist heading. Generic reading guidance in a food-budget article is not sufficient evidence that the article promises a checklist.

The final empty-section cleanup must use the same visible-content boundary as rendered inspection. A divider, HTML comment, or empty HTML wrapper is not section content. Paragraph text, list items, tables, images, and blockquotes are content. This prevents a markdown-only repair from preserving a heading that becomes empty on the public page.

If `empty_heading` still repeats after the markdown and rendered-content boundaries are aligned, stop speculative repair. Persist only bounded rendered diagnostics under `last_publish_quality.rendered_issues`: heading tag/text, failure reason, parent tag, adjacent tag/text previews, and up to eight section-sibling summaries. Do not persist the raw prompt or full failed candidate body. Use that evidence to identify the exact renderer or sanitizer boundary before one further private canary.

For the Sapporo food-budget canary, bounded diagnostics identified `H2 자주 묻는 질문 -> H3 FAQ -> H3 Q1` as the remaining failure. A standalone Q heading must remain the question H3; renderer recovery must not invent an empty `FAQ` parent when the prefix is empty. Treat `자주 묻는 질문`, `FAQ`, and `Q&A` as the same canonical parent when removing duplicates, while preserving every evidence-backed question and answer.

After a candidate passes and moves to `pending_review` or `published`, queue and creative generation metadata must reflect the current success rather than a previous repair attempt. Preserve research and private-regeneration contracts, replace `last_qa` and `last_publish_quality` with the passing reports, record `last_succeeded_at`, and remove current failure, quarantine, and self-heal markers. Historical failures remain available in durable logs; stale current-state flags must not make a successful review handoff look failed.
