# Public Catalog and Trust Hardening Tasks

Before starting this checklist, complete the shared Track 0 and applicable
Track A gates in `integration.md`. Do not duplicate release manifests, price
ledgers, outbox workers, or legacy product repair inventories in this track.

Date: 2026-08-24

Current state: Gates 0-4 implemented and locally verified on an isolated branch;
controlled repair, preview, staging, and production gates remain open

## 2026-08-24 execution snapshot

| Scope | Result | Notes |
|---|---|---|
| Gate 0 baseline and authority reconciliation | PASS | Same-time production/public-set audit recorded; production writes 0 |
| Registration/publication safety | PASS (local) | Zombie mutation UI retired, exact publication truth, revision fencing, atomic pointer bundle, canary compensation |
| Commercial and copy authority | PASS (local) | Typed departure price projection, three-table atomicity, grounded copy V2, reviewed publication requests |
| Public catalog and trust | PASS (local) | Exact service-only read projection, allowlisted API, SSR list, detail/destination/sitemap cutover, trust cleanup |
| Automated repository verification | PASS | 855 test files; 6,435 passed, 7 skipped; type-check, lint, build passed |
| Local browser verification | PASS | 6 routes × mobile/desktop = 12/12 HTTP/content/console/overlay checks passed |
| Legacy production product repair | BLOCKED | Requires controlled DB writes, source-owner decisions, and golden-product replay |
| Preview/staging/production release | BLOCKED | Requires current-main reconciliation, PR, preview, staging migrations, and explicit production approval |

The detailed checklist below remains the release ledger. A checked implementation
item means the local branch contains the behavior; it does not imply that a
staging or production observation gate has passed.

## Trigger and stop conditions

- [x] User authorized sequential development; settlement/blog sessions own
  non-overlapping areas.
- [ ] No active session still owns an overlapping file/migration.
- [ ] Final V6.1 authority, RC preview guards, and destination hardening
  disposition is known.
- [x] A clean isolated worktree/branch exists from the captured authoritative
  candidate.
- [x] Base SHA, migration head, Node/Next versions, open PRs, and deployed SHA
  baseline are recorded.
- [ ] Staging and production project identities are unambiguous.
- [ ] No production DB write, deployment, indexing request, legal text, or
  external communication occurs without the applicable explicit approval.

## A. Reconcile concurrent work

- [x] Fetch remote refs and record `git worktree list --porcelain`.
- [x] Record open PR heads/bases/check states.
- [x] Compare V6.1 authority and RC2.1 with `git merge-base`, `git cherry`,
  changed-file lists, and actual final content.
- [x] Confirm the V6.1 customer route RPC and server helper are present.
- [x] Confirm the V6.1 customer/departure fact views and service-role grants are
  present.
- [x] Confirm V6.1 visibility, source proof, preview/canonical, and outbox fixes
  are present.
- [ ] Preserve destination climate/pillar normalization and its regressions from
  PR #1143 or its successor.
- [ ] Confirm closed PR #749 is not merged/cherry-picked.
- [x] Re-run the public catalog inventory and save a new dated audit.
- [x] Update this packet where implementation evidence invalidated an assumption.

## B. Encode the authority contract

- [ ] Add `src/lib/public-catalog/types.ts`.
- [x] Add strict parsers/normalizers without `any` or unchecked broad casts.
- [x] Add a Seoul-date boundary with injectable SQL/application dates for tests.
- [x] Add separate route, discovery, marketing, SEO, price, and CTA decisions.
- [x] Require exact pointer/snapshot/proof lineage.
- [x] Require active public visibility and allowed sale state.
- [x] Require active kill-switch clearance.
- [x] Require `marketing_eligible === true` for discovery.
- [x] Require at least one eligible typed future departure.
- [ ] Encode ticketing deadline open/conditional/expired/conflicting behavior.
- [x] Make missing/unknown/conflicting facts fail closed.
- [x] Prove legacy snapshot `price_dates` is not catalog price authority.
- [ ] Add sanitized fixtures for all seven audited public products.
- [ ] Prove every audited fixture is excluded before repair.

## C. Add the explicit DTO boundary

