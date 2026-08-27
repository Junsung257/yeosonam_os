# Public Catalog and Trust Hardening Verification

This verification is Track B evidence. The combined release cannot pass until
the shared authority, price, publication-request, pointer-compensation, and
golden-product gates in `integration.md` also pass against the same release
manifest and final build.

Date: 2026-08-24

Status: local implementation verified; environment-dependent recovery and
release checks remain blocked pending authorization

## 1. Baseline evidence

Research was performed read-only from a clean worktree based on:

- Git base: `28fa9f5a19ad6e4bfcc5e22237b938ec234baf22`
- Node engine: `24.x`
- Next.js: `15.5.21`
- React: `^19.2.6`
- planning branch: `codex/public-catalog-trust-plan-20260824`
- planning worktree: `C:\dev\yeosonam-os-public-catalog-plan`

Observed baseline failures to recheck after concurrent work settles:

| Check | 2026-08-24 baseline |
|---|---|
| Strict public product readiness | 0/7 PASS in the concurrent deep audit |
| Home vs list | home reads about 7; list API exposes about 2 |
| No-future-departure rows | 5/7 public rows |
| Future row with expired deadline | present; deadline 2026-08-13, marketing false |
| Search payload boundary | full snapshot spread plus internal-shaped maps |
| Initial `/packages` product HTML | absent; SWR fetch after hydration |
| Package URLs in sitemap | absent |
| Mock recent activity | present on `/private-tour` and `/group` |
| Placeholder legal/company data | present on `/about` |
| Unsafe nested detail access | `item.activity.trim()` present |
| Home cache contract | `force-dynamic` and `revalidate=300` both present |

These are observations, not permanent facts. The implementation run must create a
fresh dated baseline and explain any difference.

## 2. Required test inventory

Names are recommended locations; equivalent final locations are acceptable when
the ownership remains clear.

### 2.1 Pure policy and DTO

- `src/lib/public-catalog/eligibility.test.ts`
  - exact pointer/proof pass;
  - active/expired visibility overlay;
  - active global/product/supplier kill switches;
  - future/past/empty/malformed departures;
  - every pricing, booking, inventory, and sale state;
  - open/conditional/expired/conflicting ticketing deadlines;
  - marketing eligible true/false/missing;
  - Seoul date boundary at 00:00 and year/month rollover;
  - direct-only versus discoverable/indexable decisions.
- `src/lib/public-catalog/audited-products-regression.test.ts`
  - all seven sanitized audit fixtures are initially excluded;
  - each becomes eligible only after all required facts are repaired.
- `src/lib/public-catalog/dto.test.ts`
  - explicit field snapshot;
  - no unknown/forbidden keys recursively;
  - no price without typed `PRICED` fact;
  - verified and availability timestamps are not synthesized;
  - missing nested data produces a valid safe DTO;
  - serialized size budget.
- `src/lib/public-catalog/egress-manifest.test.ts`
  - all raw/public package consumers are registered;
  - discovery consumers call the repository;
  - public code does not read mutable `travel_packages` as fallback;
  - new public response fields require manifest review.

### 2.2 Repository and API

- Repository integration tests:
  - fact/departure join and deduplication;
  - bounded filters and stable pagination/sort;
  - kill-switch behavior;
  - DB error/unknown runtime mode fails closed;
  - shadow reason counts contain no raw payload/PII.
- `src/app/api/packages/search/route.test.ts`
  - standard `apiResponse` shape;
  - no internal maps/hashes/revisions/proofs/reasons;
  - invalid filter rejection or normalization;
  - cache header contract;
  - 503/empty-safe fail-closed behavior;
  - payload budget for 12 cards.
- Update `PackagesClient.fetcher.test.ts` for the new response contract and
  server initial data.

### 2.3 SSR, detail, destination, sitemap, trust

- `/packages` source/render test proves server repository read and initial card
  links without a browser fetch.
- Detail render tests cover missing/null/blank/malformed itinerary activity,
  hotel, meal, images, notices, and terms.
- Detail SEO decision tests assert robots, canonical, Product/Offer JSON-LD, CTA,
  and sitemap state for every policy branch.
- Destination tests preserve the final #1143 malformed climate/body cases and
  add zero-product guide-only rendering.
- Sitemap tests prove exact set parity with `indexable` package decisions and no
  direct-only URL.
- Outbox/revalidation tests cover home, list, search API, detail, destination,
  metadata/OG, recommendations, and sitemap.
