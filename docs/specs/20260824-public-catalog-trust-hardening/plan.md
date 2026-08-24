# Public Catalog and Trust Hardening Plan

Date: 2026-08-24

Execution trigger: the user says `개발 진행해` after the concurrent sessions end

## 1. Execution strategy

Implement in one fresh worktree, but release in controlled gates. “Batch” means
one coordinated implementation program with one authority and acceptance suite;
it does not mean applying unverified SQL and UI changes directly to production.

```text
settle concurrent branches
  -> freeze/re-audit baseline
  -> pure policy + regression fixtures
  -> forward DB/view repair
  -> shadow catalog proof
  -> atomic customer-surface cutover
  -> trust/IA cleanup
  -> product repair and republish
  -> preview/canary/main production proof
```

The catalog cutover is fail closed. A repository failure in authoritative mode
must return an unavailable/empty-safe state, not fall back to legacy snapshots or
`travel_packages`.

## 2. Gate 0 — settle and reconstruct the baseline

Do this before editing code.

1. Fetch `origin` and list all worktrees and open PRs.
2. Confirm the final disposition of:
   - product registration V6.1 authority;
   - V6.1 RC2.1 preview/canary guards;
   - destination baseline PR #1141 and hardening PR #1143;
   - any session that changed home, package list/detail, sitemap, or outbox.
3. Compare the divergent V6.1/RC2 tips using merge-base, file content, and
   `git cherry`; do not infer completion from commit names.
4. Confirm V6.1 customer route state, fact views, typed departure facts, source
   proof, and outbox invalidation exist on protected `main`.
5. Preserve the destination climate/body normalizers and their tests from the
   final destination stack.
6. Do not merge or cherry-pick closed public-egress PR #749. Recreate only its
   egress manifest and boundary-test concepts on current code.
7. Create a clean worktree and branch from the resulting `origin/main`, for
   example `codex/public-catalog-trust-hardening-20260824`.
8. Record base SHA, active migration head, Node/Next versions, open PRs, and
   worktree states in the implementation verification file.
9. Re-run the 2026-08-24 catalog inventory against the settled source and
   staging data. Store a new audit, rather than modifying the concurrent audit.

Stop if V6.1 is not landed, the worktree is dirty, production source identity is
unknown, or the staging database cannot be identified unambiguously.

## 3. Gate 1 — encode policy before integration

Create pure, deterministic domain modules first:

```text
src/lib/public-catalog/
  types.ts
  normalize.ts
  eligibility.ts
  dto.ts
  repository.ts
  egress-manifest.ts
  cache.ts
  *.test.ts
```

### 3.1 Pure policy

- Accept `today` explicitly in `YYYY-MM-DD` Seoul time; do not call the wall
  clock inside eligibility tests.
- Parse V6.1 departure states and approved snapshot fields without `any` or
  unchecked casts.
- Return separate `route`, `discovery`, `marketing`, `seo`, `price`, and `cta`
  decisions with reason codes.
- Fail closed for missing/conflicting facts.
- Encode the seven audited public products as sanitized regression fixtures.
  The fixtures contain no internal source document, cost, PII, or secret.
- Prove that none is discoverable until its failing facts are explicitly fixed.
- Add property tests or a decision-table test so relaxing one gate cannot make
  hidden/expired/unresolved products eligible accidentally.

### 3.2 Allowlist DTO

- Map approved projections to `PublicCatalogCard` and normalized detail DTOs.
- Reject unknown product kinds; reserve `cruise` for the future independent
  module instead of silently treating it as a package.
- Normalize destination, departure airport, images, duration, condition flags,
  price modes, dates, and timestamps.
- Cap available dates and badge counts in the card DTO.
- Build a recursive forbidden-key test for hashes, revisions, proofs, internal
  reasons, raw payloads, costs, and policy fields.
- Add a serialized payload budget test.

## 4. Gate 2 — database read-model correction

Create a new migration with `supabase migration new`; never edit an existing
applied migration.

### 4.1 View correction

