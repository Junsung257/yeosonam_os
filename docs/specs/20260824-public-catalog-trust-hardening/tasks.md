# Public Catalog and Trust Hardening Tasks

Before starting this checklist, complete the shared Track 0 and applicable
Track A gates in `integration.md`. Do not duplicate release manifests, price
ledgers, outbox workers, or legacy product repair inventories in this track.

Date: 2026-08-24

Current state: research complete; all implementation boxes intentionally open

## Trigger and stop conditions

- [ ] User has said `개발 진행해` after the concurrent sessions ended.
- [ ] No active session still owns an overlapping file/migration.
- [ ] Final V6.1 authority, RC preview guards, and destination hardening
  disposition is known.
- [ ] A clean worktree/branch exists from the latest protected `origin/main`.
- [ ] Base SHA, migration head, Node/Next versions, open PRs, and deployed SHA
  baseline are recorded.
- [ ] Staging and production project identities are unambiguous.
- [ ] No production DB write, deployment, indexing request, legal text, or
  external communication occurs without the applicable explicit approval.

## A. Reconcile concurrent work

- [ ] Fetch remote refs and record `git worktree list --porcelain`.
- [ ] Record open PR heads/bases/check states.
- [ ] Compare V6.1 authority and RC2.1 with `git merge-base`, `git cherry`,
  changed-file lists, and actual final content.
- [ ] Confirm the V6.1 customer route RPC and server helper are present.
- [ ] Confirm the V6.1 customer/departure fact views and service-role grants are
  present.
- [ ] Confirm V6.1 visibility, source proof, preview/canonical, and outbox fixes
  are present.
- [ ] Preserve destination climate/pillar normalization and its regressions from
  PR #1143 or its successor.
- [ ] Confirm closed PR #749 is not merged/cherry-picked.
- [ ] Re-run the public catalog inventory and save a new dated audit.
- [ ] Update this packet if final branch content invalidates an assumption.

## B. Encode the authority contract

- [ ] Add `src/lib/public-catalog/types.ts`.
- [ ] Add strict parsers/normalizers without `any` or unchecked broad casts.
- [ ] Add a Seoul-date utility with an injectable date for tests.
- [ ] Add separate route, discovery, marketing, SEO, price, and CTA decisions.
- [ ] Require exact pointer/snapshot/proof lineage.
- [ ] Require active public visibility and allowed sale state.
- [ ] Require active kill-switch clearance.
- [ ] Require `marketing_eligible === true` for discovery.
- [ ] Require at least one eligible typed future departure.
- [ ] Encode ticketing deadline open/conditional/expired/conflicting behavior.
- [ ] Make missing/unknown/conflicting facts fail closed.
- [ ] Prove empty legacy `price_dates` is never treated as alive.
- [ ] Add sanitized fixtures for all seven audited public products.
- [ ] Prove every audited fixture is excluded before repair.

## C. Add the explicit DTO boundary

- [ ] Add `PublicCatalogCard` and normalized public detail DTO types.
- [ ] Build card DTO by allowlist; never spread snapshot data.
- [ ] Build detail DTO from approved public sections only.
- [ ] Normalize every nested itinerary/activity/hotel/meal string server-side.
- [ ] Separate `contentVerifiedAt` from `availabilityCheckedAt`.
- [ ] Emit price only from a typed `PRICED` departure.
- [ ] Emit request/live-check modes with `amount: null` when appropriate.
- [ ] Derive condition badges only from approved facts.
- [ ] Cap lists/strings and reject unsafe image/canonical values.
- [ ] Add recursive forbidden-key and payload-size tests.
- [ ] Add/update the customer egress manifest for every consumer.
- [ ] Add CI failure when an unregistered consumer reads the raw authority.

## D. Correct the V6.1 server read model

- [ ] Create a new forward migration with `supabase migration new`.
- [ ] Preserve existing customer fact view columns and dependencies.
- [ ] Move active-overlay expiry logic into the `LEFT JOIN` condition.
- [ ] Exclude hidden/closed/sold-out/suspended active overlays.
- [ ] Append only the minimum availability facts required by the repository.
- [ ] Preserve exact pointer/snapshot/hash/proof constraints.
- [ ] Preserve `security_invoker = true`.
- [ ] Revoke `public`, `anon`, and `authenticated` privileges.
- [ ] Grant only `service_role`.
- [ ] Confirm underlying internal schema access remains service-role only.
- [ ] Verify an expired overlay behaves as no active overlay.
- [ ] Verify anon/authenticated select fails.
- [ ] Run staging query plans; add no speculative index.
- [ ] If an index is proven necessary, add it in a separate forward migration.

