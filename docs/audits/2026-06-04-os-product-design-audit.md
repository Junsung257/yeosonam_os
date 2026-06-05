# Yeosonam OS Product Design / Admin / Backend Audit

Date: 2026-06-04
Scope: frontend conversion surfaces, admin IA, admin dashboard, API/backend boundaries, and first safe implementation pass.

## Executive Summary

Yeosonam OS is already broad enough to behave like an operating console rather than a set of pages. The next leverage point is not another isolated feature. It is faster operator decision-making: show urgent work, preserve KPI basis, reduce duplicated page logic, and make backend/API contracts predictable.

The first implementation pass intentionally stays small and low-risk:

- Added a sidebar "?ㅻ뒛 泥섎━" rail that turns existing badge counts into direct action entry points.
- Fixed admin active-route detection for links with query strings such as `/admin/packages?status=pending`.
- Extended `/api/admin/badge-counts` with lightweight `paymentUnmatched` and `blogQueue` counts, without calling the heavy ledger reconcile RPC on every admin layout mount.

## Evidence Snapshot

- Admin page routes: 124 `page.tsx` files under `src/app/admin`.
- API routes: 609 `route.ts` files under `src/app/api`.
- API response drift surface: 280 API route files still contain direct `NextResponse.json()` / `Response.json()` usage, despite the `apiResponse()` standard helper.
- Largest admin pages by line count:
  - `src/app/admin/ad-os/page.tsx`: 4,523 lines
  - `src/app/admin/customers/page.tsx`: 1,239 lines
  - `src/app/admin/products/review/page.tsx`: 932 lines
  - `src/app/admin/attractions/page.tsx`: 908 lines
  - `src/app/admin/upload/page.tsx`: 902 lines
  - `src/app/admin/scoring/page.tsx`: 866 lines
  - `src/app/admin/attractions/unmatched/page.tsx`: 819 lines
  - `src/app/admin/content-hub/page.tsx`: 803 lines

## Frontend Conversion Surface Inventory

Customer-facing routes already cover the full funnel:

- Discovery/search: `/packages`, `/destinations`, `/destinations/[city]`, `/things-to-do`, `/things-to-do/[region]`.
- Decision/detail: `/packages/[id]`, `/tour/[id]`, `/lp/[id]`, with components such as `PackageCard`, `PackageFAQ`, `PairwiseCompareModal`, and `ReviewDigestStrip`.
- Partner/affiliate entry: `/with/[slug]`, `/influencer/[code]`, `AffiliateAttributionBanner`, `AffiliateTouchpointBeacon`, and co-branding components.
- Lead/RFQ/consultation: `/group-inquiry`, `/rfq/[id]`, `/free-travel`, `/concierge`, and chat/consultation widgets.

Design implication: the product is not missing pages; the next frontend pass should reduce decision friction across 3-4 measured paths instead of adding more surface area.

## Backend/API Contract Evidence

- `src/lib/api-response.ts` and `withAdminGuard()` are established conventions.
- Several admin APIs already follow the convention, including `src/app/api/admin/badge-counts/route.ts`.
- Direct `NextResponse.json()` usage remains broad, especially in older admin/ad-os/application routes.
- First backend pass kept the existing `get_admin_badge_counts` RPC as the core source, then added optional lightweight count queries for payment matching and blog queue visibility.
- The pass deliberately avoided calling the heavy ledger reconciliation RPC from the global admin layout.

Recommended enforcement should be incremental: fail new or touched direct `NextResponse.json()` usage in `src/app/api/admin/**`, then migrate existing routes by domain.

## Findings

### P0 - Operator Entry Points Are Too Hidden

`src/app/api/admin/badge-counts/route.ts` already centralizes urgent counts for pending Jarvis actions, unmatched attractions, pending package review, ledger drift, and blog queue. Before this pass, the counts were mostly used as small badges or not reachable from the visible IA. High-value routes like `/admin/attractions/unmatched` and `/admin/blog/queue` are real operational queues but are not first-class in the sidebar.

Impact: operators have to remember where exception queues live instead of seeing today's work immediately.

First pass: `src/components/AdminLayout.tsx` now renders a "?ㅻ뒛 泥섎━" rail when any badge count is non-zero. The rail links unresolved payment matching to `/admin/payments?tab=unmatched`, while the heavier ledger reconciliation page remains `/admin/payments/reconcile`.

### P0 - Query-Based Admin Links Were Not Active-Safe

`AdminLayout` had nav items such as `/admin/packages?status=pending`, but active-route detection compared `pathname` directly to the full href. Since `pathname` excludes the query string, query-based nav items could fail active matching.

Impact: status-specific admin entry points feel unstable and can affect current-page labels, active state, and operator confidence.

First pass: active matching now strips the query string before comparing route paths.

### P1 - Admin Pages Are Carrying Too Much Local Logic

Several admin surfaces exceed 700-900 lines, and `ad-os` is over 4,500 lines. This is a maintainability and design consistency risk. It also makes Product Design iteration slower because visual structure, data fetching, and local domain logic are intertwined.

Recommended next work:

- Extract page sections into domain components.
- Move reusable admin view models into `src/lib` or page-local `_components`.
- Keep KPI math in shared libraries, not page components.

### P1 - API Response Standard Exists But Is Not Yet Enforced

`src/lib/api-response.ts` exists and `.cursor/rules/api-response-format.mdc` requires API routes to use `apiResponse`. Current evidence shows broad direct JSON usage across API routes.

Impact: client error handling, observability, tests, and automation agents receive inconsistent shapes.

Recommended next work:

- Convert admin-only API routes first, starting with high-traffic dashboard/marketing/booking endpoints.
- Add a narrow audit script or lint rule that fails only new direct `NextResponse.json()` usage in `src/app/api/admin/**`.

### P1 - Admin IA Is Role-Aware But Not Task-Aware Enough

The sidebar already has good role gates (`platform_admin`, `tenant_admin`, `tenant_staff`) and groups. The weak point is that daily work is not presented as a task queue. A travel SaaS operator thinks in unresolved events: unpaid bookings, pending package review, unmatched attractions, customer escalations, partner settlement issues.

Recommended next work:

- Promote exception queues into a persistent task rail.
- Make every urgent item show count, owner, age, and drilldown.
- Make zero states quiet so the nav stays dense.

### P2 - Product Design Needs Live Evidence For Frontend Conversion

Code structure shows customer surfaces for packages, affiliate/co-branded links, RFQ, concierge, free travel, and QA. The next frontend design pass should be driven by analytics and session evidence rather than taste alone.

Recommended next work:

- Pick 3 conversion paths:
  - `/packages -> package detail -> inquiry/booking`
  - `/with/[code]` or `/influencer/[code] -> package -> lead`
  - `/rfq` or `/free-travel -> consultation`
- Capture desktop/mobile screenshots.
- Compare click/scroll/dropoff from GA4/Search Console/Sentry if connected.

## Prioritized Backlog

### P0

- Expand "?ㅻ뒛 泥섎━" rail with owner/age metadata after the count-only version proves stable.
- Make `/admin` first viewport show only core KPI + urgent action queue + one trend, pushing secondary panels below.
- Verify all dashboard KPI cards have drilldown links and do not mix recognized revenue with new booking counts.

### P1

- Split `src/app/admin/AdminPageClient.tsx` into dashboard section components.
- Split `src/app/admin/ad-os/page.tsx` into module panels before further feature work.
- Start API response standardization in `src/app/api/admin/**`.
- Add an admin IA registry so nav, command palette, badges, and task rail share one source.

### P2

- Run Product Design visual audit for the three customer conversion paths.
- Create three admin home variants:
  - Operations cockpit
  - Booking-processing console
  - Jarvis-first AI command center
- Add visual regression coverage for `/admin`, `/admin/upload`, `/admin/bookings`, and `/packages`.

## Verification Plan

Because this pass follows a batch-edit workflow, verification should run after the implementation batch:

- `npm run type-check`
- targeted lint for changed files or full `npm run lint` if time allows
- browser check for `/admin` if the dev server is available

## First Pass Verification Result

- `npx eslint src/components/AdminLayout.tsx --max-warnings=0`: passed.
- `npx eslint src/components/AdminLayout.tsx src/app/api/admin/badge-counts/route.ts src/lib/product-registration/departure-days.ts --max-warnings=0`: passed.
- `npm run type-check`: passed after a minimal type-only fix in `src/lib/product-registration/departure-days.ts`.
- Browser check: `/admin` returned 200 and loaded without console errors. The session reached the protected/admin shell, but unauthenticated direct JSON verification for `/api/admin/badge-counts` was redirected to the app shell, so badge visual confirmation should be repeated in an authenticated admin session.

## Second Pass - Operator Productivity

Date: 2026-06-04

This pass keeps the dashboard KPI math untouched and improves the operator entry model instead.

Implemented:

- Added `src/lib/admin-mission-control.ts` as the first admin IA registry slice for urgent work.
- Moved "?ㅻ뒛 泥섎━" item definitions out of `AdminLayout` so sidebar, badges, and command palette can share one definition.
- Added action labels and count total to the full sidebar rail.
- Added a slim-sidebar mission rail so compact mode does not hide urgent work.
- Added "?ㅻ뒛 泥섎━" entries to the command palette for direct navigation.
- Standardized the payment mission link on `/admin/payments?filter=unmatched`, matching the existing payments page drilldown convention.
- Fixed payment menu badge matching so `/admin/payments` receives the unmatched payment badge.
- Aligned pending package badge semantics with `/api/packages?status=pending`: `pending`, `pending_review`, and `draft`.

Not changed:

- No dashboard revenue/KPI formulas were changed.
- No global migration from direct `NextResponse.json()` was attempted in this pass.
- `ad-os/page.tsx` was not split yet; it remains the highest-priority admin decomposition candidate.

Verification:

- Targeted ESLint passed for the changed code files.
- `npm run type-check` passed.
- Browser check on `http://localhost:3001/admin` loaded the admin dashboard with no console errors.
- Local browser verification could not visually confirm the mission rail because client-side `/api/admin/badge-counts` redirects to `/login` in the current non-authenticated browser context, while the server-rendered admin page still displays dashboard data. Repeat rail visual confirmation in a real authenticated admin session.

Next batch recommendation:

- Promote the same registry pattern from urgent missions to the full admin route catalog.
- Add owner/age/SLA metadata to each mission item once the count-only contract is proven in an authenticated admin session.
- Start `ad-os` decomposition by extracting read-only panels first, not mutation-heavy controls.

## Third Pass - Admin IA Registry

Date: 2026-06-04

This pass promotes the registry pattern from urgent missions to the full sidebar navigation map.

Implemented:

- Added `src/lib/admin-navigation.ts` as the first full admin route registry slice.
- Moved nav item/group types, sidebar group definitions, role filtering, and flattened nav item helpers out of `AdminLayout`.
- Kept `AdminLayout` responsible for rendering, state, badges, favorites, shortcuts, and responsive behavior.
- Preserved existing menu labels, route order, role gates, and icon mapping.

Why this matters:

- The admin IA can now become a shared source for sidebar, command palette, badge routing, recommendations, and future docs/search.
- Route changes no longer require editing a large layout component.
- The registry gives the next `ad-os` and dashboard decomposition pass a cleaner foundation.

Verification:

- Targeted ESLint passed for the changed code files after extraction.
- `npm run type-check` passed.
- Browser check on `http://localhost:3001/admin` loaded the admin shell with no console errors.
- The `?ㅻ뒛 泥섎━` rail rendered with live counts after the pending package badge semantics fix.

Next batch recommendation:

- Add route metadata fields to `admin-navigation.ts`: `domain`, `owner`, `searchKeywords`, `badgeKey`, and `primaryAction`.
- Use that metadata to remove route-specific badge conditionals from `AdminLayout`.
- Then start `ad-os/page.tsx` extraction with read-only panels first.

## Fourth Pass - Nav Metadata And Badge Routing

Date: 2026-06-04

This pass removes the remaining route-specific badge conditionals from `AdminLayout`.

Implemented:

- Added optional route metadata to `src/lib/admin-navigation.ts`: `domain`, `badgeKey`, `primaryAction`, and `searchKeywords`.
- Added `getNavItemBadge()` so nav item badges are resolved from registry metadata instead of hard-coded route comparisons.
- Connected command palette nav entries to route metadata for better search terms.
- Added explicit sidebar entries for `/admin/attractions/unmatched` and `/admin/blog/queue`, matching existing operational queues and mission rail links.

Why this matters:

- Badge ownership now lives with the route definition.
- Operational queues are discoverable from both sidebar and command palette.
- `AdminLayout` no longer needs to know which route maps to which badge count.

Verification:

