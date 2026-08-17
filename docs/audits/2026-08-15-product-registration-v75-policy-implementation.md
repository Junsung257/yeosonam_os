# Product Registration V75 Policy Implementation Audit

Date: 2026-08-15  
Branch: `codex/product-registration-engine-v6-20260811`  
Authority: local shadow only; production publication frozen

## Outcome

The current normalization build is `v6-canonical-2026-08-15.12`. The unchanged private corpus contains 1,171 HWP files, 1,047 unique sources, 895 travel-product sources, and 1,636 product sections. All 961 sources admitted to extraction completed extraction.

| Outcome | Sections |
|---|---:|
| Past-only safe exclusion | 713 |
| Source-incomplete private discard | 10 |
| Publication-eligible | 913 |
| Structurally safe verified/degraded | 755 |
| Blocked | 158 |
| Total safe terminal handling | 1,478 / 1,636 (90.34%) |
| Eligible structural safety | 755 / 913 (82.69%) |

Split aggregates are development 528/625 (84.48%), calibration 85/106 (80.19%), and frozen 142/182 (78.02%). Frozen cases were not opened individually. Against V74, 736 comparable non-frozen sections produced one recovery and zero regressions.

## Implemented rules

- Preserve row-spanned product identity in multi-product HWP price tables.
- Keep duration variants such as 3-night/4-day and 4-night/5-day as separate products and calendars.
- Apply a base date-range price first and a narrower or specific-date price as an evidence-backed override.
- Bind multiline date rosters to the later adult sale price even when HWP reading order is flattened, but only inside the same product-local table.
- Normalize explicit sale shorthand such as `449,-` to KRW 449,000.
- Reject foreign-currency per-person fees, guide costs, single supplements, deposits, commission, and flight-schedule numbers as adult KRW sale prices.
- Preserve the confirmed policy that a missing child price follows the adult price, while a NET-only amount never becomes a customer selling price.
- Remove the retired reextract direct writers from the authority baseline after confirming the route no longer mutates `products` or `travel_packages`.

## Verification

- Product-registration Vitest: 141 files, 907 tests passed.
- Full regression Vitest: 732 files, 5,544 tests passed.
- TypeScript: passed.
- Targeted lint: passed.
- Strict registration/authority contract: `authorized=1`, `legacy=140`, `unapproved=0`.
- Whitespace/diff validation: passed.

## Remaining gate

This measurement proves deterministic structural handling, not 99.5% field accuracy. A 95% point estimate requires 868/913 safe eligible sections, 113 additional recoveries. A one-sided 95% Wilson lower bound of 95% requires 879/913, 124 independently reviewed recoveries. The current promotion gate remains blocked by missing independently double-reviewed benchmark evidence.

The largest remaining non-frozen error families overlap across sections: unresolved sale price, price/date scope, inclusion/exclusion scope, itinerary, lodging, transport, and cross-document price/schedule companions. Cross-document joining must remain conservative and evidence-preserving; it may not copy facts from a merely similar product.

No deployment, production migration, Supabase mutation, publication-pointer change, or customer exposure was performed. `publication_freeze=true` remains the required production state.
