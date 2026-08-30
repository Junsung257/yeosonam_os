# Blog Errors

> 2026-08-13 V3 note: legacy `audit:blog-quality ... --write` and `backfill:blog-quality:write` commands in historical incident entries are no longer executable. The underlying script is permanently dry-run-only because it can create or rewrite article content.

Last updated: 2026-08-31

## ERR-BLOG-guam-airport-research-semantic-gaps@2026-08-31

- [x] **ERR-BLOG-guam-airport-research-semantic-gaps@2026-08-31**: The controlled Guam airport-to-Tumon publication canary directly fetched five reviewed pages and extracted valid GRTA fares/durations, but stopped at `5/6` supported claims because the packet did not reliably preserve multiple-mode, operating-hours, luggage, and late-arrival semantics. The failure was correct; publication remained frozen.
- **Fix**: GRTA now deterministically adds the first airport departure as a separate schedule fact, Guam Airport supplies the reviewed public-transport/taxi/rental-car mode claim, and Kakao Mobility's public FAQ JSON supplies baggage-capacity and flight-delay claims. Each adapter requires exact reviewed fields and fails closed after source drift. The client-rendered Kakao FAQ shell is not accepted as evidence.
- **Verification**: The combined official packet passes the airport-transport minimums, source-domain diversity, exact-number, and all four semantic gates in a focused end-to-end research test.

## ERR-BLOG-local-transit-misclassified-as-airport@2026-07-28

- [x] **ERR-BLOG-local-transit-misclassified-as-airport@2026-07-28**: A Canadian Rockies article about traveling without a rental car completed reviewed-source research and scored 98/100, but publication failed because the generic transport taxonomy required airport-to-city schedules, luggage handling, and late-arrival advice.
- **Root cause**: `transport_cost` and `local_mobility` both mapped to `airport_transport`. Research, planning, structure validation, SEO, related links, CTA telemetry, and the atomic publication RPC therefore shared the wrong reader task.
- **Fix**: Added the canonical `local_transport` intent across application and database contracts. It requires named local routes or modes, fares, route duration or frequency, service schedule, ticket/reservation method, seasonal or service limits, and official operator or government evidence. Airport-specific signals still resolve to `airport_transport`; generic public-transit and rental-car signals resolve to `local_transport`.
- **Prevention**: Every new informational intent must be added end to end: classifier, slots, source policy, research minimums, writer fixtures, structure validator, SEO, related links, CTA telemetry, representative constraint, atomic publication guard, source scopes, live suite, and operator documentation. A high aggregate writing score never overrides a mismatched reader-task contract.
- **Generation-time follow-up**: The first production retry reached the corrected intent and reviewed bundle but exceeded the 120-second topic-generation budget because private atomic upgrades still ran optional SERP enrichment, a second Chain-of-Density model pass, and a separate cover-image request. After those calls were removed, the next retry passed topic generation but the whole function still timed out while rebuilding an image set even though the public target already had one cover and three inline assets. Private upgrades now reserve the request for evidence-backed content work, reuse the target's verified HTTPS image set, and fetch only a real shortfall. Asset refresh is a separate quality workflow rather than a blocker inside the atomic replacement.

## ERR-BLOG-provider-call-consumed-generation-budget@2026-07-29

- [x] **ERR-BLOG-provider-call-consumed-generation-budget@2026-07-29**: A targeted evidence-backed upgrade repeatedly reached `topic_generation_timeout:120000ms` while its public predecessor correctly remained live.
- **Root cause**: The publisher had an outer writer timeout, but the Gemini and DeepSeek SDK calls had no per-provider request deadline. A stalled first provider consumed the entire writer window, so the prepared fallback provider never ran. The cascade could also retry the policy provider after that provider had already failed.
- **Fix**: Pass real SDK request timeouts through the shared blog AI caller, disable provider SDK retries inside the bounded publisher path, reserve 55 seconds for Gemini and 30 seconds for DeepSeek, cap grounded writer output at 8,192 tokens, disable Gemini 2.5 dynamic thinking for the reviewed-evidence transformation pass, and deduplicate the final policy-provider attempt.
- **Prevention**: Tests assert timeout propagation, first-provider failure to fallback-provider success, and no duplicate provider retry. Production proof must show the protected targeted upgrade finishing without `topic_generation_timeout` while preserving the prior public row until the atomic quality gate passes.

## ERR-BLOG-quality-gate-db-read-consumed-function-budget@2026-07-29

- [x] **ERR-BLOG-quality-gate-db-read-consumed-function-budget@2026-07-29**: After bounded writer inference completed, a targeted upgrade logged inline-image insertion but remained `generating` until Vercel terminated the function at 300 seconds.
- **Root cause**: Every quality and repair round re-read adaptive thresholds and duplicate candidates through unbounded Supabase queries. The atomic replacement had already validated its representative and canonical target, but still repeated those duplicate reads.
- **Fix**: Bound quality-gate DB reads to four seconds, fail ordinary duplicate checks closed on timeout, and skip repeated duplicate queries only for prevalidated atomic replacements. The atomic publication RPC still owns the final replacement.
- **Prevention**: Regression tests require the atomic path to make zero duplicate queries and preserve ordinary self-exclusion behavior. A DB outage must return a gate failure inside the function budget rather than leaving a queue row in `generating`.

## ERR-BLOG-oversized-writer-output-stalled-postprocessing@2026-07-29

- [x] **ERR-BLOG-oversized-writer-output-stalled-postprocessing@2026-07-29**: A targeted replacement completed bounded inference and inline-image insertion, but a candidate-specific synchronous postprocessing path prevented the function from returning before 300 seconds.
- **Root cause**: Writer output had a token cap but no character boundary before regex-heavy editorial, structure, and rendering repairs. A bloated or malformed model response could therefore monopolize the event loop, outside asynchronous timeout protection.
- **Fix**: Bound raw writer Markdown to 16,000 characters at a recent paragraph boundary before any postprocessing and record original/final sizes plus truncation in generation metadata. Server-owned evidence sections and every publish gate still run afterward.
- **Prevention**: Unit tests cover normal preservation and oversized truncation. Production logs expose the boundary decision without logging article text or evidence payloads.

## ERR-BLOG-research-scheduler-serial-timeout@2026-07-28

- [x] **ERR-BLOG-research-scheduler-serial-timeout@2026-07-28**: Intent-diverse preparation correctly continued past a weather-only ready buffer, but researched candidates serially and exceeded Vercel's 180-second function limit.
- **Root cause**: The scheduler added broader research coverage without changing the one-by-one execution model. A single invocation could make up to 12 full external research calls in series.
- **Fix**: Research candidates now run in bounded batches of three. The scheduler recalculates remaining numeric inventory, intent diversity, and request budget after each completed batch, and leaves unattempted rows queued.
- **Prevention**: Concurrency is an explicit exported constant with source-contract coverage. Release proof requires a protected production scheduler call to return before the function limit and runtime logs to contain no timeout.
- **Follow-up**: The first bounded production run completed in 69 seconds but exposed non-deterministic source reuse and shopping factual coverage. Identical in-flight official-page requests are now shared, and the reviewed Guam Visitors Bureau souvenir article deterministically supplies the authenticity and purchase-location facts. The versioned research recheck advanced to `v2` only after the concurrency-three live suite passed 10/10 intents.
- **Recovery contract correction**: Scheduler research failures are quarantined as `skipped`, while the first recheck script selected only `failed`. The recheck now accepts both states but requires durable research-failure markers for skipped rows, so repaired research can recover without reopening unrelated quality failures.

## ERR-BLOG-weather-only-research-and-backfill-false-pass@2026-07-28

- [x] **ERR-BLOG-weather-only-research-and-backfill-false-pass@2026-07-28**: Daily preparation researched only deterministic WMO weather rows, bulk-skipped other supported intents, and the legacy backfill treated some failed information contracts as publishable when its separate critical counter was zero. This could meet a five-post count with repetitive weather articles while describing unsupported legacy rewrites as minor cleanup.
- **Root cause**: Research scheduling used source implementation type instead of supported intent readiness, and backfill duplicated the publish decision with a weaker exception. Queue publication state was also not reconciled after linked product creatives were archived.
- **Fix**: Research preparation now prioritizes one queued candidate per intent and runs the shared live researcher for all ten supported intents. Unattempted rows remain queued. Backfill trusts only `qaReport.passed` and emits a weakest-dimension category scorecard. Versioned information-research recheck retries one deduplicated informational row per repaired intent, while queue health closes published rows whose linked creative is not published. Weather openings and headings vary by stable editorial metadata without adding unverified climate claims.
- **Prevention**: A raw daily count, average score, or green legacy critical counter is never sufficient. Release evidence requires the ten-intent live suite, full-corpus category floors, same-version retry suppression, linked-content reconciliation, and post-deploy public/indexing checks.
- **Verification**: The strict live suite passed 10/10 intents with full claim-source coverage. Focused research, scorecard, recheck, linked-state, phrase-drift, and weather generation tests pass; type-check passes. The full 161-row dry-run reports `publishBlocked=146`, proving unsupported legacy rows are now blocked instead of cosmetically written, while the current researched monthly-weather category remains above the 95 floor.