- Trust source tests reject `MOCK_FEED`, placeholder registration patterns,
  unsupported claims, duplicate social profiles, `.co.kr`, and broken internal
  legal links in customer surfaces.
- Browser tests run with JavaScript enabled and disabled/cold HTML inspection at
  mobile and desktop widths.

## 3. Database verification

Run on a clean local database and the identified staging branch. Do not run
fixture writes on production.

### 3.1 Migration integrity

```powershell
npx supabase migration list
npm run audit:migration-prefix:ci
npx supabase db reset
```

If local PostgreSQL/Supabase cannot run, record the environment blocker and use
an isolated Supabase branch. A TypeScript build is not a substitute for applying
the migration chain.

### 3.2 View security

Run an evidence query equivalent to:

```sql
select c.relname, c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'product_registration_customer_fact_view',
    'product_registration_customer_departure_fact_view'
  );

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'product_registration_customer_fact_view',
    'product_registration_customer_departure_fact_view'
  )
order by table_name, grantee, privilege_type;
```

Expected:

- `security_invoker=true` is present.
- `service_role` has required select access.
- `public`, `anon`, and `authenticated` have no grant.

Inside a rollback-only local/staging transaction, `SET LOCAL ROLE anon` and
`SET LOCAL ROLE authenticated` selects must fail. Never grant temporary public
access merely to make this test pass.

### 3.3 Overlay truth table

Use transaction-scoped fixtures or pgTAP to prove:

| Overlay fixture | Customer fact result |
|---|---|
| no overlay | row can remain when pointer/proof passes |
| active `public/available` | row remains |
| active `public/request` | row remains; live-check semantics |
| active `under_review/*` | row absent from public fact view |
| active `hidden/*` | row absent |
| active `public/closed` | row absent |
| active `public/sold_out` | row absent |
| active `public/suspended` | row absent |
| expired hidden/closed overlay | behaves as no active overlay |

Also prove the route-state RPC and repository agree for these cases.

### 3.4 Query plan

