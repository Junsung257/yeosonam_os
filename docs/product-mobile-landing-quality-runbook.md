# Product Mobile Landing Quality Runbook

Last updated: 2026-06-20

This runbook is mandatory for any product-registration, attraction-matching, itinerary-normalization, price-recovery, or publish-gate change that can affect customer pages.

The completion target is not "DB saved" or "publish gate passed". The completion target is:

```text
supplier raw source
  -> saved product rows
  -> travel_packages itinerary/price payload
  -> /packages/{id} mobile customer render
  -> A4 render contract
```

## Why This Exists

On 2026-06-12, open Baekdu/Yanji products passed earlier readiness checks but still rendered poor customer mobile landing content. The root problem was a gap between structural readiness and semantic customer-page quality.

Earlier checks proved that products existed, prices existed, itinerary days existed, and pages returned HTTP 200. They did not fully prove that:

- customer-visible attraction cards were destination-correct.
- internal/non-publishable attraction masters were excluded.
- attraction photos existed for every rendered attraction card.
- optional-tour, price, catalog-header, and pure-transfer lines were not converted into attraction cards.
- duplicate attraction concepts such as `Baekdu Heaven Lake` and `Heaven Lake` were collapsed.
- source-backed flight departure/arrival times were preserved in the actual mobile flight card.
- source itinerary lines such as key transfers, visits, and final-day stops were not silently dropped.
- the live mobile page did not show wrong rich-card copy such as cross-region Huashan/Xi'an or Bohol massage content.

On 2026-06-15, a Nha Trang golf package showed a second class of failure: the saved product was structurally renderable, but the mobile landing still exposed wrong customer semantics. `3박5일` rendered as `4박5일`, `호텔 미팅후 / 나트랑 공항으로 이동` was saved as `day.hotel.name`, `석식 *토` and `일 주말...` were split into broken exclude fragments, and cart-fee surcharge rows appeared as optional tours.

This happened because readiness checks looked mostly at the existence of prices, itinerary days, and schedules. They did not compare `trip_style` against persisted `nights`, did not inspect `day.hotel.name`, did not scan exclude fragment corruption, and did not block optional-tour arrays polluted by surcharge/cart-fee text.

The same incident also exposed a route-scope verification gap. `/lp/{id}` and `/packages/{id}` do not share every render path. A product can be repaired on `/lp/{id}` while `/packages/{id}` still has no hero image, still displays a day-only duration chip such as `#5일`, or renders a final-day arrival-only flight row as `김해 출발`. Therefore `/packages/{id}` is the primary customer-detail proof surface; `/lp/{id}` is an additional landing proof, not a substitute.

## Non-Negotiable Rule

A product is not customer-ready until the actual mobile page is checked.

Do not report completion based only on:

- upload API success.
- `customer_publishable=true`.
- saved DB rows.
- V3 gate pass.
- A4 payload existence.
- static unit tests.
- admin confidence score.

Those are prerequisites. They are not final proof.

If post-save mobile QA finds a high or critical incident after a product has already been saved, the product must be removed from customer visibility by setting `travel_packages.status='pending_review'` and `audit_status='blocked'`. Logging to `ai_quality_log` or `admin_alerts` is not enough.

## Required Checks

For every newly opened product or any repair of already-open products:

1. Compare the supplier raw source against the saved product.
2. Confirm `product_prices` and `price_dates` agree with source-backed dates and amounts.
3. Confirm itinerary day count and day sequence match the source.
4. Confirm `trip_style`, `duration`, `nights`, and `itinerary_data.meta.nights/days` agree. `3박5일` must not render as `4박5일`.
5. Confirm source-backed outbound/inbound flight departure and arrival times are saved in `itinerary_data.flight_segments`.
6. Confirm source itinerary lines that affect customer understanding are present in the saved itinerary payload.
7. Confirm `day.hotel.name` contains only a real accommodation name. Movement text such as hotel meeting, airport transfer, checkout, or routing must stay in schedule/transfer items.
8. Confirm excludes and notices preserve source meaning. Broken fragments such as `석식 *토` followed by `일 주말...` are blockers.
9. Confirm optional-tour arrays contain real optional tours only. Cart fees, caddie tips, weekend surcharges, 2B/3B fees, and single-room charges are surcharge/exclude facts, not optional tours.
10. Confirm customer-visible attraction cards are supported by source phrases.
11. Confirm every rendered attraction ID is `customer_publishable=true`.
12. Confirm every rendered attraction card has usable media or intentionally renders text-only without wrong media.
13. Confirm option, price, shopping, notice, catalog-header, and pure-transfer lines do not become attraction cards.
14. Open `/packages/{id}` in a mobile viewport.
15. Open `/lp/{id}` in a mobile viewport when the product has an LP route.
16. Confirm both customer surfaces show a representative image when a safe destination/attraction image exists.
17. Confirm duration chips/cards use the source-backed `N박M일` value, not only `M일`.
18. Confirm final-day arrival-only flight rows render as arrival text and never as a new departure card.
19. Click or scroll into the itinerary tab/section.
20. Search the rendered body text for required itinerary terms, required flight times, and known forbidden terms.
21. Run the A4/mobile readiness audit.
22. Add or update a regression fixture when the failure came from parser/matcher behavior.
23. Add an error-registry entry when the failure was user-visible or repeated.

## Commands

General product-registration verification:

```bash
npx vitest run src/lib/product-registration src/lib/product-registration-v3 src/lib/itinerary-attraction-enricher.test.ts
npm run eval:product-registration:ci
npm run type-check
npm run build
```

Mobile/A4 readiness:

```bash
node scripts/audit-product-mobile-landing-readiness.mjs --public-only --strict --limit=2000 --json
npx tsx scripts/audit-mobile-attraction-photo-coverage.ts --status=active --limit=500 --json
```

Folder registration must pass `scripts/check-upload-db-health.ts` before HWP extraction, parser/LLM work, or mobile proof. If the preflight report says `DB_HEALTHCHECK_TIMEOUT`, the correct result is "not started because storage is unavailable"; it is not a parser failure and not a partial mobile verification.

When the healthcheck times out, run `scripts/diagnose-upload-db-health.ts`. `REST_TIMEOUT_OR_522` means the Supabase project host is reachable but `/rest/v1` table/API calls are timing out or returning gateway 522. In that state, do not retry bulk registration; keep producing extraction/offline audit artifacts only and retry persistence after REST health recovers.

If live `/packages/{id}` or `/lp/{id}` navigation times out while the Supabase project status is `ACTIVE_HEALTHY`, treat it as a live Data API pressure incident, not as a mobile UI pass/fail. Check Supabase API logs for repeated 503/504/522 on these patterns:

```text
travel_packages?select=*
travel_packages?select=...large JSON fields...
content_creatives ... limit=10000
active_destinations ... select=*
upload_review_queue ... long OR filters
cron_run_logs reads/writes during cron failure handling
```

Required mitigation before claiming recovery:

- Customer routes must not use `select('*')` for product detail or LP data.
- `/packages/{id}` must avoid duplicate same-package reads between metadata and page render when possible.
- Optional customer-detail sections such as blog recommendations, social proof, score comparisons, catalog siblings, and hero-photo fallback must fail fast and must not block core price/flight/itinerary rendering.
- Sitemap/home/background surfaces must use bounded limits and longer cache windows so they cannot starve product-detail reads.
- Cron retry loops must fail fast when DB reads time out; automatic replay jobs must not run every few minutes during an outage.
- Production runs with DB resource-saver behavior unless `DB_RESOURCE_SAVER_MODE=0` is explicitly set. In that mode, non-critical blog/marketing/ad/agent crons are skipped before they scan Supabase, and cron DB logging is suppressed so failure handling does not amplify the outage.
- Public customer/discovery routes must also honor resource-saver mode. Homepage, `/packages/{id}`, `/destinations`, `/destinations/{city}`, `/destinations/region/{region}`, `/blog/destination/{dest}`, `/things-to-do`, and `/things-to-do/{region}` should skip non-critical Supabase reads while `shouldSkipPublicDbReadsForResourceSaver()` is true. Do not add a new public Supabase-heavy route without the same guard or an explicit short timeout/fallback.
- Allowed resource-saver exceptions are only product-registration/customer-readiness maintenance jobs such as registration MV refresh, unmatched/entity resolution, attraction photo fill, and registration learning reports. One-off manual execution of a skipped cron requires an authorized `force=true` call after confirming DB health.
- When Supabase SQL execution or the performance advisor itself times out, do not keep retrying expensive SQL from the app. First deploy the traffic-shedding/code fix, then re-run advisors and apply hot-path indexes once `/rest/v1` health returns.
- Actual browser proof remains blocked until `/rest/v1` healthcheck succeeds and the mobile route reaches `domcontentloaded`.