- [x] Add strict public catalog card and normalized public detail DTO types.
- [x] Build card DTO by allowlist; never spread snapshot data.
- [x] Build detail DTO from approved public sections only.
- [x] Normalize nested itinerary/activity/hotel/meal strings server-side.
- [ ] Separate `contentVerifiedAt` from `availabilityCheckedAt`.
- [x] Emit price only from a typed `PRICED` future departure.
- [x] Emit request/live-check modes with `amount: null` when appropriate.
- [ ] Derive condition badges only from approved facts.
- [x] Cap/normalize customer data and reject unsafe image values.
- [x] Add forbidden-key and public response contract tests.
- [x] Add/update the customer egress manifest for every converted consumer;
  blog-owned consumers remain an explicit cross-session reconciliation gate.
- [x] Add CI failure when a registered consumer stops using the catalog
  boundary; full repository consumer discovery remains a release-review gate.

## D. Correct the V6.1 server read model

- [x] Create a new forward-only migration.
- [ ] Preserve existing customer fact view columns and dependencies.
- [ ] Move active-overlay expiry logic into the `LEFT JOIN` condition.
- [ ] Exclude hidden/closed/sold-out/suspended active overlays.
- [ ] Append only the minimum availability facts required by the repository.
- [x] Preserve exact pointer/snapshot/hash/proof constraints.
- [x] Preserve `security_invoker = true`.
- [x] Revoke `public`, `anon`, and `authenticated` privileges.
- [x] Grant only `service_role`.
- [ ] Confirm underlying internal schema access remains service-role only.
- [ ] Verify an expired overlay behaves as no active overlay.
- [ ] Verify anon/authenticated select fails.
- [ ] Run staging query plans; add no speculative index.
- [ ] If an index is proven necessary, add it in a separate forward migration.

## E. Build the public catalog repository

- [x] Add a server-only repository over exact customer/departure facts.
- [x] Select card projection rather than full snapshot JSON for list reads.
- [ ] Load active global/product/supplier kill switches once per bounded query.
- [ ] Implement typed query/destination/hub/month/price/kind/urgency filters.
- [ ] Require an open future deadline for urgency.
- [x] Return exact DTOs and safe bounded filters.
- [ ] Add repository unit/integration tests for every state combination.
- [ ] Add decision reason counts without raw product/proof/PII logging.
- [ ] Add validated `PUBLIC_CATALOG_MODE` server configuration.
- [ ] Implement `shadow`, `authoritative`, and `hidden` behavior.
- [ ] Make unknown mode and repository failure fail closed.
- [ ] Add shadow ID-set/reason evidence collection.

## F. Cut over customer surfaces

### Home

- [x] Replace direct snapshot and local alive/urgency logic with repository data.
- [x] Remove `force-dynamic`/`revalidate` ambiguity.
- [x] Show 3–6 eligible cards or honest empty state.
- [x] Remove unsupported urgency/popularity/trust badges.
- [x] Ensure customer cards contain only DTO fields.

### Product list and API

- [x] Server-render the initial 12 list cards.
- [x] Pass serializable initial data to `PackagesClient`.
- [ ] Use SWR only for subsequent query/filter changes.
- [x] Convert search route to `apiResponse`.
- [x] Remove direct response construction, broad casts, and snapshot spreads.
- [x] Return only 13 allowlisted card fields and safe filter metadata.
- [ ] Split personalization/scoring from the base search response.
- [x] Hide low-value filters when catalog cardinality is too small.
- [x] Preserve crawlable canonical detail links in initial HTML.

### Detail

- [x] Preserve final V6.1 route state and preview/canonical guards.
- [x] Normalize the approved detail DTO on the server.
- [ ] Remove raw/internal snapshot dependencies from `DetailClient`.
- [x] Fix missing/null `activity` and equivalent nested-string assumptions.
- [ ] Add detail fixtures with absent, null, empty, and malformed schedule data.
- [x] Drive CTA from booking/publication state.
- [ ] Drive robots/canonical/Product/Offer JSON-LD from the shared SEO decision.
- [ ] Remove Offer data from direct-only/noindex products.
- [ ] Make unavailable route-state errors fail closed without legacy fallback.

### Destination

