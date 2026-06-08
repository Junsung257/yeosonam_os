# Product Registration Learning Engine Audit

Date: 2026-06-08

This is evidence for the self-improving product-registration engine work. The current operating rules remain in `docs/product-registration-current-ssot.md`.

## Scope

- Micro auto QA repair loop: deterministic pre-save repair, one normal attempt plus up to three capped repair/final attempts, phase-named ledger events.
- Macro learning loop: durable ledger report, pattern mining, review-required promotion work items.
- Customer readiness: mobile `/packages`, LP mapping, A4 render contract, `product_prices`, `price_dates`, V3 draft status.
- OCR/PDF candidates: benchmark-only harness, no production OCR dependency.
- Operator visibility: `/admin/registration-monitor` learning panel and score display.

## Evidence

All commands were run from the repo root on 2026-06-08.

```text
npx vitest run src/lib/product-registration/learning-engine-integration.test.ts src/lib/product-registration/upload-route-boundary.test.ts src/app/admin/registration-monitor/page.test.ts src/components/AdminLayout.test.ts
Result: 4 files passed, 35 tests passed.

npm run type-check
Result: passed.

npx vitest run src/lib/parser/deterministic src/lib/product-registration src/lib/upload-validator.test.ts src/lib/price-dates.test.ts src/lib/upload-verify.test.ts
Result: 55 files passed, 344 tests passed.

npm run eval:product-registration:ci
Result: supplier raw fixtures 5/5, field pass 100%, deterministic LLM skip 100%, duplicate second-pass skip 100%, section reduce-ready 100%, scenario coverage 100%, customer deliverability corpus 12/12, blocker counts 0.

npm run benchmark:product-ocr:ci
Result: candidates 5/5 customer-ready; table, price rows, price dates, itinerary days, flight, hotel, meal, evidence spans, and final mobile/A4 outcome all passed.

node --check scripts/audit-product-mobile-landing-readiness.mjs
Result: passed.

npm run audit:product-mobile-readiness -- --strict --days=365 --limit=30 --json --public-only
Result: total 5, public_total 5, pass 5, warn 0, fail 0, public_fail 0.
```

The same gates are now codified as:

```text
npm run verify:product-registration-learning
npm run verify:product-registration-learning:live
npm run verify:product-registration-learning:full
```

`npm run verify:product-registration-learning:full` was run after the runner was added. It passed the focused tests, full product-registration regression tests, type check, golden corpus eval, OCR benchmark, live 365-day public mobile/A4 audit, and production build in one sequence.

After the completion audit, the ledger contract was tightened so capped automatic improvement means `attempt 0` normal registration plus `attempt 1..3` repair/final audit phases. The full verification runner was re-run after this adjustment and passed focused tests, full regression tests, type check, golden corpus eval, OCR benchmark, live 365-day public mobile/A4 audit, and production build.

Remote Supabase migration `20260607180750_product_registration_improvement_attempt_phase` was applied to project `ixaxnvbmhzjvupissmly`. The remote `product_registration_improvement_events` table now has `attempt_phase`, a default of `normal_registration`, an allowed-phase check constraint, and the `(attempt_phase, created_at desc)` index.

## Deep Recheck Follow-Up

The follow-up audit found two missed issues:

- `price_dates` alignment was one-directional. It checked that every calendar date existed in `product_prices`, but did not check that every positive `product_prices.target_date` existed in `price_dates`. This could hide a sellable date from the customer calendar. The deliverability gate and Micro Auto QA now check both directions, rebuild missing date-level summaries from `product_prices`, and include regression tests.
- `npm run audit:drift:ci` failed on 29 existing customer packages where ambiguous `optional_tours` names such as massages had no `region`. A dry-run/apply repair script was added as `npm run repair:optional-tours-region-drift` and `npm run repair:optional-tours-region-drift:apply`; 29/29 remote rows were repaired. Re-running the drift audit now reports 0 package drift and 0 attraction drift.

The product-registration verification runner now includes the phase-contract tests, price deliverability tests, ledger persistence/report tests, and migration prefix audit so these misses are covered by the standard command.