During a DB outage, extraction-only reports may be produced with `scripts/register-upload-inbox.ts` without `--register`. These reports are useful source queues only when they include per-file hashes and extracted text paths. They do not prove saved products, customer pages, A4 readiness, attraction cards, or media quality.

HWP/HWPX handling is intentionally explicit:

- `.hwpx` is extracted directly from the document XML and can be used for unattended inbox runs.
- HWPX paragraph, table-row, and table-cell text boundaries must be preserved as line breaks or tabs. If a real supplier HWPX extracts to a near-single-line text blob, the result is not registration-safe because catalog splitting, price matrices, flight rows, meals, and itinerary days can all be misread.
- `.pdf` is a first-class unattended inbox input. The extractor must compare available free text extractors and keep the higher-quality result. `pdf-parse` is always available from the app dependency tree; `pdfplumber` may be used when `PDFPLUMBER_PYTHON` points to a Python environment with `pdfplumber`, or when the local bundled Codex Python runtime exists.
- PDF extraction quality must be scored before registration. Prefer text with itinerary/price/travel signals and reject or down-rank glyph-heavy output. A structurally present PDF is not enough if the title, price table, flight rows, or itinerary text is mojibake.
- `.hwp` binary extraction is allowed only when a non-GUI extractor such as pyhwp is available on the machine. The unattended inbox first tries `hwp5txt`; when that returns placeholder-only table markers, it must fall back to `hwp5html` and recover paragraph/table text from `index.xhtml`.
- HWP extraction output must also pass a quality threshold. Placeholder-only output such as repeated table/image markers is not registration-safe even if `hwp5txt` exits successfully. The HTML fallback is registration-safe when the recovered text has at least 900 meaningful non-placeholder characters and at least 8 meaningful lines.
- If no non-GUI HWP extractor is available, the inbox run must record `HWP binary extractor is not available` and stop before registration for that file.
- If a `.hwp` file has a same-stem `.pdf`, `.hwpx`, `.txt`, or `.md` companion, the unattended inbox should prefer the companion and skip that HWP path. This avoids Hancom permission popups and avoids counting known-unreadable HWP copies as product failures.
- Duplicate extracted raw-text hashes must be skipped before DB registration. They should remain visible in the extraction report as `duplicate_skipped`, but they must not trigger another parser/DB/mobile run.
- Do not drive the Hancom desktop app through permission popups as a hidden automation path. If the operator normally copies all text from HWP into `/upload`, the equivalent unattended input is a `.txt` file containing that copied supplier text.

After an extraction-only report exists, run the offline source audit before retrying registration:

```bash
npx tsx scripts/audit-upload-inbox-extracted-sources.ts --report=scratch/upload-inbox-batch-reports/{run}/report.json --limit=2000 --no-parser
```

This audit checks the extracted source queue against deterministic catalog splitting, source-backed price/date recovery, itinerary normalization, and the standard registration deliverability gate. It is still not mobile proof. The summary must keep `mobileLandingVerified=false` until the products are saved and the actual `/packages/{id}` mobile page plus A4 contract are checked.

