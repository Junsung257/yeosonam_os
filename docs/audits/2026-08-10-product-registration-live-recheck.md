# Product registration V5 live usability recheck

- Checked: 2026-08-10 KST
- Production alias: `https://www.yeosonam.com`
- Deployment: `dpl_snwWtBW5MVbapsXnsgU4viSNbtBx` (`READY`, production)
- Sample package: `41441e88-097e-4362-89c7-92be9653ce02`
- Snapshot hash observed in both customer surfaces: `326a04557f4285502aebe234ab8c293871dce9ee5e8549eb0c204b7cb6f6fee0`

## Browser journey

1. `/packages` loaded in the connected Chrome session and returned the sample card through `/api/packages/search` (HTTP 200, default Busan hub and nationwide filter).
2. Clicking the sample card opened `/packages/{id}` without `NOT_FOUND`.
3. Detail page hydrated after the initial loading state, showed the title, price, departure calendar, flight, hotel, itinerary, terms, and inquiry CTA.
4. Detail inquiry form opened with name, phone, date, request, consent, and a disabled submit button until required input was provided. No personal data was entered or submitted.
5. `/lp/{id}` rendered at a 390px viewport with `scrollWidth=375`, no horizontal overflow, a loaded 960px hero image, price table, flight schedule, itinerary, terms, and the same snapshot hash.
6. LP inquiry sheet opened at step `1/3` with date, passenger count, name, phone, consent, and next controls. No personal data was entered or submitted.

All browser console logs were empty for the tested list, detail, and LP navigations.

## Fixes made during this recheck

- The catalog search route now resolves the approved V5 snapshot before applying the legacy V3 customer-open contract. This prevents a historical stale mobile-proof field from hiding an already-approved V5 package.
- Legacy surcharge objects using `note` and `amount_krw` are preserved. The detail page now repairs only the derived surcharge section of an immutable snapshot view, so the customer sees source-backed lines such as `2인플레이요금 – 22,000원/인/회` instead of four generic `추가요금` labels.

## Verification gates

- TypeScript: PASS
- ESLint (`--max-warnings=0`): PASS
- Snapshot projection tests: PASS (13/13)
- Render-contract integration tests: PASS (20/20, including legacy surcharge regression)
- Detail source tests: PASS
- Full Vitest suite: PASS (665 files, 5,073 tests)
- Remote Vercel build: PASS (385 static pages, postbuild output verification)
- No inquiry was submitted during browser verification.

## Decision

The sampled V5 product is practically usable for a customer-facing pilot: catalog discovery, detail viewing, mobile landing, and inquiry-sheet opening all work against the same immutable snapshot hash. Other products remain fail-closed until they independently satisfy the same V5 lineage, evidence, proof, and publication gates.