- Targeted ESLint passed after the metadata extraction.
- `npm run type-check` passed.
- Browser check on `http://localhost:3001/admin` loaded the admin shell with no console errors.
- The sidebar rendered `?ㅻ뒛 泥섎━`, `愿愿묒? 留ㅼ묶`, and `釉붾줈洹??? after nav badge metadata moved into the registry.

Next batch recommendation:

- Add `owner` and `slo` metadata for urgent operational queues.
- Move mission definitions to reuse selected nav route metadata where possible.
- Begin `ad-os/page.tsx` decomposition after the IA registry stabilizes.

## Fifth Pass - Registry Regression Coverage And Ad OS Execution Plan

Date: 2026-06-04

This pass adds guardrails around the admin IA registry work and prepares the next large refactor target without mixing it into the same code change.

Implemented:

- Added `src/lib/admin-navigation.test.ts` to protect route uniqueness, role filtering, badge routing, payment fallback behavior, and search metadata.
- Added `src/lib/admin-mission-control.test.ts` to protect urgent mission ordering, role gating, badge-to-count mapping, zero-count filtering, and total count behavior.
- Added `docs/audits/2026-06-04-ad-os-decomposition-plan.md` as the safe execution plan for decomposing the 4,648-line `src/app/admin/ad-os/page.tsx`.

Why this matters:

- Sidebar, command palette, and mission rail now have tests covering the registry contracts that future admin changes will depend on.
- The next highest-risk admin page has a concrete extraction order: pure helpers, queue primitive, read-only panels, controlled mutation panels, then state reducer cleanup.
- The plan explicitly avoids KPI/formula, API contract, and external-write behavior changes during UI decomposition.

Verification:

- `npx vitest run src/lib/admin-navigation.test.ts src/lib/admin-mission-control.test.ts` passed: 2 files, 13 tests.
- Targeted ESLint passed for the changed admin registry/layout/badge-count files.
- `npm run type-check` passed.
- Fresh headless browser check for `http://localhost:3001/admin` returned 200 with no console errors, then redirected to `/login?redirect=%2Fadmin` because the automated browser had no admin session. Authenticated visual confirmation of the mission rail should be repeated in a logged-in admin browser.

Next batch recommendation:

- Execute Batch 1 from `docs/audits/2026-06-04-ad-os-decomposition-plan.md`: move pure Ad OS types/helpers/fetchers into page-local `_lib` modules and add helper tests.
- Keep mutation handlers in `page.tsx` until read-only panels are extracted and visually verified.

## Sixth Pass - Ad OS Batch 1 And Admin Metadata

Date: 2026-06-04

This pass executes the full next batch: Ad OS pure helper extraction, regression tests, urgent mission metadata, and a narrow admin API response-standardization pass.

Implemented:

- Extracted Ad OS page-local types into `src/app/admin/ad-os/_lib/types.ts`.
- Extracted Ad OS display helpers into `src/app/admin/ad-os/_lib/display.ts`.
- Extracted Ad OS fetch helpers into `src/app/admin/ad-os/_lib/fetchers.ts`.
- Added tests for display formatting, tone mapping, endpoint centralization, and fetcher error behavior.
- Added `domain`, `owner`, and `sloMinutes` metadata to every urgent mission definition.
- Displayed urgent mission owner/SLA metadata in the full admin mission rail and added it to command-palette keywords.
- Converted `src/app/api/admin/applications/route.ts` from direct `NextResponse.json()` usage to the project-standard `apiResponse()` helper without changing response bodies.

Why this matters:

- `src/app/admin/ad-os/page.tsx` dropped from 4,648 lines to 4,065 lines without touching KPI formulas, spend logic, mutation handlers, or API payloads.
- Urgent operator queues now carry ownership and response-time metadata in code, not just tribal knowledge.
- API response standardization has a safe first conversion in a guarded admin route.

Verification:

- `npx vitest run src/app/admin/ad-os/_lib/display.test.ts src/app/admin/ad-os/_lib/fetchers.test.ts src/lib/admin-navigation.test.ts src/lib/admin-mission-control.test.ts` passed: 4 files, 23 tests.
- Targeted ESLint passed for the changed Ad OS, admin layout, registry, and admin applications API files.
- `npm run type-check` passed.
- Browser checks for `http://localhost:3001/admin` and `http://localhost:3001/admin/ad-os` returned 200 with no console errors, then redirected to login because the automated browser had no admin session.

Next batch recommendation:

- Execute Batch 2 from `docs/audits/2026-06-04-ad-os-decomposition-plan.md`: extract `StatusPill` and `OpsQueueList` as page-local components.
- Add a small component-level test only if the local test stack can do it cheaply; otherwise keep the acceptance bar at type-check, targeted lint, and authenticated browser verification.

## Seventh Pass - Ad OS Queue Component Extraction

Date: 2026-06-04

This pass executes Batch 2 from the Ad OS decomposition plan.

Implemented:

- Added `src/app/admin/ad-os/_components/StatusPill.tsx`.
- Added `src/app/admin/ad-os/_components/OpsQueueList.tsx`.
- Removed the local `StatusPill` and `OpsQueueList` definitions from `src/app/admin/ad-os/page.tsx`.
- Added server-render tests for status-pill tone rendering and ops queue empty/non-empty action states.

Why this matters:

- `src/app/admin/ad-os/page.tsx` dropped again, from 4,065 lines after Batch 1 to 3,968 lines after Batch 2.
- The queue primitive is now reusable for executor, confirmation, and failed/blocked queues.
- The button action contract remains unchanged: `executor_dry_run`, `confirm_failed`, and `acknowledge_blocker`.

Verification:

- `npx vitest run src/app/admin/ad-os/_components/StatusPill.test.tsx src/app/admin/ad-os/_components/OpsQueueList.test.tsx src/app/admin/ad-os/_lib/display.test.ts src/app/admin/ad-os/_lib/fetchers.test.ts` passed: 4 files, 12 tests.
- Targeted ESLint passed for `src/app/admin/ad-os/page.tsx` and the new `_components` files.
- Full current-scope check passed: 6 targeted test files, 26 tests; targeted ESLint; `npm run type-check`.
- Browser checks for `http://localhost:3001/admin` and `http://localhost:3001/admin/ad-os` returned 200 with no console errors, then redirected to login because the automated browser had no admin session.

Next batch recommendation:

- Start Batch 3 with the staging/completion safety panels, but keep fetch timing, manual refresh handlers, and safety-state ownership in `page.tsx`.
- Use an authenticated admin browser session before claiming visual parity, because unauthenticated browser checks can only prove redirect/load behavior.

## Eighth Pass - Ad OS Read-Only Metric Primitive

Date: 2026-06-04

This pass starts Batch 3 without moving mutation handlers or panel ownership.

Implemented:

- Added `src/app/admin/ad-os/_components/MetricGrid.tsx`.
- Added a server-render test for metric labels, values, and responsive column metadata.
- Replaced repeated metric grids in Staging Smoke, Admin Surface QA, Staging Validation, and Operating Inventory panels.

Why this matters:

- `src/app/admin/ad-os/page.tsx` dropped from 3,968 lines to 3,892 lines.
- The staging/completion area now has a shared read-only metric primitive before extracting whole panels.
- Fetch timing, refresh buttons, JSON links, and safety-state ownership remain in `page.tsx`.

Verification:

- `npx vitest run src/app/admin/ad-os/_components/MetricGrid.test.tsx src/app/admin/ad-os/_components/StatusPill.test.tsx src/app/admin/ad-os/_components/OpsQueueList.test.tsx` passed: 3 files, 4 tests.
- Targeted ESLint passed for `src/app/admin/ad-os/page.tsx` and the new MetricGrid component/test.
- Full current-scope check passed: 7 targeted test files, 27 tests; targeted ESLint; `npm run type-check`.
- Browser checks for `http://localhost:3001/admin` and `http://localhost:3001/admin/ad-os` returned 200 with no console errors, then redirected to login because the automated browser had no admin session.

Next batch recommendation:

- Extract a small `SafetyEvidenceList` primitive for repeated evidence/check rows.
- Then extract the Admin Surface QA or Operating Inventory panel first, because each receives a single response object and one refresh handler.

## Ninth Pass - Ad OS Safety Evidence Primitive

Date: 2026-06-04

This pass continues Batch 3 with another read-only primitive, keeping side-effect ownership in the page.

Implemented:

- Added `src/app/admin/ad-os/_components/SafetyEvidenceList.tsx`.
- Added a server-render test for status rendering, evidence text, next-action text, drilldown links, and empty states.
- Replaced repeated evidence/check row rendering in completion drilldown, Admin Surface QA, Staging Validation, and Operating Inventory panels.
- Repaired syntax damage in adjacent Ad OS display text while preserving KPI, spend, ROAS, CPA, mutation handler, and API response behavior.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 3,860 lines.
- The staging/completion safety area now shares both metric and evidence primitives.
- Manual refresh buttons, JSON links, safety-state labels, and response ownership remain in `page.tsx`.

Verification:

- `npx vitest run src/app/admin/ad-os/_components/SafetyEvidenceList.test.tsx src/app/admin/ad-os/_components/MetricGrid.test.tsx src/app/admin/ad-os/_components/StatusPill.test.tsx src/app/admin/ad-os/_components/OpsQueueList.test.tsx src/app/admin/ad-os/_lib/display.test.ts src/app/admin/ad-os/_lib/fetchers.test.ts src/lib/admin-navigation.test.ts src/lib/admin-mission-control.test.ts` passed: 8 files, 29 tests.
- Targeted ESLint passed for the current Ad OS component/lib scope, admin layout/registry files, and touched admin API routes.
- `npm run type-check` passed.
- Browser checks for `http://localhost:3002/admin` and `http://localhost:3002/admin/ad-os` returned 200 with no console errors, then redirected to login because the automated browser had no admin session.

Next batch recommendation:

- Extract either the Admin Surface QA panel or Operating Inventory panel next, because `MetricGrid` and `SafetyEvidenceList` now cover their repeated read-only interiors.
- Keep mutation handlers and fetch timing in `page.tsx` until authenticated visual parity is confirmed.

## Tenth Pass - Admin Surface QA Panel Extraction

Date: 2026-06-04

This pass completes the first full read-only panel extraction from the Ad OS staging/completion area.

Implemented:

- Added `src/app/admin/ad-os/_components/AdminSurfaceQaPanel.tsx`.
- Added `src/app/admin/ad-os/_components/AdminSurfaceQaPanel.test.tsx`.
- Replaced the inline Admin Surface QA panel in `src/app/admin/ad-os/page.tsx` with a prop-driven component.
- Kept fetch timing, loaded response state, refresh loading state, and the refresh handler in `page.tsx`.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 3,808 lines.
- The Admin Surface QA panel is independently testable while preserving its manual refresh behavior and safety labels.
- This establishes the extraction pattern for the next read-only panels: Staging Validation and Operating Inventory.

Verification:

- Focused panel check passed: `npx vitest run src/app/admin/ad-os/_components/AdminSurfaceQaPanel.test.tsx src/app/admin/ad-os/_components/SafetyEvidenceList.test.tsx src/app/admin/ad-os/_components/MetricGrid.test.tsx` passed: 3 files, 5 tests.
- Full current-scope regression passed: 9 targeted test files, 31 tests; targeted ESLint; `npm run type-check`.
- Browser checks for `http://localhost:3002/admin` and `http://localhost:3002/admin/ad-os` returned 200 with no console errors, then redirected to login because the automated browser had no admin session.

Next batch recommendation:

- Extract `StagingValidationPanel` next, because it now has the same structure as `AdminSurfaceQaPanel`: summary text, `MetricGrid`, `SafetyEvidenceList`, refresh button, JSON link, and safety label.
- After that, extract `OperatingInventoryPanel`; it has one additional status tone helper but the same prop-driven shape.

## Eleventh Pass - Staging And Inventory Panel Extraction

Date: 2026-06-05

This pass continues Batch 3 by extracting the two remaining read-only staging/completion panels that already used the metric and evidence primitives.

Implemented:

- Added `src/app/admin/ad-os/_components/StagingValidationPanel.tsx`.
- Added `src/app/admin/ad-os/_components/StagingValidationPanel.test.tsx`.
- Added `src/app/admin/ad-os/_components/OperatingInventoryPanel.tsx`.
- Added `src/app/admin/ad-os/_components/OperatingInventoryPanel.test.tsx`.
- Replaced the inline Staging Validation and Operating Inventory panels in `src/app/admin/ad-os/page.tsx` with prop-driven components.
- Kept fetch timing, loaded response state, refresh loading state, and refresh handlers in `page.tsx`.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 3,720 lines.
- The staging/completion area now has three independently testable read-only panels: Admin Surface QA, Staging Validation, and Operating Inventory.
- Safety labels still expose DB write, external write, full-auto, and live-spend state from the same backend response fields.

Verification:

- Focused panel check passed: `npx vitest run src/app/admin/ad-os/_components/OperatingInventoryPanel.test.tsx src/app/admin/ad-os/_components/StagingValidationPanel.test.tsx src/app/admin/ad-os/_components/AdminSurfaceQaPanel.test.tsx src/app/admin/ad-os/_components/SafetyEvidenceList.test.tsx src/app/admin/ad-os/_components/MetricGrid.test.tsx` passed: 5 files, 9 tests.
- Full current-scope regression passed: 11 targeted test files, 35 tests; targeted ESLint; `npm run type-check`.
- Browser checks for `http://localhost:3002/admin` and `http://localhost:3002/admin/ad-os` returned 200 with no console errors, then redirected to login because the automated browser had no admin session.

Next batch recommendation:

- Extract the Staging Smoke/completion card next if continuing Batch 3, because it is the remaining large read-only card in the same grid.
- After the staging/completion area is fully isolated, move to controlled mutation panels while keeping handlers in `page.tsx`.

## Twelfth Pass - Completion Audit Panel Extraction

Date: 2026-06-05

This pass finishes the large read-only card extraction in the Ad OS staging/completion grid.

Implemented:

- Added `src/app/admin/ad-os/_components/CompletionAuditPanel.tsx`.
- Added `src/app/admin/ad-os/_components/CompletionAuditPanel.test.tsx`.
- Replaced the inline Completion Audit card and nested Staging Smoke evidence block in `src/app/admin/ad-os/page.tsx` with a prop-driven component.
- Kept staging smoke fetch timing, loaded response state, refresh loading state, and refresh handler in `page.tsx`.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 3,652 lines.
- The staging/completion grid is now mostly composed of independently testable read-only panels.
- Completion evidence, staging smoke metrics, DB/external-write safety state, and highlight behavior are covered by focused tests.