Replace the V6.1 `product_registration_customer_fact_view` definition while
preserving existing columns and appending any required overlay facts:

- active-overlay expiry belongs in the join predicate;
- active `customer_visibility_state` must be `public`;
- active `sale_state` must not be `closed`, `sold_out`, or `suspended`;
- append `availability_sale_state`, `availability_checked_at`, and only other
  server facts proven necessary by the DTO mapper;
- retain exact pointer/snapshot/hash/proof joins;
- retain `security_invoker = true`;
- revoke `public`, `anon`, and `authenticated`; grant `service_role` only.

The departure fact view remains a facts view, not the public catalog policy. It
may contain past/unknown rows for audit consumers; the application repository
selects eligible future facts.

### 4.2 Database verification

- Reset a clean local Supabase instance from migrations when the environment is
  available.
- Apply the migration on an isolated/staging branch first.
- Verify view owner, `security_invoker`, grants, dependency validity, and row
  behavior for no overlay, active overlay, expired overlay, hidden, sold-out,
  suspended, and request states.
- Query with anon/authenticated roles and prove access is denied.
- Run `EXPLAIN (ANALYZE, BUFFERS)` for the pointer/fact/departure lookup at 500,
  5,000, and realistic current row counts.
- Reuse V6.1 indexes. Add an index only from observed evidence, and add it in a
  separate forward migration if needed.

## 5. Gate 3 — repository and shadow proof

### 5.1 Server repository

- Use the server-only Supabase client.
- Read service-role customer fact and departure fact views.
- Evaluate active global/product/supplier kill switches centrally.
- Select only needed columns; avoid returning full `snapshot_json` for cards
  when `card_projection` is sufficient.
- Make filters typed and bounded: query, destination, departure hub, month,
  price, product kind, urgency.
- Urgency requires an open future deadline. An expired deadline can never be
  urgent.
- Record decision reason counts in server logs/metrics without logging full
  payloads, proofs, PII, or sensitive terms.

### 5.2 Runtime mode

Add a server-only enum such as:

```text
PUBLIC_CATALOG_MODE=shadow | authoritative | hidden
```

- `shadow`: existing customer output remains temporarily active while the new
  repository produces ID-set and reason-count evidence. Keep this window short.
- `authoritative`: every registered surface uses the new repository; no legacy
  data fallback.
- `hidden`: emergency honest empty/unavailable state; no products or Offer data.

Validate the value in configuration. Unknown values fail to `hidden`, not to a
legacy catalog. After the stabilization window, remove legacy public reads and
the shadow comparison path; retain a fail-closed emergency control.

### 5.3 Shadow acceptance

- Capture legacy versus authoritative IDs by surface/query.
- Explain every difference with an eligibility reason.
- Expect the audited seven-product cohort to be excluded under strict P0.
- Treat zero eligible products as a valid result.
- Do not activate authoritative mode until no unexplained row remains.

## 6. Gate 4 — customer-surface cutover

Cut over all discovery surfaces in one reviewed change so a single deployment
cannot leave mixed data contracts.

### 6.1 Home

Files likely owned:

- `src/app/page.tsx`
- home product/hero/customer components touched by the final V6.1 branch

Changes:

- Replace snapshot/date/deadline filters with the repository.
- Choose a single cache model and remove `force-dynamic` plus `revalidate`
  ambiguity.
- Render only 3–6 eligible cards, or an honest empty state.
- Remove expired urgency behavior and unsupported badges.
- Keep P1 layout changes behind the same reviewed data contract.

### 6.2 Product list and search API

Files likely owned:

- `src/app/packages/page.tsx`
- `src/app/packages/PackagesClient.tsx`
- `src/app/api/packages/search/route.ts`
- possibly split filter/card components under `src/components/customer/`

Changes:

- Server-render the first 12 DTOs from the repository.
- Pass `initialData` to the client; use SWR only after query/filter changes.
- Use `apiResponse`; remove `NextResponse.json` and `any` from the route.
- Return only the DTO plus derived filter metadata.
- Move scoring/personalization to a separate safe endpoint or server projection.
- Hide a filter when there is only one meaningful value or the catalog is too
  small for it to help.

