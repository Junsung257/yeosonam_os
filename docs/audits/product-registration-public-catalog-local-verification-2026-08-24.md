# Product Registration and Public Catalog Local Verification

Date: 2026-08-24  
Branch: `codex/product-publication-catalog-integration-20260824`  
Worktree: `C:\dev\yeosonam-os-product-public-integration`

## Decision

Gates 0-4 are implemented and verified locally. The branch is ready for a
fresh-main reconciliation and protected preview, but it is not production
ready. No production database write, pointer mutation, deployment, indexing
request, or external communication occurred.

## Implemented scope

- reconciled the deployed product-registration lineage into a clean branch;
- retired legacy publication mutations and exposed one exact admin truth;
- added latest-revision fencing, reviewed publication requests, atomic channel
  pointer changes, post-public canary compensation, and stranded-request
  recovery through the existing convergence worker;
- extended revision-bound typed commercial facts and atomically projected
  `products`, `product_prices`, and `travel_packages`;
- added grounded customer-copy V2 with deterministic facts, gateway-mediated
  optional rewrite, evidence validation, and safe fallback;
- added a service-role-only `public_catalog_view` read projection over exact
  pointer/snapshot/proof lineage and typed future departures;
- cut home, package list/search/detail, metadata/print, destinations, sitemap,
  QA, Jarvis, recommendations, campaigns, influencer/affiliate surfaces, and
  public product readers over to the allowlisted catalog;
- server-rendered the initial package list and reduced the public search API to
  13 customer fields;
- removed mock activity, unsupported counters/claims, placeholder company data,
  obsolete `.co.kr` customer references, and broken legal navigation;
- retained the existing mobile-first design while adding truthful
  package/cruise/golf/private-group information architecture.

## Automated evidence

| Gate | Result |
|---|---|
| Focused catalog/publication/trust tests | PASS |
| Full Vitest | PASS — 855 files; 6,435 passed; 7 skipped |
| TypeScript | PASS |
| ESLint | PASS |
| Next production build | PASS — Next.js 15.5.21; 396 static pages |
| Migration-prefix audit | PASS — 548 files; 16 pre-existing collisions; 0 new |
| Runtime environment docs/code audits | PASS |
| Vercel function-count audit | PASS — 26/50 |
| Sensitive API guard audit | PASS |
| Strict PII audit | PASS — 0 blockers |
| Customer egress manifest | PASS — 29 registered catalog consumers |
| `git diff --check` | PASS |

The full build safely produced an empty catalog when no local service-role
database was available; it did not fall back to legacy `approved` products.

## Browser evidence

The Vercel `agent-browser` CLI was unavailable, so the repository Playwright
runtime was used as the documented fallback. The reusable verifier is
`scripts/verify-public-catalog-local-browser.mjs`.

The matrix covered `/`, `/packages`, `/cruise`, `/private-tour`, a destination,
and `/about` at 390×844 and 1440×900. All 12 combinations returned HTTP 200,
rendered the expected meaningful heading/content, showed no blocking overlay,
emitted zero browser console errors, and contained none of the audited old
domain or unsupported trust claims.

Screenshots were inspected from the temporary local evidence directory. They
are not committed because they are machine-local derivative artifacts.

## Explained blockers

1. A full empty-database migration replay reaches a pre-existing legacy
   migration that assumes a `customers` table. The isolated temporary database
   was removed; production was untouched. New migration static/security
   contracts pass, but staging migration apply and query-plan evidence remain
   mandatory.
2. The repository structured-data audit fails in the untouched blog-owned file
   `src/lib/blog-jsonld.ts` because a Product description can be absent. The
   concurrent blog session owns that file, so this branch records the release
   blocker instead of overwriting that work.
3. Blog-owned product attachment paths (`/api/blog`, blog detail/destination,
   and angle matching) still use the exact published-snapshot helpers rather
   than `public_catalog_view`. They remain safe from raw compatibility-table
   fallback, but final cross-surface catalog parity must be reconciled after the
   concurrent blog branch lands. This branch intentionally did not edit those
   files.
4. The Gate 0 production read showed V6.1 migrations were not applied and the
   source-proof auto-publish environment flag was on. Both must be rechecked and
   made safe before any staging/production data operation.
5. Legacy product repair, the two Da Nang golden-product replays, live set
   parity, query plans, cache/rollback drills, and 4-hour/24-hour observation
   require controlled environment writes or elapsed production observation.
6. Company, registration, insurance, and legal claims require owner-supplied
   evidence and legal review. Missing facts are hidden rather than fabricated.

## Required next sequence

1. Wait for concurrent settlement/blog work, then fetch and reconcile this
   branch with the resulting protected `main` without discarding either work.
2. Push a protected PR and deploy an unaliased preview for the exact reviewed
   SHA.
3. Apply migrations to an approved staging environment; run RLS/grant tests,
   query plans, catalog shadow parity, browser proof with real eligible cards,
   kill-switch/cache/rollback drills, and structured-data audit.
4. Repair and replay the two golden products twice under one release manifest.
5. Request explicit approval for production migrations, release, and any data
   repair. Only then prove production SHA parity and run 4-hour/24-hour
   observation gates.

## Final local status

```text
STATIC FINDINGS REPRODUCED: YES
LOCAL IMPLEMENTATION GATES 0-4: PASS
LOCAL TEST/TYPE/LINT/BUILD: PASS
LOCAL BROWSER MATRIX: 12/12 PASS
PRODUCTION WRITES: 0
DEPLOYMENTS: 0
PRODUCTION READY: NO
NEXT STATE: PROTECTED PR/PREVIEW AFTER CONCURRENT-SESSION RECONCILIATION
```