Verification:

- Focused panel check passed: `npx vitest run src/app/admin/ad-os/_components/CompletionAuditPanel.test.tsx src/app/admin/ad-os/_components/OperatingInventoryPanel.test.tsx src/app/admin/ad-os/_components/StagingValidationPanel.test.tsx src/app/admin/ad-os/_components/AdminSurfaceQaPanel.test.tsx src/app/admin/ad-os/_components/SafetyEvidenceList.test.tsx src/app/admin/ad-os/_components/MetricGrid.test.tsx` passed: 6 files, 11 tests.
- Full current-scope regression passed: 12 targeted test files, 37 tests; targeted ESLint; `npm run type-check`.
- Browser checks on a clean dev server at `http://localhost:3010` passed after warm-up: `/login?redirect=%2Fadmin`, `/admin`, and `/admin/ad-os` returned 200 with no console errors.

Next batch recommendation:

- Start Batch 4 by extracting controlled mutation panels with handlers passed through as props.
- Keep mutation logic in `page.tsx` until panel-level parity is established.

## Thirteenth Pass - Launch Action Queue Panel Extraction

Date: 2026-06-05

This pass starts Batch 4 by extracting a controlled mutation panel without moving side-effect logic.

Implemented:

- Added `src/app/admin/ad-os/_components/LaunchActionQueuePanel.tsx`.
- Added `src/app/admin/ad-os/_components/LaunchActionQueuePanel.test.tsx`.
- Replaced the inline Today queue action cards and optional Naver setup packet/CSV controls in `src/app/admin/ad-os/page.tsx`.
- Kept action handlers, loading maps, Naver packet state, CSV download, and CSV copy behavior in `page.tsx`, passing them through as props.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 3,528 lines.
- The first controlled mutation panel is independently testable without changing API calls or mutation ownership.
- Naver setup packet controls still expose campaign/ad group/channel counts, keyword samples, and CSV actions.

Verification:

- Focused panel check passed: `npx vitest run src/app/admin/ad-os/_components/LaunchActionQueuePanel.test.tsx` passed: 1 file, 2 tests.
- Full current-scope regression passed: 13 targeted test files, 39 tests; targeted ESLint.
- `npm run type-check` passed after extending the timeout because the local TypeScript run took longer than 5 minutes.
- Cleaned duplicate local Next dev servers and `.next/cache`, then verified a single dev server at `http://localhost:3020`: `/login?redirect=%2Fadmin`, `/admin`, and `/admin/ad-os` returned 200 with no console errors.

Next batch recommendation:

- Continue Batch 4 by extracting the launch wizard/advertising start checklist panel, because it has a clear button group with handlers already centralized in `page.tsx`.
- Keep all mutation functions and loading booleans in `page.tsx` until the UI panels are isolated and verified.

## Fourteenth Pass - Launch Wizard Panel Extraction

Date: 2026-06-05

This pass continues Batch 4 by extracting the launch wizard and platform readiness section without moving side-effect logic.

Implemented:

- Added `src/app/admin/ad-os/_components/LaunchWizardPanel.tsx`.
- Added `src/app/admin/ad-os/_components/LaunchWizardPanel.test.tsx`.
- Replaced the inline launch checklist, four-step start flow, pilot setup action, launch audit action, and platform readiness summaries in `src/app/admin/ad-os/page.tsx`.
- Kept pilot setup, launch audit, loading state, launch step derivation, and external launch status ownership in `page.tsx`, passing them through as props.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 3,446 lines.
- The launch wizard is independently testable while preserving the same operator actions and readiness labels.
- Batch 4 now has two extracted controlled mutation panels with mutation ownership still centralized in the page shell.

Verification:

- Focused panel check passed: `npx vitest run src/app/admin/ad-os/_components/LaunchWizardPanel.test.tsx src/app/admin/ad-os/_components/LaunchActionQueuePanel.test.tsx` passed: 2 files, 4 tests.
- Full current-scope regression passed: 14 targeted test files, 41 tests.
- Targeted ESLint passed for the Ad OS page, extracted Ad OS components/libs/tests, admin navigation/mission-control files, and touched admin API files.
- `npm run type-check` passed.
- Cleaned duplicate local Next dev servers and `.next`, then verified a single dev server at `http://localhost:3030`: `/login?redirect=%2Fadmin`, `/admin`, and `/admin/ad-os` returned 200 with no console or page errors. The automated browser had no admin session, so admin routes correctly redirected to login.

Next batch recommendation:

- Continue Batch 4 with the next controlled operation panel, prioritizing button groups whose handlers are already centralized in `page.tsx`.
- Do not start reducer/state consolidation until the controlled panels have been extracted and the authenticated operator flow can be visually checked.

## Fifteenth Pass - Enterprise Runtime Controls Extraction

Date: 2026-06-05

This pass continues Batch 4 by extracting the Enterprise Runtime action toolbar and operations queue without moving side-effect ownership out of the page shell.

Implemented:

- Added `src/app/admin/ad-os/_components/EnterpriseRuntimeActionBar.tsx`.
- Added `src/app/admin/ad-os/_components/EnterpriseRuntimeActionBar.test.tsx`.
- Added `src/app/admin/ad-os/_components/EnterpriseOpsQueuePanel.tsx`.
- Added `src/app/admin/ad-os/_components/EnterpriseOpsQueuePanel.test.tsx`.
- Replaced the inline Enterprise Runtime button group and Operations queue section in `src/app/admin/ad-os/page.tsx`.
- Kept runtime readiness, channel adapter, packet creation, execution gate, rollback, pilot, platform job, conversion upload, data quality, portfolio, creative factory, tenant default, experiment standard, audit export, and queue action handlers in `page.tsx`.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 3,376 lines.
- The largest remaining live-operations section now has isolated action and queue subcomponents.
- Operator safety context remains visible: queue blocker counts, live write count, and dry-run/confirmation actions still flow from the same summary and sample payloads.

Verification:

- Focused panel check passed: `npx vitest run src/app/admin/ad-os/_components/EnterpriseRuntimeActionBar.test.tsx src/app/admin/ad-os/_components/EnterpriseOpsQueuePanel.test.tsx` passed: 2 files, 3 tests.
- Full current-scope regression passed: 16 targeted test files, 44 tests.
- Targeted ESLint passed for the Ad OS page, extracted Ad OS components/libs/tests, admin navigation/mission-control files, and touched admin API files.
- `npm run type-check` passed.
- Browser checks on the running dev server at `http://localhost:3030` passed after warm-up: `/login?redirect=%2Fadmin`, `/admin`, and `/admin/ad-os` returned 200 with no console or page errors. The automated browser had no admin session, so admin routes correctly redirected to login.

Next batch recommendation:

- Continue Batch 4 with the Channel budget guardrails form extraction, because it is now the next high-value controlled mutation panel.
- Keep save/update handlers and draft state in `page.tsx`; pass drafts and field update callbacks into the form component first.

## Sixteenth Pass - Budget Guardrails Controls Extraction

Date: 2026-06-05

This pass continues Batch 4 by extracting the Channel budget guardrails table and the large operation action bar while keeping draft state and side-effect ownership in the page shell.

Implemented:

- Added `src/app/admin/ad-os/_components/BudgetGuardrailTable.tsx`.
- Added `src/app/admin/ad-os/_components/BudgetGuardrailTable.test.tsx`.
- Added `src/app/admin/ad-os/_components/BudgetOperationActionBar.tsx`.
- Added `src/app/admin/ad-os/_components/BudgetOperationActionBar.test.tsx`.
- Replaced the inline budget draft table and budget operation button group in `src/app/admin/ad-os/page.tsx`.
- Kept `budgetDrafts`, `updateBudgetDraft`, `saveBudgets`, launch/audit/learning/publisher handlers, and all loading booleans in `page.tsx`.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 3,228 lines.
- Budget edit controls are independently testable while preserving the existing save/update flow.
- The previously hard-to-scan operation button group now has readable labels and a single component boundary, without changing handler behavior.

Verification:

- Focused panel check passed: `npx vitest run src/app/admin/ad-os/_components/BudgetOperationActionBar.test.tsx src/app/admin/ad-os/_components/BudgetGuardrailTable.test.tsx` passed: 2 files, 4 tests.
- Full current-scope regression passed: 18 targeted test files, 48 tests.
- Targeted ESLint passed for the Ad OS page, extracted Ad OS components/libs/tests, admin navigation/mission-control files, and touched admin API files.
- `npm run type-check` passed.
- Cleaned duplicate local Next dev servers and `.next`, then verified a single dev server at `http://localhost:3030`: `/login?redirect=%2Fadmin`, `/admin`, and `/admin/ad-os` returned 200 with no console or page errors. The automated browser had no admin session, so admin routes correctly redirected to login.

Next batch recommendation:

- Continue by extracting the launch audit result panel and the larger generated result panels below the budget operation bar.
- After remaining controlled panels are isolated, revisit reducer consolidation for loading booleans and result state.

## Seventeenth Pass - Budget Result Panels Extraction

Date: 2026-06-05

This pass continues Batch 4 by extracting the generated tenant report and launch audit result panels below the budget operation controls.

Implemented:

- Added `src/app/admin/ad-os/_components/TenantReportSummaryPanel.tsx`.
- Added `src/app/admin/ad-os/_components/TenantReportSummaryPanel.test.tsx`.
- Added `src/app/admin/ad-os/_components/LaunchAuditResultPanel.tsx`.
- Added `src/app/admin/ad-os/_components/LaunchAuditResultPanel.test.tsx`.
- Replaced inline tenant report summary and launch audit result rendering in `src/app/admin/ad-os/page.tsx`.
- Kept `tenantReport`, `tenantReportPeriod`, `launchAudit`, loading state, and all execution handlers in `page.tsx`.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 3,165 lines.
- Two generated result panels are independently testable and no longer add branching/rendering weight to the page shell.
- Existing metric formatting stays centralized through `fmtWon`; no KPI or finance formula changed.

Verification:

- Focused panel check passed: `npx vitest run src/app/admin/ad-os/_components/LaunchAuditResultPanel.test.tsx src/app/admin/ad-os/_components/TenantReportSummaryPanel.test.tsx` passed: 2 files, 4 tests.
- Full current-scope regression passed: 20 targeted test files, 52 tests.
- Targeted ESLint passed for the Ad OS page, extracted Ad OS components/libs/tests, admin navigation/mission-control files, and touched admin API files.
- `npm run type-check` passed.
- Cleaned duplicate local Next dev servers and `.next`, then verified a single dev server at `http://localhost:3030`: `/login?redirect=%2Fadmin`, `/admin`, and `/admin/ad-os` returned 200 with no console or page errors. The automated browser had no admin session, so admin routes correctly redirected to login.

Next batch recommendation:

- Continue extracting the remaining generated result panels in the same budget operation section: ops plan, keyword brain, and Naver asset plan.
- After those are isolated, the page will be ready for a reducer review of loading booleans and generated result state.

## Eighteenth Pass - Generated Result Panels Extraction

Date: 2026-06-05

This pass completes the generated result panel extraction in the budget operation section by isolating ops plan, keyword brain, and Naver asset plan summaries.

Implemented:

- Added `src/app/admin/ad-os/_components/OpsPlanResultPanel.tsx`.
- Added `src/app/admin/ad-os/_components/OpsPlanResultPanel.test.tsx`.
- Added `src/app/admin/ad-os/_components/KeywordBrainResultPanel.tsx`.
- Added `src/app/admin/ad-os/_components/KeywordBrainResultPanel.test.tsx`.
- Added `src/app/admin/ad-os/_components/NaverAssetPlanPanel.tsx`.
- Added `src/app/admin/ad-os/_components/NaverAssetPlanPanel.test.tsx`.
- Replaced inline ops plan, keyword brain, and Naver asset plan rendering in `src/app/admin/ad-os/page.tsx`.
- Removed page-local display derivations for ops publisher, ops measurement, keyword candidates, and Naver asset mutations; each result panel now derives its own display-only values from loaded result props.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 3,067 lines.
- The budget operation section now mostly reads as orchestration plus component calls instead of nested generated-result rendering.
- State and side effects remain centralized in `page.tsx`; extracted panels only format loaded results.

Verification:

- Focused panel check passed: `npx vitest run src/app/admin/ad-os/_components/OpsPlanResultPanel.test.tsx src/app/admin/ad-os/_components/KeywordBrainResultPanel.test.tsx src/app/admin/ad-os/_components/NaverAssetPlanPanel.test.tsx` passed: 3 files, 6 tests.
- Full current-scope regression passed: 23 targeted test files, 58 tests.
- Targeted ESLint passed for the Ad OS page, extracted Ad OS components/libs/tests, admin navigation/mission-control files, and touched admin API files.
- `npm run type-check` passed.
- Cleaned duplicate local Next dev servers and `.next`, then verified a single dev server at `http://localhost:3030`: `/login?redirect=%2Fadmin`, `/admin`, and `/admin/ad-os` returned 200 with no console or page errors. The automated browser had no admin session, so admin routes correctly redirected to login.

Next batch recommendation:

- One more low-risk extraction can push `page.tsx` below 3,000 lines: move the mapping status distribution and several sample-list cards into small read-only panels.
- After the page is below 3,000 lines and remaining panels are stable, start Batch 5 reducer review for related loading booleans.