### 6.3 Package detail

Files likely owned:

- `src/app/packages/[id]/page.tsx`
- `src/app/packages/[id]/DetailClient.tsx`
- detail metadata/JSON-LD helpers and tests

Changes:

- Keep final V6.1 route-state and preview/canonical guards.
- Load one normalized approved detail DTO on the server.
- Remove client access to internal snapshot fields.
- Fix every unsafe nested string assumption, including missing `activity`.
- Drive CTA, robots, canonical, Product/Offer JSON-LD, and similar-products link
  from the shared decisions.
- Do not claim price/availability freshness without a persisted timestamp.

### 6.4 Destination

Files likely owned:

- `src/app/destinations/[city]/page.tsx`
- destination helpers/tests from PR #1143

Changes:

- Preserve final malformed climate/pillar normalization.
- Remove the repeated `price_dates` alive filter.
- Match normalized destination against repository results.
- Separate guide/post/attraction counts from product counts.
- Return a useful 200 page with reviewed guide content when products are zero.
- Remove unsupported operations claims and any price/Offer block when products
  are zero.
- Choose the final render strategy only after verifying Vercel route emission;
  never reintroduce a static route omission to avoid `force-dynamic`.

### 6.5 Sitemap and downstream egress

Files likely owned:

- `src/app/sitemap.ts`
- recommendation, blog-link, campaign, customer-AI readers listed by the egress
  manifest
- final V6.1 outbox/revalidation code

Changes:

- Emit every indexable package detail canonical URL and no non-indexable one.
- Derive product-bearing destinations from eligible catalog rows.
- Preserve reviewed guide-only destination URLs under their own content rule.
- Update recommendation, campaign, blog, AI, RSS/OG, and comparison consumers to
  start from eligible IDs and consume only their declared projection.
- Always invalidate a broad `product:destinations` tag and invalidate old/new
  destination tags/paths when publication lineage supplies them.
- Add convergence probes for home, list, search, detail, destination, and sitemap.

## 7. Gate 5 — trust, metadata, and P1 IA

### 7.1 Immediate trust cleanup

Likely files:

- `src/app/private-tour/page.tsx`
- `src/app/group/page.tsx`
- `src/app/about/page.tsx`
- `src/app/privacy/page.tsx`
- `src/app/terms/page.tsx`
- footer/company components

Actions:

- Remove both mock feeds and hard-coded unsupported counts/times.
- Remove placeholders and broken `/disclaimer` link.
- Add the verified company-profile contract and render only valid evidence.
- Keep legal document replacement blocked until owner/legal-approved content is
  supplied; show accurate current links without fabricating terms.
- Add CI source scans for known placeholder/mock/unsupported-claim patterns.

### 7.2 Brand and navigation

Likely files:

- `src/app/layout.tsx`
- `src/components/customer/GlobalNav.tsx`
- `src/components/customer/BottomTabBar.tsx`
- hero/home section components and footer

Actions:

- Correct metadata to package/cruise/golf positioning and the canonical `.com`.
- Verify social URLs and remove duplicates/unverified accounts.
- Correct organization/JSON-LD copy and visible H1.
- Reorder navigation and bottom tabs per the spec.
- Hide one-slide controls.
- Collapse duplicate home destination/package/quote sections.
- Add the four business-family cards without inventing cruise inventory.
- Render the trust section only from verified company-profile facts.

### 7.3 Reviews and guides

- Do not replace mock feeds with synthetic reviews.
- Add real reviews only after source URL, consent/republication rights, travel
  period, incentive disclosure, and redaction are recorded.
- Use the blog public-quality authority for main-page guides; no ad hoc date
  filter or hard-coded editor pick in the home page.

## 8. Gate 6 — product repair and controlled reopening

Catalog quarantine and product repair are separate lanes.