## ERR-BLOG-slot-quality-learning-retry-source-drift@2026-07-28

- [x] **ERR-BLOG-slot-quality-learning-retry-source-drift@2026-07-28**: The publisher could consume the whole daily quota at the first invocation, sub-95 components could pass through lower per-checker thresholds, Bayesian learning queried nonexistent `key/value` policy columns while reporting a soft success, the same failed editorial row could be requeued repeatedly, and the reviewed source registry was too narrow to support non-weather low-risk intents.
- **Root cause**: Daily quota and publishing slots were modeled separately; quality pass flags and score floors were inconsistent; optimizer storage drifted from the live `publishing_policies.meta` schema; backlog retries had no same-version idempotency key; and research authority was concentrated in weather/Guam documents plus hotel and flight domains.
- **Fix**: The publisher now computes cumulative KST due-slot quota, all scored publish components have a 95 floor, optimizer reads/writes `scope='global'` metadata and fails closed, and recheck suppresses a second failure under the same version. Direct-fetch migrations register intent-scoped official and reviewed secondary pages with explicit limitations; BudgetYourTrip and Rome2Rio were revoked after repeatable HTTP 403 from the production worker. Exact parsers now cover WMO monthly climate, GRTA schedules and current fares, Booking/Agoda hotel areas, USAGov/Guam Visitors Bureau currency and cards, and checked menu samples. Semantic gates cover every supported intent. High-risk entry and insurance rules are unchanged.
- **Additional live finding**: The first 10/10 research pass still exposed a stale secondary bus fare in a family-budget sample. Passing counts alone were therefore insufficient. Family research now includes official GRTA documents, deterministically injects current regular fares, removes conflicting secondary transit claims, and preserves lodging, meal, transport, and child/family evidence within the bounded bundle.
- **Prevention**: `remainingAfterRun` is due-now while `remainingDailyAfterRun` is observational; forced retries cannot publish future slots. Reviewed secondary data must be presented as a checked-date estimate and corroborated according to the intent contract. A current official operator value supersedes a conflicting secondary value. Advancing a backlog version requires a real source or repair change plus regression evidence.
- **Verification**: Targeted research/contract tests pass, the production-registry strict live suite passed all 10/10 supported intents with no readiness issue after the family-fare correction, and all checked claims had full claim-source coverage. Full test, type-check, lint, build, migration, and post-deploy public audits remain required release evidence.

## ERR-BLOG-image-relevance-and-generation-persistence@2026-07-19

- [x] **ERR-BLOG-image-relevance-and-generation-persistence@2026-07-19**: Automatic information posts could receive visually unrelated Pexels photos because the selector sampled random pages and the gate only checked destination words that the application itself wrote into alt/caption text. A separate AI image helper still called the retired Imagen 3 endpoint and returned temporary Base64 data URLs instead of public assets.
- **Root cause**: Image quantity and synthetic metadata were treated as relevance evidence. The live publisher did not inspect Pexels' original description, destination mappings missed cities such as Guangzhou, and the dormant AI path had no durable Storage step.
- **Fix**: Image selection now searches the first high-relevance page with destination + intent queries, scores provider descriptions, rejects visual conflicts, and uses OG only after no second contextual candidate exists. Guangzhou has an explicit Canton Tower/city mapping. AI generation uses Gemini 3.1 Flash Image through the Interactions API, uploads immutable content-hashed files to public `blog-assets/generated/blog/...`, and labels generated alt text as an AI reference image. Disabling AI generation still leaves Pexels fallback active.
- **Prevention**: Do not infer image relevance from application-generated alt text. Base64/data URLs cannot enter a public blog body. Generated visuals are presentation assets, never official-source or factual evidence. Runtime MCP is not an image provider; production uses explicit provider APIs with stored provenance and deterministic tests.
- **Verification**: `npx vitest run src/lib/blog-image-relevance.test.ts src/lib/blog-inline-images.test.ts src/lib/blog-image-gen.test.ts src/lib/blog-image-quality.test.ts`; targeted ESLint; `git diff --check`. No paid image-generation request or remote Storage upload was made during implementation.

## ERR-BLOG-fallback-source-prompt-drift@2026-07-19

- [x] **ERR-BLOG-fallback-source-prompt-drift@2026-07-19**: Recent public samples exposed three related quality-control gaps: a late repair could recreate deterministic fallback copy after the publisher's first blocker, Markdown image URLs and arbitrary external links could be counted as official-source evidence, and an active database prompt older than the repository contract could continue driving generation.
- **Root cause**: The fallback rule lived in one publisher branch instead of the shared publish contract; engine evidence extraction did not distinguish image links or validate source hosts; prompt selection trusted `is_active` without comparing versions.
- **Fix**: `evaluateBlogPublishQuality()` now blocks both deterministic fallback flags for every information-post publishing path. Official-source candidate extraction excludes images and non-official/unsafe hosts, while final factual trust remains owned by the server registry and claim-evidence gate. Prompt selection uses the repository guide whenever the database row is empty, malformed, or older than `BLOG_PROMPT_VERSION`, and records `prompt_source` for diagnosis.
- **Prevention**: A technical SEO/readability score can never override a publish-contract issue. Stock-image URLs are visual assets, not evidence. Active prompt rows must meet the current code version before overriding Prompt-as-Code. Food-budget and monthly-weather fallback examples remain locked as intent-contract regression tests.
- **Verification**: `npx vitest run src/lib/blog-publish-quality.test.ts src/lib/blog-engine-v2.test.ts src/lib/blog-official-source-url.test.ts src/lib/blog-prompt-selection.test.ts src/lib/blog-quality-gate-information-contract.test.ts`; `npx vitest run src/app/api/cron/blog-publisher/route.test.ts`; targeted ESLint; `git diff --check`.

## ERR-BLOG-info-fallback-and-ops-signal-leak@2026-07-15

- [x] **ERR-BLOG-info-fallback-and-ops-signal-leak@2026-07-15**: Information generation failures could be replaced by one broad deterministic travel template and still continue through publish gates. The same path also injected related-product counts, active-product counts, internal price ranges, and booking counts into information-writer prompts.
- **Root cause**: Quota recovery was allowed to substitute shape-complete boilerplate for intent-complete research, and product/booking operational signals were treated as originality evidence for informational articles.
- **Fix**: The publisher now hard-blocks deterministic fallback artifacts before any public write and no longer fetches or injects product/booking originality signals in `generateFromTopic()`. Customer quality also blocks explicit active-product and booking/consultation signal values.
- **Prevention**: Information posts may publish only from an intent-specific, evidence-backed candidate. Fallback copy can be private repair evidence only. Product inventory and reservation operations are never informational prompt inputs. Regression coverage lives in `src/app/api/cron/blog-publisher/route.test.ts` and `src/lib/blog-customer-quality.test.ts`.
- **Verification**: Run the focused Vitest files above, then `npm run type-check` and the standard blog quality/public customer audits.

## ERR-BLOG-legacy-surface-artifacts@2026-07-03

- [x] **ERR-BLOG-legacy-surface-artifacts@2026-07-03**: Public SEO/render audits found legacy generated surface text on live blog posts, including raw `::tip TL;DR`, lone list markers, paragraph-ending `---`, machine hyphen keywords, and markdown image residue inside headings.
- **Root cause**: The publish/backfill repair path handled core render artifacts, tables, and prompt residue, but did not normalize older article-level presentation traces that only become obvious in the rendered public article text.
- **Fix**: `repairBlogEditorialQuality()` and `repairBlogStructureQuality()` now remove legacy surface artifacts, normalize machine hyphen keywords into Korean reading text, clean image residue from headings, and repair broken split CTA wording before publish gates/backfill writes.
- **Prevention**: Public SEO/render audit failures for `surface_text_noise`, visible `TL;DR`, lone bullets, heading image residue, or machine keyword strings must become deterministic repair tests before live backfill.
- **Verification**: `npx vitest run src/lib/blog-editorial-repair.test.ts`; then focused `npm run audit:blog-quality -- --slug=<affected-slug> --write`, indexing drain, and public `npm run audit:blog-seo` / `npm run audit:blog-render:browser`.