## Nineteenth Pass - Sample Insight Panels Extraction

Date: 2026-06-05

This pass extracts the learning loop summary, mapping status distribution, and first sample insight cards, pushing the Ad OS page below the 3,000-line threshold.

Implemented:

- Added `src/app/admin/ad-os/_components/LearningLoopPanel.tsx`.
- Added `src/app/admin/ad-os/_components/LearningLoopPanel.test.tsx`.
- Added `src/app/admin/ad-os/_components/MappingStatusDistributionPanel.tsx`.
- Added `src/app/admin/ad-os/_components/MappingStatusDistributionPanel.test.tsx`.
- Added `src/app/admin/ad-os/_components/LearningSignalsPanel.tsx`.
- Added `src/app/admin/ad-os/_components/LearningSignalsPanel.test.tsx`.
- Added `src/app/admin/ad-os/_components/ProductScenariosPanel.tsx`.
- Added `src/app/admin/ad-os/_components/ProductScenariosPanel.test.tsx`.
- Added `src/app/admin/ad-os/_components/LandingEvolutionPanel.tsx`.
- Added `src/app/admin/ad-os/_components/LandingEvolutionPanel.test.tsx`.
- Added `src/app/admin/ad-os/_components/ChangeRequestsPanel.tsx`.
- Added `src/app/admin/ad-os/_components/ChangeRequestsPanel.test.tsx`.
- Replaced the inline learning loop, mapping status distribution, learning signals, product scenarios, landing evolution, and change requests sections in `src/app/admin/ad-os/page.tsx`.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 2,475 lines.
- The page is now substantially closer to an orchestration shell, with the first sample insight grid expressed as tested panel components.
- Change request actions are still controlled by `page.tsx`; the child panel only receives `onUpdate` and the current loading id.

Verification:

- Focused panel check passed: `npx vitest run src/app/admin/ad-os/_components/LearningLoopPanel.test.tsx src/app/admin/ad-os/_components/MappingStatusDistributionPanel.test.tsx src/app/admin/ad-os/_components/LearningSignalsPanel.test.tsx src/app/admin/ad-os/_components/ProductScenariosPanel.test.tsx src/app/admin/ad-os/_components/LandingEvolutionPanel.test.tsx src/app/admin/ad-os/_components/ChangeRequestsPanel.test.tsx` passed: 6 files, 7 tests.
- Full current-scope regression passed: 29 targeted test files, 65 tests.
- Targeted ESLint passed for the Ad OS page, extracted Ad OS components/libs/tests, admin navigation/mission-control files, and touched admin API files.
- `npm run type-check` passed.
- Cleaned duplicate local Next dev servers and `.next`, then verified a single dev server at `http://localhost:3030`: `/login?redirect=%2Fadmin`, `/admin`, and `/admin/ad-os` returned 200 with no console or page errors. The automated browser had no admin session, so admin routes correctly redirected to login.

Next batch recommendation:

- Continue with the remaining lower sample cards: mappings, keyword plans, and recent decisions.
- After the sample cards are isolated, begin Batch 5 reducer review for loading booleans and generated result state.

## Twentieth Pass - Lower Sample Panels Extraction

Date: 2026-06-05

This pass completes the lower sample grid extraction by isolating mapping samples, keyword plans, and recent decisions.

Implemented:

- Added `src/app/admin/ad-os/_components/MappingSamplesPanel.tsx`.
- Added `src/app/admin/ad-os/_components/MappingSamplesPanel.test.tsx`.
- Added `src/app/admin/ad-os/_components/KeywordPlansPanel.tsx`.
- Added `src/app/admin/ad-os/_components/KeywordPlansPanel.test.tsx`.
- Added `src/app/admin/ad-os/_components/RecentDecisionsPanel.tsx`.
- Added `src/app/admin/ad-os/_components/RecentDecisionsPanel.test.tsx`.
- Replaced the inline mappings, keyword plans, and recent decisions cards in `src/app/admin/ad-os/page.tsx`.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 2,392 lines.
- The lower sample grid is now covered by focused component tests instead of being buried in the page shell.
- Keyword plan actions still flow through `page.tsx`; the child panel only receives `onUpdate` and the current loading id.

Verification:

- Focused panel check passed: `npx vitest run src/app/admin/ad-os/_components/MappingSamplesPanel.test.tsx src/app/admin/ad-os/_components/KeywordPlansPanel.test.tsx src/app/admin/ad-os/_components/RecentDecisionsPanel.test.tsx` passed: 3 files, 4 tests.
- Full current-scope regression passed: 32 targeted test files, 69 tests.
- Targeted ESLint passed for the Ad OS page, extracted Ad OS components/libs/tests, admin navigation/mission-control files, and touched admin API files.
- `npm run type-check` passed.
- Browser/build verification is not complete for this pass. Repeated local Next dev attempts produced generated `.next` manifest/static chunk instability, and `npm run build` failed inside generated `.next/types/routes.d.ts` with `Declaration or statement expected` around a generated route union export. Source-level checks passed, but visual parity should wait until the local Next generated artifact issue is repaired or isolated.

Next batch recommendation:

- Pause Batch 5 reducer work until browser parity is reliable again.
- Investigate the local Next generated route/type artifact issue first, because reducer consolidation is the first phase that can affect interaction behavior.

## Twenty-First Pass - Build And Browser Validation Repair

Date: 2026-06-05

This pass repairs the validation path that blocked safe Batch 5 reducer work.

Implemented:

- Removed `src/pages/404.tsx`, leaving App Router `src/app/not-found.tsx` as the single 404 owner.
- Gated `SpeedInsights` in `src/app/layout.tsx` behind `process.env.VERCEL === '1'`, so local production verification no longer requests the Vercel-only script path.
- Cleaned stale local Next dev/start processes before production build verification.

Why this matters:

- The earlier `/_document` and partial `app-paths-manifest.json` failures were reproduced only while stale local Next servers were still alive or the duplicate Pages Router 404 was present.
- Clean production build now generates the full route table, including `/admin/ad-os`.
- Local `next start` no longer reports the Speed Insights 404/MIME console error.

Verification:

- Focused Ad OS regression passed: 32 targeted test files, 69 tests.
- Targeted ESLint passed for the Ad OS page/components/libs, admin navigation/mission-control files, touched admin API files, and `src/app/layout.tsx`.
- `npm run type-check` passed.
- `npm run clean:next; npm run build` passed after the repair.
- Production-start browser verification passed on `http://localhost:3030`: `/login?redirect=%2Fadmin` returned the login screen, `/admin` redirected to `/login?redirect=%2Fadmin`, and `/admin/ad-os` redirected to `/login?redirect=%2Fadmin%2Fad-os` with no console errors in an unauthenticated session.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime `crypto` warning from `src/lib/timing-safe.ts` via `src/lib/api-auth.ts`.

Next batch recommendation:

- Batch 5 reducer review can proceed now, but keep it narrow: consolidate related loading/result state without changing handler behavior or external-write safety gates.

## Twenty-Second Pass - Action Flag State Consolidation

Date: 2026-06-05

This pass starts Batch 5 by consolidating action/loading booleans without moving side-effect handlers out of `page.tsx`.

Implemented:

- Added `src/app/admin/ad-os/_lib/action-flags.ts`.
- Added `src/app/admin/ad-os/_lib/action-flags.test.ts`.
- Replaced the many separate `useState(false)` action flags in `src/app/admin/ad-os/page.tsx` with one `useActionFlags()` hook.
- Kept all mutation handlers, result state, action ids, and external-write safety gates in `page.tsx`.
- Added `scripts/ensure-next-routes-js-shim.cjs` and wired it into `prebuild` so standard clean builds no longer fail when Next 15 generated validation imports `./routes.js` before a matching JS shim exists.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 2,346 lines.
- Action loading state is now centrally initialized and type constrained by `ActionFlagKey`.
- Future action additions have one obvious key list instead of another isolated boolean pair.
- The clean build path is now reproducible from `npm run clean:next; npm run build`.

Verification:

- Focused/current Ad OS regression passed: 33 targeted test files, 70 tests.
- Targeted ESLint passed for `src/app/layout.tsx`, the Ad OS page/components/libs, admin navigation/mission-control files, touched admin API files, and tests.
- `npm run type-check` passed.
- `npm run clean:next; npm run build` passed with the prebuild shim in place.
- Production-start browser verification passed on `http://localhost:3030`: `/login?redirect=%2Fadmin` returned the login screen, `/admin` redirected to `/login?redirect=%2Fadmin`, and `/admin/ad-os` redirected to `/login?redirect=%2Fadmin%2Fad-os` with no console errors in an unauthenticated session.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warnings.
- The in-app browser tab became unresponsive after a screenshot timeout during verification, so the final visual check used production-start HTTP checks plus Playwright browser automation instead.

Next batch recommendation:

- Continue Batch 5 with result-state grouping only after an authenticated admin session is available, because unauthenticated verification can confirm routing but not button-level action behavior.

## Twenty-Third Pass - View Model Cleanup

Date: 2026-06-05

This pass continues Batch 5 by moving the last active page-level display calculations into a small view-model module and removing stale calculations left behind by previous panel extraction.

Implemented:

- Added `src/app/admin/ad-os/_lib/view-model.ts`.
- Added `src/app/admin/ad-os/_lib/view-model.test.ts`.
- Replaced inline `totalMappingStatus`, execution-state filtering, and active automation mode indexing in `src/app/admin/ad-os/page.tsx`.
- Removed stale launch/readiness/action-map calculations and unused extracted-panel imports from `page.tsx`.
- Fixed an existing upload API type mismatch by adapting V3 normalized optional-tour `null` price fields to the parser-side optional-tour shape before assignment in `src/app/api/upload/route.ts`.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 2,155 lines.
- The page is closer to an orchestration shell: fetches, side effects, and result state still live in the page, while reusable display derivations have tests.
- The upload API now type-checks when V3 optional-tour normalization returns nullable price fields.

Verification:

- Focused view-model/action-flag tests passed.
- Current Ad OS regression passed: 34 targeted test files, 73 tests.
- Targeted ESLint passed for the Ad OS page/components/libs, admin navigation/mission-control files, touched admin API files, `src/app/layout.tsx`, and the upload route.
- `npm run type-check` passed.
- `git diff --check` passed with only existing CRLF normalization warnings.
- `npm run clean:next; npm run build` passed.
- Production-start browser verification passed on `http://localhost:3030`: `/login?redirect=%2Fadmin` returned the login screen, `/admin` redirected to `/login?redirect=%2Fadmin`, and `/admin/ad-os` redirected to `/login?redirect=%2Fadmin%2Fad-os` with no console errors in an unauthenticated session.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warnings.
- Button-level Ad OS behavior still needs an authenticated admin session for full interactive parity checks.

Next batch recommendation:

- The next worthwhile batch is action-handler pruning or extraction: identify handlers and result states no longer reachable after panel extraction, then either reconnect them intentionally or remove them with focused tests.

## Twenty-Fourth Pass - Panel Reconnection And Runtime Repair

Date: 2026-06-05

This pass corrected the previous extraction cleanup by reconnecting panels that had been extracted but were no longer rendered, then repaired the production runtime path until `next start` was healthy again.

Implemented:

- Reconnected the Ad OS launch queue, launch wizard, completion audit, staging validation, operating inventory, budget guardrail/action, tenant report, generated result, enterprise runtime, and enterprise ops queue panels in `src/app/admin/ad-os/page.tsx`.
- Expanded `src/app/admin/ad-os/_lib/view-model.ts` with launch checklist, launch wizard, completion drilldown, and tenant report view helpers.
- Expanded `src/app/admin/ad-os/_lib/view-model.test.ts` to cover the restored view-model helpers.
- Fixed upload/product-registration type adapters surfaced by full validation.
- Gated `src/instrumentation.ts` so Sentry and OTel bundles load only when their runtime configuration is present.
- Expanded `scripts/ensure-next-main-app-js-shim.cjs` to cover the Windows/non-ASCII Next runtime gaps for `main-app.js` and server chunk aliases.

Why this matters:

- The extracted panels are now real UI again, not dead code.
- `/admin/ad-os` production bundle reflects the restored panels at 32.6 kB.
- Local production startup no longer fails with empty 500 responses from missing runtime artifacts or optional instrumentation bundles.

Verification:

- Focused Ad OS tests passed: 34 files, 76 tests.
- `npm run type-check` passed.
- `npm run build` completed successfully and ran the postbuild runtime shim.
- Production-start checks passed: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.
- Playwright browser check passed for the login page: title, email field, password field, and submit button rendered with no console errors.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning.
- Button-level Ad OS behavior still needs an authenticated admin session for full interactive parity checks.

## Twenty-Fifth Pass - Edge-Safe Timing Comparison

Date: 2026-06-05

This pass removed the remaining code-owned Edge runtime warning by replacing the Node `crypto` import used by API authentication timing checks with an Edge-compatible constant-time byte comparison helper.

Implemented:

- Replaced `src/lib/timing-safe.ts`'s Node `crypto.timingSafeEqual` import with a `TextEncoder`-based byte comparison.
- Added `src/lib/timing-safe.test.ts` to cover equal values, different values, nullish values, different lengths, and multibyte strings.

Why this matters:

- Edge middleware and auth helpers no longer pull Node-only `crypto` through `src/lib/api-auth.ts`.
- The production build warning list is now reduced to environment/runtime-level warnings rather than a fixable app helper import.