For each audited product:

1. Recover the authoritative supplier/source document.
2. Resolve title/terms contradictions: tip, shopping count, optional tours,
   inclusions/exclusions, retail-return wording, deadline, and price.
3. Recompile through the existing registration pipeline.
4. Require typed future departure facts and correct booking/pricing states.
5. Require approved image, customer copy, terms validation, and browser proof.
6. Review `marketing_eligible` and `booking_mode`; do not set them merely to
   increase catalog count.
7. Publish the immutable snapshot pointer using the approved V6.1 path.
8. Verify outbox convergence and the exact customer DTO.
9. Re-open one product at a time. A failed product remains under review/hidden
   without blocking already verified products.

Do not use bulk SQL updates to force all seven products public.

## 9. Gate 7 — release sequence

### Preview/staging

1. Apply the migration to an isolated/staging database using the documented
   Supabase workflow.
2. Build and test the exact Git commit with Node `24.x`, Next `15.5.21`.
3. Deploy an unaliased preview/candidate from that commit.
4. Run API, SSR, browser, sitemap, structured-data, accessibility, payload,
   database-grant, and outbox convergence verification.
5. Record deployment ID, URL, commit SHA, database migration head, runtime mode,
   screenshots, logs, and query evidence.

### Production

1. Merge only through protected `main` after required CI.
2. Confirm `origin/main` equals the approved release SHA.
3. Deploy through the reviewed GitHub/Vercel release path. Direct local CLI
   production deployment is not an accepted source path.
4. Start with a short `shadow` evidence window only if the production data set
   was not fully represented in staging; otherwise activate `authoritative` in
   the candidate before promotion.
5. Promote the exact candidate, then verify Vercel's deployed commit equals
   protected GitHub `main`.
6. Submit sitemap/re-indexing only after customer surfaces and runtime logs are
   clean.
7. Observe for 4 hours and again after 24 hours: catalog decisions, 5xx,
   function memory/timeouts, stale cache, crawler HTML, and consultation events.

## 10. Rollback and emergency response

### Application/cache incident

- Set the reviewed emergency catalog control to `hidden` to stop product and
  Offer exposure without restoring unsafe legacy rows.
- Revalidate home, list, API, detail, destination, and sitemap surfaces.
- Revert the scoped application commit through Git and redeploy from protected
  `main`.

### Database incident

- Do not delete migrations or mutate immutable pointers/snapshots to “roll back”.
- Hide affected products with the existing availability/visibility overlay or
  kill switch.
- Roll the application back first.
- Correct the view/function in a forward migration after exporting evidence.

### Product-data incident

- Mark the specific product under review/hidden or use the product kill switch.
- Preserve the bad snapshot and revision as audit evidence.
- Recompile and publish a new revision; never edit the published snapshot in
  place.

## 11. Conflict ownership at implementation time

Assign one owner per overlap group, even if one agent performs all work:

| Group | Files/responsibility | Must incorporate |
|---|---|---|
| Authority | migration, public-catalog repository, snapshot/route state | final V6.1 facts, proof, overlay, kill-switch behavior |
| Customer catalog | home, package list, search API, sitemap | server DTO and one eligibility policy |
| Detail | package detail server/client, metadata/JSON-LD | final V6.1 route/preview guards and null normalization |
| Destination | destination page/helpers/tests | #1143 malformed-data hardening and final Vercel render decision |
| Trust/IA | layout, nav, bottom tabs, footer, group/private/about/legal links | verified company profile; no synthetic proof |
| Release evidence | scripts/workflows/docs | exact main/deployment SHA and forward migration head |

No worker may revert another group's final landed changes. Resolve conflicts by
reapplying this spec's invariant on the final file content, not by choosing an
older branch wholesale.

## 12. Completion boundary

The implementation PR may be called complete only when every P0 item and all
verification gates are green. P1 product count recovery is reported per product
and can continue without weakening P0. Cruise receives a separate Tier-3 spec
only after P0 has production evidence and the product authority is stable.
