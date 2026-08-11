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

These failures demonstrate why source upload acceptance and extraction success must be measured separately. The product is not customer-openable until the WASM canary reaches a terminal registration outcome and its snapshot has exact mobile proof.

## Remaining live gate

The V6 preview is branch-scoped to shadow mode with publication disabled and frozen. A successful second HWP canary, exact source comparison, Chrome mobile proof, and surface convergence are still required before any bounded publication. Chrome automation could not be completed in this run because the Codex Chrome-control runtime failed to create its internal kernel asset path even though Chrome, the extension, and native-host diagnostics all passed. Do not substitute a different browser and do not claim visual proof until the Browser/Chrome plugin is reinstalled or repaired.
