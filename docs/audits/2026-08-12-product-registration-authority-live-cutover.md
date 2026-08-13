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

The final live run used the same source blob and completed without changing a customer publication pointer. During visual inspection of the initially retained PNG, Korean DOM text was present but glyphs were blank in minimal serverless Chromium. The customer UI now self-hosts the bundled Korean font, waits for `document.fonts.ready`, and fails proof with `KOREAN_WEBFONT_NOT_READY` if that face is unavailable. The retained artifact was also changed from an unreliable tiled full-page capture to the exact first 390x844 customer viewport before CTA interaction; the workflow separately scrolls the full page, validates all required/forbidden text, and opens the CTA.

- Job `5218a5cf-a388-480a-baaf-a1019f4cbf81` and workflow `wrun_01KZTGK0D049AJJ6YBR8ST3YFE` reached terminal `done` as `published_degraded` at `2026-08-12T08:16:14.269350Z`.
- The source produced 2 pages, 5 tables, 97 IR nodes, 1,544 characters, one product section, immutable revision `5fc17d75-bafa-405e-8890-cb2ada4a5dac`, and candidate snapshot `683e0e4f-fae7-4b7b-8af1-b559efb18d51`.
- All 8 critical/high claims have verified evidence and at least one evidence anchor; no critical/high evidence gap or conflict remains.
- The customer snapshot contains the exact 10 departure-date prices from 979,000 to 1,269,000 KRW, a 3-day/2-night itinerary, BX134/BX133, 7 inclusions, 5 exclusions, and the customer-safe ticketing/cancellation notice.
- Uncorroborated source flight times are absent from the customer snapshot. The engine retained route/date/flight number and applied the final-confirmation disclosure instead of copying historical product times.
- Canonical payload hash `a8b2cc20f856c51dd4d7defeb213bcc6a6551a1751ff5b240ad6a29e19c1e423` remained identical across repeated source runs. Snapshot hash `b75e95f002e3d82349277b711ecc37061608a570144a6c38ff3f54f451faeff0` was rendered by build `f576b226841f1aa3c3478309b5699cdf83c3d68a` at 390x844 in actual serverless Chromium.
- Proof run `87ad8c4e-ed09-42ba-8a0b-b21f72cb24cc` passed. Both `/packages` and `/lp` returned 200, matched the exact snapshot/build lineage, loaded the Korean webfont, opened the customer CTA, had zero missing required facts, zero forbidden flight times, zero broken images, and zero hydration/runtime errors.
- The private first-viewport artifacts are SHA-256 `65899462cb6ba9b1b397d11bdc414dfabc3eea303f84c040a253a0e6fa5d6ffe` for `/packages` and `e96d32b5bfeda14acebddf22507401bea6cf7887dae0940b887be8095514ae89` for `/lp`; downloaded bytes matched the stored proof hashes exactly.
- Deployment-log inspection found that CTA `lead_sheet_open` telemetry returned HTTP 200 but was discarded by the legacy `package_score_signals_signal_type_check`. Migration `20260812082107_expand_package_score_signal_types.sql` is applied, all eight API-accepted types are now in the DB constraint, a real `lead_sheet_open` canary inserted successfully, and the canary row was removed afterward to avoid learning-data pollution.
- The snapshot stays `candidate`, the publication pointer query returns no row for catalog product `a4d687d2-13e0-4cda-ba46-d9b6ff78454d`, and the job records `publication_state=frozen`. Production exposure therefore remains unchanged.

## Customer assessment and remaining launch gate

The sample is technically safe for degraded automatic publication, but it is not yet visually sales-ready as a premium landing page. The document contains no licensable product imagery, so the snapshot explicitly records `MEDIA_ASSET_MISSING` and renders the brand fallback. OAG/Cirium credentials or two equivalent current schedule observations are also absent, so the source times remain hidden. These are the only three degraded reasons; there are no blockers in price, departure date, itinerary, terms, evidence, customer rendering, or CTA interaction.

The proof engine now preserves the faithful first mobile viewport PNG in tenant-scoped private Storage, records its state, path, and SHA-256 in the proof run, and never places capture bytes in public snapshot JSON. Full-page coverage comes from independent scroll, DOM fact, image, hydration, and CTA assertions. A later deployment may re-proof the same immutable snapshot with its own renderer build; proof acceptance still requires the observed build to equal the new proof run's expected build.

Keep the global freeze and existing-inventory backfill disabled until: (1) licensed destination/product media is automatically resolved or the business explicitly accepts brand fallback for the launch cohort, (2) the airline schedule provider policy is live if exact times must be shown, (3) more representative supplier files pass the same source-to-mobile gate, and (4) the existing 989 rows are shadow-classified before broad publication. One successful canary proves the end-to-end path, not an 80% corpus auto-publication rate.

## 2026-08-13 publication integrity follow-up

- A pre-existing pointer that claimed `published` while referencing an `approved` snapshot rendered by `local-v5-canary` was audit-logged and quarantined to `blocked`; the pointer version advanced to 9 and customer readers remain fail-closed.
- A deferred pointer invariant now requires exact tenant, catalog product, package, canonical revision, published snapshot, passed proof, snapshot hash, renderer build, and a non-local deploy build in the final transaction state.
- Public snapshot bodies are now append-only at the database boundary. Existing payloads, hashes, renderer lineage and proof inputs cannot be rewritten or deleted; a correction creates a new snapshot. A snapshot still referenced by a published pointer cannot be downgraded.
- The evidence-qualified legacy flight seed inserted 28 observations covering 17 flight numbers and 26 independent source families. These rows do not fill a customer time unless two independent, exact date/route/flight observations agree.
- Eight remaining public-schema Product Registration foreign-key indexes were applied and verified `valid=true`, `ready=true`. A fresh Supabase performance advisor run reports zero unindexed Product Registration foreign keys.
- Security advisor output contains no new Product Registration warning caused by this change. The internal `registration_schema_manifest` retains the expected service-only `RLS enabled, no policy` informational notice.
- A real blocked package URL exposed no body, but its parent layout still generated title/price/destination/OG metadata from `travel_packages`. The layout now calls the exact current-public snapshot reader, the boundary test forbids reintroducing the legacy reader, and the rebuilt HTML contains none of the blocked product title, `1,349,000` price, or Fukuoka destination. It emits generic Korean `noindex` metadata instead.
