# Product Registration Authority Live Cutover Audit

Date: 2026-08-12

## Outcome

The production database authority boundary is hardened, while customer publication remains intentionally frozen. This is a schema-and-reader cutover, not a declaration that the full product corpus is ready to open.

## Production Supabase evidence

- Applied the 18 product-registration migrations from `20260808172425` through `20260811121526` in repository order.
- Reconciled only those applied versions; unrelated historical migration drift was not rewritten.
- Normalized legacy null/all-zero tenant placeholders to the explicit platform tenant where the migration contract required it.
- Verified zero tenant/catalog blockers for products, packages, revisions, snapshots, pointers, and publication decisions.
- Ran `finalize_product_registration_authority_hardening('product-registration-authority-hardened-1')` successfully.
- Verified `authority_mode=shadow`, `publication_freeze=true`, `schema_verification_state=verified`, no unvalidated tenant foreign keys, and no executable legacy publication RPCs.

## Customer reader and audit correction

- Public package API, home, destination, and sitemap discovery are pointer-only regardless of writer authority mode.
- Added a pure publication-authority audit joining package tenant/catalog/revision, exact customer pointer, immutable snapshot, canonical revision, evidence pack, customer-open contract, price-date parity, and current mobile proof.
- The existing Kota Kinabalu active/published row is now classified as legacy-public-without-authority because it has no valid pointer chain.
- The existing Fukuoka active/published row is now blocked because its saved 85 price dates disagree with the 84-date snapshot, its proof is stale, and its customer-open contract/evidence state is not openable.

## Verification

- Authority scan: `authorized=1 legacy=143 unapproved=0`.
- Full regression: 684 test files and 5,154 tests passed.
- Merge-conflict price/upload rules: 5 files and 61 tests passed after integrating latest `main`.
- TypeScript passed after the merge.
- Production Next.js build passed with 389 static pages; local duration was about 14 minutes 38 seconds.
- Draft PR: `#1082`.

## Real HWP canary findings

The exact private sample `#마쓰야마_[스탠다드]_0828TL_시내 다색 골프 2박3일 (컴10만원).hwp`
(133,632 bytes, SHA-256 `122edd3707c541d1e2ed91a4aebd4f90fb508370f20d2e4c9152ceca0d0a9871`)
was used for the live shadow canary. No publication pointer was changed.

- First canary exposed a missing native parser in the workflow function. The pinned `rhwp` 0.8.2 binary is now installed during prebuild, explicitly included in the workflow-step trace, and verified during postbuild.
- The next canary exposed an invalid Storage content type when browsers sent HWP as `application/octet-stream`. Storage now receives the verified `application/x-hwp` type.
- Retrying the same source exposed `ON CONFLICT DO UPDATE` against append-only source-lineage tables. The production RPC and repository migration now use `DO NOTHING` followed by tenant-scoped resolution and request-key conflict validation.
- Source ingestion now succeeds idempotently as source document `412bfbd5-572c-475e-b912-2d85679d5aae`.
- Live job `a2b77fd8-5d98-489a-b2f7-74e45bee5fbc` reached the durable workflow but failed at `extract` after three retries. Build tracing contained the binary, while runtime lookup still depended on `process.cwd()`. Runtime discovery now checks the Lambda task root and bounded parent candidates and records safe path diagnostics on failure. A second live canary is required on the new deployment.
- Second live job `d174d361-ffb2-48d2-a2ed-be586bb6d375` proved that `/var/task/vendor/rhwp/0.8.2/rhwp` existed but could not be executed by the minimal Vercel runtime loader. The workflow now uses the official pinned `@rhwp/core` 0.8.2 WebAssembly parser, while the native CLI remains a local regression tool.
- The WASM adapter reconstructs page text, table dimensions, merged-cell coordinates, and evidence hashes from `getPageTextLayout`, `getTableDimensions`, and `getCellInfo`. Against the exact Matsuyama sample it produced 2 pages, 1,544 text characters, 5 tables, 90 cells, the source price grid, and flight numbers `BX134`/`BX133` in about 2.3 seconds locally.
- A production-mode build passed with 389 static pages. Postbuild verified both the pinned native regression binary and `node_modules/@rhwp/core/rhwp_bg.wasm` in the workflow-step trace.

These failures demonstrate why source upload acceptance and extraction success must be measured separately.

## Successful live customer-flow canary

The final live run used the same source blob and completed without changing a customer publication pointer.

- Job `d35796d2-7089-47ee-ae0a-1624c77a05d1` and workflow `wrun_01KZTB1WC3Y2F4FGQ5TQHW8EHQ` reached terminal `done` as `published_degraded` at `2026-08-12T06:39:30.125629Z`.
- The source produced 2 pages, 5 tables, 97 IR nodes, 1,544 characters, one product section, immutable revision `2d97526f-92a4-42bc-b087-61c8aad87d4e`, and candidate snapshot `387e4cca-62fc-4da9-8ca6-b1a48d8a4636`.
- All 8 critical/high claims have verified evidence and at least one evidence anchor; no critical/high evidence gap or conflict remains.
- The customer snapshot contains the exact 10 departure-date prices from 979,000 to 1,269,000 KRW, a 3-day/2-night itinerary, BX134/BX133, 7 inclusions, 5 exclusions, and the customer-safe ticketing/cancellation notice.
- Uncorroborated source flight times are absent from the customer snapshot. The engine retained route/date/flight number and applied the final-confirmation disclosure instead of copying historical product times.
- Snapshot hash `7db389acf8fbfe75f13a4f5a17f7a9048a6496093aea1cadd1ac425d6d5a51f6` was rendered by build `06881581ddd9e6974cf0b3cbc398084dab03babb` at 390x844 in actual serverless Chromium.
- Both `/packages` and `/lp` returned 200, matched the exact snapshot/build lineage, opened the customer CTA, had zero missing required facts, zero forbidden flight times, zero broken images, and zero hydration/runtime errors.
- The snapshot stays `candidate`, the publication pointer query returns no row for catalog product `a4d687d2-13e0-4cda-ba46-d9b6ff78454d`, and the job records `publication_state=frozen`. Production exposure therefore remains unchanged.

## Customer assessment and remaining launch gate

The sample is technically safe for degraded automatic publication, but it is not yet visually sales-ready as a premium landing page. The document contains no licensable product imagery, so the snapshot explicitly records `MEDIA_ASSET_MISSING` and renders the brand fallback. OAG/Cirium credentials or two equivalent current schedule observations are also absent, so the source times remain hidden. These are the only three degraded reasons; there are no blockers in price, departure date, itinerary, terms, evidence, customer rendering, or CTA interaction.

The proof engine now preserves each full-page PNG in tenant-scoped private Storage, records its path and SHA-256 in the proof run, and never places capture bytes in public snapshot JSON. A later deployment may re-proof the same immutable snapshot with its own renderer build; proof acceptance still requires the observed build to equal the new proof run's expected build.

Keep the global freeze and existing-inventory backfill disabled until: (1) licensed destination/product media is automatically resolved or the business explicitly accepts brand fallback for the launch cohort, (2) the airline schedule provider policy is live if exact times must be shown, (3) more representative supplier files pass the same source-to-mobile gate, and (4) the existing 989 rows are shadow-classified before broad publication. One successful canary proves the end-to-end path, not an 80% corpus auto-publication rate.
