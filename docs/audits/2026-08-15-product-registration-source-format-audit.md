# Product Registration Source Format Audit

Date: 2026-08-15  
Status: private development/calibration source audit; frozen cases were not opened

## Scope

- Actual non-frozen travel-product HWP sources scanned: 731
- Extraction failures: 0
- Frozen individual sources inspected: 0
- Machine-readable output: `C:\Users\admin\Downloads\코덱스테스트\product-registration-source-price-format-audit-20260815-v8-engine-normalized.json`
- Full-source simulation: `C:\Users\admin\Downloads\코덱스테스트\product-registration-private-corpus-all-20260815-v46-source-money-safe-final.json`

Counts overlap because one source can contain several patterns or can be blocked by an unrelated structural issue.

## Decided operating policy

Supplier documents are uploaded as received. Operators do not rename files, rewrite prices, move table cells, or repair supplier templates before upload. Raw bytes, the raw filename, the raw evidence quote, and the source hash are preserved. The engine may create normalized derived values, but it never overwrites the source.

| Source notation | Canonical value | Safety rule |
|---|---:|---|
| `899,` | KRW 899,000 | accepted in a price/sale context |
| `699,---`, `999,-`, `1,079,-` | KRW 699,000 / 999,000 / 1,079,000 | accepted as supplier thousand-won shorthand |
| `399 특가` | KRW 399,000 | accepted only when the same text or trusted table role explicitly proves a special sale price |
| `839.000` | KRW 839,000 | dot is normalized as a Korean thousands separator |
| `839,000 → 599,000` | list KRW 839,000; final KRW 599,000 | only the final amount is sellable; the list amount remains source lineage |

An arrow is not interpreted as a discount when the line is a commission, fuel surcharge, local fee, guide fee, option, foreign-currency charge, capacity, or another non-sale fact. Numbers appearing in dates or promotional date lists are not converted into prices merely because the word `특가` appears nearby.

## Customer display contract

- Canonical storage uses integer KRW amounts.
- Customer display uses comma-separated won formatting such as `899,000원`.
- A crossed-out list price or discount badge appears only when one source row explicitly proves both the former/list price and the final sale price.
- A higher price from another departure date is never used as a compare-at price.
- If the source proves only the final price, the customer sees only the final price.

## Commission contract

- When commission is absent, product registration uses a fixed default of 9%.
- A valid explicit source commission overrides the default.
- Commission is an internal commercial field. It is not customer-visible and cannot be used as adult sale-price evidence.

## Filename contract

- Corrupted characters and decomposed Hangul are preserved in the raw filename for audit.
- Filename encoding damage alone is not a registration blocker.
- A normalized derived label may be used for routing or display, but the raw filename is never replaced.
- Product facts are authorized by document body, table cells, evidence anchors, and hashes—not by a cleaned filename.

## Measured effect

On the same 1,634-section private corpus, deterministic normalization increased verified/degraded candidates from 908 to 933, reduced blocked sections from 252 to 228, and reduced source-incomplete discard candidates from 2 to 1. Safe automatic terminal handling increased from 1,382/1,634 (84.58%) to 1,406/1,634 (86.05%).

In the 731-source non-frozen price-format audit:

| Pattern cohort | Sources | Blocked before | Blocked after |
|---|---:|---:|---:|
| trailing comma such as `899,` | 7 | 7 | 3 |
| bare special such as `399 특가` | 49 | 24 | 21 |
| label and amount split across cells | 44 | 22 | 20 |
| dot thousands such as `839.000` | 2 | 0 | 0 |

The remaining blocked items are not requests for supplier-file cleanup. They are engine work involving departure-date/price applicability, multi-product attribution, table scope, itinerary structure, or evidence replay. A notation match alone never relaxes the critical publication gate.

## Safety interpretation

This normalization is deterministic and evidence-bound. AI may propose table roles or product boundaries, but it cannot invent an amount or turn an unrelated number into a selling price. Any unresolved critical price, departure date, currency, or source-scope conflict remains blocked. These private corpus measurements are structural readiness evidence, not independently reviewed 99.5% field accuracy and not authorization to unfreeze production publication.