## E. Build the public catalog repository

- [ ] Add a server-only repository over V6.1 customer/departure facts.
- [ ] Select card projection rather than full snapshot JSON for list reads.
- [ ] Load active global/product/supplier kill switches once per bounded query.
- [ ] Implement typed query/destination/hub/month/price/kind/urgency filters.
- [ ] Require an open future deadline for urgency.
- [ ] Return exact DTOs and aggregate filter metadata.
- [ ] Add repository unit/integration tests for every state combination.
- [ ] Add decision reason counts without raw product/proof/PII logging.
- [ ] Add validated `PUBLIC_CATALOG_MODE` server configuration.
- [ ] Implement `shadow`, `authoritative`, and `hidden` behavior.
- [ ] Make unknown mode and repository failure fail closed.
- [ ] Add shadow ID-set/reason evidence collection.

## F. Cut over customer surfaces

### Home

- [ ] Replace direct snapshot and local alive/urgency logic with repository data.
- [ ] Remove `force-dynamic`/`revalidate` ambiguity.
- [ ] Show 3–6 eligible cards or honest empty state.
- [ ] Remove unsupported urgency/popularity/trust badges.
- [ ] Ensure customer cards contain only DTO fields.

### Product list and API

- [ ] Server-render the initial 12 list cards.
- [ ] Pass serializable initial data to `PackagesClient`.
- [ ] Use SWR only for subsequent query/filter changes.
- [ ] Convert search route to `apiResponse`.
- [ ] Remove `NextResponse.json`, `any`, snapshot spreads, and internal maps.
- [ ] Return only card DTOs and safe filter metadata.
- [ ] Split personalization/scoring from the base search response.
- [ ] Hide low-value filters when catalog cardinality is too small.
- [ ] Preserve crawlable canonical detail links in initial HTML.

### Detail

- [ ] Preserve final V6.1 route state and preview/canonical guards.
- [ ] Normalize the approved detail DTO on the server.
- [ ] Remove raw/internal snapshot dependencies from `DetailClient`.
- [ ] Fix missing/null `activity` and all equivalent nested-string assumptions.
- [ ] Add detail fixtures with absent, null, empty, and malformed schedule data.
- [ ] Drive CTA from the shared decision.
- [ ] Drive robots/canonical/Product/Offer JSON-LD from the shared SEO decision.
- [ ] Remove Offer data from direct-only/noindex products.
- [ ] Make unavailable route-state errors fail closed without legacy fallback.

### Destination

- [ ] Preserve final #1143 climate/body normalizers and tests.
- [ ] Replace local package date logic with the repository.
- [ ] Normalize destination matching once.
- [ ] Separate product, guide, and attraction counts.
- [ ] Return reviewed guide-only 200 pages when product count is zero.
- [ ] Remove product price/Offer blocks when product count is zero.
- [ ] Remove unsupported direct-verification/response-time/history claims.
- [ ] Verify the final Vercel renderer emits every valid city route.
- [ ] Add zero-product, empty-signals, malformed-climate, and malformed-body tests.

### Sitemap and downstream consumers

- [ ] Add every indexable canonical package detail URL to the sitemap.
- [ ] Exclude direct-only/noindex/ineligible product URLs.
- [ ] Use eligible rows for product-bearing destination URLs.
- [ ] Keep guide-only destination URLs under an explicit content rule.
- [ ] Register and convert recommendations/comparison readers.
- [ ] Register and convert blog product links.
- [ ] Register and convert customer AI/Jarvis product suggestions.
- [ ] Register and convert campaigns/ads/marketing readers.
- [ ] Register and convert RSS/OG/other public product readers.
- [ ] Add broad destination invalidation plus old/new destination tags/paths.
- [ ] Add convergence probes for all public product surfaces.

## G. Remove misleading trust signals

- [ ] Remove `MOCK_FEED` from `/private-tour`.
- [ ] Remove `MOCK_FEED` from `/group`.
- [ ] Remove unsupported `120+`, `24시간`, response-time, and similar claims.
- [ ] Remove placeholder representative/registration/address values.
- [ ] Remove or replace the nonexistent `/disclaimer` link only with reviewed
  content.
- [ ] Add one verified public company-profile contract.
- [ ] Render a company/trust field only while its evidence is current.
- [ ] Obtain owner/legal-reviewed company, insurance, privacy, terms, travel
  terms, and cancellation/refund facts; do not generate them.
