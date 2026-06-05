# Upload Registration Pipeline Centralization Audit

Date: 2026-06-05

## Current Pipeline Map

The upload API route is now a thin HTTP adapter:

```text
src/app/api/upload/route.ts
  -> prepareUploadRequestIntake()
  -> runUploadRegistrationPipeline()
  -> NextResponse.json()
```

The registration engine lives in `src/lib/product-registration/`:

```text
prepareUploadRequestIntake
  -> parse text/file input
  -> source metadata and commission validation
  -> input quality guard
  -> upload buffer/hash/mode

runUploadRegistrationPipeline
  -> initial duplicate check
  -> load upload context
  -> resolve upload source
  -> archive-only save, if requested
  -> parseUploadDocumentForRegistration
  -> normalizeUploadRegistrationDocument
  -> prepareUploadRegistrationProducts
  -> processUploadRegistrationProducts
  -> completeUploadRegistration

runUploadRegistrationPipeline.test
  -> duplicate stops before context loading
  -> archive stops before parsing/normalization/runner
  -> preparation failures stop before runner/persistence
  -> runner receives only prepared standardized products

registerProductFromRaw
  -> deterministic product fixes
  -> supplier raw facts
  -> price recovery
  -> destination/code resolution
  -> itinerary normalization
  -> customer deliverability gate
  -> StandardProductRegistrationObject

processUploadRegistrationProducts
  -> registerProductFromRaw -> StandardProductRegistrationObject
  -> final upload gate
  -> build persistence rows
  -> persist products/product_prices/travel_packages
  -> schedule review/sidecar tasks
```

## Price Data Ownership

Price recovery is centralized in `src/lib/product-registration/price-recovery.ts`.

Success means both stores are populated:

```text
price success = product_prices.length > 0 AND price_dates.length > 0
```

The route and runner do not call price parsers directly. The runner only consumes the standardized result from `registerProductFromRaw`.

## Fragmentation Points Removed From Route

Removed from direct route ownership:

- request JSON/form-data parsing details
- file extension validation
- raw text quality gate
- source metadata parsing
- hash generation
- supplier code and land operator resolution
- filename destination extraction
- document parsing and parsed duplicate checks
- raw normalizer dispatch
- catalog split and V3 count preflight
- price recovery
- destination/code resolution for product code generation
- itinerary normalization
- customer deliverability gate
- final upload gate classification
- products/product_prices/travel_packages persistence
- post-registration side effects
- response trust report composition

## Registration Failure Types Tracked

The current gates classify the recurring failures as structured causes:

- input quality blocked
- duplicate upload
- catalog split required
- product count mismatch
- price table unrecognized
- product_prices missing
- price_dates missing
- destination/code UNK
- itinerary days invalid
- customer landing/A4 blocked
- final upload gate blocked
- persistence failure with rollback/review queue

## Golden Corpus / Quality Evidence

Last verified commands:

```bash
npx vitest run src/lib/parser/deterministic/price-ir src/lib/product-registration src/lib/product-registration-strict-cutover.test.ts src/lib/upload-validator.test.ts src/lib/price-dates.test.ts src/lib/upload-verify.test.ts
npm run type-check
npm run eval:product-registration:ci
npx tsx scripts/audit-product-mobile-landing-readiness.mjs --strict --days=3 --limit=100 --json
```

Observed results:

```text
36 test files passed
237 tests passed
type-check passed
supplier raw fixtures 5/5 passing
customer deliverability corpus 12/12 passing
price rows zero 0
price dates zero 0
destination UNK 0
optional-tour price pollution 0
deliverability blocked 0
price storage mismatch 0
render blocked 0
recent DB readiness: 6 pass / 0 fail
```

## Change Rule

New supplier failures must follow this order:

```text
fixture -> parser/IR or registration object improvement -> recovery result verification -> deliverability gate -> persistence
```

Do not add supplier-specific rescue logic directly to `src/app/api/upload/route.ts`.