For catalog-style supplier sheets with a shared price table before multiple `PKG` sections, the audit must verify that each product variant keeps the shared price table and selects the correct grade column by product title. A table such as `실속패키지 / 베이토우+미식 / 노팁노옵션` must not be treated as a hotel-column matrix; otherwise one variant can pass structurally while showing another variant's price.

Catalog split recovery must also reject false splits. If recovery finds only one section with real customer itinerary evidence and another section is just a title, fare preamble, or header fragment, the source must be processed as one product. A title-only pseudo-product must never create an `itinerary_missing` blocker or be registered as a customer product.

The offline source audit must also write `learning-events.json`, `offline-master-candidates.json`, and `macro-learning-report.json`. These files feed the same micro/macro learning loop with source hashes, blocker signatures, compared fields, offline master-candidate decisions, and offline audit status while REST persistence is unavailable. They are read-only learning artifacts: they must not store raw supplier text, must not mutate production parser rules, and must not be treated as customer mobile proof.

The same audit also runs `offlineMobilePreview` from the standard registration render input through `renderPackage()` and `mapTravelPackageToLandingData()`. This preview must remain labeled as offline evidence, but it is required to catch customer-render problems before persistence: empty customer prices, empty landing days, leaked internal fields, and food/hotel/massage labels rendered as sightseeing.

Offline source readiness and customer readiness are different. `publishableOffline` only means the standard registration object has enough source-backed structure to attempt persistence later. `customerReadyOffline` must remain separate and can be `0` when active attraction masters, photos/descriptions, shopping/option review, or high-risk notices cannot be verified. Any `v3:gate:*`, `v3:needs_review`, customer-visible unmatched attraction, or missing attraction description warning must become `customerReviewNeededOffline`, not a silent PASS.

When Supabase is healthy, export a reusable active-attraction cache for outage-safe audits:

```bash
npx tsx scripts/export-active-attractions-cache.ts --output=scratch/attractions/active-attractions-latest.json
npx tsx scripts/audit-upload-inbox-extracted-sources.ts --report=scratch/upload-inbox-batch-reports/{run}/report.json --limit=2000 --no-parser --active-attractions-json=scratch/attractions/active-attractions-latest.json
```

This cache is not a substitute for live DB/mobile proof. It only makes offline attraction matching, customer description checks, and media-readiness warnings more precise while REST is unavailable.

When REST is unavailable but archived attraction exports exist, build an outage-only cache from the archive before running the offline audit:

```bash
npx tsx scripts/build-active-attractions-cache-from-archive.ts --out=scratch/active-attractions-cache/from-archive.json
npx tsx scripts/audit-upload-inbox-extracted-sources.ts --report=scratch/upload-inbox-batch-reports/{run}/report.json --limit=2000 --no-parser --active-attractions-json=scratch/active-attractions-cache/from-archive.json
```

The archive cache must merge description-bearing archive CSV rows and filter out hotel, meal, restaurant, and wellness rows so they cannot become attraction cards. It may reduce offline unmatched/media warnings, but it still cannot mark `mobileLandingVerified=true`; only saved package ids plus live `/packages/{id}` and A4 proof can do that.

`offline-master-candidates.json` groups customer-visible unmatched attraction labels into automatic action buckets such as `create_internal_master`, `needs_review`, and `reject_noise`. Descriptive fragments, minimum-person conditions, generic cable-car text, and transfer phrases must not be promoted as attraction masters. Repeated probable attraction labels may become internal, non-customer-publishable master candidates, but customer-publishable masters still require external evidence and final mobile proof.

The offline summary must report both candidate counts and occurrence counts by action. `offlineMasterCandidateActions` tells how many normalized candidate groups exist, while `offlineMasterCandidateOccurrenceActions` tells how many raw unmatched occurrences those groups cover. This prevents repeated attraction candidates from being mistaken for unclassified errors after the micro/macro engine has already grouped them.

Every offline master candidate must include `photoSearchPlan` and `descriptionSeed`. `photoSearchPlan` is the media backfill plan only: it should use the normalized attraction name, known English/local aliases, and destination context. Do not use long supplier description sentences as photo aliases. `descriptionSeed` may keep source labels and hashes for review/evidence, but the final mobile description still needs external verification or an approved internal master before customer publication.