- [ ] Add source scans for mock and placeholder patterns.
- [ ] Add broken internal legal-link verification.

## H. Apply P1 public IA without redesigning the system

- [ ] Preserve palette, spacing, rounded cards, tap targets, width, and Kakao.
- [ ] Update visible H1 and metadata to package/cruise/golf positioning.
- [ ] Correct organization JSON-LD copy and canonical `.com`.
- [ ] Verify and deduplicate social profile URLs.
- [ ] Rework global nav to 패키지/크루즈/해외골프/단독·단체/여행가이드.
- [ ] Rework bottom tabs to 홈/상품찾기/실시간견적/카카오/내 여행.
- [ ] Hide carousel controls for a single hero.
- [ ] Add four business-family cards without fake cruise inventory.
- [ ] Collapse duplicate home package/destination/quote sections.
- [ ] Use only eligible product cards in `지금 확인할 수 있는 여행`.
- [ ] Add only rights-cleared real reviews; otherwise omit the section.
- [ ] Use reviewed current blog items through the blog public authority.
- [ ] Render verified company/insurance/legal links in the footer.

## I. Repair and reopen product data

- [ ] Create a repair ledger for the seven audited product IDs.
- [ ] Recover/confirm each authoritative supplier source.
- [ ] Resolve tip/no-tip contradictions.
- [ ] Resolve shopping-count contradictions.
- [ ] Resolve optional-tour/inclusion/exclusion contradictions.
- [ ] Remove retail-product return/refund wording from travel terms.
- [ ] Resolve price/departure/deadline facts.
- [ ] Recompile each product through the V6.1 pipeline.
- [ ] Require typed future departures and allowed pricing/booking state.
- [ ] Re-run customer copy, image, terms, and browser proof gates.
- [ ] Review booking mode and marketing eligibility separately.
- [ ] Publish a new immutable revision/pointer through the approved workflow.
- [ ] Verify outbox convergence and DTO output.
- [ ] Reopen one product at a time; keep failures under review.
- [ ] Confirm no bulk force-public update occurred.

## J. Verification and release

- [ ] Complete every check in `verification.md` locally/staging as applicable.
- [ ] Run focused tests for policy, DTO, repo, API, SSR, detail, destination,
  sitemap, trust, cache, and egress.
- [ ] Run type-check, lint, full Vitest, build, docs, migration, RLS, and release
  readiness gates.
- [ ] Deploy an unaliased preview/candidate for the exact reviewed SHA.
- [ ] Record preview URL/deployment ID/SHA/migration head/runtime mode.
- [ ] Run browser verification at mobile and desktop widths.
- [ ] Prove initial HTML works without JavaScript.
- [ ] Prove API field and payload budgets.
- [ ] Prove sitemap/robots/JSON-LD parity.
- [ ] Prove outbox invalidation/convergence.
- [ ] Obtain explicit approval before production migration/deployment/indexing.
- [ ] Merge through protected `main` after required checks.
- [ ] Prove production deployed SHA equals GitHub `main` SHA.
- [ ] Observe production for 4 hours and 24 hours.
- [ ] Submit sitemap/re-indexing only after zero relevant runtime errors.
- [ ] Record all evidence in `verification.md` and the dated audit index.

## K. Rollback readiness

- [ ] Prove emergency `hidden` catalog mode before live activation.
- [ ] Document exact cache/path/tag invalidation commands for the release.
- [ ] Document scoped Git revert and protected-main redeploy path.
- [ ] Prove product/global kill switches and visibility overlays in staging.
- [ ] Confirm immutable pointer/snapshot history is never deleted or edited.
- [ ] Prepare a forward-fix migration path; do not prepare destructive down SQL.

## L. Completion gates

- [ ] Same authority/decision serves home, list, search, destination, sitemap,
  recommendations, blog links, AI, and marketing.
- [ ] Audited failing cohort has zero discovery exposure until repaired.
- [ ] Internal hashes/revisions/proofs/reasons have zero public API exposure.
- [ ] Initial package list is server-rendered.
- [ ] Destination relevant SSR errors are zero.
- [ ] Detail `.trim()` TypeErrors are zero.
- [ ] Mock feeds/placeholders/unsupported claims are zero.
- [ ] Sitemap and robots/JSON-LD are policy-consistent.
- [ ] Production SHA equals protected `main` SHA.
- [ ] P0 evidence is signed off before a cruise implementation spec begins.