## Live Audit Adjustment

The live readiness audit now treats latest V3 draft state as authoritative for customer-visible publication:

- strict mode fails if latest V3 draft is `blocked`, `needs_review`, or missing.
- latest `product_registration_drafts.match_summary.attraction_unmatched_count` is used before stale `unmatched_activities` queue rows.
- legacy queue fallback counts only unresolved `pending` rows.

This avoids treating old operational queue noise as a customer render failure while still blocking actual V3 customer-readiness failures.

## Stored Live Sample Learning Verification

The saved-sample learning audit was run against live `travel_packages.raw_text`, persisted `product_prices`, and the durable `product_registration_improvement_events` ledger.

```text
npm run verify:product-registration-live-samples:ci
Result: 20/20 stored samples passed; learning events 4; macro candidates 5; promotion work items 0; score micro 100, macro 65, combined 83; direction aligned.

npm run verify:product-registration-learning:live
Result: focused tests 8 files / 54 tests passed; product-registration regression 55 files / 347 tests passed; type check passed; golden corpus 5/5 and customer deliverability 12/12 passed; OCR benchmark 5/5 passed; migration prefix audit passed; stored live sample verification 20/20 passed; live public mobile/A4 readiness 5/5 passed.
```

The actual ledger exposed a direction bug: four successful phase events from one raw-text hash were being treated like enough evidence for promotion. Macro promotion now requires at least three independent raw-text hashes, and deterministic auto-fix success rate is calculated only over deterministic-fix events. The live report now correctly returns zero promotion work items for the current evidence window. This matches the SSOT rule that repeated attempts from one source are not independent supplier evidence.

## Ticketing Deadline Open/Archive Pass

The ticketing/mobile landing pass was run on 2026-06-08 KST with `scripts/audit-open-archive-ticketing-products.ts`.

```text
npx tsx scripts/audit-open-archive-ticketing-products.ts --json --limit=1000 --today=2026-06-08
Result before apply: open candidates 0, archive candidates 3, future-ticketing non-public 1.

npx tsx scripts/audit-open-archive-ticketing-products.ts --apply --json --limit=1000 --today=2026-06-08
Result: opened 0, archived 3, product rows archived 3.

npx tsx scripts/audit-open-archive-ticketing-products.ts --json --limit=1000
Result after apply: open candidates 0, archive candidates 0, future-ticketing non-public 1.
```

The three archived customer-visible rows were blocked because their mobile landing could not build customer price options from `product_prices`:

- `PUS-TC-CXR-05-0013` / `나트랑/달랏 3박5일 (진에어)`
- `PUS-TC-CXR-05-0012` / `나트랑/달랏 3박5일 (진에어)`
- `PUS-ETC-UNK-05-0023` / `PR 마닐라 다색골프+시내숙박`

The only non-public row with a remaining ticketing deadline was `PUS-ETC-CXR-05-0002` (`2026-06-12`). Source reprocessing, persisted prices, itinerary, and mobile render passed, but V3 returned `blocked` because high-risk standard notice/structured fact values need review and 12 unmatched attraction events require review. The blocked V3 draft was persisted as `edb2d32b-2e2a-4a1a-9de5-84d82b5e9851`, so this product remains closed until review clears those blockers.

Post-apply verification:

```text
npm run audit:product-mobile-readiness -- --strict --days=365 --limit=50 --json --public-only
Result: public_total 5, pass 5, fail 0, price_storage_mismatch 0, render_blocked 0, v3_blocked 0, missing_v3_draft 0.

npm run verify:product-registration-learning:live
Result: focused tests, product-registration regression, type check, golden corpus, OCR benchmark, stored live samples, and live public mobile/A4 readiness all passed.
```

## Residual Notes

- The 2-day public live audit returned zero rows, so it is a freshness check but not strong proof by itself.
- The 365-day public live audit is the stronger current data evidence.
- Macro production mutation remains intentionally disabled; promotion outputs are review-required work items, not direct parser edits.
- Current macro score is intentionally not production-ready because the persisted learning ledger has only 4 events from 1 independent source. More real supplier documents must be collected before macro rule promotion.
