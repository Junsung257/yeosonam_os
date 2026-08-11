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

## Remaining live gate

The V6 preview is branch-scoped to shadow mode with publication disabled and frozen. Real HWP canary upload, exact source comparison, Chrome mobile proof, and surface convergence are still required before any bounded publication. Chrome automation could not be completed in this run because the Codex Chrome-control runtime failed to create its internal kernel asset path even though Chrome, the extension, and native-host diagnostics all passed. Do not substitute a different browser and do not claim visual proof until the Browser/Chrome plugin is reinstalled or repaired.
