# Product Publication Authority Rebuild — Implementation Evidence

Date: 2026-08-29

Base: `origin/main@579cbb2458cc82771d59c6db35ae5c4c4640e32a`

Worktree: `C:\dev\yeosonam-os-product-authority-rebuild-20260829`

Branch: `codex/product-registration-publication-rebuild-20260829`

## Verdict

The code implementation is a staging candidate. It is not a production release.

- Registration, source-price lineage, grounded customer copy, documentary product media, immutable mobile proof, customer publication, cache convergence, and live canary now form one observable authority chain.
- Customer readers use one exact public catalog. Legacy `approved` and raw package rows are no longer customer-publication authority.
- Production writes, deployment, public pointer changes, and auto-publish changes in this implementation session are zero.
- The migrations now pass an isolated Supabase rehearsal apply, atomic single-product and four-product shared-price samples, idempotent retry, rollback, immutability and service-role catalog canary. Authenticated candidate browser proof is still required before P0 can be declared implementation-ready.

## Implemented controls

| Risk | Implemented control |
|---|---|
| `approved` mistaken for public | Customer routes and public catalog require the exact published customer pointer and immutable snapshot lineage. |
| Two admin approval paths | `/admin/packages` is read-only; the active command is an idempotent publication request from `/admin/product-registration`. |
| Stale revision/proof race | Expected revision/pointer fencing and immutable proof lineage are checked before pointer publication. |
| Partial package/price write | V62 wraps the V61 atomic revision commit and inserts one immutable, revision-bound price-lineage row per departure; exact retries reuse it and any mismatch rolls the transaction back. |
| NET/selling-price confusion | `NET`, `SELLING`, and `REQUEST_ONLY` retain their source meaning; SELLING never receives a reverse-invented NET. |
| Generic or cross-product copy | Copy V3 score ≥82, source/numeric/cross-product/internal-language validation, and a 900-token output cap. |
| Logo/stock image used as product evidence | Publication requires exact supplier/operator documentary media with verified rights, safety, and relevance. |
| Inconsistent public surfaces | Home, package catalog/detail, LP, search, destinations, sitemap, affiliate, recommendations, reviews, print, marketing, and Jarvis use `public_catalog_view`. |
| DB/cache transaction confusion | Pointer mutation and outbox creation are the DB boundary; cache convergence and live `/packages`/`/lp` canary remain durable external steps. |
| Canary failure hidden | Failed convergence/canary hides the customer pointer. Automatic old-pointer restoration is intentionally not authorized by this change. |

## Source-price append-only correction

The rehearsal apply exposed a P0 in the first V162 implementation: V62 delegated the immutable insert to V61 and then attempted to UPDATE `departure_instances`. The existing append-only trigger correctly rejected the write.

The corrected design therefore:

- stores price meaning in `internal_product_registration.departure_price_lineage`, an immutable 1:1 extension bound to tenant, catalog product, revision, departure, source hash and revision hash;
- writes that row in the same transaction as the revision, with `ON CONFLICT DO NOTHING` followed by an exact-value idempotency comparison;
- keeps `NET`, `SELLING`, and `REQUEST_ONLY` contracts in database constraints and never reverse-invents NET from a supplier selling price;
- makes the V61 exact-date override projection append-only and converts retries from conflict UPDATE to exact reuse;
- joins customer departure facts and admin readiness to the immutable lineage; legacy departures without it fail closed;
- leaves the old nullable columns as compatibility storage only and never treats them as customer authority.

The rehearsal database then passed one initial write, two identical retries, an intentional malformed-price rollback, and direct mutation rejection for both immutable tables.

## Durable baseline B — Clark shared price table

The existing deterministic golden source `CLARK_MULTIPRODUCT_RAW` was persisted to the isolated rehearsal project through V62. The source document contains one shared price table and four local product sections. Its exact UTF-8 source was retained in `upload_jobs.raw_text` and bound to one source document:

- migration: `20260829142322_rehearsal_clark_shared_price_baseline_b`
- source document: `f61a7dd3-96cd-4041-b09e-dcd43402f222`
- source hash: `4f10c9f365e85a58cdf7871c134c12e08e8ce7cd28175979e7d0244c027274f8`
- source bytes: `2,673`
- product revisions: `4`
- future/reference-date departure facts: `54`
- immutable price-lineage rows: `54`
- authority events after one identical retry per product: `4`

