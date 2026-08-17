# Product Registration V82 Full Error Audit

Date: 2026-08-16  
Scope: private actual-source shadow replay only  
Normalization: `v6-canonical-2026-08-16.17`

## Decision

The engine is safer and measurably more capable than V80, but it is not approved for customer-wide opening. Production publication remains frozen. No deployment, production migration, publication pointer, or customer-visible data was changed.

The current result demonstrates deterministic structural handling, not 99.5% field accuracy. Independent double-reviewed ground truth and live mobile proof are still absent.

## Corpus replay

| Measure | V82 result |
|---|---:|
| Files inventoried | 1,171 |
| Unique sources | 1,047 |
| Duplicate files | 124 |
| Extraction | 961/961 |
| Travel sources | 895 |
| Product sections | 1,632 |
| Past-only safe terminal | 717 |
| Source-incomplete safe terminal | 10 |
| Publication-eligible sections | 905 |
| Verified/degraded candidates | 768 |
| Blocked | 137 |
| Structural safe-publication rate | 84.86% |
| Total automatic safe-terminal rate | 91.61% |

Split results were development 538/622 (86.50%), calibration 90/104 (86.54%), and frozen aggregate-only 140/179 (78.21%). No frozen individual case was inspected.

## Confirmed defects fixed

### False product split

A row-spanned Qingdao golf price card followed by a repeated detailed itinerary was treated as two products. Continuation detection now keeps them together. The actual source replays as one product with 128 unique date-price rows, zero price conflicts, four itinerary days, and two flights.

### Duration and grade axes collapsed

A Chengdu layout expressed grade and duration as two independent axes. It previously collapsed into one variant with conflicting prices. The kernel now produces Premium/Crown crossed with 3-night/5-day and 4-night/6-day: four products, each with seven unique prices and zero conflicts.

The new matrix recognition is deliberately limited to the proven English Premium/Crown layout. A broader Korean-grade rule contaminated unrelated Zhangjiajie products, so it was removed.

### Shared-prefix price contamination

A Bali source shared commercial context before separate 3-night/5-day and 4-night/6-day products. The local-product reconciliation step now removes shared-prefix pseudo-variants and preserves only the explicit local product. The resulting products have 40 and 10 source-backed prices respectively.

### Deposit interpreted as sale price

Reservation and contract deposits are now forbidden as adult selling prices. If the local product cannot uniquely resolve a non-deposit price for its hotel, grade, and duration, it remains blocked.

### Cross-product price leakage

A product-local section may reuse a same-duration source-backed calendar only when there is exactly one eligible non-deposit candidate. Multiple hotel/grade calendars remain ambiguous. This prevents September prices from leaking into July/August products.

### Contradictory fuel scope

Fuel surcharge text appearing in both inclusions and exclusions now creates a `conflicting` customer-budget state. No expected total is invented, and the publish gate emits `commercial_terms_conflict`. An excluded guide fee remains outside product price and expected budget.

## Comparable-result interpretation

Among 726 comparable non-frozen sections, 9 recovered and 3 became newly blocked. The three blocks are safety corrections for deposit or cross-product price contamination. The generic learning report currently labels them as regressions because it has no semantic category for this hardening. They must not be restored to unsafe verified/degraded outcomes merely to improve the metric.

Promotion also remains blocked by `REVIEWED_BENCHMARK_EVIDENCE_MISSING`.

## Remaining blocker clusters

| Cluster | Findings | Sources |
|---|---:|---:|
| Price/date scope ambiguity | 36 | 24 |
| Variant price/scope attribution | 34 | 23 |
| Missing adult sale price | 30 | 19 |
| Source sale price requires resolution | 32 | 20 |
| Lodging | 13 | — |
| Exclusions | 11 | — |
| Exact price evidence | 11 | — |
| Inclusions | 10 | — |
| Itinerary | 10 | — |
| Flight | 7 | — |

Counts overlap. The priority is price ownership, date applicability, and exact evidence. None may be solved by borrowing another product's value.

## Verification

- Focused regression: 7 files, 188 tests passed.
- Broad product-registration regression: 167 files, 1,253 tests passed.
- TypeScript check passed.
- Targeted lint passed.
- Product-registration authority contract passed: `authorized=1`, `legacy=140`, `unapproved=0`.
- Full learning-engine verification passed, including 156-file/1,158-test regression, golden corpus 5/5, customer deliverability 13/13, OCR/PDF candidate benchmark 5/5, and no new migration collisions.
- `git diff --check` passed.
- Supabase-dependent live upload regression was skipped because the environment was unavailable.
- Live customer Chrome/mobile proof was not run.

## Customer-open gap

A 95% point estimate at the current denominator requires 860/905 safe sections, 92 additional correct recoveries. The stricter one-sided 95% Wilson lower-bound gate requires 871/905, 103 additional independently reviewed correct recoveries.

Before opening, the engine still requires:

1. Blind, independent, double-reviewed ground truth for at least 300 frozen sections.
2. Critical-field exact match of at least 99.5% with zero critical false publication.
3. Recovery of the remaining price/date/product-ownership blocker cohorts without weakening safety gates.
4. Supabase-backed upload-to-terminal-state replay in the real environment.
5. Actual 390x844 customer journey proof for list, detail, LP, media, terms, and CTA against the same snapshot hash.
6. A controlled cohort rollout with automatic supplier/parser kill switches.

## Private artifacts

The V82 manifest, learning report, review queue, silver queue, and targeted source inspection results are stored under `C:\Users\admin\Downloads\코덱스테스트`. They contain supplier-source paths and must remain private.