## ERR-BLOG-audit-sample-partial-coverage@2026-07-03

- [x] **ERR-BLOG-audit-sample-partial-coverage@2026-07-03**: Render and SEO audits could report a perfect score while auditing fewer detail articles than the requested sample when `/blog` listing/API collection returned a partial set.
- **Root cause**: Audit collectors treated any non-empty source as enough. `audit-blog-render-integrity` only used sitemap fallback when listing pages returned zero links, and `audit-blog-seo-quality` returned API links immediately even if the API sample did not meet `--limit`.
- **Fix**: Render and SEO audits now normalize absolute and relative blog hrefs, ignore non-article collection pages consistently, and fill from sitemap whenever the collected article count is below the requested limit.
- **Prevention**: A 100 score for render, image, or SEO audits is only meaningful when `summary.totalLinks`/audited count matches the requested sample size, unless the sitemap itself has fewer public article URLs. Do not accept partial collection as a healthy fleet signal.
- **Verification**: `npm run audit:blog-render:browser -- --base=https://www.yeosonam.com --json --strict --limit=30 --timeout-ms=20000 --hard-timeout-ms=180000`; `npm run audit:blog-seo -- --base=https://www.yeosonam.com --json --strict --limit=30 --timeout-ms=20000 --hard-timeout-ms=180000`; `npm run audit:blog-search-daily:strict`; `npm run type-check`.

## ERR-BLOG-prompt-contract-drift@2026-06-22

- [x] **ERR-BLOG-prompt-contract-drift@2026-06-22**: Blog visual/publish rules were hardened to remove highlight clutter and malformed tables, but the live `blog-publisher` prompt still instructed the model to wrap key sentences with `==...==` highlights.
- **Root cause**: The durable blog contract, quality gates, renderer/CSS cleanup, and LLM writing prompt were not verified as one unit. Earlier checks proved existing rows and post-generation gates improved, but they did not prove the upstream prompt stopped asking for the old behavior.
- **Fix**: `src/app/api/cron/blog-publisher/route.ts` now explicitly bans `==...==`, `<mark>`, and highlight-style emphasis, and requires stable GitHub Flavored Markdown tables with a separator row and no blank lines inside table rows. `tests/regression/cases/ERR-BLOG-prompt-highlight-regression.test.js` locks this prompt contract.
- **Prevention**: Blog prompt changes count as blog automation behavior changes. They require a durable artifact through `scripts/check-doc-automation-contract.mjs`: a regression test, blog SSOT/runbook update, blog error entry, or audit note. Do not call a blog quality fix complete until prompt, repair, quality gate, and rendered output all enforce the same rule.
- **Verification**: `node tests/regression/cases/ERR-BLOG-prompt-highlight-regression.test.js`; `npx vitest run src/lib/blog-cta.test.ts src/lib/blog-quality-gate-accent-density.test.ts src/lib/blog-editorial-repair.test.ts`; `npx tsc --noEmit --pretty false`.

## ERR-BLOG-supabase-rest-522@2026-06-18

- [ ] **ERR-BLOG-supabase-rest-522@2026-06-18**: Production blog list/detail/API can appear empty or delayed when the Supabase REST/Data API returns 522 or never returns a response after an API key is accepted.
- **Observed production evidence**: `/api/blog?limit=3` returned `503 Blog database request timed out`, `/api/v1/health` reported `db:"timeout"`, and direct Supabase REST calls to `/rest/v1/content_creatives?select=id&limit=1` returned no body after 70 seconds with a valid legacy anon key. Supabase API logs showed repeated `522` for `content_creatives`, `travel_packages`, `active_destinations`, `cron_run_logs`, and other app tables.
- **Root cause status**: Not closed yet. This is below the blog query layer: even a one-row REST read times out, while unauthenticated REST returns `401` immediately. Supabase project status can still show `ACTIVE_HEALTHY`, so the app must not treat this as "no posts".
- **Additional finding**: The project exposes a new `sb_secret_...` key through the Supabase CLI, but this key returned `401 Invalid API key` against this project's REST/Data API. Production must prefer the verified legacy `SUPABASE_SERVICE_ROLE_KEY` while this migration remains unverified.
- **Mitigation already applied**: Blog list/detail/destination tabs/angle tabs/API now use explicit aborts plus `Promise.race` response timers, and render DB-unavailable states instead of silent empty lists or false 404s. `supabaseAdmin` key selection keeps `SUPABASE_SERVICE_ROLE_KEY` ahead of unvalidated secret-key aliases. Public blog list, detail, destination, and angle reads are cached with `unstable_cache` (`blog-list`, `blog-detail`, `blog-destination`, `blog-angle`) and only successful data is cached; timeout/unavailable fallbacks throw inside the cache scope so stale successful data can survive a later REST outage. `/api/blog` successful public responses include `stale-if-error=86400` for an additional CDN stale layer. `/sitemap.xml` no longer forces dynamic rendering; it revalidates hourly, runs package/destination/blog reads in parallel, caps public URL reads, and aborts each DB query after 2.5 seconds so crawlers cannot amplify a Supabase REST outage. Public surface monitoring now checks `/blog`, all 7 angle tabs, optional destination/detail URLs, sitemap, `/api/blog`, and `/api/v1/health`; cache revalidation also triggers best-effort warmup for the public blog surfaces.
- **Next recovery step**: Restart the Supabase project from the Dashboard if REST continues to 522 after load reduction. Supabase's HTTP API troubleshooting guide lists under-provisioning or ongoing workload as common causes and project restart as a temporary recovery step.
- **Prevention**: Do not add `SUPABASE_SECRET_KEY` to Vercel production until a direct REST one-row read succeeds with that key. When `/api/v1/health` is degraded, do not run "published count" cleanup or blog UI audits as if the data were authoritative. Public blog render paths must not depend on AbortController alone; every Supabase read that can affect the response must also have a `Promise.race` fallback timer. Any path that publishes, archives, regenerates, reindexes, or changes featured public blog posts must call `revalidatePublicBlogCache()` so list, detail, destination, angle, sitemap, and public warmup are handled together. `/api/ops/blog-system` must bound its own Supabase reads and return `public_surfaces` even when Supabase reads fail, so dashboard monitoring does not go dark during a DB outage; it remains protected by admin session or `Authorization: Bearer CRON_SECRET` server-to-server access. Keep automatic publishing clamped to 3-4 posts/day; higher targets increase DB/API pressure without improving public recovery.

## ERR-BLOG-queue-contract-drift@2026-06-17

- [x] **ERR-BLOG-queue-contract-drift@2026-06-17**: Blog automation could keep cycling through failures or misleading "published" counts because queue producers, publisher, and DB constraints did not share one queue contract.
- **Root cause**: `blog_topic_queue.angle_type` accepted free-form producer labels, while `content_creatives.angle_type` only allowed the final content angle set. Some producers used values like `trend` or `longtail`; programmatic/manual paths also sent `search_intent` as a top-level queue column even though the table has no such column. Separately, product lifecycle archiving changed `content_creatives.status` to `archived` but left linked queue rows as `published`.
- **Additional root cause**: `/admin/blog/policy` could show a daily target of 8 posts while `normalizeDailyPostTarget()` clamped the runtime target to 4, so `blog-publisher` stopped at 4 and the daily summary later reported an SLA miss.
- **Fix**: Added `src/lib/blog-queue-normalize.ts` and wired it into publisher, programmatic SEO, GSC longtail, trend miner, manual queue, and card-news queue paths. Search intent now moves to `meta.search_intent`; raw producer angle moves to `meta.raw_angle_type`; publishable `angle_type` is normalized to the allowed content angle set. `blog-lifecycle` now reconciles published queue rows whose linked article is no longer public. `blog-publisher` now reads the global publishing policy, and the daily target normalizer allows the 8-post policy used by the admin screen.
- **Production cleanup**: On 2026-06-17, live Supabase queue data was repaired: 17 active queue rows received a valid publish angle, 9 published/archived mismatches were moved out of published counts, and the DB source check was updated to include `gsc_longtail`.
- **Prevention**: Every queue producer must call `normalizeBlogTopicQueueRow()` before insert. New queue sources require DB constraint, admin label, and runbook updates. Unknown queue fields belong in `meta`, not in the table payload.
- **Verification**: `npm run type-check`; `npx vitest run src/lib/blog-queue-normalize.test.ts`; Supabase verification showed published queue/article mismatch `0`.

