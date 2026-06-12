# Product Mobile Landing Quality Runbook

Last updated: 2026-06-12

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

## Required Checks

For every newly opened product or any repair of already-open products:

1. Compare the supplier raw source against the saved product.
2. Confirm `product_prices` and `price_dates` agree with source-backed dates and amounts.
3. Confirm itinerary day count and day sequence match the source.
4. Confirm source-backed outbound/inbound flight departure and arrival times are saved in `itinerary_data.flight_segments`.
5. Confirm source itinerary lines that affect customer understanding are present in the saved itinerary payload.
6. Confirm customer-visible attraction cards are supported by source phrases.
7. Confirm every rendered attraction ID is `customer_publishable=true`.
8. Confirm every rendered attraction card has usable media or intentionally renders text-only without wrong media.
9. Confirm option, price, shopping, notice, catalog-header, and pure-transfer lines do not become attraction cards.
10. Open `/packages/{id}` in a mobile viewport.
11. Click or scroll into the itinerary tab/section.
12. Search the rendered body text for required itinerary terms, required flight times, and known forbidden terms.
13. Run the A4/mobile readiness audit.
14. Add or update a regression fixture when the failure came from parser/matcher behavior.
15. Add an error-registry entry when the failure was user-visible or repeated.

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
- the itinerary tab/section is reachable.
- source-backed outbound and inbound flight times are visible.
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

Upload enrichment may only use attractions that are publishable for customers:

```text
attractions.is_active = true
attractions.customer_publishable = true
```

If a phrase contains an attraction-looking term but the matching master is internal, unverified, region-mismatched, or media-broken, the itinerary phrase must remain as normal text. Do not attach a wrong rich card.

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
