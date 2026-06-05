# Upload Registration Goal Completion Audit

Date: 2026-06-05

## Objective

End the structure where `upload/route.ts` directly decides product registration, centralize supplier raw upload registration into one standard registration object, and persist only results that pass verification.

## Requirement Evidence

| Requirement | Evidence | Status |
|---|---|---|
| `upload/route.ts` no longer owns product-registration decisions | `src/app/api/upload/route.ts` only calls `prepareUploadRequestIntake()` and `runUploadRegistrationPipeline()` after admin/env handling. Boundary tests assert no direct parser, price recovery, destination, itinerary, persistence, or V3 calls in route. | Proven |
| Upload flow is centralized | `src/lib/product-registration/upload-registration-pipeline.ts` owns duplicate, context, source resolution, archive, parse, normalize, prepare, runner, and completion orchestration. | Proven |
| Supplier raw forms converge into one standard object | `registerProductFromRaw()` returns `StandardProductRegistrationObject`; runner consumes `const registrationResult: StandardProductRegistrationObject = await registerProductFromRaw(...)`. | Proven |
| Price recovery is centralized | `recoverUploadPriceData()` is only used inside `register-product-from-raw.ts`; route and runner boundary tests reject direct price parser/recovery calls. | Proven |
| Price success requires both `product_prices` and `price_dates` | `price-recovery.test.ts` covers tier-only failure; `recoverUploadPriceData()` returns ok only when both rows and dates are present. | Proven |
| Destination/code resolution is centralized before code issuance | Runner uses `registrationResult.destination` after the standard object and before `issueUploadInternalCode()`. Boundary tests assert this order. | Proven |
| Itinerary normalization happens before deliverability and persistence | Runner reads `registrationResult.itinerary` before `registrationResult.deliverability` and before persistence; boundary tests assert ordering. | Proven |
| Deliverability gate blocks customer A4/mobile failures before persistence | Runner continues before persistence when `deliverability.ok` is false; `upload-product-runner.test.ts` and boundary tests assert no persistence on blocked results. | Proven |
| Final upload gate blocks persistence | Runner continues before `buildUploadPersistenceRows()` when `uploadGate === 'BLOCKED'`; tested in `upload-product-runner.test.ts`. | Proven |
| Product count/catalog split failures stop before persistence | `prepareUploadRegistrationProducts()` returns 422 for `CATALOG_SPLIT_REQUIRED` or `PRODUCT_COUNT_MISMATCH`; `upload-registration-pipeline.test.ts` asserts runner is not called. | Proven |
| `products`, `product_prices`, and `travel_packages` persistence is isolated | Persistence lives in `upload-persistence.ts` and row building in `persistence-rows.ts`; route has no direct table writes. | Proven |
| New failures have a clear extension point | Audit doc `2026-06-05-upload-registration-pipeline-centralization.md` records the rule: fixture -> parser/IR or registration object improvement -> recovery verification -> deliverability gate -> persistence. | Proven |

## Required Commands

```bash
npx vitest run src/lib/parser/deterministic
npx vitest run src/lib/product-registration
npx vitest run src/lib/upload-validator.test.ts src/lib/price-dates.test.ts src/lib/upload-verify.test.ts
npm run type-check
```

Observed:

```text
deterministic parser tests: 8 files / 64 tests passed
product-registration tests: 32 files / 143 tests passed
upload validator/price dates/upload verify: 3 files / 90 tests passed
type-check passed
```

## Additional Quality Gates

```bash
npm run eval:product-registration:ci
npx tsx scripts/audit-product-mobile-landing-readiness.mjs --strict --days=3 --limit=100 --json
```

Observed:

```text
supplier raw fixtures: 5/5 passing
field pass: 100%
deterministic LLM skip: 100%
duplicate second-pass skip: 100%
section reduce-ready: 100%
scenario coverage: 100%
customer deliverability corpus: 12/12 passing
price rows zero: 0
price dates zero: 0
destination UNK: 0
optional-tour price pollution: 0
deliverability blocked: 0
price storage mismatch: 0
render blocked: 0
recent DB readiness: 6 pass / 0 fail
code_unk: 0
no_customer_price: 0
product_ledger_price_mismatch: 0
render_blocked: 0
no_itinerary_days: 0
```

## Completion Decision

The current evidence proves the requested end state:

```text
route adapter -> centralized upload registration pipeline -> StandardProductRegistrationObject -> gates -> persistence
```

No required work remains for the stated objective.