---

## ERR-BLOG-briefless-generation@2026-06-16

- [x] **ERR-BLOG-briefless-generation@2026-06-16**: A good seasonal seed such as `보라카이 7월` could drift into an irrelevant micro-topic such as air-conditioner lodging, then still pass technical SEO/render checks because the generator started from the queued topic instead of a validated search-intent brief.
- **Root cause**: The publisher had keyword research, SERP analysis, topic-fit gates, and editorial audits as separate pieces, but `generateFromTopic()` trusted `blog_topic_queue.topic` as the writing source of truth. SERP data was appended as prompt context after the topic was chosen; it did not first create a canonical content brief with primary keyword, secondary keyword cluster, intent, required H2 sections, forbidden angles, and source requirements.
- **Fix**: Added `src/lib/blog-content-brief.ts` and wired it into `src/app/api/cron/blog-publisher/route.ts`. Automatic topic generation now builds a `content_brief` before LLM writing, rewrites destination-month seasonal tangents into weather/clothing/preparation briefs, stores the brief in `generation_meta.content_brief`, and uses the brief primary keyword for publish quality gates.
- **Prevention**: No automatic informational post may treat a raw queue topic as the final writing contract. Topic queue input is only a seed; `content_brief` is the source of truth for final title, primary keyword, secondary keywords, required sections, forbidden angles, and source requirements. Repeated bad examples must become deterministic brief tests before they are considered learned.
- **Verification**: `npx vitest run src/lib/blog-content-brief.test.ts`; then run type-check, lint, and the production editorial audit before considering the pipeline healthy.

---

## ERR-BLOG-topic-fit-editorial-gate@2026-06-15

- [x] **ERR-BLOG-topic-fit-editorial-gate@2026-06-15**: Recent automatically published posts could pass high SEO/readability scores while still having reader-facing failures: machine-looking slugs, nonsensical longtail combinations, placeholder text, excessive highlight marks, generic image text, and related-content headings polluting article structure.
- **Root cause**: Existing automation optimized generation, keyword scoring, metadata, and renderer integrity, but topic suitability and Korean editorial quality were not hard blockers at the queue boundary and publish boundary. Public DOM audits also allowed table-required posts to pass with `tableCount=0`.
- **Fix**: Added `src/lib/blog-topic-fit-gate.ts`; connected `topic_fit` and `editorial_quality` to `runQualityGates()`; filtered scheduler, GSC longtail expansion, card-news enqueue, and manual topic enqueue before `blog_topic_queue` insert; made render audit fail table-required posts with no rendered table; removed `h2` from `InlineRelated`; disabled automatic comparison `<mark>` unless `BLOG_AUTO_COMPARE_MARK=1`.
- **Prevention**: No automatic path may treat `published` as complete until topic fit, editorial quality, rendered DOM, image quality, SEO, readability, and indexing evidence are present. Repeated bad examples must become deterministic gate rules or tests before the issue is considered closed.
- **Verification**: Run `npx vitest run src/lib/blog-topic-fit-gate.test.ts src/lib/blog-renderer.test.ts`; `npm run type-check`; `npm run audit:blog-render -- --base=https://www.yeosonam.com --limit=10 --json`.

---

## ERR-BLOG-legacy-backfill-preview-vs-write@2026-06-09

- [x] **ERR-BLOG-legacy-backfill-preview-vs-write@2026-06-09**: Editorial repair preview can pass the whole corpus while the DB write path still fails full publish quality. On 2026-06-10, `npm run backfill:blog-quality -- --limit=120` scanned 101 published posts and reported `qualityGateFailed=0`.
- **Root cause**: Older generated posts stored headings, prose, tables, FAQ, hashtags, and checklist blocks as collapsed one-line Markdown. Editorial intent repair catches the article contract, but write safety must also pass render, structure, image, SEO, CTA/internal links, and readability gates.
- **Fix**: Backfill is now dry-run by default, write mode is explicit, failed samples include `failedGates` evidence, renderer no longer treats hashtags as literal headings, raw `:::tip` insertion was replaced by safe HTML, legacy table/heading/checklist/FAQ repair handles the full published corpus, loose image Markdown is normalized, residual linked-image Markdown is rendered, official reference links are topped up, and SEO title/description/longtail coverage are repaired by topic type.
- **Prevention**: Never run `backfill:blog-quality:write` from preview results alone. Full write requires `qualityGateFailed=0` for the full batch, or a deliberately scoped slug batch with 0 failures and reviewable evidence. After write, re-run render/image/SEO/editorial/revenue audits and bulk reindex.
- **Verification**: `npx vitest run src/lib/blog-renderer.test.ts src/lib/blog-structure-audit.test.ts src/lib/blog-editorial-repair.test.ts src/lib/blog-content-intent.test.ts src/lib/blog-publish-quality.test.ts`; `npm run backfill:blog-quality -- --limit=120`; `npm run audit:blog-editorial -- --base=https://www.yeosonam.com --repair-preview`; `npm run audit:blog-revenue-funnel -- --strict`.

---

## ERR-BLOG-topic-fit-editorial-gate@2026-06-15

- [x] **ERR-BLOG-topic-fit-editorial-gate@2026-06-15**: Recent posts could receive high SEO/render scores while still being reader-hostile: machine slugs (`post-*`, `7-post-*`), placeholder text, malformed comparison/highlight wording, weak table rendering, and impossible destination/intent combinations such as `석가장 신혼여행`.
- **Root cause**: The pipeline scored technical SEO, render shape, and keyword density, but did not block invalid topic fit before queue insertion or final editorial quality before publish/backfill. Backfill also used slugs as fallback keywords even when real target keywords existed in `generation_meta`.
- **Fix**: Added `src/lib/blog-topic-fit-gate.ts`, wired `topic_fit` and `editorial_quality` into `runQualityGates()`, filtered queue insertion paths, repaired renderer loose-table normalization, disabled automatic comparison highlight by default, made slug migration repeat-safe, and made backfill use stored keywords before slug fallback.
- **Production cleanup**: Migrated five latest machine slugs, backfilled all repairable latest published posts, archived `shijiazhuang-itinerary`, queued `URL_DELETED` for the bad URL, and drained all indexing jobs.
- **Verification**: Latest published 10 dry-run returned `changed=0`, `qualityGateFailed=0`, `failedSamples=[]`; active indexing queue returned `0`; `npx vitest run src/lib/blog-topic-fit-gate.test.ts src/lib/blog-renderer.test.ts`, `npm run type-check`, and `npm run lint` passed.
- **Prevention**: A blog is not complete because SEO score is high. It must pass topic fit, editorial quality, render integrity, image quality, SEO, readability, and indexing evidence. Bad topic fit is quarantined, not rewritten into another public article.

---

## ERR-BLOG-editorial-intent-blindspot@2026-06-09

- [x] **ERR-BLOG-editorial-intent-blindspot@2026-06-09**: Existing audits reported render/image/SEO as 100, but production samples still contained bad article quality: informational weather posts with product-sales wording, preparation posts without checklist shape, weak tables/lists, wall-of-text paragraphs, and missing required blocks for the article intent.
- **Root cause**: The system used mostly shared prompts and shared publish checks. It validated that pages rendered and had metadata, but it did not enforce per-intent contracts such as weather/monthly table, preparation/checklist, itinerary/day structure, or product/price-departure facts. The old "100점" was therefore a technical render/SEO score, not an editorial quality score.
- **Fix**: Added `src/lib/blog-content-intent.ts`, `intent_quality` in `runQualityGates()`, prompt injection through `buildBlogIntentPromptContract()`, and `npm run audit:blog-editorial`.
- **Prevention**: New blog posts must pass `intent_quality`. Repeated audit issues must become a deterministic rule, fixture test, or publish gate before being considered learned.
- **Verification**: `npx vitest run src/lib/blog-content-intent.test.ts`; `npm run audit:blog-editorial -- --base=https://www.yeosonam.com --limit=20` found the previous blind spot with score 72/100 and 15/20 failures.

---

## ERR-BLOG-publish-quality-bypass@2026-06-09

