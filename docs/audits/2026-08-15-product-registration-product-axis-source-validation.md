# Product Registration Product-Axis And Source Validation

Date: 2026-08-15  
Status: private shadow evidence; not customer-open approval

## V68 follow-up

- Normalization: `v6-canonical-2026-08-15.8`
- Active safe candidates: 760/927 (81.98%)
- Past-only safe termination: 709
- Source-incomplete private outcome: 1
- Total automatic safe terminal handling: 1,470/1,636 (89.85%)
- Development: 535/638 (83.86%); calibration: 86/106 (81.13%); frozen aggregate only: 139/183 (75.96%)
- Comparable V66→V68 regression: 1 recovered, 0 regressed
- Required additional active safe sections: 121 for a 95% point estimate; 132 for a one-sided 95% Wilson lower bound of 95%
- Actual BX northern Kyushu replay: 77 date-price rows, 3 itinerary days, one 2-night/3-day product, source-backed ticketing condition, safe hotel-equivalent degradation
- Ticketing deadline loss and ticket-only auto-archive were corrected. Expired deadlines now require consultation; only fully past departures archive.
- Unmatched attractions remain review-queued under STRICT SSOT but do not block raw itinerary text or create attraction records/media.
- AI price/date fact authority is disabled in the production workflow. Source cancellation conflicts block instead of silently applying the platform fallback.

This is still structural shadow evidence. No reviewed frozen exact-match benchmark exists, and customer publication remains frozen.

## Scope

- 1,171 local HWP files
- 1,047 unique source hashes
- 895 travel-product sources
- 1,636 product sections
- 961/961 attempted HWP extractions succeeded
- Frozen cases were used only for aggregate counts. No individual frozen case was opened.

## Implemented corrections

1. Separate duration products such as 3-night/5-day and 4-night/6-day.
2. Separate same-date products whose hotel identity differs.
3. Bind a price only to the date roster in the same physical table row or cell.
4. Preserve explicit list-price to final-sale relationships.
5. Apply a bounded yearless-date policy: September can remain in the intake year, January can roll to the next year, and stale past months are excluded rather than rolled by a full year.
6. Prevent a duration token such as `5일` from becoming a KRW 5,000,000 selling price.

## Latest aggregate result

| Measure | Result |
|---|---:|
| All sections | 1,636 |
| Past-only safe termination | 694 |
| Source-incomplete private discard | 1 |
| Active sections | 942 |
| Structurally safe active sections | 746 |
| Blocked active sections | 195 |
| Active structural safe-publication rate | 79.19% |
| Total automatic safe termination | 1,441/1,636 (88.08%) |
| Additional active recoveries for a 95% point estimate | 149 |
| Additional reviewed recoveries for a one-sided 95% Wilson lower bound of 95% | 160 |

Development measured 524/648 (80.86%), calibration 86/106 (81.13%), and frozen aggregate 136/188 (72.34%). The final inline date-price correction recovered two further development sections with zero regression against the immediately preceding manifest.

At the current 942-section denominator, the formal Wilson gate requires at least 906 reviewed safe sections (96.18% observed), not merely 895 sections at a 95% point estimate.

## Actual-source replay examples

- Danang LJ: 14 date-price pairs now replay their own source rows. Examples include 8/24, 8/25, and 8/29 at KRW 539,000; 9/6, 9/13, 9/20, 9/28, and 9/29 at KRW 399,000; and 10/4, 10/5, and 10/15 at KRW 519,000.
- Phu Quoc ZE: 8/30 and 9/13 are KRW 599,000; 9/3 and 9/17 are KRW 699,000; 9/30 is KRW 799,000; 10/7 is KRW 879,000; 10/8 is KRW 899,000. Every final price retains its same-row list price.
- Ulaanbaatar LJ: 3-night/5-day Friday rows and 4-night/6-day Monday rows remain separate; the duration token no longer appears as a price.
- Bohol: 3-night/5-day and 4-night/6-day rows remain separate, and hotel variants are separate products.
- Songbaek golf: only explicitly priced special dates are published when the weekly base price is absent.

These checks prove deterministic replay for the named cases. They do not establish population exact-match accuracy.

## Accuracy boundary

The corpus manifest contains engine prelabels, not independent ground truth. No completed double-reviewed frozen annotation exists. Therefore:

- critical-field exact match is currently unknown;
- critical false-publication count is currently unknown;
- 79.19% is a structural safe-publication candidate rate, not an accuracy percentage;
- customer opening remains frozen.

## Remaining findings

Non-frozen blocked sections overlap across these families: price/departure scope 85, missing or unresolved adult sale price 55, departure year 20, inclusion/exclusion 16, itinerary 15, lodging 14, and transport 7.

One additional customer-open defect was confirmed in the Danang and Phu Quoc samples: the raw source carries a ticketing deadline, but the canonical customer preview can still contain `ticketing_deadline=null`. A passed deadline must not delete the departure price or archive the product. It must produce a source-backed condition and customer copy requiring current seat and price confirmation.

## Private artifacts

The following files stay outside Git because they include supplier filenames and local source paths:

- `product-registration-private-corpus-all-20260815-v60-normalization-5-final.json`
- `product-registration-learning-cycle-20260815-v19-normalization-5-final.json`
- `inspect-danang-lj-v59-inline-binding.json`
- `inspect-phuquoc-ze-v59.json`

All are under `C:\Users\admin\Downloads\코덱스테스트`.

V68 follow-up artifacts in the same private folder:

- `product-registration-private-corpus-all-20260815-v68-normalization-8-final.json`
- `product-registration-learning-cycle-v68.json`
- `product-registration-development-error-clusters-v68.json`
- `product-registration-active-learning-review-queue-v68.json`
- `product-registration-silver-candidate-queue-v68.json`
- `inspect-bx-kyushu-calendar-v68.json`