| Product key | Revision | Dates | Selling-price range | Scope proof |
|---|---:|---:|---:|---|
| `codex-clark-shared-lean-3n5d` | `0665e5e7-e57e-41ba-92ed-475ff1ae5199` | 11 | 1,169,000–1,289,000 KRW | 2026-09-02 = 1,169,000 |
| `codex-clark-shared-lean-4n6d` | `856204de-6d34-44bb-a151-48744d7abe90` | 16 | 1,189,000–1,229,000 KRW | 2026-09-05 = 1,189,000 |
| `codex-clark-shared-villa-3n5d` | `3bd1505d-beb6-4699-b7ef-9733d00f4de3` | 11 | 1,289,000–1,409,000 KRW | 2026-09-02 = 1,289,000 |
| `codex-clark-shared-villa-4n6d` | `29ecefec-be4b-4edb-a28f-268e536ebcb6` | 16 | 1,349,000–1,389,000 KRW | 2026-09-05 = 1,349,000 |

Every price retained `source_price_kind='SELLING'`, `source_amount=adult_selling_price`, and `net_price IS NULL`; no reverse-invented NET value was created. Excluded source dates `2026-09-23`, `2026-09-24`, `2026-10-01`, `2026-10-07`, and `2026-10-08` produced zero departure rows. The V62 transaction also asserted zero invalid price lineage, grounded-copy and documentary-media blockers, no customer catalog membership, and global `publication_freeze=true` before committing.

The first rehearsal attempt supplied obsolete upload-stage labels and failed the current `upload_jobs` check constraint. The transaction rolled back source, product, revision and departure counts to zero. The successful replay used the current upload contract; no constraint or grant was weakened.

## Current production mobile baseline — read only

Fresh Chrome inspection used a 390×844 viewport override on 2026-08-29. No form was submitted and no live state changed.

### `/packages`

- URL: `https://www.yeosonam.com/packages`
- Two Danang/Hoi An products were visible.
- Both cards described their media as `참고 이미지` and repeated generic confirmation copy.
- No browser console warning/error was observed after the page settled.

### `/lp/5958c8cb-7d0f-4267-8ee2-7bd0f6996c20`

- The hero image accessible name was `여소남 브랜드 이미지`, confirming that a brand/logo asset is currently standing in for product documentary media.
- The same long alternative-hotel sentence was repeated in day headings and body rows.
- KRW 499,000 departure rows were shown while flight times remained `시간 미정`.
- The page had working detail and consultation controls and no observed console warning/error, but its content quality is not V162 publication-ready.

This production evidence is a baseline finding only. It is not evidence that the un-deployed V162 candidate renders correctly.

## Verification

| Check | Result |
|---|---|
| Focused authority/catalog/admin/mobile suites | PASS — 74 files / 342 tests |
| Full Vitest regression | PASS — 878 files / 6,551 passed, 7 conditional skips |
| Product-registration contract | PASS — `authorized=1`, `legacy=0`, `unapproved=0` |
| Migration prefix audit | PASS — no new/unbaselined collision |
| ESLint 8 GB profile | PASS — zero warnings |
| TypeScript 8 GB profile | PASS |
| Production Next build 8 GB profile | PASS after final parser/sitemap correction, including postbuild and pinned native/WASM `rhwp` tracing |
| Whitespace check | PASS before final evidence staging; rerun after staging |
| Isolated Supabase rehearsal migration apply | PASS — `product-registration-v61-rehearsal`, production untouched |
| V62 atomic normal sample | PASS — revision 3, one SELLING lineage, no invalid price lineage |
| V62 identical retry | PASS — one revision, one lineage, one authority event after two further retries |
| V62 malformed-price rollback | PASS — no revision/departure/event persisted |
| Append-only mutation checks | PASS — departure lineage and V61 price override UPDATE rejected |
| Service-role public catalog canary | PASS — exact count 0, fail closed |
| Multi-product durable DB sample | PASS — one exact Clark source, four products, 54 departures, 54 immutable lineage rows, four idempotent authority events, zero excluded-date leakage |
| Authenticated V6.2 browser proof | NOT RUN — the implementation branch is not committed, pushed or deployed, and no application candidate/server credential targets rehearsal; grants remain closed |

## Required rollout order

1. Commit and push the reviewed candidate, then attach a non-production application candidate to the rehearsal project without exposing service credentials to the browser.
2. Rebuild the two Danang products as the first golden cohort from their source evidence.
3. Capture signed 390×844 `/packages`, `/lp`, and CTA proofs and compare snapshot/render hashes.
4. Run customer-only publication in shadow, verify cache convergence and live-domain canary, and confirm public product-set parity.
5. Obtain explicit approval before production migration/deployment; keep `publication_freeze=true` until that approval.

## Final gate

```text
STATIC FINDINGS REPRODUCED: YES
BASELINE SAMPLE RUNS: PASS (A/B/C PASS)
PRODUCTION WRITES: 0
AUTO-PUBLISH: OFF
STAGING CANDIDATE READY: YES
P0 IMPLEMENTATION READY: NO
PRODUCTION READY: NO
```