- [x] **ERR-BLOG-publish-quality-bypass@2026-06-09**: `/api/blog` publish path was protected, but other live-entry paths could still flip a blog post to public without the same SEO/readability/render/image/structure gate. The missed paths were content queue approval, content hub publish/manual publish, distribution publisher `blog_body`, MRT hotel ranking immediate publish, backfill writes, and zero-click regeneration.
- **Root cause**: Quality logic existed in multiple places instead of a single publish contract. Earlier verification focused on the main auto publisher and public DOM audits, so admin/manual/distribution paths were not treated as equivalent public publishing.
- **Fix**: Added `src/lib/blog-publish-quality.ts` with `evaluateBlogPublishQuality()`. It runs `runQualityGates()`, `computeSeoScore()`, and `computeReadability()` together and stores `quality_gate`, `seo_score`, `readability_score`, and `readability_issues`.
- **Prevention**: Any future code that sets `content_creatives.status` to `published` or `manually_published`, or replaces a published blog body, must call `evaluateBlogPublishQuality()` first. Failure must block status update, indexing notification, and public revalidation.
- **Verification**: `npm run type-check`, `npm run lint`, `npx vitest run src/lib/blog-structure-audit.test.ts src/lib/blog-renderer.test.ts`, and `git diff --check`.

---

## ERR-BLOG-structure-contamination@2026-06-09

- [x] **ERR-BLOG-structure-contamination@2026-06-09** (렌더/이미지 감사 100점인데 본문 의미 구조가 깨짐): `/blog/zhangjiajie-weather` 실제 화면 점검에서 이미지는 보이지만 표 마지막 행에 문단이 빨려 들어가고, 나머지 셀이 비어 있으며, `:::` 원시 directive가 노출되고, `핵심 요약`/FAQ 블록이 중복·붕괴되고, 날씨 정보글에 `여소남이 이 상품을 고른 이유` 같은 상품 판매 어투가 섞였다. 기존 `render_integrity`는 `<img>`, heading, markdown artifact 중심이라 “HTML로는 렌더됐지만 의미 구조가 망가진 상태”를 통과시켰다.
- **Root cause**: 자동 점검이 DOM 존재 여부와 CSS overflow에 치우쳐 있었다. Markdown table collapse, admonition directive leak, checklist collapse, FAQ heading collapse, content-type tone mismatch를 발행 차단 기준으로 갖고 있지 않았다.
- **Fix**: `src/lib/blog-structure-audit.ts` 신규 추가. Cheerio로 렌더 HTML을 파싱해 `table_prose_contamination`, `raw_directive_leak`, `heading_shape_invalid`, `duplicate_core_block`, `checklist_shape_invalid`, `content_type_tone_mismatch`를 검사한다. `runQualityGates()`에 `structure_integrity` 게이트를 연결해 앞으로 같은 구조 오류는 발행 단계에서 실패한다.
- **Verification**: `src/lib/blog-structure-audit.test.ts`에 장가계 날씨 글에서 확인된 표 문단 오염, `:::` 누출, 중복 핵심 요약, 무너진 FAQ, 접힌 체크리스트, 정보글/상품어투 mismatch 회귀 테스트를 추가했다.
- **Prevention**: 블로그 자동화는 `render_integrity`, `image_quality`, `structure_integrity`, SEO 점수를 모두 통과해야 발행/배포/색인 요청으로 넘어간다. 이미지 URL 200, `<img>` 존재, table overflow 0만으로 정상 판정하지 않는다.

---

블로그 렌더링, 이미지 품질, SEO, slug 처리, 자동 발행 반복 오류 상세.

## ERR-blog-encoded-slug@2026-05-16

> Source: `db/error-registry.md` active checklist before docs/errors split.

- **Discovered**: 2026-05-16
- **Domain**: 블로그 slug 라우팅
- **Source vs result**: `/blog/[slug]` 정보성 블로그 25건이 일괄 404로 노출됐다. 2026년 5월 1일부터 5월 16일까지 발행된 한글 slug 글이 모두 영향을 받았다.
- **Root cause**: Next.js dynamic route가 한글 slug를 URL-encoded 문자열로 전달했는데, `[slug]` page handler가 decode 없이 `getPost(slug)`를 호출했다. Supabase 조회는 DB에 저장된 한글 원본 slug와 encoded parameter를 비교해 0건이 되었고 `notFound()`로 빠졌다.
- **Fix**: `src/lib/decode-slug.ts`의 `safeDecodeSlug()`를 도입하고 `page.tsx`와 `opengraph-image.tsx`에 모두 적용했다. `getPost` error 분기에는 `admin_alerts` 적재를 추가해 silent fail을 막았다.
- **Verification**: `tests/unit/lib/decode-slug.spec.ts` 5건.
- **Status**: FIXED
- **Prevention**: Dynamic slug route는 DB 조회 전에 반드시 decode한다. 다른 route에서 이미 쓰는 decode 패턴을 블로그 route에도 동일하게 적용한다.

---

## ERR-BLOG-render-markdown-skip@2026-06-07

> Original source before 2026-06-07 split: `db/error-registry.md:1014`

- [ ] **ERR-BLOG-render-markdown-skip@2026-06-07** (블로그 렌더 — 본문 이미지/표/링크 마크다운 원문 노출): 공개 `/blog/zhangjiajie-weather` 및 최신 블로그 샘플 12건에서 본문에 `##`, `![이미지](url)`, `[링크](url)`, 표 파이프가 그대로 노출되고 본문 이미지 3장이 `<img>`로 렌더되지 않음. 이미지 URL은 200이라 CDN 문제가 아니라 상세 페이지 렌더 판정 문제였음. **근본 원인**: `content_creatives.blog_html`은 "마크다운 + 안전한 HTML(`<figcaption>`, `<aside>`)" 혼합 저장값인데, 상세 페이지가 `<figcaption>` 존재만 보고 전체를 raw HTML로 오판해 `marked.parse()`를 건너뜀. **해결**: ① `src/lib/blog-renderer.ts` 공용 렌더러 추가 — 마크다운 신호(`#`, `![ ]`, 링크, 표, 리스트)가 있으면 HTML 태그가 섞여도 반드시 markdown으로 파싱. ② `/blog/[slug]` 상세 페이지가 공용 렌더러만 사용. ③ `runQualityGates()`에 `render_integrity` 게이트 추가 — 렌더 결과에 literal markdown artifact 또는 누락 이미지가 있으면 발행 차단. ④ `src/lib/blog-renderer.test.ts`로 `<figcaption>` 혼합 저장값 회귀 테스트 추가. **재발 방지**: 블로그 본문 렌더 변경 시 raw HTML 여부를 `<tag>` 존재만으로 판단 금지. 공개 QA는 이미지 URL 200뿐 아니라 DOM 내 `<article img>` 수와 본문 텍스트의 `![`, `##`, `[...](...)` 잔여 여부를 함께 확인.

---

## ERR-BLOG-render-integrity-audit@2026-06-07

> Original source before 2026-06-07 split: `db/error-registry.md:1029`

- [x] **ERR-BLOG-render-integrity-audit@2026-06-07** (블로그 전수 렌더 감사/재발 방지): 운영 `https://www.yeosonam.com/blog` 전체 링크 기준 99개 글 중 99개가 상세 본문 렌더 실패(`score=0`, `avgImages=0`, `avgArtifacts=45.2`)했다. CDN/이미지 URL 장애가 아니라 `blog_html`의 "마크다운 + 안전 HTML" 혼합값을 raw HTML로 오판한 렌더 엔진 문제였다. 해결 후 로컬 `http://localhost:3002`에서 `npm run audit:blog-render:browser -- --base=http://localhost:3002 --json` 실행 결과 99개 글 전부 통과(`score=100`, `failed=0`, `errors=0`, `avgImages=3`). 재발 방지 장치: `src/lib/blog-renderer.ts` 공용 렌더러, `render_integrity` 품질 게이트, `src/lib/blog-renderer.test.ts` 회귀 테스트, `scripts/audit-blog-render-integrity.mjs` 전수 감사 스크립트, `docs/blog-system-runbook.md` 운영 명령/100점 기준 박제. 운영 점검은 PPR/스트리밍 오탐 방지를 위해 반드시 `--browser-fallback`을 사용한다.

---

## ERR-BLOG-image-quality-gate@2026-06-07

> Original source before 2026-06-07 split: `db/error-registry.md:1031`