Verification:

- Focused timing-safe tests passed.
- Targeted ESLint passed for the timing-safe helper, test, API auth, and middleware files.
- `npm run build` completed successfully after the change, and the previous `src/lib/timing-safe.ts` Edge `crypto` warning is gone.
- Production-start checks passed after the new build: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for pages/routes that intentionally use Edge runtime.
- Button-level Ad OS behavior still needs an authenticated admin session for full interactive parity checks.

## Twenty-Sixth Pass - Result State Reducer

Date: 2026-06-05

This pass started Batch 5 by moving Ad OS result-panel state into a reducer-backed hook while preserving the existing action handlers and external-write guardrails.

Implemented:

- Added `src/app/admin/ad-os/_lib/result-state.ts`.
- Added `src/app/admin/ad-os/_lib/result-state.test.ts`.
- Replaced separate page-level state slots for automation messages, launch audit, Naver setup packet, tenant report, ops plan, keyword brain, Naver asset plan, and readiness QA payloads with `useAdOsResultState()`.

Why this matters:

- `src/app/admin/ad-os/page.tsx` now has one explicit owner for generated result and readiness payloads instead of a long list of independent result `useState` calls.
- The page is closer to the intended orchestration shell without changing API payloads, KPI formulas, or external-write behavior.

Verification:

- Focused Ad OS reducer/view-model/action-flag tests passed: 3 files, 9 tests.
- Targeted ESLint passed for the Ad OS page, components, and libs.
- `npm run type-check` passed.
- Clean `npm run build` completed and ran the postbuild runtime shim.
- `.next` JSON manifests parsed successfully after the clean build.
- Production-start checks passed: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Button-level Ad OS behavior still needs an authenticated admin session for full interactive parity checks.

## Twenty-Ninth Pass - JSON Action Runner

Date: 2026-06-05

This pass reduced repeated Ad OS action-handler boilerplate by introducing a shared JSON action runner for simple button actions.

Implemented:

- Added `src/app/admin/ad-os/_lib/action-runner.ts`.
- Added `src/app/admin/ad-os/_lib/action-runner.test.ts`.
- Replaced 12 simple action handlers with `useAdOsJsonActionRunner()`.
- Preserved existing request URLs, payloads, fallback error messages, refresh behavior, and result-state updates.
- Restored the missing upload-route import for `canUseSupplierRawDeterministicPreflight` surfaced by the production build.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 2,284 lines.
- Simple action handlers now share one audited success/error/loading flow instead of duplicating the same `setActionFlag`, `fetch`, `ok`, `refresh`, and message sequence.
- More complex actions with custom summaries, confirmations, or safety copy remain explicit in the page.

Verification:

- Focused Ad OS action/state/view-model tests passed: 6 files, 19 tests.
- Targeted ESLint passed for the Ad OS page, components, and libs.
- `npm run type-check` passed.
- `npm run build` completed and ran the postbuild runtime shim.
- `.next` JSON manifests parsed successfully after the build.
- Production-start checks passed: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Button-level Ad OS behavior still needs an authenticated admin session for full interactive parity checks.

## Twenty-Eighth Pass - Page Summary State Reducer

Date: 2026-06-05

This pass completed the first state-led cleanup slice by moving Ad OS summary, loading, error, budget draft, and tenant policy draft state into a reducer-backed page-state hook.

Implemented:

- Added `src/app/admin/ad-os/_lib/page-state.ts`.
- Added `src/app/admin/ad-os/_lib/page-state.test.ts`.
- Replaced direct page-level `useState` ownership for summary data, budget drafts, loading, error, and tenant policy draft with `useAdOsPageState()`.
- Moved budget draft numeric normalization, tenant policy numeric normalization, and tenant platform toggling into the page-state reducer.

Why this matters:

- `src/app/admin/ad-os/page.tsx` no longer owns raw React `useState` cells directly; page state is grouped by concern across dedicated hooks.
- The page is now 2,415 lines and closer to an orchestration shell without changing API calls, KPI formulas, or external-write behavior.

Verification:

- Focused Ad OS state/view-model/action tests passed: 5 files, 16 tests.
- Targeted ESLint passed for the Ad OS page, components, and libs.
- `npm run type-check` passed.
- `npm run build` completed and ran the postbuild runtime shim.
- `.next` JSON manifests parsed successfully after the build.
- Production-start checks passed: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Button-level Ad OS behavior still needs an authenticated admin session for full interactive parity checks.

## Twenty-Seventh Pass - Active Action Id Reducer

Date: 2026-06-05

This pass continued Batch 5 by grouping the remaining per-row loading identifiers in the Ad OS page into a small reducer-backed hook.

Implemented:

- Added `src/app/admin/ad-os/_lib/active-action-ids.ts`.
- Added `src/app/admin/ad-os/_lib/active-action-ids.test.ts`.
- Replaced independent page-level `keywordActionId`, `changeRequestActionId`, and `opsQueueActionId` state slots with `useActiveActionIds()`.
- Removed an unused local `report` variable in the tenant report loader.

Why this matters:

- Row-level loading state is now represented as one explicit UI-state group instead of three separate page-level state cells.
- The Ad OS page has fewer unrelated state owners while preserving the existing button callbacks and API calls.

Verification:

- Focused Ad OS reducer/view-model/action-flag tests passed: 4 files, 12 tests.
- Targeted ESLint passed for the Ad OS page, components, and libs.
- `npm run type-check` passed before the final unused-line cleanup; the final cleanup was covered by focused ESLint and tests.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Button-level Ad OS behavior still needs an authenticated admin session for full interactive parity checks.

## Thirtieth Pass - Action Message Helpers

Date: 2026-06-05

This pass continued the Ad OS orchestration cleanup by moving repeated action-result summary text into tested helper functions.

Implemented:

- Added `src/app/admin/ad-os/_lib/action-messages.ts`.
- Added `src/app/admin/ad-os/_lib/action-messages.test.ts`.
- Replaced the inline success-message builders for guarded apply, pilot setup, and publish drafts with `buildGuardedApplyMessage()`, `buildPilotSetupMessage()`, and `buildPublishDraftsMessage()`.
- Preserved the existing English operator-facing message text, number formatting, action URLs, payloads, refresh behavior, and safety copy.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 2,180 lines.
- The remaining page-level action handlers are easier to scan because the low-risk formatting logic is no longer mixed into side-effect flow.
- Message formatting is now covered by focused unit tests before any future handler extraction.

Verification:

- Focused Ad OS action/state/view-model tests passed: 7 files, 22 tests.
- Targeted ESLint passed for the Ad OS page, components, libs, and upload route.
- `npm run type-check` passed.
- `npm run build` completed and ran the postbuild runtime shim.
- `.next` JSON manifests parsed successfully after the build.
- Production-start checks passed: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Button-level Ad OS behavior still needs an authenticated admin session for full interactive parity checks.

## Thirty-First Pass - Result-Based Action Runner Messages

Date: 2026-06-05

This pass connected the new action-message helpers to the shared JSON action runner and added a safer fallback path for malformed API responses.

Implemented:

- Extended `useAdOsJsonActionRunner()` so `successMessage` can be either a static string or a function of the parsed JSON response.
- Replaced the guarded apply, pilot setup, and publish-draft handlers with shared runner calls while preserving URLs, payloads, fallback errors, refresh behavior, and result text.
- Hardened `parseAdOsJsonResponse()` so non-JSON, empty, or non-object JSON API responses surface the existing button-specific fallback error instead of raw parser/type errors.
- Added focused coverage for JSON-derived success messages, invalid JSON fallback handling, and non-object JSON fallback handling.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 2,147 lines.
- Three more side-effect handlers now share one audited loading/error/fetch/refresh path.
- Operator-facing error handling is less likely to expose low-level parser text during upstream failures.

Verification:

- Targeted ESLint passed for the Ad OS page, action runner, and action-message helpers.
- Focused action-runner/action-message tests passed: 2 files, 9 tests.
- `npm run type-check` passed.
- `npm run build` completed and ran the postbuild runtime shim.
- `.next` JSON manifests parsed successfully after the build.
- Production-start checks passed: `/api/v1/health` 200 under a 15s timeout, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- The production health endpoint had one 5s cold-start timeout during verification, then returned 200 in 6.9s under a 15s timeout.
- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Button-level Ad OS behavior still needs an authenticated admin session for full interactive parity checks.

## Thirty-Second Pass - Readiness Runner and Fetcher Fallbacks

Date: 2026-06-05

This pass moved the four read-only Ad OS readiness/check buttons onto a shared runner and hardened the centralized fetchers against malformed JSON responses.

Implemented:

- Added `src/app/admin/ad-os/_lib/readiness-runner.ts`.
- Added `src/app/admin/ad-os/_lib/readiness-runner.test.ts`.
- Replaced the repeated loading/error/result/message flow in staging smoke, operating inventory, staging validation, and admin surface QA handlers with `useAdOsReadinessRunner()`.
- Preserved the existing fetch functions, state setters, readiness messages, safety copy, and read-only behavior.
- Added a small `readJson()` helper in `src/app/admin/ad-os/_lib/fetchers.ts` so invalid JSON responses surface a clear `HTTP <status>` error.
- Expanded fetcher coverage for invalid JSON fallback behavior.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 2,137 lines.
- Four more handlers now share an audited loading/error path without moving any external-write or KPI behavior.
- Initial/readiness fetch failures are less likely to expose raw parser errors to operators.

Verification:

- Targeted ESLint passed for the Ad OS page, readiness runner, and fetchers.
- Focused Ad OS fetcher/readiness/action tests passed: 4 files, 16 tests.
- Full Ad OS `_lib` test slice passed: 10 files, 37 tests.
- `npm run type-check` passed.
- `npm run build` completed and ran the postbuild runtime shim.
- `.next` JSON manifests parsed successfully after the build.
- Production-start checks passed: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Button-level Ad OS behavior still needs an authenticated admin session for full interactive parity checks.

## Thirty-Third Pass - Result Action Runner Coverage

Date: 2026-06-05

This pass moved three result-producing Ad OS actions onto the shared JSON action runner while preserving their result state and operator messages.

Implemented:

- Extended `AdOsJsonActionRequest` with a generic response type so typed result actions can use the shared runner.
- Moved `generateNaverSetupPacket()` onto `runJsonAction()` with `refresh: false`, preserving the existing no-refresh behavior and Naver setup packet state update.
- Moved `runKeywordBrain()` onto `runJsonAction()`, preserving the `keywordBrainResult` update, refresh behavior, and success message.
- Moved `createNaverAssets()` onto `runJsonAction()`, preserving the `naverAssetPlan` update, refresh behavior, blocker summary, and `external spend 0` safety copy.
- Left `runLaunchAudit()` explicit because its current success message is intentionally set before the subsequent refresh call.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 2,129 lines.
- Three more actions now share the audited loading/error/fetch/JSON parsing flow.
- Result-producing actions can be migrated incrementally without weakening external-write guardrails.

Verification:

- Targeted ESLint passed for the Ad OS page and action runner.
- Focused action-runner/result-state tests passed: 2 files, 8 tests.
- Full Ad OS `_lib` test slice passed: 10 files, 37 tests.
- `npm run type-check` passed.
- `npm run build` completed and ran the postbuild runtime shim.
- `.next` JSON manifests parsed successfully after the build.
- Production-start checks passed: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Button-level Ad OS behavior still needs an authenticated admin session for full interactive parity checks.

## Thirty-Fourth Pass - Simple Runner Action Coverage

Date: 2026-06-05

This pass moved four more single-request Ad OS actions onto the shared JSON action runner while preserving their external-write safety language.

Implemented:

- Moved `executeNaverGate()` onto `runJsonAction()`.
- Moved `exportGoogleConversions()` onto `runJsonAction()`.
- Moved `exportMetaConversions()` onto `runJsonAction()`.
- Moved `runBidOptimizer()` onto `runJsonAction()`.
- Preserved the existing URLs, payloads, refresh behavior, fallback errors, count formatting, and operator-facing `API write 0` / upload safety copy.

Why this matters:

- Four more handlers no longer duplicate loading, error, fetch, JSON parsing, refresh, and final-message flow.
- The page still keeps custom safety text local where operators can see it while side-effect plumbing is centralized.

Verification:

- Targeted ESLint passed for the Ad OS page and action runner.
- `npm run type-check` passed.
- Full Ad OS `_lib` test slice passed: 10 files, 37 tests.
- `npm run build` completed and ran the postbuild runtime shim.
- `.next` JSON manifests parsed successfully after the build.
- Production-start checks passed: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Button-level Ad OS behavior still needs an authenticated admin session for full interactive parity checks.

## Thirty-Fifth Pass - Additional Simple Runner Coverage

Date: 2026-06-05

This pass moved another four single-request Ad OS actions onto the shared JSON action runner.

Implemented:

- Tightened the generic parameter on `useAdOsJsonActionRunner()` so typed response shapes flow through runner requests.
- Moved `runExperimentRunner()` onto `runJsonAction()`.
- Moved `applyBlogEvolution()` onto `runJsonAction()`.
- Moved `runPlatformJobs()` onto `runJsonAction()`.
- Moved `runRuntimeReadiness()` onto `runJsonAction()`.
- Preserved the existing URLs, payloads, refresh behavior, fallback errors, count formatting, and operator-facing safety text.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 2,112 lines.
- Four more handlers no longer duplicate loading, error, fetch, JSON parsing, refresh, and final-message flow.
- Runtime and platform-job safety messaging remains visible while common side-effect plumbing stays centralized.

