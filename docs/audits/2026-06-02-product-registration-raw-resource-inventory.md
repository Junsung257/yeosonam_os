# Product Registration Raw Resource Inventory

Date: 2026-06-02

## Scope

This audit inventories local raw supplier-product resources used by the product-registration pipeline. It covers:

- `src/lib/product-registration-golden-fixtures.ts`
- `src/lib/parser/fixtures/`
- `db/_archive/`
- Recent Codex pasted-text attachments

The local Supabase client was not configured in this shell, so live DB counts for `travel_packages.raw_text`, `products.raw_extracted_text`, `product_registration_drafts.raw_text`, and `upload_review_queue.raw_text_chunk` could not be queried.

## Automated Inventory

Command:

```bash
node scripts/audit-product-registration-raw-resources.mjs
```

Summary from the local scan:

| Metric | Count |
| --- | ---: |
| Scanned files | 51 |
| Blocked/contaminated-like files | 5 |
| Weak source files | 1 |
| Files with price signal | 26 |
| Files with flight signal | 51 |
| Files with day/itinerary signal | 23 |
| Files with notice/remark signal | 30 |
| Files with table signal | 38 |

## Raw Resource Families Found

| Family | Representative resources | Coverage |
| --- | --- | --- |
| Da Nang multi-product/table-heavy | `db/_archive/sample_dad_bx7315_3products.txt`, `db/_archive/insert_dad_bx7315_3products.js`, `db/_archive/insert_DAD_투어비_신라메리어트_2026.js` | Multi-product split, prices, flights, remarks, table-ish layout |
| Nha Trang / Dalat | `db/_archive/sample_nha_wt.txt`, `db/_archive/insert_nhatrang_packages.js`, `db/_archive/insert_nha_wt_selectum_3n5d.js`, golden fixture | Free-text itinerary, prices, flights, remarks |
| Phu Quoc / vertical grade catalog | `C:/Users/admin/.codex/attachments/b344cf14-173f-4ca5-825e-57e7c6d5b711/pasted-text.txt`, golden fixture | Shared price catalog, expected multi-variant split |
| Baekdu / Yanji | `src/lib/parser/fixtures/baekdu-e2e-input.txt`, `db/_archive/insert_baekdusan_tourphone_packages.js` | Long catalog, itinerary, notices, partial table structure |
| Bohol | `db/_archive/insert_bohol_*`, `db/_archive/_bohol_day1_raw.txt` | Resort/package variants, flight/day corrections, notice fidelity |
| Huangshan | `db/_archive/sample_huangshan_5d.txt`, `db/_archive/insert_bestasia_huangshan_20260421_packages.js` | Shorter sample, itinerary/notice, render-fix history |
| Toyama | `db/_archive/raw_toyama_510.txt` | Compact raw text, table/notice/flight signals |

## Contaminated / Not Safe As Supplier Raw

These recent attachments should not be treated as clean supplier raw:

| Resource | Detected issue |
| --- | --- |
| `C:/Users/admin/.codex/attachments/146766f5-0349-465c-b630-6f11d3a3a1a8/pasted-text.txt` | Customer/mobile page copy |
| `C:/Users/admin/.codex/attachments/3b31da99-cb24-49d6-a8e7-3d8620a6c17b/pasted-text.txt` | Web page copy + development prompt |
| `C:/Users/admin/.codex/attachments/520cff29-d87d-4d93-b38d-7bab0266bf2f/pasted-text.txt` | Web page copy + development prompt |
| `C:/Users/admin/.codex/attachments/bbc20ff3-0e6c-4990-b747-f313bcfb93e2/pasted-text.txt` | Web page copy + development prompt |
| `C:/Users/admin/.codex/attachments/8d4cad8c-d54c-4660-937c-a528c78303b7/pasted-text.txt` | Web page copy + development prompt |

## Findings

1. The current fixture set covers several important shapes, but it is not yet representative of truly random supplier input.
2. `product-registration-golden-fixtures.ts` includes OCR/mojibake-style fixtures. These are useful as resilience tests, but they are not enough as clean supplier-source examples.
3. A large portion of historical raw material is embedded inside archived insert/fix scripts rather than stored as standalone fixture files.
4. Recent user-provided attachments include both valid supplier-like raw text and contaminated customer-page/development-prompt copies. Upload input guarding is required before parsing.
5. Live DB raw resources could not be counted in this shell because Supabase was not configured.

## Recommended Next Improvements

1. Promote representative raw samples from `db/_archive/*.js` into standalone fixture text files under `src/lib/parser/fixtures/product-registration/`.
2. Add at least one clean fixture each for: pure price table, no table/free text, shared price prefix with multiple products, REMARK-heavy notices, hotel-heavy itinerary, optional-tour-heavy itinerary, OCR/noisy extraction, and customer-page contamination.
3. Keep contaminated attachments as negative fixtures so `/admin/upload` cannot regress into parsing page chrome as supplier raw.
4. When Supabase env is available, run the same inventory against `travel_packages.raw_text`, `products.raw_extracted_text`, `product_registration_drafts.raw_text`, and `upload_review_queue.raw_text_chunk` using metadata only first, then select safe representative samples for fixtures.
