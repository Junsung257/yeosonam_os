# Product Registration P0 Integration Refresh — 2026-08-27

Status: current production source authority is reconciled; public-catalog and
V6.1 database contracts remain unapplied. Production remains `NO-GO` for
automatic publication.

This refresh was captured between 2026-08-27 08:26 and 08:31 KST. All
production checks were read-only. Production database writes, environment
changes, deployments, pointer changes, cache invalidations, and search-engine
requests were zero.

## Release authority

| Authority | Observed value | Result |
|---|---|---|
| GitHub protected `main` | `9c410cf84eea97a79a115ce39dd95c5d1bf6d511` | Current authority |
| Vercel production code SHA | `9c410cf84eea97a79a115ce39dd95c5d1bf6d511` | Exact match |
| Vercel production deployment | `dpl_4AEbZRF3iywMkgfbdTBXBHTYJ98q` | `READY` |
| Integration branch | `codex/product-authority-phase0-20260827` | Clean worktree based on current main |
| Prior implementation PR | `#1148`, head `966ed921f5a0bf85b440fb075d0348b119af631c` | Re-integrated instead of duplicated |

The deployment/Git authority split recorded on 2026-08-24 is closed at this
capture time. The older implementation PR conflicted with current main in two
files only. Resolution keeps current API input validation and structured
logging while changing the V1 package reader to the exact public catalog; the
OCR benchmark keeps both provenance assertions and the bounded timeout.

## Production authority and publication ledger

Supabase project: `ixaxnvbmhzjvupissmly`.

| Control or record | Observed value | Assessment |
|---|---:|---|
| Authority mode | `kernel` | Active |
| Publication freeze | `false` | Broad freeze is not active |
| Active kill switches | `0` | No emergency block active |
| Customer pointers | 9 `published`, 1 `blocked` | Unchanged from prior audit |
| Published pointer/latest revision parity | 9/9 | Exact |
| Published pointer/`travel_packages.canonical_revision_id` parity | 9/9 | Exact |
| All-channel pointers | 25 `published`, 1 `blocked` | 9 customer + 8 B2B + 8 partner |
| Public snapshots | 19 `published`, 8 `approved`, 5 `blocked`, 305 `candidate` | Pre-V6.1 contract |
| Browser proofs | 247 `passed`, 312 `failed` | Historical aggregate |
| Convergence | 69 `converged`, 28 `failed`, 12 `stale` | Historical aggregate |
| Outbox | 60 `delivered` | No other state at capture |
| Revisions | 18 `verified`, 1 `approved`, 48 `candidate`, 926 `needs_review` | Automation gate not met |

The Vercel control keys still exist, but their current encrypted values were not
exported. Therefore the 2026-08-24 source-proof auto-publication value remains
historical evidence and the current value is classified
`LIVE_STATE_UNVERIFIED`. The integration code does not use that flag to
publish directly; it requires a reviewed publication request.

## Database contract inventory

Production does not yet contain:

- `internal_product_registration.admin_package_publication_truth_v`
- `internal_product_registration.public_catalog_view`
- `internal_product_registration.publication_requests`
- `internal_product_registration.price_date_overrides`

`internal_product_registration.departure_instances` exists. The V6.1,
publication-guardrail, customer-copy V2, publication-workflow, and public
catalog migrations in the integration branch are not recorded in production
migration history. Applying them remains a separately approved release action.

## Same-time public surfaces

| Surface | Observed result | Assessment |
|---|---:|---|
| Home SSR | 7 distinct package detail links | Mismatch |
| `/api/packages/search` | 2 packages | Mismatch |
| Customer published pointers | 9 packages | Mismatch |
| `sitemap.xml` | 0 package detail URLs | Mismatch |
| Public search item fields | 49 | Internal coupling/payload leak remains |
| `/destinations/푸꾸옥` | HTTP 404 | No public route for this slug |

Vercel runtime logs for the previous 24 hours still include
`DYNAMIC_SERVER_USAGE` on `/destinations/푸꾸옥` (four occurrences across
two groups). Destination rendering is therefore not considered closed even
though the direct request returned 404.

## Readiness metrics

The live automation metric reports a legacy inventory of 993, 640 unique V6
sources, 304 media-ready revisions, three eligible cohort samples, zero passed
benchmark samples, and no frozen HWP/text holdout population. The benchmark V2
readiness object is empty. These figures do not satisfy the frozen blind-review
automation threshold and must not be treated as permission to auto-publish.

## Refreshed decision

```text
STATIC FINDINGS REPRODUCED: YES
BASELINE SAMPLE RUNS: PARTIAL / EXACT FIVE-SAMPLE REPLAY PENDING
PRODUCTION WRITES: 0
CURRENT SOURCE-PROOF AUTO-PUBLISH VALUE: LIVE_STATE_UNVERIFIED
PUBLIC CATALOG CONTRACT APPLIED TO PRODUCTION: NO
P0 IMPLEMENTATION READY: YES
PRODUCTION READY: NO
```

The next safe action is code integration, full local verification, protected
PR, and an unaliased Vercel preview. Remote migration rehearsal and production
release remain explicit approval gates.

## Current-main integration verification

The prior implementation branch was merged into current main and verified in
the clean integration worktree.

| Check | Result |
|---|---|
| Focused publication/catalog/admin/destination/OCR contracts | 14 files, 43 tests passed |
| Full Vitest suite | 870 files passed; 6,525 tests passed; 7 skipped |
| TypeScript | `npm run type-check` passed |
| ESLint | `npm run lint` passed with zero warnings |
| Product-registration authority contract | strict check passed; authorized 1, legacy 0, unapproved 0 |
| Next.js production build | passed; 397/397 static pages generated and post-build output verified |

The first local build completed compilation but exhausted the default 6 GB V8
heap while repeating Next.js's whole-application type collection. The
standalone 8 GB type-check had already passed. Re-running the identical build
with `NEXT_BUILD_MAX_OLD_SPACE_SIZE=8192` completed compilation, type
collection, page generation, trace collection, output verification, and pinned
RHWP runtime verification. This was a local resource limit, not a code or
contract failure.