Verification:

- Targeted ESLint passed for the Ad OS page and action runner.
- `npm run type-check` passed.
- Full Ad OS `_lib` test slice passed: 10 files, 37 tests.
- `npm run build` completed and ran the postbuild runtime shim.
- `.next` JSON manifests parsed successfully after the build.
- Production-start checks passed: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Button-level Ad OS behavior still needs an authenticated admin session for full interactive parity checks.

## Thirty-Sixth Pass - Portfolio and Platform Runner Coverage

Date: 2026-06-05

This pass moved four more single-request Ad OS actions onto the shared JSON action runner.

Implemented:

- Moved `loadDataQuality()` onto `runJsonAction()` while preserving its GET URL and summary message.
- Moved `runPortfolioPlan()` onto `runJsonAction()`.
- Moved `applyApprovedPortfolio()` onto `runJsonAction()`.
- Moved `executePlatformJobsDryRun()` onto `runJsonAction()`.
- Preserved existing URLs, payloads, refresh behavior, fallback errors, count formatting, and operator-facing `API write 0` safety language.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 2,097 lines.
- Four more handlers now share the audited loading/error/fetch/JSON parsing path.
- The remaining manual handlers are increasingly concentrated around multi-request flows, row-specific actions, confirmations, and special message ordering.

Verification:

- Targeted ESLint passed for the Ad OS page and action runner.
- `npm run type-check` passed.
- Full Ad OS `_lib` test slice passed: 10 files, 37 tests.
- `npm run build` completed and ran the postbuild runtime shim.
- `.next` JSON manifests parsed successfully after the build.
- Production-start checks passed: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Button-level Ad OS behavior still needs an authenticated admin session for full interactive parity checks.

## Thirty-Seventh Pass - Lower Action Runner Coverage and Copy Repair

Date: 2026-06-05

This pass moved four additional lower Ad OS actions onto the shared JSON action runner and repaired corrupted display copy found during the final diff review.

Implemented:

- Moved `standardizeExperimentTemplates()` onto `runJsonAction()`.
- Moved `checkChannelAdapters()` onto `runJsonAction()`.
- Moved `runRollbackDrill()` onto `runJsonAction()`.
- Moved `createAssetGroup()` onto `runJsonAction()`.
- Removed the direct `setActionFlag()` plumbing for those four simple single-request actions.
- Repaired mojibake/corrupted Ad OS page labels in the remaining inline shell: page header buttons, channel execution state, automation policy, tenant safety policy, status pills, and operating mode cards.
- Preserved existing URLs, payloads, refresh behavior, fallback errors, count formatting, and external-write safety language for the converted actions.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 2,183 lines.
- Four more handlers now use the audited loading/error/fetch/JSON parsing path.
- The page no longer exposes corrupted copy in the Ad OS shell after the large extraction and runner batches.
- Remaining manual handlers are concentrated around multi-request flows, row-specific actions, confirmations, and special result ordering.

Verification:

- Targeted ESLint passed for the Ad OS page and action runner.
- `npm run type-check` passed.
- Full Ad OS `_lib` test slice passed: 10 files, 37 tests.
- `npm run build` completed and ran the postbuild runtime shim.
- `.next` JSON manifests parsed successfully after the build.
- Ad OS copy scan found no remaining mojibake/Hanja-corruption markers in `page.tsx`, `_components`, or `_lib`.
- Production-start checks passed: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Some action success/failure fallback messages are intentionally generic until the next copy-normalization pass; authenticated button-level behavior still needs a real admin session.

## Thirty-Eighth Pass - Ad OS Message Restoration and Runner Consolidation

Date: 2026-06-05

This pass restored detailed operator-facing Ad OS action messages and reduced more repeated action plumbing in `page.tsx`.

Implemented:

- Replaced generic action completion/failure copy with count-aware, safety-aware English messages across Ad OS action handlers.
- Added shared message helpers for safe record access, number formatting, and blocker-list formatting.
- Added `useAdOsJsonBatchActionRunner()` for parallel Google/Meta conversion upload flows.
- Added `useAdOsJsonIdActionRunner()` for row-level actions that need a single active loading id.
- Moved conversion upload prepare/dry-run, keyword plan row updates, ops queue row actions, change request updates, tenant policy/budget saves, tenant audit export, channel packet generation, execution gate check, Naver limited pilot, and tenant workspace defaults onto shared runners where behavior was simple enough.
- Preserved existing URLs, payloads, confirmations, refresh behavior, active-row loading ids, fallback errors, and external-write safety language.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 2,127 lines.
- `src/app/admin/ad-os/_lib/action-runner.ts` now owns single-request, batch-request, and row-id request flows.
- Ad OS `_lib` coverage now includes 40 focused tests.
- Remaining manual handlers are more clearly limited to actions with special result state, clipboard/download behavior, or deliberate message ordering.

Verification:

- Targeted ESLint passed for the Ad OS page, action runner, and action message helpers/tests.
- `npm run type-check` passed.
- Full Ad OS `_lib` test slice passed: 10 files, 40 tests.
- Ad OS copy scan found no remaining generic `Action completed` / `Action failed` shell copy or mojibake/Hanja-corruption markers in `page.tsx` and `_lib/action-messages.ts`.
- `npm run build` completed and ran the postbuild runtime shim.
- Production-start checks passed: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Authenticated button-level behavior still needs a real admin session for full interactive parity checks.

## Thirty-Ninth Pass - Ad OS Remaining Manual Action Cleanup

Date: 2026-06-05

This pass moved the remaining direct Ad OS page API calls onto shared action runners where the behavior could be preserved.

Implemented:

- Moved Naver paused keyword dry-run, Naver ad group lookup, Naver asset lookup, and Naver asset sync onto `runJsonAction()`.
- Moved paused keyword activation, Creative Factory drafts, conversion attribution, external publish dry-run, publisher probe, launch audit, Naver candidate approval, kill-switch dry-run, experiment planning, and Google permission probe onto `runJsonAction()`.
- Preserved existing URLs, payloads, fallback errors, refresh/no-refresh choices, result-state updates, and operator-facing safety messages.
- Kept clipboard/download helpers outside the API runner because they use browser APIs rather than JSON endpoints.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 1,988 lines.
- Direct `setActionFlag()` and direct Ad OS/search-ads `fetch()` calls are no longer present in `page.tsx`.
- The page is closer to a pure orchestration shell: API action loading/error/message flow now lives in `_lib/action-runner.ts`.

Verification:

- Targeted ESLint passed for the Ad OS page, action runner, and action message helpers/tests.
- `npm run type-check` passed.
- Full Ad OS `_lib` test slice passed: 10 files, 40 tests.
- Ad OS scan found no remaining direct `setActionFlag()`, direct Ad OS/search-ads `fetch()` calls, generic action messages, or mojibake/Hanja-corruption markers in `page.tsx` and `_lib/action-messages.ts`.
- `npm run build` completed and ran the postbuild runtime shim.
- Production-start checks passed: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Authenticated button-level behavior still needs a real admin session for full interactive parity checks.

## Fortieth Pass - Ad OS Policy Panel Extraction

Date: 2026-06-05

This pass extracted the remaining large policy and operating-state render blocks from `page.tsx` into focused display panels.

Implemented:

- Added `ChannelExecutionStatePanel` for Naver/Google channel spend readiness, active mode, level, and next action.
- Added `AutomationPolicyPanel` for automation ladder, tenant guardrails, and tenant ad readiness.
- Added `TenantSafetyPolicyPanel` for tenant policy summary and edit controls.
- Added `OperatingModesPanel` for the static recommendation/safety/scale-up operating mode cards.
- Preserved existing labels, status tones, policy edit inputs, checkbox behavior, save handler wiring, and safety copy.

Why this matters:

- `src/app/admin/ad-os/page.tsx` is now 1,718 lines.
- The remaining page render shell is mostly panel composition rather than nested policy/card markup.
- Policy edit behavior remains owned by the page reducer and is passed into the extracted panel through existing handlers.

Verification:

- Targeted ESLint passed for the Ad OS page and the four extracted panels.
- `npm run type-check` passed.
- Full Ad OS `_lib` test slice passed: 10 files, 40 tests.
- Ad OS scan found no direct `setActionFlag()`, direct Ad OS/search-ads `fetch()` calls, generic action messages, or mojibake/Hanja-corruption markers in `page.tsx` and `_lib/action-messages.ts`.
- `npm run build` completed and ran the postbuild runtime shim.
- Production-start checks passed: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307 to login, and `/_next/static/chunks/main-app.js` 200.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Authenticated button-level behavior still needs a real admin session for full interactive parity checks.

## Forty-First Pass - Ad OS Action Bar Prop Bundles

Date: 2026-06-05

This pass reduced the prop width between `page.tsx` and the two largest action bars.

Implemented:

- Changed `BudgetOperationActionBar` to accept typed `actions` and `loading` bundles instead of 76 individual handler/loading props.
- Changed `EnterpriseRuntimeActionBar` to accept typed `actions` and `loading` bundles instead of 38 individual handler/loading props.
- Moved each action bar's button registry into a local typed spec list while preserving the labels, ordering, icons, primary button, and loading behavior.
- Updated focused component tests to use the new bundle props and continue checking readable labels and button count.

Why this matters:

- `page.tsx` now passes compact action bundles into the two densest button surfaces.
- Action bar prop contracts are easier to audit because every required handler/loading key is typed as a closed union.
- The rendered button surfaces remain unchanged while page orchestration becomes less brittle.

Verification:

- Targeted ESLint passed for the Ad OS page, `_components`, and `_lib`.
- `npm run type-check` passed.
- Full Ad OS `_lib` plus action-bar test slice passed: 12 files, 43 tests.
- Ad OS scan found no direct `setActionFlag()`, direct Ad OS/search-ads `fetch()` calls, generic action messages, or mojibake/Hanja-corruption markers in `page.tsx` and `_lib/action-messages.ts`.
- `npm run build` passed.
- `git diff --check` passed with existing CRLF normalization warnings only.
- Production-start HTTP smoke passed on port 3057: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307, and `/_next/static/chunks/main-app.js` 200.
- In-app browser smoke passed on port 3058: `/admin/ad-os` redirected to `/login?redirect=%2Fadmin%2Fad-os`, showed login text, and reported no console errors.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Authenticated button-level behavior still needs a real admin session for full interactive parity checks.

## Forty-Second Pass - Ad OS Section Shell Extraction

Date: 2026-06-05

This pass moved the last two large inline operation sections out of `page.tsx`.

Implemented:

- Added `BudgetOperationsPanel` to compose budget guardrails, the budget action bar, tenant report summary, launch audit result, ops plan result, Keyword Brain result, and Naver asset plan.
- Added `EnterpriseRuntimePanel` to compose runtime controls, external-write status evidence, and operations queue evidence.
- Updated `page.tsx` so those sections are passed as compact panel props while keeping handlers, result state, and data loading in the page.
- Added focused render tests for both new section panels.

Why this matters:

- `page.tsx` is now closer to a route-level orchestrator instead of owning every visual section.
- Budget and runtime section boundaries are named, testable, and easier to review independently.
- Existing action bar button order, queue evidence, external-write status text, and result panels are preserved.

Verification:

- Targeted ESLint passed for the Ad OS page, `_components`, and `_lib`.
- `npm run type-check` passed.
- Ad OS `_lib` plus action-bar and section-panel test slice passed: 14 files, 45 tests.
- Ad OS scan found no direct `setActionFlag()`, direct Ad OS/search-ads `fetch()` calls, generic action messages, or mojibake/Hanja-corruption markers in `page.tsx` and `_lib/action-messages.ts`.
- `npm run build` passed.
- `git diff --check` passed with existing CRLF normalization warnings only.
- Production-start HTTP smoke passed on port 3059: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307, and `/_next/static/chunks/main-app.js` 200.
- In-app browser smoke passed on port 3059: `/admin/ad-os` redirected to `/login?redirect=%2Fadmin%2Fad-os`, showed login text, and reported no console errors.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Authenticated button-level behavior still needs a real admin session for full interactive parity checks.

## Forty-Third Pass - Ad OS Launch Queue Action Contract

Date: 2026-06-05

This pass tightened the Today queue action contract and fixed a degraded-summary fallback gap.

Implemented:

- Added a closed `LaunchActionKey` union, `LaunchActionHandlers`, and `LaunchActionLoading` contract to `LaunchActionQueuePanel`.
- Added the missing `refresh` handler/loading entry used by the degraded summary fallback action.
- Disabled unsupported server-provided `ui_action` keys instead of wiring an undefined click handler.
- Expanded `LaunchActionQueuePanel` tests to cover normal actions, optional Naver packet rendering, degraded-summary `refresh`, and unsupported action keys.

Why this matters:

- The Today queue now has a typed boundary between `/api/admin/ad-os/summary` action keys and frontend handlers.
- The fallback recovery action can actually refresh the page state when summary loading degrades.
- Future server-side action key additions fail visibly in type/test review or degrade safely as disabled buttons.

Verification:

- Targeted ESLint passed for the Ad OS page, `_components`, and `_lib`.
- `npm run type-check` passed.
- Ad OS `_lib` plus launch/action-bar/section-panel test slice passed: 15 files, 49 tests.
- Ad OS scan found no direct `setActionFlag()`, direct Ad OS/search-ads `fetch()` calls, generic action messages, or mojibake/Hanja-corruption markers in `page.tsx` and `_lib/action-messages.ts`.
- `npm run build` passed.
- `git diff --check` passed with existing CRLF normalization warnings only.
- Production-start HTTP smoke passed on port 3060: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307, and `/_next/static/chunks/main-app.js` 200.
- In-app browser smoke passed on port 3060: `/admin/ad-os` redirected to `/login?redirect=%2Fadmin%2Fad-os`, showed login text, and reported no console errors.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Authenticated button-level behavior still needs a real admin session for full interactive parity checks.