- [ ] Preserve final #1143 climate/body normalizers and tests.
- [x] Replace local package date logic with the repository.
- [x] Normalize destination matching once.
- [x] Separate product and reviewed-guide counts.
- [x] Return reviewed guide-only 200 pages when product count is zero.
- [x] Remove product price/Offer blocks when product count is zero.
- [x] Remove unsupported direct-verification/response-time/history claims.
- [ ] Verify the final Vercel renderer emits every valid city route.
- [ ] Add zero-product, empty-signals, malformed-climate, and malformed-body tests.

### Sitemap and downstream consumers

- [x] Add every indexable canonical package detail URL to the sitemap.
- [x] Exclude direct-only/noindex/ineligible product URLs.
- [x] Use eligible rows for product-bearing destination URLs.
- [ ] Keep guide-only destination URLs under an explicit content rule.
- [x] Bound recommendations/comparison readers by public catalog IDs.
- [x] Select home/destination guides through the reviewed blog catalog API.
- [x] Register and convert customer AI/Jarvis product suggestions.
- [x] Register and convert campaigns, influencer, affiliate, and marketing
  readers in this branch; blog-owned attachment readers remain open.
- [x] Convert RSS and other product-bearing public readers in this scope.
- [ ] Add broad destination invalidation plus old/new destination tags/paths.
- [ ] Add convergence probes for all public product surfaces.

## G. Remove misleading trust signals

- [x] Remove `MOCK_FEED` from `/private-tour`.
- [x] Retire the duplicate `/group` surface through a canonical redirect.
- [x] Remove unsupported `120+`, `24시간`, response-time, and similar claims.
- [x] Remove placeholder representative/registration/address values.
- [x] Replace the nonexistent `/disclaimer` link with the existing reviewed
  terms route.
- [ ] Add one verified public company-profile contract.
- [ ] Render a company/trust field only while its evidence is current.
- [ ] Obtain owner/legal-reviewed company, insurance, privacy, terms, travel
  terms, and cancellation/refund facts; do not generate them.
- [x] Add source scans for mock, old-domain, and placeholder patterns.
- [x] Add broken internal legal-link verification.

## H. Apply P1 public IA without redesigning the system

- [x] Preserve palette, spacing, rounded cards, tap targets, width, and Kakao.
- [x] Update visible H1 and metadata to package/cruise/golf positioning.
- [x] Correct organization JSON-LD copy and canonical `.com`.
- [ ] Verify and deduplicate social profile URLs.
- [x] Rework global nav to 패키지/크루즈/해외골프/단독·단체/여행가이드.
- [x] Rework bottom tabs to 홈/상품찾기/실시간견적/카카오/내 여행.
- [ ] Hide carousel controls for a single hero.
- [x] Add four business-family cards without fake cruise inventory.
- [x] Collapse duplicate home package/destination/quote sections.
- [x] Use only eligible product cards in `지금 확인할 수 있는 여행`.
- [ ] Add only rights-cleared real reviews; otherwise omit the section.
- [x] Use reviewed current blog items through the blog public authority.
- [x] Hide unverified company/insurance facts and retain existing legal routes.

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
- [x] Run focused tests for policy, DTO, repo, API, SSR, detail, destination,
  sitemap, trust, cache, and egress.
- [x] Run type-check, lint, full Vitest, build, migration-prefix, runtime-env,
  function-count, security, and PII gates; environment-dependent DB/preview
  gates remain separately blocked.
- [ ] Deploy an unaliased preview/candidate for the exact reviewed SHA.
- [ ] Record preview URL/deployment ID/SHA/migration head/runtime mode.
- [x] Run local browser verification at mobile and desktop widths.
- [x] Prove honest server-rendered initial HTML and empty-state behavior locally.
- [x] Prove API field allowlist and forbidden internal-key boundary.
- [ ] Prove sitemap/robots/JSON-LD parity.
- [ ] Prove outbox invalidation/convergence.
- [ ] Obtain explicit approval before production migration/deployment/indexing.
- [ ] Merge through protected `main` after required checks.
- [ ] Prove production deployed SHA equals GitHub `main` SHA.
- [ ] Observe production for 4 hours and 24 hours.
- [ ] Submit sitemap/re-indexing only after zero relevant runtime errors.
- [x] Record local evidence in `verification.md` and the dated audit index.

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