Capture `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for:

- current customer fact rows by tenant/channel/locale;
- departures for a bounded product/revision set with `departure_date >= today`;
- active kill switches by tenant and expiry;
- the first 12 catalog cards and a representative destination/month filter.

Record row count, total execution time, shared buffer reads/hits, and plan nodes.
Use existing V6.1 indexes unless the measured plan proves a missing path. A
sequential scan over a tiny table is not automatically an index defect.

## 4. Static and automated commands

Run focused tests first, then the repository gates:

```powershell
npx vitest run src/lib/public-catalog
npx vitest run src/app/api/packages/search/route.test.ts
npx vitest run src/app/packages
npx vitest run src/app/destinations
npx vitest run src/app/sitemap.test.ts src/app/public-package-boundary.test.ts
npm run type-check
npm run lint
npm test
npm run audit:migration-prefix:ci
npm run verify:runtime-env-docs
npm run audit:vercel-functions:ci
npm run verify:local-release -- --json --report=.tmp/public-catalog-local-release.json
npm run build
```

If final V6.1 supplies additional release/readiness commands, add them rather
than replacing them. Record start/end time, exit code, and artifact path for
every required gate. A later Linux/Vercel build may supersede a documented local
Windows build limitation, but an unrecorded timeout is not PASS.

Also run:

```powershell
git diff --check
git status --short
```

Only expected files may be dirty before commit.

## 5. Contract and payload verification

Create a deterministic script, for example
`scripts/verify-public-catalog-contract.mjs`, that can inspect a local/preview
base URL and output JSON evidence.

Required assertions:

- response uses the expected standard envelope;
- every card has exactly the allowlisted schema;
- recursively forbidden keys are absent, including patterns:
  `hash`, `revision`, `proof`, `canonical_payload`, `policy`, `validation_reason`,
  `raw`, `supplier_cost`, `net_cost`, `margin`, `authority`;
- card JSON is at most 2.5 KB uncompressed;
- initial 12-card response is at most 30 KB uncompressed;
- IDs are unique and stable across repeated requests;
- every returned ID is discovery eligible under the captured policy date;
- no audited failing fixture ID appears before repair.

The forbidden-key list applies to public JSON keys and values known to be
internal. It must be reviewed to avoid rejecting a legitimate customer phrase
merely because its human-readable text contains a substring.

## 6. SSR and crawler verification

Against the exact preview/candidate URL:

1. Fetch `/`, `/packages`, representative package details, a destination with
   products, a guide-only destination, and `/sitemap.xml` with a cold request.
2. Save response headers and HTML.
3. Without executing JavaScript, assert:
   - `/packages` contains its H1, eligible card titles, prices/modes, and
     crawlable canonical detail links;
   - an empty catalog contains an honest empty state and inquiry link;
   - destination guide content survives zero products;
   - no loading skeleton/empty placeholder is the only crawlable content;
   - canonical and robots are correct.
4. Run Playwright/browser verification at at least 390×844 and 1440×900.
5. Confirm cards, filters, CTA, bottom tabs, modal/focus, and back navigation.
6. Inspect hydration/console/network errors and Vercel function logs.

Google's official JavaScript SEO guidance is the standard for crawler-visible
HTML; search-engine cache alone is not used as a current production oracle.

## 7. Cross-surface set parity

The verification script must capture normalized IDs from:

- catalog repository audit output;
- home cards;
- `/packages` initial HTML;
- search API without filters;
- each destination's product block;
- package URLs in sitemap;
- recommendations/blog/customer-AI/marketing candidate outputs where enabled.

Expected relations:

```text
home IDs subset of discovery IDs
list/search unfiltered IDs equal bounded/paginated discovery IDs
destination IDs equal discovery IDs matching that normalized destination
sitemap package IDs equal indexable IDs
marketing IDs subset of discovery IDs where marketingEligible=true
recommendation/blog/AI proactive IDs subset of discovery IDs
```

Every difference requires a named query/pagination rule or is a failure. “Each
page has a different filter” is not an acceptable undocumented explanation.

## 8. SEO and structured-data verification

For every decision branch, assert:

| Decision | Robots | Sitemap | Product JSON-LD | Offer JSON-LD |
|---|---|---|---|---|
| discoverable/indexable priced | `index,follow` | included | allowed | allowed with complete facts |
| discoverable request-only | policy-approved `index,follow` | included | allowed | no numeric Offer unless valid |
| direct-only consultation | `noindex,follow` | excluded | absent by default | absent |
| under review/hidden/not found | noindex/not found boundary | excluded | absent | absent |

Validate canonical URL consistency and JSON-LD serialization. Confirm:

- no past availability/departure dates;
- no expired deadline described as urgent;
- no product price/count on a zero-product destination;
- package detail URLs use the route's real canonical ID/slug;
- organization sameAs contains only verified profiles;
- title/description/H1 describe package, cruise, and golf without claiming live
  cruise inventory.

Use the Google Product structured-data requirements as a check and archive test
output/screenshots; do not rely only on a green schema parser.

## 9. Trust and legal verification

### Source scan

The CI test must fail if customer source contains known patterns such as:

- `MOCK_FEED`
- `000-00-00000`
- `제2024-000000`
- the placeholder representative/address found in the baseline
- `120+`, unsupported `24시간`, `3분 평균 응답`
- unconditional `출발 보장`
- customer footer `.co.kr`
- links to a route that does not exist

Numeric strings are not banned globally; the scanner is scoped to the affected
claims/components and an evidence-backed allowlist.

### Company evidence

For every displayed field/badge, archive:

- value and display wording;
- source/evidence reference;
- business/legal owner;
- verified date and expiry/review date;
- public help/proof link when allowed.

Expired/missing evidence must make the UI hide the field. Never expose uploaded
insurance/business documents or internal evidence IDs from the browser.

Privacy, terms, travel terms, cancellation/refund, and insurance wording require
owner/legal sign-off. Automated tests verify presence, routes, dates, and company
identity consistency, not substantive legal correctness.

## 10. Cache and convergence verification

For publication, under-review, public, hidden/sold-out, and repaired-price events:

1. Record pointer/overlay version and event ID.
2. Trigger the approved V6.1 outbox path.
3. Confirm invalidation/convergence for:
   - `/`;
   - `/packages`;
   - `/api/packages/search`;
   - `/packages/[id]` and metadata/OG;
   - every affected `/destinations/[city]`;
   - `/sitemap.xml`;
   - recommendation/blog/AI/marketing caches.
4. Confirm old ID/price/visibility does not survive past the documented bound.
5. Confirm a transient cache API failure remains observable/retryable and does
   not silently mark all surfaces converged.

No page may combine `force-dynamic` with a misleading ISR declaration. Record
the selected cache mode and response headers for each surface.

## 11. Preview and production source identity

Add a release verifier that compares:

- reviewed full Git SHA;
- local checkout SHA;
- `origin/main` SHA;
- Vercel deployment Git metadata SHA;
- production deployment SHA after promotion;
- Supabase migration head used by that deployment.

Expected before production promotion:

```text
reviewed SHA = checkout SHA = origin/main SHA = candidate deployment SHA
```

Expected after promotion:

```text
production deployment SHA = protected GitHub main SHA = approved release SHA
```

The verifier uses Vercel/GitHub metadata with redacted output. It must not print
tokens or environment secrets. A production deployment sourced from an unknown
local checkout fails the release gate even if smoke tests pass.

## 12. Runtime and observability

During preview, the first 4 production hours, and the 24-hour follow-up, inspect:

- destination/package/home/list/search/sitemap 5xx and exceptions;
- `.trim()` TypeError recurrence;
- `DYNAMIC_SERVER_USAGE` and missing route/lambda behavior;
- function duration, timeout, memory, statement timeout, and cold start;
- cache decision/revalidation errors and convergence backlog;
- public catalog reason counts and unexpected zero/nonzero changes;
- crawler HTML and canonical/robots drift;
- consultation CTA errors and analytics schema errors;
- public API payload size and forbidden-key regressions.

Log catalog decisions by reason/count/product ID only when necessary; do not log
full snapshots, terms, proofs, PII, or source documents.

## 13. Rollback drill

Before live activation on staging:

- switch the catalog to `hidden` and prove every product/Offer disappears while
  inquiry/help navigation remains;
- clear/revalidate all scoped surfaces and prove no stale card remains;
- exercise a product kill switch and visibility overlay;
- revert the scoped app commit in a disposable branch and build it;
- document the forward migration correction path;
- prove the drill did not delete a pointer, snapshot, revision, proof, or audit
  row.

Production rollback uses the same mechanisms only after incident approval.

## 14. Final acceptance record

Complete this table during implementation:

| Gate | Result | Evidence |
|---|---|---|
| Concurrent branch reconciliation | PASS | Gate 0 audit and clean integration lineage |
| Fresh catalog baseline | PASS | Same-time home 7 / API 2 / pointers 9 / sitemap 0; destination 500 captured |
| Pure policy/DTO tests | PASS | Targeted catalog, API, eligibility, trust, and migration contract suites |
| Migration reset/apply/security | BLOCKED | Static contracts pass; full local replay stops at legacy migration missing `customers` |
| Query-plan budget | BLOCKED | Requires migrated staging data and representative row counts |
| Shadow reconciliation | BLOCKED | Requires staging/production-like data; no production write was authorized |
| Cross-surface set parity | PASS (code) | Home/list/API/detail/destination/sitemap use the exact catalog projection; live set proof awaits migration |
| Server-rendered initial HTML | PASS (local) | `/packages` returns honest SSR empty state without service DB; card-bearing preview proof remains open |
| API field/payload boundary | PASS | Minimal 13-field allowlisted search DTO; internal lineage is not serialized |
| Detail/destination runtime regressions | PASS (local) | Targeted tests and 12-route viewport browser matrix; zero page console errors |
| Sitemap/robots/JSON-LD parity | PARTIAL | Catalog routes pass; repository structured-data audit is blocked by untouched `src/lib/blog-jsonld.ts` |
| Mock/placeholder/claim removal | PASS | Trust contract scan and local browser assertions pass |
| Company/legal owner sign-off | BLOCKED | Unverified facts are hidden; owner/legal evidence was not supplied or invented |
| Cache/outbox convergence | PASS (contract) | Existing outbox reused; canary compensation and request recovery tested; staging runtime drill open |
| Type/lint/full test/build/release gates | PASS (local) | Type-check, lint, build; 855 files, 6,435 passed and 7 skipped |
| Preview browser and runtime proof | BLOCKED | Local 12/12 browser proof passes; no external preview deployment authorized |
| Emergency hidden/rollback drill | BLOCKED | Requires migrated staging and release-operator authorization |
| Protected main / Vercel SHA parity | BLOCKED | Local branch is intentionally unpushed and unmerged |
| 4-hour production observation | BLOCKED | No production deployment authorized |
| 24-hour production observation | BLOCKED | No production deployment authorized |

The local implementation packet is complete through Gate 4. Production P0 is
not complete while the explained environment/owner gates above remain blocked.
A zero-product catalog can pass; an unsafe product exposed to avoid an empty
site cannot.
