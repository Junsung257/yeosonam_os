# Product Registration Engine Audit - 2026-06-15

## Scope

This audit covers the source upload to customer mobile/A4 readiness path:

1. Admin upload route and registration pipeline
2. Catalog split and supplier raw deterministic extraction
3. V3 matching/gate/customer render blockers
4. Historical `upload_review_queue` replay verification
5. Mobile landing readiness and media quality scripts

## Current Engine Shape

The engine is not one monolithic function. It is a single product-registration workflow composed of these stages:

- Upload intake and section jobs
- Catalog/product split recovery
- Deterministic supplier raw facts
- Model-assisted extraction fallback
- V3 match/gate evaluation
- Mobile/A4 readiness audit
- Historical failure replay and learning verification

This split is appropriate. The issue was not that the process was split; the issue was that replay coverage was incomplete and partial coverage could look like a pass.

## Confirmed Coverage

The following historical blocker class is now replay-checked from real `upload_review_queue` rows:

- Inline `PKG` catalog boundary errors
- `PKG` followed by markdown separators before the product title
- Duplicate day numbers caused by multiple products being parsed as one
- Duration overflow caused by multiple products being parsed as one

Current live replay result on 2026-06-15:

- Source rows: 61
- Deduped rows: 42
- Checked rows: 5
- Passed rows: 0
- Partial rows: 5
- Failed checked rows: 0
- Skipped rows: 37

The 5 checked rows are partial because their itinerary split blockers no longer reproduce, but other blocker codes remain unverified by deterministic replay checkers.

## Critical Gap Fixed In This Audit

Before this audit, a historical queue row with both supported and unsupported blocker codes could be reported as `passed` when only the supported itinerary checker passed.

That was misleading.

The verifier now distinguishes:

- `passed`: all detected codes on the row are covered and passed
- `partial`: supported checks passed, but unsupported blocker codes remain
- `failed`: a supported historical blocker still reproduces
- `skipped`: no deterministic checker exists for the row's codes

The CLI now prints both total code counts and uncovered code counts.

## Remaining Uncovered Blocker Families

As of this audit, the largest uncovered deterministic replay categories are:

- `CUSTOMER_RENDER_BLOCKED`
- `PRICE_ROWS_MISSING`
- `PRICE_DATES_MISSING`
- `MODEL_PRICE_UNSUPPORTED`
- `SUPABASE_NOT_CONFIGURED`
- `PERSISTENCE_CONSTRAINT_FAILED`
- `DESTINATION_UNRESOLVED`
- `FLIGHT_TIME_MISMATCH`
- `PRICE_DATE_DISAGREEMENT`
- `REQUEST_SCOPE_ERROR`
- `UNKNOWN_BLOCKER`

These must not be treated as resolved just because catalog split replay passes.

## Unnecessary Or Lower-Value Process

No major redundant production path was removed in this audit.

The low-value pattern to avoid is adding more manual one-off scripts that are not wired into:

- `npm run verify:product-registration-learning`
- historical queue replay
- mobile/A4 readiness verification
- a regression fixture

One-off repair scripts can still be used for backfill, but they should not be counted as engine improvement unless they add a repeatable verifier or fixture.

## Next Required Checkers

Priority order:

1. Price checker: verify source-backed price rows/dates against recovered product branches.
2. Flight checker: verify flight route, carrier, flight number, and time windows from source text.
3. Destination checker: verify destination code resolution with source context and reject cross-region attraction matches.
4. Customer render checker: render mobile/A4 payload from the replayed draft and assert no itinerary/meal/hotel/attraction leakage.
5. Persistence checker: replay minimal DB write contract for known constraint failures in a dry-run mode.

## Operating Rule

For future uploads, "registered" is not enough.

A product should be considered customer-openable only when the latest source upload passes:

- Product branch split
- Price/date source audit
- Destination resolution
- Flight/transport extraction
- Itinerary day integrity
- Meal/hotel/option/shopping classification
- Attraction matching and media fallback
- Mobile landing payload render
- A4 payload render