- [x] **ERR-BLOG-image-quality-gate@2026-06-07** (블로그 이미지 품질/주제 적합성 하한선): 렌더 복구만으로는 Pexels/OG 이미지가 실제 글 주제에 맞는지, alt/caption이 비었는지, 같은 글 안에서 중복되는지 보장할 수 없었다. 해결: `src/lib/blog-image-quality.ts` 추가, `runQualityGates()`에 `image_quality` 게이트 연결, `scripts/audit-blog-image-quality.mjs` 전수 감사 스크립트와 `npm run audit:blog-images` 명령 등록. 게이트는 최소 이미지 수, 빈 alt, generic alt, 중복 URL, 깨진 Pexels URL, 목적지/키워드 토큰 없는 alt/caption을 발행 전에 차단한다. 한계: 실제 사진의 시각적 의미 적합성은 자동으로 완전 판정할 수 없으므로 감사 스크립트의 제목 토큰/alt/caption 검사를 하한선으로 두고, 신규 목적지 대량 발행 전에는 실패 예시와 샘플을 사람이 확인한다.

---

## ERR-BLOG-image-audit-sample-collapse@2026-07-03

- [x] **ERR-BLOG-image-audit-sample-collapse@2026-07-03**: `npm run audit:blog-images -- --base=https://www.yeosonam.com --json --limit=30` could report 100/100 while auditing only one article. If the `/blog` listing temporarily exposed only a fallback/detail link, the script did not use the sitemap unless it found zero links.
- **Root cause**: The image audit treated "some links found" as enough coverage and returned early before filling the requested sample. Link extraction also only matched relative `/blog/...` hrefs, so it was brittle against absolute links and query-heavy listing markup.
- **Fix**: `scripts/audit-blog-image-quality.mjs` now normalizes absolute and relative blog hrefs, excludes blog collection/query/image links by parsed pathname, and supplements listing links from `/sitemap.xml` whenever the requested `--limit` is not reached.
- **Prevention**: Image audit success is only meaningful when `summary.totalLinks` matches the requested sample or the sitemap has fewer valid blog detail URLs. Do not accept a 100 score from a collapsed one-row sample as proof of public image health.
- **Verification**: `npm run audit:blog-images -- --base=https://www.yeosonam.com --json --limit=30 --timeout-ms=20000 --hard-timeout-ms=180000` now audits 30 posts and 90 images with score 100. `npm run audit:blog-search-daily:strict`, `npm run type-check`, and `git diff --check` passed.

---

## ERR-BLOG-quality-audit-minor-blindspot@2026-07-03

- [x] **ERR-BLOG-quality-audit-minor-blindspot@2026-07-03**: `npm run audit:blog-quality -- --limit=50` exposed `minorOnlyIssues=7` but did not show which posts or issue types caused the warnings, so operators could not distinguish harmless SEO length warnings from recurring naturalness or CTA problems.
- **Root cause**: The backfill/audit summary only emitted detailed samples for blocking quality failures. Publish-ready rows with non-blocking quality issues were reduced to a single count.
- **Fix**: `scripts/backfill-blog-quality.ts` now emits `minorIssueCounts` and `minorIssueSamples` with slug, SEO/readability scores, issue code, source, severity, message, and evidence for publish-ready warning rows.
- **Prevention**: Daily blog quality evidence must be diagnosable without raw DB reads. A nonzero `minorOnlyIssues` count is acceptable only when the JSON also shows the recurring issue classes and sample slugs.
- **Verification**: `npm run audit:blog-quality -- --limit=50` now identifies the current warning mix (`seo.title`, `seo.meta_description`, `seo.heading_structure`, `seo.image_seo`, `seo.url_slug`, `seo.internal_links_cta`, and one readability repetition warning). `npm run type-check` passed.

---

## ERR-BLOG-repeated-planning-phrase@2026-07-03

- [x] **ERR-BLOG-repeated-planning-phrase@2026-07-03**: Recent info posts could pass publish gates while repeating planning boilerplate such as "예약 전 비용, 일정, 현지..." enough times to trigger readability warnings and make the article sound templated.
- **Root cause**: Existing repairs deduped repeated FAQ/support blocks, but did not use the readability duplicate-phrase evidence to soften overlapping 5-word planning phrases scattered across keyword/checklist sections.
- **Fix**: `repairBlogEditorialQuality()` and `repairBlogStructureQuality()` now use `computeReadability().duplicate_phrases` to soften repeated travel-planning phrases after three exact uses, collapse duplicated replacement phrases, and leave already softened replacements stable.
- **Live repair**: `npm run audit:blog-quality -- --limit=50 --write` repaired five published posts, followed by a focused second write for `phuquoc-preparation` after idempotency tightening. The indexing worker processed the resulting jobs successfully.
- **Verification**: `npx vitest run src/lib/blog-editorial-repair.test.ts`, `npm run type-check`, `npm run audit:blog-quality -- --limit=50`, `npm run run:blog-indexing-worker -- --json --limit=15`, and `npm run diagnose:blog-autopublish -- --json` passed. Final quality dry-run reported `changed=0`, `qualityGateFailed=0`, and no readability minor issue.

---

## ERR-BLOG-product-seo-minor-false-positive@2026-07-03

- [x] **ERR-BLOG-product-seo-minor-false-positive@2026-07-03**: Recent product-consult posts passed publish gates but still showed minor SEO warnings for title, meta description, heading count, and image alt because the scorer treated them like generic info guides.
- **Root cause**: `computeSeoScore()` did not fully recognize product-consult decision signals such as package, departure, price-from, duration, fit/consult language, partial destination tokens in image alt text, or the bottom-soft CTA policy for info guides.
- **Fix**: The SEO scorer now gives product-consult credit for commercial decision metadata, accepts up to 8 H2 sections for product decision articles, matches split destination tokens in image alt text, treats one soft bottom CTA as valid for info guides, and accepts concise readable two-word English slugs after slug-quality validation.
- **Verification**: `npx vitest run src/lib/blog-seo-scorer.test.ts` passed, and `npm run audit:blog-quality -- --limit=50` reported `minorOnlyIssues=0`, `qualityGateFailed=0`, and `publishBlocked=0` without rewriting published rows.

---

## ERR-BLOG-card-news-dead-image-url@2026-06-07

> Original source before 2026-06-07 split: `db/error-registry.md:1033`

- [x] **ERR-BLOG-card-news-dead-image-url@2026-06-07** (카드뉴스 → 블로그 죽은 Storage 이미지 유입): `/blog/busan-danang-shilla-monogram-package-cn`에 Supabase `blog-assets` URL 2개가 400 응답인데 본문에 그대로 들어와 깨진 이미지가 노출될 수 있었다. 원인: `card_news.slide_image_urls`와 `publisher_bridge` 요청의 이미지 URL을 생존 확인 없이 신뢰함. 해결: `getSlideImagePublicUrlsForBlog()`와 `/api/blog/from-card-news`에서 공개 이미지 URL HEAD/GET 생존 확인 후 죽은 URL 제외, 상세 렌더 시 기존 저장 본문의 죽은 Supabase blog-assets 이미지는 제거. 최종 로컬 전수 감사: 이미지 품질 99/99 통과(`score=100`, `totalImages=299`, `failed=0`), 렌더 무결성 99/99 통과(`score=100`, `avgArtifacts=0`).

---

## ERR-BLOG-seo-threshold-too-low@2026-06-07

> Original source before 2026-06-07 split: `db/error-registry.md:1035`

- [x] **ERR-BLOG-seo-threshold-too-low@2026-06-07** (블로그 자동 발행 SEO 기준이 상위노출 기준이 아니라 최소 발행 기준이었음): 기존 `computeSeoScore()`는 최대 125점인데 자동 발행 통과 기준이 정보성 45점/상품형 35점이라 title/meta/schema/longtail 품질이 약해도 발행될 수 있었다. 해결: `src/lib/blog-seo-scorer.ts`를 100점 만점 엔진으로 재정의하고 자동 발행 기준을 정보성 85점, 상품형 80점으로 상향. critical fail(title, meta, heading, image SEO, internal CTA, structured data, helpful content)은 점수가 높아도 발행 차단. `blog-publisher`가 `blog_topic_queue.meta.keywords`를 `secondaryKeywords`로 넘겨 롱테일/보조 키워드 커버리지를 채점한다. 예방: SEO 기준 변경 시 `src/lib/blog-seo-scorer.test.ts`와 `npm run audit:blog-seo`를 함께 통과해야 한다.

---