## Forty-Fourth Pass - Ad OS Shared Launch Action Keys

Date: 2026-06-05

This pass moved the launch queue action key contract to shared Ad OS types so the API and UI compile against the same keys.

Implemented:

- Moved `LAUNCH_ACTION_KEYS` and `LaunchActionKey` into `_lib/types.ts`.
- Updated `Summary['launch_action_queue'][number].ui_action` from `string` to `LaunchActionKey`.
- Updated `/api/admin/ad-os/summary` so generated launch queue actions and degraded-summary fallback actions use the shared key type.
- Kept the runtime unsupported-action guard in `LaunchActionQueuePanel` for stale or malformed server payloads, with the test explicitly casting the malformed payload.

Why this matters:

- New or renamed Today queue actions now have to be reflected in the shared contract before the API can emit them.
- The degraded fallback `refresh` action is covered from API generation through UI handler wiring.
- The UI still fails safe if runtime data arrives outside the compile-time contract.

Verification:

- Targeted ESLint passed for the Ad OS page, `_components`, `_lib`, and `/api/admin/ad-os/summary`.
- `npm run type-check` passed.
- Ad OS `_lib` plus launch/action-bar/section-panel test slice passed: 15 files, 49 tests.
- Ad OS/API scan found no `ui_action: string`, direct `setActionFlag()`, direct Ad OS/search-ads `fetch()` calls, generic action messages, or mojibake/Hanja-corruption markers in the checked files.
- `npm run build` passed.
- `git diff --check` passed with existing CRLF normalization warnings only.
- Production-start HTTP smoke passed on port 3061: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307, and `/_next/static/chunks/main-app.js` 200.
- In-app browser smoke passed on port 3061: `/admin/ad-os` redirected to `/login?redirect=%2Fadmin%2Fad-os`, showed login text, and reported no console errors.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Authenticated button-level behavior still needs a real admin session for full interactive parity checks.

## Forty-Fifth Pass - Ad OS Readiness And CSV Utility Hardening

Date: 2026-06-05

This pass tightened two small operator-facing edges and restored full type-check health after an untracked product-registration gate file was found malformed.

Implemented:

- Updated the Ad OS readiness runner to clear stale automation messages at the start of each readiness check.
- Added `naver-keyword-csv` helpers for Naver setup packet CSV presence checks and filesystem-safe keyword CSV filenames.
- Updated page-level Naver CSV copy/download handlers to use the shared helpers while keeping clipboard/download browser APIs explicit.
- Rebuilt `src/lib/product-registration/deliverability-gate.ts` and its tests with parse-safe English blocker messages after the untracked files were found to contain broken string/regex literals.

Why this matters:

- Operators no longer see an old readiness success message while a new readiness check is running.
- Naver keyword CSV downloads use predictable, sanitized filenames even when campaign names contain path-invalid characters.
- Full repo type-check and build are no longer blocked by the malformed deliverability gate files.

Verification:

- Targeted ESLint passed for the Ad OS page, `_components`, `_lib`, `/api/admin/ad-os/summary`, and the restored deliverability gate files.
- `npm run type-check` passed.
- Ad OS `_lib` plus launch/action-bar/section-panel and deliverability-gate tests passed: 17 files, 57 tests.
- `npm run build` passed.
- `git diff --check` passed with existing CRLF normalization warnings only.
- Production-start HTTP smoke passed on port 3062: `/api/v1/health` 200, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307, and `/_next/static/chunks/main-app.js` 200.
- In-app browser smoke passed on port 3062: `/admin/ad-os` redirected to `/login?redirect=%2Fadmin%2Fad-os`, showed login text, and reported no console errors.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Authenticated button-level behavior still needs a real admin session for full interactive parity checks.

## Forty-Sixth Pass - Initial Readiness Loader And Itinerary Normalizer Recovery

Date: 2026-06-05

This pass extracted the Ad OS initial readiness panel loading path and repaired a product itinerary normalizer syntax break that full type-check surfaced.

Implemented:

- Added `_lib/initial-readiness-loader.ts` to load staging smoke, operating inventory, staging validation, and admin surface QA panels through a testable helper.
- Preserved the existing partial-success behavior: fulfilled readiness panels are applied before the first rejected panel is surfaced in fixed dashboard order.
- Preserved unmount safety through a `shouldApply` guard so stale async loads do not write state or surface errors after page teardown.
- Replaced the inline page-level `Promise.allSettled()` readiness block with the shared loader.
- Repaired `src/lib/itinerary-normalizer.ts` after meal normalization helpers were found nested inside `normalizeRegions()`.
- Expanded itinerary normalizer tests for string meal slots, preserved meal notes, total meal recounting, and meta flight hint application.

Why this matters:

- The Ad OS page is closer to a thin orchestration shell and the initial readiness error contract is now covered by focused tests.
- Product upload/display normalization is no longer blocked by a syntax error.
- Meal and flight-hint normalization behavior now has regression coverage instead of relying on accidental type-check coverage.

Verification:

- `npm run type-check` passed.
- Initial readiness loader tests passed: 1 file, 4 tests.
- Itinerary normalizer tests passed: 1 file, 6 tests.
- Focused Ad OS/product-registration test slice passed: 19 files, 67 tests.
- Targeted ESLint passed for the Ad OS page, `_components`, `_lib`, `/api/admin/ad-os/summary`, deliverability gate, and itinerary normalizer files.
- `git diff --check` passed with existing CRLF normalization warnings only.
- `npm run build` passed.
- Production-start HTTP smoke passed on port 3065: `/api/v1/health` 200 on three retries, `/login?redirect=%2Fadmin` 200, `/admin/ad-os` 307, and `/_next/static/chunks/main-app.js` 200.
- In-app browser smoke passed on port 3066: `/admin/ad-os` redirected to `/login?redirect=%2Fadmin%2Fad-os`, showed login text, and reported no console errors.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- Authenticated button-level behavior still needs a real admin session for full interactive parity checks.

## Forty-Seventh Pass - Customer Package Price Option Safety

Date: 2026-06-05

This pass fixed a customer package detail pricing leak risk found during the continuation audit.

Implemented:

- Changed `/packages/[id]` product price option enrichment to select `adult_selling_price` instead of internal `net_price` from `product_prices`.
- Added `customer-package-price-options` helper to keep selected-date option display logic out of the large detail component.
- Updated `DetailClient` so option rows render as a compact customer-facing option price list using selling prices only.
- Added regression tests that verify option sorting/filtering and statically prevent the customer package page from selecting `product_prices.net_price` again.

Why this matters:

- Customer public pages must not expose internal margin/cost fields.
- The page already documented that `net_price`/margin data is not allowed on the customer surface; the query now matches that contract.
- The UI no longer has malformed JSX around the selected departure date price block.

Verification:

- `npm run type-check` passed.
- Targeted ESLint passed for `/packages/[id]`, `DetailClient`, and the new helper/tests.
- Customer price option tests passed: 1 file, 3 tests.
- Focused Ad OS/customer/product-registration test slice passed: 20 files, 70 tests.
- `npm run audit:pii-surface` and `npm run audit:pii-surface:strict` passed with `strict_blockers=0` (existing discovery findings remain).
- `npm run build` passed.
- `git diff --check` passed with existing CRLF normalization warnings only.
- Production-start HTTP smoke passed on port 3067: `/api/v1/health` 200, `/packages/d5a1c083-9d30-4e89-80e1-7b2281d7db4a` 200, `/admin/ad-os` 307, and `/_next/static/chunks/main-app.js` 200.
- In-app browser smoke passed on port 3067: package detail rendered body text and KRW pricing, reported no internal `net_price`/margin text, and had no console errors.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- PII audit still reports existing discovery findings, but strict blockers are 0.

## Fiftieth Pass - Concierge Public Cost Boundary

Date: 2026-06-05

This pass removed internal cost and margin data from public concierge search/cart payloads and made checkout pricing server-authoritative.

Implemented:

- Added `concierge-public-payload` sanitizer for customer-facing concierge items.
- Removed item-level `cost`, `cost_price`, `net_price`, `margin`, `margin_rate`, and `selling_price` from concierge public payloads.
- Removed the same internal cost/margin keys from item `attrs`.
- Routed `/api/concierge/search` results through the sanitizer before responding.
- Routed `/api/concierge/cart` reads/writes through the sanitizer so stored public cart items no longer depend on client-visible cost.
- Removed the public concierge UI line-through cost display.
- Updated shared itinerary item normalization and fixed-date cart creation to omit cost from public items.
- Added mock product server-pricing resolution and changed checkout to rebuild cost/price server-side before transaction and order creation.
- Added regression tests for sanitizer behavior, search/cart route usage, and checkout server-authoritative pricing.

Why this matters:

- `/api/concierge/search` is called by public concierge and shared itinerary pages, so exposing `cost` and `attrs.margin` leaked internal economics.
- The old checkout path trusted client-provided cart cost, which could corrupt transaction cost and tenant settlement data.
- Customer-visible cart data now carries selling price only; internal cost is reconstructed at checkout.

Verification:

- Concierge public payload tests passed: 1 file, 4 tests.
- Customer/concierge payload safety slice passed: 4 files, 18 tests.
- Targeted ESLint passed for concierge search/cart/checkout, public sanitizer, public pages, and mock pricing helper.
- `npm run type-check` passed.
- `npm run audit:pii-surface:strict` passed with `strict_blockers=0` (existing discovery findings remain).
- `npm run build` passed; postbuild shim ran successfully.
- Production-start HTTP smoke passed on port 3071: `/api/v1/health` 200, `/concierge` 200, and `/_next/static/chunks/main-app.js` 200.
- Concierge search API smoke on port 3071 returned a Gemini billing error due depleted credits, but the error payload contained no internal cost or margin strings.
- In-app browser smoke passed on port 3071: `/concierge` rendered body text, reported no internal cost/margin text, and had no console errors.

Remaining caveats:

- Gemini search is currently blocked by external billing/prepayment credits, so a successful live search result payload could not be exercised in production-start smoke.
- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- PII audit still reports existing discovery findings, but strict blockers are 0.

## Fifty-First Pass - Internal Finance API Admin Guard

Date: 2026-06-05

This pass added explicit admin protection to internal finance, tax, settlement, and margin endpoints.

Implemented:

- Added `requireAdminRequest()` to `/api/margin` GET and POST.
- Added `requireAdminRequest()` to `/api/tax` and `/api/tax/export`.
- Added `requireAdminRequest()` to `/api/tenant/settlements`.
- Added `requireAdminRequest()` to `/api/bookings/unsettled`.
- Added `requireAdminRequest()` to `/api/payments/settlements`.
- Added `internal-admin-api-guard` regression tests so these routes cannot silently lose the guard.

Why this matters:

- These routes expose or mutate margin settings, booking cost, tax exports, tenant settlement cost, and land settlement payment details.
- They are called from admin screens, but the route handlers themselves previously did not prove admin authorization before reading internal finance data.
- The protection is route-level and test-backed, so accidental public access is less likely to return sensitive finance payloads.

Verification:

- Internal admin API guard tests passed: 1 file, 6 tests.
- Finance/internal payload safety slice passed: 4 files, 18 tests.
- Targeted ESLint passed for the guarded routes and regression test.
- `npm run type-check` passed.
- `npm run audit:pii-surface:strict` passed with `strict_blockers=0` (existing discovery findings remain).
- `npm run build` passed; postbuild shim ran successfully.
- Production-start HTTP smoke passed on port 3072: `/api/v1/health` 200 and `/_next/static/chunks/main-app.js` 200.
- Unauthenticated internal API smoke on port 3072 confirmed all guarded routes redirect to `/login`: `/api/margin`, `/api/tax`, `/api/tax/export`, `/api/tenant/settlements`, `/api/bookings/unsettled`, and `/api/payments/settlements`.
- In-app browser smoke passed on port 3072: `/admin/tax` redirected to `/login?redirect=%2Fadmin%2Ftax`, reported no internal finance text, and had no console errors.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- PII audit still reports existing discovery findings, but strict blockers are 0.

## Fifty-Second Pass - Payment Operations API Admin Guard

Date: 2026-06-05

This pass extended the internal finance API guard to payment matching, bank transaction, and settlement operation routes.

Implemented:

- Added `requireAdminRequest()` to `/api/bank-transactions` GET, PUT, PATCH, and POST.
- Added `requireAdminRequest()` to `/api/payments/auto-suggest`.
- Added `requireAdminRequest()` to `/api/payments/export`.
- Added `requireAdminRequest()` to `/api/payments/match-confirm`.
- Added `requireAdminRequest()` to `/api/payments/match-intent`.
- Added `requireAdminRequest()` to `/api/payments/operator-alias`.
- Added `requireAdminRequest()` to `/api/payments/settlement-bundle`.
- Added `requireAdminRequest()` to `/api/payments/settlement-confirm`.
- Added `requireAdminRequest()` to `/api/payments/settlement-reverse`.
- Expanded `internal-admin-api-guard` regression coverage from 6 guarded routes to 15 guarded routes.

Why this matters:

- `/api/bank-transactions` exposes raw bank transaction data and mutates booking payment ledger state.
- `/api/payments/auto-suggest` reads bank transactions, booking payment/cost fields, customer names, and settlement candidates.
- `/api/payments/export` returns CSV settlement data with operators, counterparties, booking numbers, customer names, and settlement amounts.
- `/api/payments/match-confirm` performs one-click payment match confirmation and writes audit logs.
- `/api/payments/match-intent` resolves payment command input into booking, customer, and land operator candidates.
- `/api/payments/operator-alias` mutates land operator matching aliases and writes command logs.
- `/api/payments/settlement-bundle` creates land settlement bundles through an atomic RPC.
- `/api/payments/settlement-confirm` confirms settlement close state.
- `/api/payments/settlement-reverse` reverses land settlement state through an atomic RPC and sends best-effort Slack alerts.
- These operations are admin workflow actions, so the API handlers now enforce the same route-level admin boundary as the finance/tax/settlement endpoints.

Verification:

- Internal admin API guard tests passed: 1 file, 15 tests.
- Targeted ESLint passed for bank transaction, payment auto-suggest, payment export, payment match-confirm, payment match-intent, operator alias, settlement bundle, settlement confirm, settlement reverse, and regression test files.
- `npm run type-check` passed.
- `npm run audit:pii-surface:strict` passed with `strict_blockers=0` (existing discovery findings remain).
- `npm run build` passed; postbuild shim ran successfully.
- Production-start HTTP smoke passed on port 3075: `/api/v1/health` 200 and `/_next/static/chunks/main-app.js` 200.
- Unauthenticated payment operations API smoke on port 3075 confirmed all guarded routes redirect to `/login`: `/api/bank-transactions`, `/api/payments/auto-suggest`, `/api/payments/export`, `/api/payments/match-confirm`, `/api/payments/match-intent`, `/api/payments/operator-alias`, `/api/payments/settlement-bundle`, `/api/payments/settlement-confirm`, and `/api/payments/settlement-reverse`.

Remaining caveats:

- Middleware may also redirect unauthenticated requests, but route-level admin checks are still required as the durable API boundary.
- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- PII audit still reports existing discovery findings, but strict blockers are 0.

## Fifty-Third Pass - Booking And Customer Operations API Admin Guard

Date: 2026-06-05

This pass extended the admin API guard to booking and customer operations routes while leaving booking creation and phone duplicate-check route branches unchanged.

Implemented:

- Replaced authenticated-only guards with `requireAdminRequest()` for `/api/bookings` GET and PATCH.
- Added `requireAdminRequest()` to `/api/bookings/[id]` GET and PATCH.
- Added `requireAdminRequest()` to `/api/customers` PATCH and DELETE.
- Added `requireAdminRequest()` to `/api/customers/[id]/notes` GET, POST, and DELETE.
- Added `requireAdminRequest()` to `/api/customers/[id]/mileage-history` GET and POST.
- Expanded `internal-admin-api-guard` regression coverage from 15 guarded routes to 20 guarded routes.

Why this matters:

- Booking GET/PATCH responses expose or mutate booking status, paid amount, total cost, customer joins, settlement fields, and operational workflow flags.
- `/api/bookings/[id]` uses `supabaseAdmin` service-role access and returns or updates joined booking/customer data.
- Customer PATCH/DELETE can edit PII, passport fields, CRM tags, mileage, customer status, and soft-delete state.
- Customer notes and manual mileage adjustments are admin CRM actions and should not be reachable through unauthenticated route calls.
- Booking POST and customer phone duplicate lookup were not changed in this pass because they are distinct route branches from the protected admin operations.

Verification:

- Internal admin API guard tests passed: 1 file, 20 tests.
- Targeted ESLint passed for booking routes, customer routes, and the regression test.
- `npm run type-check` passed.
- `npm run audit:pii-surface:strict` passed with `strict_blockers=0` (existing discovery findings remain).
- `npm run build` passed after stopping stale local Next dev/start processes; postbuild shim ran successfully.
- Production-start HTTP smoke passed on port 3076: `/api/v1/health` 200 and `/_next/static/chunks/main-app.js` 200.
- Unauthenticated booking/customer operations API smoke on port 3076 confirmed all guarded routes redirect to `/login`: `/api/bookings` GET/PATCH, `/api/bookings/[id]` GET/PATCH, `/api/customers` PATCH/DELETE, `/api/customers/[id]/notes` GET/POST, and `/api/customers/[id]/mileage-history` GET/POST.
- Current local middleware also redirected direct unauthenticated calls to `/api/bookings` POST and `/api/customers?phone=...` before the route handler; those branches were intentionally not modified by this pass.

Remaining caveats:

- `/api/bookings` POST and `/api/customers?phone=` were not given route-level admin guards in this pass; current middleware still redirects direct unauthenticated calls in local production smoke.
- Middleware may also redirect unauthenticated requests, but route-level admin checks are still required as the durable API boundary.

## Fifty-Fourth Pass - Booking Subroute Operations API Admin Guard

Date: 2026-06-05

This pass extended the booking/customer operations guard to booking subroutes that mutate status, cancellation, restoration, timeline logs, and companion invite tokens.

Implemented:

- Added `requireAdminRequest()` to `/api/bookings/[id]/cancel`.
- Added `requireAdminRequest()` to `/api/bookings/[id]/restore`.
- Added `requireAdminRequest()` to `/api/bookings/[id]/transition`.
- Added `requireAdminRequest()` to `/api/bookings/[id]/timeline` GET and POST.
- Added `requireAdminRequest()` to `/api/bookings/[id]/companions/invite`.
- Expanded `internal-admin-api-guard` regression coverage from 20 guarded routes to 25 guarded routes.

Why this matters:

- Cancellation and restoration mutate booking status, refund/penalty fields, settlement state, message logs, audit logs, and booking task state.
- Status transition updates booking state and can send customer notifications and admin push events.
- Timeline GET/POST exposes and writes booking communication logs.
- Companion invite creation generates join tokens tied to a booking.
- These routes are called from admin booking views and mobile admin actions, so the route handlers now enforce admin authorization directly.

Verification:

- Internal admin API guard tests passed: 1 file, 25 tests.
- Targeted ESLint passed for booking subroutes and the regression test.
- `npm run type-check` passed.
- `npm run audit:pii-surface:strict` passed with `strict_blockers=0` (existing discovery findings remain).
- `npm run build` passed; postbuild shim ran successfully.
- Production-start HTTP smoke passed on port 3077: `/api/v1/health` 200 and `/_next/static/chunks/main-app.js` 200.
- Unauthenticated booking subroute API smoke on port 3077 confirmed all guarded routes redirect to `/login`: `/api/bookings/[id]/cancel`, `/api/bookings/[id]/restore`, `/api/bookings/[id]/transition`, `/api/bookings/[id]/timeline` GET/POST, and `/api/bookings/[id]/companions/invite`.

Remaining caveats:

- Middleware may also redirect unauthenticated requests, but route-level admin checks are still required as the durable API boundary.

## Fifty-Fifth Pass - Unmatched Attractions Admin API Guard

Date: 2026-06-06

This pass hardened the unmatched-attractions management API without changing the public customer beacon that reports unmatched activity labels.

Implemented:

- Added `requireAdminRequest()` to `/api/unmatched` GET.
- Added `requireAdminRequest()` to `/api/unmatched` PATCH.
- Added `requireAdminRequest()` to `/api/unmatched/suggest` GET.
- Left `/api/unmatched` POST unchanged because it is the public collection beacon used by customer package pages.
- Expanded `internal-admin-api-guard` regression coverage from 25 guarded routes to 27 guarded routes.
- Renamed the regression test suite from finance-only language to the broader internal API guard scope.

Why this matters:

- `/api/unmatched` GET exposes unmatched activity records, operational summaries, and bootstrap candidates used by the admin attractions workflow.
- `/api/unmatched` PATCH mutates unmatched status, links aliases, triggers resweeps/re-enrichment, and can create admin-approved attraction records only through the existing guarded reconciliation policy.
- `/api/unmatched/suggest` reads unmatched activities and attraction candidates and can call external suggestion sources for admin review.
- The attractions runbook rule remains intact: no automatic seeding, no new seed script, and no bypass around the existing admin-managed matching pipeline.

Verification:

- Internal admin API guard tests passed: 1 file, 27 tests.
- Targeted ESLint passed for `/api/unmatched`, `/api/unmatched/suggest`, and the regression test.
- `npm run type-check` passed.
- `npm run audit:pii-surface:strict` passed with `strict_blockers=0` (existing discovery findings remain).
- `git diff --check` for the touched files reported only CRLF normalization warnings.

Deferred follow-up:

- Full `npm run build` could not be completed in this local Windows workspace because Next/SWC repeatedly failed to load `@next/swc-win32-x64-msvc` with `not a valid Win32 application`, then stalled during `Creating an optimized production build`.
- `npm rebuild @next/swc-win32-x64-msvc` completed successfully but did not resolve the SWC load failure.
- Next/SWC package versions are aligned at `15.5.18`; the local Node runtime reported `win32 x64 node v24.14.0`.
- Before merge to production, rerun the full build in a clean Node LTS environment or CI runner and then run production-start HTTP smoke for `/api/unmatched` GET/PATCH and `/api/unmatched/suggest` GET.

## Forty-Ninth Pass - Public Packages API Payload Boundary

Date: 2026-06-05

This pass hardened the mixed `/api/packages` response path so public calls no longer receive internal package metadata.

Implemented:

- Added an admin-aware response branch in `/api/packages` GET.
- Preserved the existing admin payload when `isAdminRequest()` succeeds.
- Routed non-admin detail and list responses through the shared customer package sanitizer.
- Expanded the sanitizer to strip supplier source hashes, audit reports, embeddings, tenant/creator metadata, parsed/internal files, margin/cost fields, commission fields, and operational review metadata.
- Added regression tests for nested product arrays and public API sanitizer usage.
- Updated the existing supplier-remark safety test to assert the new public sanitizer boundary.

Why this matters:

- `/api/packages` is used by admin screens and public/customer surfaces, so a role-aware boundary is safer than removing fields globally.
- Public package detail and list responses now hide internal cost, margin, raw source, audit, and operational metadata even when the DB select remains broad for admin compatibility.
- The customer detail page and the fallback API path now share the same payload-cleaning contract.

Verification:

- Customer payload and content-brief safety tests passed: 2 files, 11 tests.
- Targeted ESLint passed for `/api/packages`, the customer payload sanitizer, and related tests.
- `npm run type-check` passed.
- `npm run audit:pii-surface:strict` passed with `strict_blockers=0` after the final sanitizer expansion (existing discovery findings remain).
- `npm run build` passed after the final sanitizer expansion; postbuild shim ran successfully.
- Production-start HTTP smoke passed on port 3070: `/api/v1/health` 200, `/packages/d5a1c083-9d30-4e89-80e1-7b2281d7db4a` 200, `/api/packages?id=d5a1c083-9d30-4e89-80e1-7b2281d7db4a` 200, `/api/packages?limit=1` 200, `/admin/ad-os` 307, and `/_next/static/chunks/main-app.js` 200.
- Public API payload smoke passed on port 3070: package detail and list responses contained no internal `raw_text`, cost, margin, audit, commission, tenant, embedding, or source-hash field strings.
- In-app browser smoke passed on port 3070: package detail rendered body text and KRW pricing, reported no internal field text, and had no console errors.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- PII audit still reports existing discovery findings, but strict blockers are 0.

## Forty-Eighth Pass - Customer Package Payload Boundary

Date: 2026-06-05

This pass hardened the customer package detail server/client boundary after the price option safety fix.

Implemented:

- Added `customer-package-payload` sanitizer to remove top-level internal package fields before props reach the client component.
- Sanitized nested `product_prices` rows down to customer-safe fields only: `target_date`, `adult_selling_price`, and `note`.
- Sanitized nested product cost/margin fields while preserving display fields still used by the inquiry/contact flow.
- Replaced the inline `raw_text` destructuring in `/packages/[id]` with the shared sanitizer so the contract is testable.
- Added regression tests for top-level field removal, nested price row stripping, nested product stripping, and page-level sanitizer usage.

Why this matters:

- The page can still use supplier raw text server-side for enrichment, but that data now has a named boundary before rendering.
- Future edits are less likely to accidentally pass internal package, price, or margin fields into the client payload.
- The prior price-option fix now has a broader payload-level guard around it.

Verification:

- `npm run type-check` passed.
- Customer payload and price option tests passed: 2 files, 6 tests.
- Focused customer/product-registration/Ad OS test slice passed: 21 files, 73 tests.
- Targeted ESLint passed for `/packages/[id]`, `DetailClient`, and the new helper/tests.
- `npm run audit:pii-surface:strict` passed with `strict_blockers=0` (existing discovery findings remain).
- `npm run build` passed.
- `git diff --check` passed with existing CRLF normalization warnings only.
- Production-start HTTP smoke passed on port 3068: `/api/v1/health` 200, `/packages/d5a1c083-9d30-4e89-80e1-7b2281d7db4a` 200, `/admin/ad-os` 307, and `/_next/static/chunks/main-app.js` 200.
- In-app browser smoke passed on port 3068: package detail rendered body text and KRW pricing, reported no internal `net_price`/`raw_text`/margin text, and had no console errors.

Remaining caveats:

- Build still prints the existing Windows/non-ASCII path SWC native-load warning.
- Build still prints the existing Edge runtime/static-generation warning for intentionally Edge-rendered image routes.
- PII audit still reports existing discovery findings, but strict blockers are 0.