When REST recovers, resume from the extracted text queue instead of reopening HWP/HWPX files:

```bash
npx tsx scripts/register-upload-inbox-from-extract-report.ts --report=scratch/upload-inbox-batch-reports/{run}/report.json --register --fill-attraction-photos --audit-mobile --limit=2000
```

This resume command must run DB preflight first. If the preflight returns `DB_HEALTHCHECK_TIMEOUT`, no product registration or mobile proof has started. If it saves products successfully, `--fill-attraction-photos` should backfill media for referenced attractions first, and the `--audit-mobile` step must pass for the saved package ids before anything is marked customer-ready.

For unattended recovery, add `--wait-db --wait-db-timeout-ms=900000 --wait-db-interval-ms=30000`. This keeps retrying the DB preflight and starts registration only after the preflight is OK. If the wait expires, the output summary remains non-customer-ready with the failed preflight attempts recorded.

If `--report` is omitted, the resume command must select the valid extraction report with the most file rows, not a summary-only or small smoke-test JSON that happened to be written later. The final `summary.json` is authoritative for resume status: `mobileLandingVerified=true` is allowed only when saved package ids exist and the targeted mobile/A4 audit passes. Otherwise `mobileLandingVerificationReason` must explain whether there were no saved ids, the audit was not requested, or the audit failed.

For targeted saved-package proof, the mobile readiness audit accepts saved ids directly:

```bash
node scripts/audit-product-mobile-landing-readiness.mjs --package-ids={packageId1},{packageId2} --strict --json
```

Attraction card quality is part of mobile proof. A matched attraction with missing customer description is a blocker because the mobile page cannot explain the schedule professionally. A matched attraction with no photo is a warning and a fill-target, not a reason to drop the attraction card; the card must still keep the attraction name and source-backed description visible.

```bash
npx tsx scripts/audit-mobile-attraction-photo-coverage.ts --package-ids={packageId1},{packageId2} --json
npx tsx scripts/fill-attraction-photos.ts --package-ids={packageId1},{packageId2} --limit=200 --json
```

Full attraction/media quality engine:

```bash
npm run quality:product-mobile-engine
npm run quality:product-mobile-engine:apply
```

Targeted Baekdu/Yanji repair and audit:

```bash
npx tsx scripts/repair-baekdu-mobile-landing.ts
npx tsx scripts/repair-baekdu-mobile-landing.ts --apply
npx tsx scripts/repair-baekdu-flight-and-source-lines.ts
npx tsx scripts/repair-baekdu-flight-and-source-lines.ts --apply
```

## Browser Proof Requirement

For active/open products, at least one representative page per raw supplier source must be checked in a mobile viewport. If one raw source created multiple variants, sample across the variants and run DB-level checks across all variants.

The browser check must verify:

- HTTP status is 200.
- at least one usable hero/representative image is rendered when image data exists or can be resolved from destination.
- the itinerary tab/section is reachable.
- the route being checked is explicit: `/packages/{id}` and `/lp/{id}` findings must be reported separately.
- source-backed `N박M일` duration is visible and no fallback `M일`-only chip/card replaces it on `/packages/{id}`.
- source-backed outbound and inbound flight times are visible.
- final-day arrival text is not inverted into `{homeCity} 출발`.
- required source terms are visible in the rendered customer text.
- known wrong terms are absent.
- images are present when the itinerary contains attraction cards with media.

For Baekdu/Yanji, the required flight-time checks include:

```text
BX337: 09:40 -> 11:30
BX338: 12:30 -> 16:25
BX3175: 09:05 -> 11:00
BX3185: 12:00 -> 16:00
```

For Baekdu/Yanji, the forbidden regression terms include:

```text
서안,화산의 관광 명소 화산
화산은 지하 마그마
보홀에서 즐기는 전신 오일 마사지
전통오일마사지는 보홀
```

## Attraction Matching Rules

