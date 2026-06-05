# Registration Object Verification Update

Date: 2026-06-05

## Scope

This audit records the current product-registration centralization step:

- `registerProductFromRaw()` is the shared registration-object path used by the upload route and by golden corpus evaluation.
- Golden corpus checks validate `ProductRegistrationResult` directly instead of assembling destination resolution, price recovery, itinerary normalization, and deliverability as separate test-only paths.
- `ProductRegistrationResult` now carries `priceYear` into centralized price recovery so 2026/2027 fixtures run through the same route-shaped engine.
- V3 draft gate failures remain as warnings in the registration object. Final customer/A4/mobile blocking is owned by `evaluateUploadDeliverability()` over the standardized registration result.
- V3 itinerary preview is used only when day numbers are valid and sequential. Invalid V3 day output falls back to deterministic day-table parsing to prevent duplicate-day pollution.
- The upload route no longer downgrades product status from a document-level V3 `customer_publishable` result after the standardized registration result has passed.

## Verification

Commands run:

```bash
npx vitest run src/lib/product-registration-v3 src/lib/product-registration src/lib/parser/deterministic/price-ir
npx vitest run src/lib/parser/deterministic src/lib/product-registration src/lib/upload-validator.test.ts src/lib/price-dates.test.ts src/lib/upload-verify.test.ts
npm run eval:product-registration:ci
npm run type-check
npx tsx scripts/audit-product-mobile-landing-readiness.mjs --strict --days=3 --limit=100 --json
npx vitest run src/lib/product-registration/upload-route-boundary.test.ts src/lib/product-registration/golden-corpus/golden-corpus.test.ts src/lib/product-registration/register-product-from-raw.test.ts
```

Results:

- product-registration/customer golden corpus: 12/12 pass
- supplier raw fixtures: 5/5 pass
- `priceRowsZeroCount`: 0
- `priceDatesZeroCount`: 0
- `destinationUnkCount`: 0
- optional-tour price pollution: 0
- customer deliverability blocked: 0
- strict mobile/A4 readiness audit: 9/9 pass

## Remaining Work

- `upload/route.ts` still performs document-level preflight, V2/V3 planning, and persistence orchestration. The route boundary is improved, but not yet a minimal persist-only shell.
- V3 draft persistence still runs as an after-save sidecar; future work should persist V3 from the same `ProductRegistrationResult` evidence envelope.
- More route pre-normalizers should move behind `registerProductFromRaw()` so the route does not decide which parser result wins.