## ERR-BLOG-seo-audit-missing@2026-06-07

> Original source before 2026-06-07 split: `db/error-registry.md:1037`

- [x] **ERR-BLOG-seo-audit-missing@2026-06-07** (공개 블로그 SEO 전수검사 부재): 렌더링/이미지 감사와 별개로 canonical, meta description, OG/Twitter, JSON-LD, H1/H2, 내부링크, 롱테일 제목 modifier를 실제 DOM 기준으로 전수 점검하는 명령이 없었다. 해결: `scripts/audit-blog-seo-quality.mjs`와 `npm run audit:blog-seo` 추가. 로컬 표본 10개 검증 결과 `score=100`, `failed=0`, `errors=0`, warnings 3건(short title/weak longtail modifier). 예방: 배포 전 로컬, 배포 후 운영 URL에서 `audit:blog-render`, `audit:blog-images`, `audit:blog-seo`를 모두 실행한다.

---

## ERR-BLOG-visual-blindspot@2026-06-08

- [x] **ERR-BLOG-visual-blindspot@2026-06-08** (블로그 시각 깨짐을 DOM 감사가 놓침): 사용자가 `/blog` 목록 사진 미노출, 상세 사진 깨짐, 삭제선 노출, 모바일 표 깨짐을 신고했다. 기존 운영 표본 감사는 render/image/SEO가 100점으로 보였지만, 실제 viewport 기준 감사가 없어 삭제선과 table overflow를 놓쳤다. 첫 visual audit은 lazy image를 스크롤 전에 판정해 이미지 깨짐을 과대 보고했으나, 스크롤 후 재감사에서 실제 남은 문제는 `/blog/zhangjiajie-weather` 삭제선과 모바일 table overflow였다. **해결**: `scripts/audit-blog-visual-system.mjs`와 `npm run audit:blog-visual` 추가, lazy image 스크롤 후 판정, 상세 렌더러의 `~~...~~`/`<del>/<s>/<strike>` 일반 텍스트화, `.prose-blog` table mobile overflow 방어, 카드 `og_image_url`이 generic `/og-image.png`일 때 본문 첫 실제 이미지를 썸네일로 승격. **검증**: 로컬 `http://localhost:3002`에서 `npm run audit:blog-visual -- --limit=3 --surface-limit=3 --json` 결과 `score=100`, `failed=0`; `npx vitest run src/lib/blog-renderer.test.ts` 16건 통과; `npm run type-check` 통과. **재발 방지**: 블로그 배포 전후 `audit:blog-visual --full --strict`를 render/image/SEO 감사와 함께 필수 실행한다.

---

## ERR-BLOG-gsc-property-split-audit@2026-06-08

- [x] **ERR-BLOG-gsc-property-split-audit@2026-06-08** (Search Console 속성 분리와 canonical 혼선 위험): Search Console에 `yeosonam.com` Domain property, `https://www.yeosonam.com/`, `https://yeosonam.com/` URL-prefix property가 같이 보여 색인 자동화가 non-www와 www 사이에서 갈릴 수 있는지 확인이 필요했다. **확인 결과**: Domain property와 URL-prefix property 공존 자체는 정상이다. 운영 redirect, canonical, `og:url`, sitemap은 `https://www.yeosonam.com`으로 수렴했다. **해결**: `scripts/audit-blog-gsc-domain.mjs`와 `npm run audit:blog-gsc-domain` 추가. 이 감사는 `http://`, non-www, www redirect, canonical, `og:url`, sitemap origin, `GSC_SITE_URL` 힌트를 검사한다. **검증**: `npm run audit:blog-gsc-domain -- --json` 결과 `score=100`, issue 0건. **재발 방지**: 색인 요청 전 `audit:blog-gsc-domain --strict`를 통과해야 하며, `GSC_SITE_URL`은 `https://www.yeosonam.com/` URL-prefix property 기준으로 맞춘다.
---

## ERR-BLOG-external-image-client-block@2026-06-09

- [x] **ERR-BLOG-external-image-client-block@2026-06-09** (external image URL passed server audit but failed in the reader browser): `/blog/zhangjiajie-weather` still showed broken article images after render/SEO/image URL audits reported 100. Browser inspection showed all three Pexels images had `naturalWidth=0` and collapsed visible height, while `curl` returned HTTP 200 for the same URLs. The root cause was relying on direct third-party image delivery (`images.pexels.com`) and audits that treated URL reachability as proof of visible rendering. **Fix**: added allowlisted `/api/blog/image` proxy, `src/lib/blog-image-proxy.ts`, renderer HTML rewriting, card/hero/related image display rewriting, metadata/JSON-LD proxying, and tests. **Verification**: `npx vitest run src/lib/blog-image-proxy.test.ts src/lib/blog-renderer.test.ts src/lib/blog-publish-quality.test.ts`, `npm run type-check`, and `npm run lint` passed. Local browser opened `/api/blog/image?src=<encoded pexels url>` with `naturalWidth=1880` and `naturalHeight=1253`. **Prevention**: public visual QA must measure browser-loaded dimensions and the blog system must never expose proxyable Pexels article images directly to the reader viewport.

---

## ERR-BLOG-mobile-heading-flex-overflow@2026-06-09

- [x] **ERR-BLOG-mobile-heading-flex-overflow@2026-06-09** (visual audit 94 after image fix): post images, markdown artifacts, strikethrough, and table overflow were clean, but mobile visual audit still found horizontal page overflow on `/blog/5-post-1k2q` and `/blog/nagasaki-34`. Browser inspection showed `.prose-blog h2` used `display:flex`; when generated headings accidentally included long FAQ/body text and `.num` strong nodes, those nodes became flex items and pushed the document width by 269-647px. **Fix**: changed `.prose-blog h2` back to normal block flow while keeping the numbered badge through `h2::before` margin/vertical alignment. **Verification**: injecting the same CSS into production reduced the two failing pages from 269px/647px overflow to 0px. **Prevention**: article typography must not use unwrapped flex layout for user/generated heading text; `audit:blog-visual --strict` remains the required gate for mobile horizontal overflow.

---

## ERR-BLOG-backfill-idempotency-and-audit-blindspot@2026-06-10

- [x] **ERR-BLOG-backfill-idempotency-and-audit-blindspot@2026-06-10** (quality backfill repeatedly changed stored posts and audits misread transient shells): `backfill:blog-quality -- --limit=120` kept reporting changes after write because generated sections and line-wrapped Markdown link labels were not idempotent. A later public render audit also reported `images=0/h2=0` or raw Markdown on posts that were normal in the browser because the audit counted Next script payload text or checked images before article images loaded. **Fix**: added final Markdown link-label normalization, idempotent guards for itinerary and longtail sections, trimmed stored HTML comparison, change-reason/debug diff reporting, render audit script/style removal plus retry for empty article shells, and image audit `article img` wait plus retry. **Verification**: `npm run backfill:blog-quality -- --limit=120 --debug-diff` now returns `changed=0`, `qualityGateFailed=0`; production `audit:blog-render` and `audit:blog-images` return 100/100. **Prevention**: backfill write must be followed by a second dry-run proving `changed=0`; audits must inspect rendered article content, not Next internal script payloads or first-tick loading state.

---

## ERR-BLOG-topic-fit-leak@2026-06-17

- [x] **ERR-BLOG-topic-fit-leak@2026-06-17** (bad queue topics could still publish): Queue rows could contain reader-hostile topics such as `7월 보라카이 에어컨 없는 숙소`, unsupported honeymoon pairings such as `석가장 신혼여행`, or duplicated product prefixes such as `연길/백두산 연길/백두산(...)`. The root cause was that topic-fit checks existed in some generation/quality paths but were not enforced consistently at every queue producer and again at publisher runtime. **Fix**: `evaluateBlogTopicFit()` now blocks Korean seasonal lodging tangents, bad honeymoon-destination pairings, and duplicate destination prefixes. `blog-publisher` re-runs topic fit before AI generation and quarantines failed rows as non-retryable `topic_fit`. `trend-topic-miner`, `programmatic-seo-generator`, and `promotePendingTopics()` filter topic-fit failures before queue insert. Live DB cleanup skipped 8 bad queued rows and left active bad-topic candidates at 0. **Verification**: `npx vitest run src/lib/blog-topic-fit-gate.test.ts src/lib/blog-queue-normalize.test.ts` and `npm run type-check` passed; Supabase showed queue counts `published 107`, `queued 14`, `failed 9`, `skipped 259`, with published mismatch `0`. **Prevention**: any new queue producer must call the topic-fit gate before insert, and the publisher remains the final backstop so historical bad rows cannot leak into publication.