Upload enrichment must use all active attraction masters for semantic matching:

```text
attractions.is_active = true
```

Do not filter matching candidates by `customer_publishable`. That flag is a customer-rendering quality flag, not a semantic matching flag. Filtering upload matching by `customer_publishable=true` caused active masters such as `악화폭포`, `연길민속촌`, `수목한계선`, and `36호 경계비` to be invisible to the registration engine even though they were already registered.

Customer rendering must still be protected separately:

- A matched active master may be used to preserve `attraction_ids` and prevent unmatched queues.
- A rich customer card may render only when the render contract has enough safe customer-facing data: destination-compatible master, source-supported phrase, and usable text/media or intentional text-only fallback.
- If a master is internal, unverified, region-mismatched, or media-broken, the itinerary phrase must remain visible as normal schedule text and must not attach a wrong rich card.

The mobile readiness audit must fail when a registered active attraction term appears in a customer-visible schedule line but the saved item has no `attraction_ids`. Pure transfer lines such as `백두산 북파로 이동 (15분 소요)` are exempt unless they also contain visit/tour/walk/viewing hints.

Strip attraction references from:

- local-payment option lines.
- optional-tour price rows.
- shopping center rows.
- catalog price/header rows.
- pure-transfer rows without a visit/tour/walk hint.
- perks such as massage or special meals unless explicitly modeled as a customer-safe non-attraction entity.

Deduplicate overlapping concepts:

- prefer `백두산 천지` over generic `천지`.
- prefer a destination-specific spaced canonical name over duplicate spacing variants.
- never map `36호 경계비` to `37호 경계비`.
- never map `악화폭포` to `백두산 천지` only because the same sentence contains `백두산`.

Route-scope compatibility must reflect the actual package course, not only the title destination string. For Yanji/Baekdu packages, attraction matching includes the recurring course regions:

```text
Yanji, Baekdu/Changbai Mountain, Yanbian, Tumen, Longjing,
Songjianghe, Erdaobaihe, North Slope, West Slope, South Slope
```

This prevents registered terms such as `두만강 강변공원` from being excluded only because the product destination says `연길/백두산` while the attraction master region says `도문` or `연변`.

## Incident Response

When the user reports a bad mobile landing:

1. Query all active/open variants for the same raw source or destination.
2. Extract all itinerary `attraction_ids` and join to `attractions`.
3. Fail the audit if any referenced attraction is not customer-publishable or has no photo when a rich card is rendered.
4. Check for cross-region or unrelated copy in live mobile text.
5. Repair saved data only when the deterministic mapping is source-supported.
6. Patch the central engine so the same source shape cannot recreate the same failure.
7. Add or update tests and this runbook/error registry.
8. Re-run mobile browser proof after deployment.
9. If the failure is found after save, confirm the package was demoted to `pending_review`/`blocked` until the repair passes strict readiness.

## 2026-06-12 Baekdu/Yanji Proof

Open active products repaired and verified:

```text
06c8cb20-9257-4f58-b246-b3a5cc427d71
de1c3c29-a7ce-4652-ae25-abc021d86c69
4586930d-1830-4f72-b790-0aebf02bea8a
1d5776d4-a9b6-4043-a44c-c493cd95272b
063825a7-48bc-4b4e-8bd0-a290879ce57a
ab671acd-9dae-41a8-9fa8-a5ae2b5db607
f0fe98e2-ac82-4a83-86bb-009cdece2c56
d29809e7-fb39-458c-b5b0-efaf76fd9d0f
3c3ed200-b1fc-419e-b411-89304010a075
64019572-243b-4a2c-81fa-0d8f4dcbce60
1af1690c-6e37-4db1-bef4-cb351546e462
```

Verified result:

- all 11 live pages returned HTTP 200.
- itinerary section rendered in mobile viewport.
- required Baekdu/Yanji itinerary terms were visible.
- forbidden Huashan/Xi'an and Bohol massage copy was absent.
- attraction photo coverage was 101/101.
- regression tests, type-check, product-registration eval, and production build passed.
