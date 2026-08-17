# Product Registration Real HWP Mobile Proof (2026-08-17)

## Scope

- Private source: `[LJ]푸꾸옥 3박 ♥특가♥노옵션스페셜팩 0910 0918 (0814발권) 0804.hwp`
- Production source document: `594d4b8e-6418-420e-b591-b3e4fafe8443`
- Final V6 job: `a16c488d-be22-472c-8d19-9b9feae8802f`
- Workflow run: `wrun_01M05TQEABZRA2ZVSNY6N052EJ`
- Catalog product: `4cdcfde6-d740-4995-84d1-eb8fadab9cb9`
- Compatibility package: `fcf0f011-d885-4b32-8527-1972ab5d6824`

The source was processed through the real production source, EvidenceIR, immutable canonical revision, typed facts, immutable snapshot, private signed preview, and mobile-Chrome proof path. Production publication remained frozen and no public pointer was created.

## Final result

- Terminal outcome: `ready_degraded_not_published`
- Analysis: `degraded`
- Publication state: `frozen`
- Sole publication blocker: `PUBLICATION_FREEZE_ACTIVE`
- Revision: `efe5d3fa-47d8-472b-bbad-6198d0debdb5`
- Snapshot: `e43d3a66-5c18-438d-b400-6aa4edc0306c`
- Snapshot hash: `6aac1ba2af63b6dcaec6e9deec0d00f2440cfab5934e3eb0d2aa9d63a1af3630`
- Proof: `35930571-6736-4171-bcaa-82ffc7cbeff5`, status `passed`
- Proof suite: `product-registration-v6-mobile-chrome-3+result.8a11e7cff36a27e7319c16e4`

Both `/packages` and `/lp` private previews returned HTTP 200 and exposed the exact same snapshot hash and renderer build. The 390×844 proof opened the customer CTA, loaded the Korean font, found zero broken images, zero missing/forbidden text findings, and zero hydration errors.

## Source-to-customer facts

- Customer title: `푸꾸옥 노옵션 자유일정 3박5일`
- Departure prices:
  - 2026-09-10: KRW 799,000
  - 2026-09-18: KRW 699,000
- No departure was falsely labelled confirmed.
- Included: return airfare, TAX, lodging, local vehicle, listed meals, guide service, attraction admission, and travel insurance.
- Excluded: driver/guide expense USD 50 per person, etiquette tips, and personal expenses.
- Shopping notice: two planned visits, with the source items preserved.
- Lodging: the source-backed Sol by Meliá or Sonaga Resort or equivalent pool is shown as scheduled/unconfirmed rather than invented as a confirmed hotel.
- LJ119/LJ120 identifiers remain visible. Times are hidden behind final confirmation because route identity could not be independently resolved; no sibling product value was copied.
- Customer expected budget uses the KRW 699,000 product price only. The excluded guide expense is not added and no unstated fuel surcharge is invented.
- Missing source cancellation terms use the configured standard-terms fallback.
- The free Pexels destination asset is explicitly labelled as a travel-destination reference image with source and license attribution; it is not presented as an actual hotel, room, or included experience.

## Defects found and corrected by the proof

- A header-level alternative-hotel pool was not reaching generic `해당숙소` itinerary rows.
- Departure dates defaulted to confirmed when the source had no exact confirmation evidence.
- International airfare/TAX and etiquette-tip wording were not fully normalized into public terms.
- Shopping information was flattened into a generic statement instead of preserving the exact source count/items.
- Proof traffic could write review-score, user-action, engagement, and web-vital analytics.
- The package proof still rendered a review digest that could introduce unrelated social proof.

All were corrected. The final proof generated zero score signals, user actions, engagement logs, or web-vital rows. Earlier test-only analytics created during diagnosis were removed; no customer records were involved.

## Verification

- Focused regression: 145 tests passed.
- Complete Vitest: 738 files passed, 5,661 tests passed, 7 conditional skips, zero failures.
- TypeScript: passed.
- Product-registration authority contract: passed (`authorized=1`, `legacy=136`, `unapproved=0`).
- Production build: passed, including 389 generated static pages and the rhwp runtime trace check.
- Product-registration Supabase security advisors: zero WARN/ERROR after hardening both internal append-only trigger functions.
- Product-registration performance advisors: duplicate catalog index removed; zero WARN/ERROR remain. Informational unused-index and unindexed-FK observations require usage data before further index churn.
- Stale V6 jobs older than 30 minutes: zero after four historical/test jobs were terminally quarantined through the registered terminal/dead-letter contract.

## Launch interpretation

This proves that one real HWP can reach a customer-usable, source-faithful, exact-hash mobile snapshot without public exposure. It does not certify the 95% corpus target. Normalization `v6-canonical-2026-08-17.43` includes the later source-price reference, overnight-timeline, commercial-heading, duration-roster/applicability boundary, qualified supplier-profile, and double-consensus evidence-bound AI fixes, so the pinned corpus and independently reviewed publication-eligible frozen benchmark must be rerun before cohort publication.