---

## ERR-BLOG-gsc-url-inspection-noncanonical@2026-06-17

- [x] **ERR-BLOG-gsc-url-inspection-noncanonical@2026-06-17** (Google URL Inspection reported many unknown URLs): Recent GSC URL Inspection rows said `Google에는 아직 알려지지 않은 URL입니다.` for blog URLs, but the inspected URLs were stored as `https://yeosonam.com/blog/...` while the site redirects, canonical tags, OG URLs, robots sitemap, and sitemap locs use `https://www.yeosonam.com/blog/...`. The root cause was coupling the inspected URL host to `GSC_SITE_URL`; a non-www Search Console property caused the cron to inspect non-canonical URLs. **Fix**: `inspectUrlIndexState()` no longer rewrites the inspection URL to the GSC property host. `gsc-index-rank` now builds inspected URLs from the canonical public origin and tries multiple Search Console property candidates separately. `blog-ops-summary` counts `google_url_unknown` only for canonical `www` blog inspection records, so old non-www samples do not keep the system in false risk. **Verification**: `npm run type-check`, `npm run audit:blog-gsc-domain -- --json`, and `npm run audit:site-indexability -- --base=https://www.yeosonam.com --limit=30 --json` passed. **Prevention**: never rewrite URL Inspection targets based on the Search Console property host; the target URL must equal the public canonical URL.

---

## ERR-BLOG-weather-clothing-rainfall-only@2026-07-28

- [x] **ERR-BLOG-weather-clothing-rainfall-only@2026-07-28** (cold destinations received tropical clothing advice): The deterministic monthly-weather writer selected clothing from rainfall alone, so Sapporo in January could say to wear short sleeves. The generic legacy backfill also converted the reviewed 12-month tables into damaged prose, and the renderer could absorb the paragraph following a table as an empty-cell row. **Fix**: clothing now uses the verified minimum temperature first and adds rain gear separately; `monthly_weather:v2` blocks bypass destructive generic backfill and receive only the bounded clothing-table repair; the renderer restores a hard boundary after completed Markdown tables. The backfill primary keyword now prefers the stored content brief over a broad micro-angle label. **Verification**: focused generation, final-surface, and renderer tests pass; the production Sapporo repair dry-run reports `qualityGateFailed=0`, `publishBlocked=0`, and no minor SEO issues. **Prevention**: never infer seasonal clothing from precipitation alone, and never run generic prose/table rewrites across a persisted evidence-backed research block.
## ERR-BLOG-audit-policy-drift-and-image-timeout@2026-07-28

- [x] **ERR-BLOG-audit-policy-drift-and-image-timeout@2026-07-28**: The production publisher enforced the current exact-five cumulative KST slot policy, but the revenue-funnel source audit still required the retired three-to-four-post constants and the old `remainingToday` variable name. The daily summary also retained a redundant three-post alert floor, while the combined search audit killed the healthy 30-post image audit at 60 seconds.
- **Root cause**: Operational policy changed without updating every source-pattern assertion and timeout budget in the aggregate audit. The image audit needs about 63 seconds against production, so the aggregate wrapper misclassified a hard timeout as a quality failure.
- **Fix**: Align the audit with exact-five scheduler constants, `calculateBlogPublishSlotQuota()`, `remainingDueNow`, and the configured daily-summary target; remove the retired three-post floor; and use a 180-second default hard timeout for browser-backed daily checks.
- **Verification rule**: The standalone 30-post image audit must pass at 180 seconds, the revenue-funnel audit must score 100, and `audit:blog-search-daily:strict` must finish with every required check at 100.

## ERR-BLOG-weather-fleet-template-drift@2026-07-28

- [x] **ERR-BLOG-weather-fleet-template-drift@2026-07-28**: Thirteen evidence-backed monthly-weather posts passed their individual 100-point gates but repeated the same opening signature and H2 order, making the public fleet look mechanically generated.
- **Root cause**: Most rows predated editorial-variation metadata, the four-way assignment used a weak small-modulo hash, and `section_order_variant` changed labels without moving the actual sections.
- **Fix**: Version the variation contract, use a stable SHA-256 assignment, reorder the five intact weather sections, and let the existing-post backfill migrate only evidence-safe prose and structure while preserving claims, tables, sources, images, and canonical identity.
- **Verification rule**: The 13-destination regression fleet must use all four opening and section-order variants with no variant above five rows. Backfill write must be followed by an idempotent dry-run, public customer-quality/SEO/image audits, and fleet phrase-drift diagnosis.
- [x] **ERR-BLOG-climate-url-without-complete-data@2026-07-30** (a reviewed weather URL could be counted as research coverage even when its city climate table was empty, incomplete, or split across pages): A hostname and destination allowlist proved document relevance but not operational claim completeness. **Fix**: new climate destinations are admitted only after live deterministic parsing of the exact station, normals period, 12 months, and all four monthly decision fields. JMA temperature and precipitation tables are extracted with stable row markers and must jointly support each composite claim; the `>=1.0 mm` column is the explicit rain-day definition. Existing complete WMO single-feed evidence remains compatible. **Verification**: live WMO Xi'an and JMA Nagasaki/Shizuoka/Yufuin feeds each produced 12 complete claims with no fetch failures; incomplete or destination-mismatched fixtures fail closed. **Prevention**: never equate an HTTP 200 city page with research readiness, never substitute a nearby station without explicit review, and never attach a composite weather claim to only one of multiple source tables.
- [x] **ERR-BLOG-recovery-same-run-representative-duplicate@2026-07-30** (two legacy Manila weather URLs entered the same bounded recovery batch): Existing representative rows were checked before the loop, but the route did not reserve an accepted representative key inside that loop. Both rows therefore passed the same pre-run snapshot. **Fix**: keep an invocation-scoped selected-key set, persist the key on every quality-upgrade row, enforce a partial unique database index across all active upgrade states, and treat a unique race as a safe skip rather than a queue failure. The lower-quality broad monthly guide was upgraded to a live public score of 100; the later month-specific duplicate is redirected to it. **Prevention**: representative ownership must be protected both in process memory and in the database because cron invocations can overlap.
# ERR-20260831-02 — Guam Airport page fetch must not be the only multi-mode proof

- **Symptom**: The controlled airport-to-Tumon canary passed fare, duration, operating-hours, luggage, and late-arrival checks in production but still failed `airport_transport:multiple_modes` when the Guam Airport page was one of the direct-fetch failures.
- **Fix**: The deterministic GRTA Route 14 claims now identify the route as airport public transport. Together with the independently parsed Kakao T Guam taxi claims, the reviewed packet proves two modes even when the airport overview page is temporarily unavailable. The airport page remains an additional official mode source when fetched.
- **Regression proof**: A focused packet test removes the Guam Airport page entirely and still requires the complete airport-transport readiness gate to pass with GRTA and Kakao Mobility as two official domains.

# ERR-20260831-03 — Editorial duplicate gate must not cancel a bounded rewrite

- **Symptom**: The controlled Guam airport-to-Tumon canary passed source research, then correctly requested `rewrite_pro_high` after the first draft failed unsupported-number and reader-decision gates. The queue was nevertheless marked `skipped` before the second attempt.
- **Root cause**: The generic failure policy treated the V4 quality reason `publish_gate:duplicate` as proof of an existing canonical duplicate. It also allowed a generic non-retryable classification to override an explicit, attempt-bounded orchestrator rewrite or reresearch route.
- **Fix**: Duplicate detection now ignores only the editorial `publish_gate:duplicate` marker while preserving real slug, representative, recent-content, and dedup collisions. An explicit non-terminal orchestrator route queues immediately, clears stale quarantine metadata, and records the forced bounded retry; terminal quarantine and real duplicates still fail closed.
- **Recovery gap found by dry-run**: V6 correctly fixed future queue transitions, but the exact recovery dry-run kept the already-skipped production canary blocked because the older recheck contract admitted only research failures. No database write occurred.
- **Regression proof**: Queue-policy tests cover the exact production failure string and real duplicate variants. Publisher contract tests require the shared duplicate detector and forced-retry metadata. V7 additionally admits only a `user_seed` controlled/editor-approved canary with a persisted reviewed research bundle, the V4 single-rewrite evidence, and matching `rewrite_pro_high` route/next-stage; lookalike quality rows remain blocked.
