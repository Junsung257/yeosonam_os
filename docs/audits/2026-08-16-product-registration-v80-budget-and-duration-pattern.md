# Product Registration V80 Budget And Duration-Pattern Audit

Date: 2026-08-16  
Scope: private actual-source shadow replay; no deployment, production database write, publication pointer movement, or customer exposure

## Owner decisions fixed in the engine

1. A guide or driver fee written under exclusions is not part of the product sale price and is not part of the expected customer budget. The exclusion retains its source amount, currency, unit, and wording.
2. The expected customer budget is the adult base product price plus only a separately excluded, fixed numeric fuel surcharge.
3. Fuel already included in the product price is not added again. A variable or unpriced fuel surcharge produces no guessed total and is displayed as confirmation required.
4. A broad row-spanned date range is visual context when a closer exact-date roster sits beside the amount. Only the local roster receives that amount; exact special-date rows override it.
5. An explicit `출발일 | 패턴 | 상품가` table is a different structure. Every `3박5일` and `4박6일` row is a distinct duration product and receives only its own weekday/date price.

## Implementation evidence

- `customer-budget.ts` derives the immutable, source-backed expected-budget contract. Guide fees are excluded from every sum.
- Public term normalization preserves fixed fuel and guide amounts and semantically removes weaker duplicate wording.
- Public snapshot/card/LP projections and both customer detail surfaces consume the same budget object; hard-coded fuel-inclusion copy was removed.
- `table-grid-price-calendar.ts` now separates grouped-range/local-roster tables from explicit duration-pattern tables and resolves exact-date overrides without cross-product leakage.
- Normalization version is `v6-canonical-2026-08-16.15`.

## Actual source checks

### Apparent duplicate-product concern

- `★[중중 더블온천팩] 7월 ~ 10월일정표.hwp`: one section, one variant, 77 dated prices, 77 unique dates, zero duplicate dates, zero price conflicts.
- `[BX 3박4일 실속비에이PKG] 비에이 오타루 도야 노보리베츠 ...hwp`: one section, one variant, 12 dated prices, 12 unique dates, zero duplicate dates, zero price conflicts.
- `[BX 3박4일 품격비에이PKG] 비에이 오타루 도야 노보리베츠 ...hwp`: one section and one variant. At the 2026-08-16 operational reference date every source departure is past, so customer price rows are correctly removed; it is not split into two products.

The source did not contain two products. The earlier appearance came from expanding a visual group range with the first adjacent amount. The corrected parser binds only the local exact roster.

### Legitimate duration products

Two Kota Kinabalu sources contain one source section with explicit 3-night/5-day and 4-night/6-day price rows. Those are legitimate separate duration products:

- Grandis: future 3-night/5-day dates 2026-08-19 and 2026-08-26 at KRW 729,000; future 4-night/6-day date 2026-08-22 at KRW 699,000.
- Hyatt Regency: future 3-night/5-day dates 2026-08-19 and 2026-08-26 at KRW 1,359,000; future 4-night/6-day date 2026-08-22 at KRW 1,519,000.

These two cases were the only active V79 regressions. V80 recovered both.

## Full private replay

| Measure | V80 result |
|---|---:|
| HWP files | 1,171 |
| Unique source hashes | 1,047 |
| Travel sources | 895 |
| Product sections | 1,636 |
| Attempted/successful extraction | 961 / 961 |
| Past-only safe terminal | 723 |
| Source-incomplete safe terminal | 10 |
| Publication-eligible | 903 |
| Structurally safe verified/degraded | 761 (84.27%) |
| Blocked | 142 |
| Total automatic safe terminal | 1,494 / 1,636 (91.32%) |

Split result:

- development: 532/619 (85.95%)
- calibration: 86/104 (82.69%)
- frozen aggregate only: 143/180 (79.44%); no individual frozen case was inspected
- V79 comparison: 728 comparable non-frozen sections, 2 recovered, 0 regressed

## Verification

- Product-registration Vitest: 153 files, 1,034 tests passed
- TypeScript: passed
- Targeted lint: passed
- strict registration/authority contract: passed (`authorized=1`, `legacy=140`, `unapproved=0`)

## Release decision

This replay proves deterministic structural handling, not independent field accuracy. Reaching a 95% point estimate on the 903 publication-eligible sections requires 858 safe sections (97 more); the one-sided 95% Wilson lower-bound gate requires 869 (108 more) with independent review. The frozen corpus still lacks completed blinded double review, critical exact-match evidence, and a representative live mobile proof cohort. Production therefore remains `publication_freeze=true` and customer-wide release is not approved.
