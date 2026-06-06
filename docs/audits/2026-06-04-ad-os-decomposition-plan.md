# Ad OS Admin Decomposition Plan

Date: 2026-06-04
Scope: `src/app/admin/ad-os/page.tsx`

## Current State

- The page is 4,648 lines in a single client component.
- Types, fetch helpers, display helpers, state, mutation handlers, and UI panels are colocated in `page.tsx`.
- API and service boundaries are already more modular than the page layer: `src/app/api/admin/ad-os/**` and `src/lib/ad-os-*` contain the domain work.
- The highest-risk area is not API behavior. It is UI maintainability and operator confidence when changing a dense live-operations console.

## Guardrails

- Do not change spend, revenue, ROAS, CPA, margin, or finance formulas during decomposition.
- Do not change API endpoints, request payloads, or response shape in the same pass as UI extraction.
- Extract read-only presentational pieces first.
- Keep mutation-heavy handlers in `page.tsx` until their target panels are isolated and visually verified.
- Keep external-write safety labels visible: dry-run, blocked, live write count, approval state, and next action.
- Browser-check `/admin/ad-os` after each large extraction batch.

## Proposed Target Structure

```text
src/app/admin/ad-os/
  page.tsx
  _components/
    StatusPill.tsx
    OpsQueueList.tsx
    ReadinessAuditPanel.tsx
    RuntimeReadinessPanel.tsx
    LaunchActionQueuePanel.tsx
    LaunchWizardPanel.tsx
    EnterpriseRuntimeActionBar.tsx
    EnterpriseOpsQueuePanel.tsx
    BudgetGuardrailPanel.tsx
    BudgetGuardrailTable.tsx
    BudgetOperationActionBar.tsx
    TenantReportSummaryPanel.tsx
    LaunchAuditResultPanel.tsx
    OpsPlanResultPanel.tsx
    KeywordBrainResultPanel.tsx
    NaverAssetPlanPanel.tsx
    LearningLoopPanel.tsx
    MappingStatusDistributionPanel.tsx
    LearningSignalsPanel.tsx
    ProductScenariosPanel.tsx
    LandingEvolutionPanel.tsx
    ChangeRequestsPanel.tsx
    MappingSamplesPanel.tsx
    KeywordPlansPanel.tsx
    RecentDecisionsPanel.tsx
  _lib/
    display.ts
    fetchers.ts
    tones.ts
    types.ts
```

This structure intentionally stays page-local. Once the contracts stabilize, reusable view models can move into `src/lib`.

## Batch Plan

### Batch 1 - Pure Helpers

- Move `Summary` and related UI response types into `_lib/types.ts`.
- Move `fmtWon`, `pct`, `queueTone`, `readinessTone`, `auditTone`, `inventoryTone`, and `actionTone` into `_lib/display.ts` / `_lib/tones.ts`.
- Move fetch helpers into `_lib/fetchers.ts`.
- Add focused tests for tone and formatting helpers.

Expected result: `page.tsx` loses low-risk scaffolding without changing visible UI.

Status 2026-06-04: completed. `page.tsx` dropped from 4,648 to 4,065 lines. Added `_lib/types.ts`, `_lib/display.ts`, `_lib/fetchers.ts`, plus focused tests for display and fetcher contracts.

### Batch 2 - Queue Primitive

- Extract `StatusPill`.
- Extract `OpsQueueList`.
- Keep its action callback contract unchanged.
- Add a minimal render/behavior test if the existing test stack supports it cheaply; otherwise rely on type-check plus browser check.

Expected result: repeated queue rendering can be reused by executor, confirmation, and blocked queues.

Status 2026-06-04: completed. Added `_components/StatusPill.tsx` and `_components/OpsQueueList.tsx`, preserving the same queue action callback contract. Added server-render tests for tone rendering, empty state, queue metadata, and gated action buttons. `page.tsx` is now 3,968 lines.

### Batch 3 - Read-Only Panels

- Extract readiness/audit panels that only receive `summary`, `stagingSmoke`, `operatingInventory`, `stagingValidation`, or `adminSurfaceQa`.
- Keep all fetch timing and state ownership in `page.tsx`.
- Preserve card order and empty states.

Expected result: `page.tsx` should drop below roughly 3,000 lines.

Recommended first target: extract the four safety/readiness cards in the staging/completion area only after an authenticated visual check is available, because those panels mix read-only evidence, safety labels, JSON links, and manual refresh buttons.

Status 2026-06-04: started. Added `_components/MetricGrid.tsx` and replaced repeated metric grids in Staging Smoke, Admin Surface QA, Staging Validation, and Operating Inventory panels. This keeps panel ownership and refresh handlers in `page.tsx` while reducing duplicated read-only rendering. `page.tsx` is now 3,892 lines.

Status 2026-06-04 update: continued. Added `_components/SafetyEvidenceList.tsx` and replaced repeated completion, Admin Surface QA, Staging Validation, and Operating Inventory evidence rows. Refresh handlers, JSON links, safety labels, and response ownership remain in `page.tsx`. `page.tsx` is now 3,860 lines.

Status 2026-06-04 update 2: continued. Added `_components/AdminSurfaceQaPanel.tsx` as the first full read-only panel extraction after the metric/evidence primitives. The panel receives `adminSurfaceQa`, refresh loading state, and the refresh callback as props; fetch timing and state ownership stay in `page.tsx`. `page.tsx` is now 3,808 lines.

Status 2026-06-05: continued. Added `_components/StagingValidationPanel.tsx` and `_components/OperatingInventoryPanel.tsx`, following the same prop-driven read-only extraction pattern. Both panels keep refresh callbacks and loading state passed in from `page.tsx`; fetch timing, response state ownership, and mutation behavior remain unchanged. `page.tsx` is now 3,720 lines.

Status 2026-06-05 update: continued. Added `_components/CompletionAuditPanel.tsx`, extracting the Completion Audit card and nested Staging Smoke evidence into a prop-driven read-only panel. The staging smoke refresh callback/loading state and completion evidence are passed in from `page.tsx`; fetch timing, response state ownership, and mutation behavior remain unchanged. `page.tsx` is now 3,652 lines.

### Batch 4 - Controlled Mutation Panels

- Extract panels with buttons only after their read-only shell is isolated.
- Pass current handlers and loading ids as props.
- Do not move mutation logic into child components during the first extraction.

Expected result: UI sections become testable without changing side-effect behavior.

Status 2026-06-05: started. Added `_components/LaunchActionQueuePanel.tsx`, extracting the Today queue action cards and optional Naver setup packet/CSV controls. All action handlers, loading maps, and CSV callbacks are still owned by `page.tsx` and passed through as props. `page.tsx` is now 3,528 lines.

Status 2026-06-05 update: continued. Added `_components/LaunchWizardPanel.tsx`, extracting the launch checklist, four-step start flow, pilot setup button, launch audit button, and platform readiness summaries. Pilot setup and launch audit handlers, loading booleans, and external launch status state remain owned by `page.tsx` and are passed through as props. `page.tsx` is now 3,446 lines.

Status 2026-06-05 update 2: continued. Added `_components/EnterpriseRuntimeActionBar.tsx` and `_components/EnterpriseOpsQueuePanel.tsx`, extracting the Enterprise Runtime action toolbar and operations queues. Runtime/adapter/portfolio/audit handlers, loading booleans, queue loading id, and queue action handler remain owned by `page.tsx` and are passed through as props. `page.tsx` is now 3,376 lines.

Status 2026-06-05 update 3: continued. Added `_components/BudgetGuardrailTable.tsx` and `_components/BudgetOperationActionBar.tsx`, extracting the channel budget draft table and large budget operation button group. Budget draft state, save/update handlers, launch/audit/learning/publisher action handlers, and all loading booleans remain owned by `page.tsx` and are passed through as props. `page.tsx` is now 3,228 lines.

Status 2026-06-05 update 4: continued. Added `_components/TenantReportSummaryPanel.tsx` and `_components/LaunchAuditResultPanel.tsx`, extracting generated tenant report and launch audit result panels below the budget operation controls. Tenant report state, launch audit state, loading booleans, and all execution handlers remain owned by `page.tsx`; extracted panels receive already-loaded result data as props. `page.tsx` is now 3,165 lines.

Status 2026-06-05 update 5: continued. Added `_components/OpsPlanResultPanel.tsx`, `_components/KeywordBrainResultPanel.tsx`, and `_components/NaverAssetPlanPanel.tsx`, extracting the remaining generated result panels in the budget operation section. Ops plan, keyword brain, and Naver asset response state remain owned by `page.tsx`; extracted panels derive display-only metrics from the loaded result objects. `page.tsx` is now 3,067 lines.

Status 2026-06-05 update 6: continued. Added `_components/LearningLoopPanel.tsx`, `_components/MappingStatusDistributionPanel.tsx`, `_components/LearningSignalsPanel.tsx`, `_components/ProductScenariosPanel.tsx`, `_components/LandingEvolutionPanel.tsx`, and `_components/ChangeRequestsPanel.tsx`, extracting the learning loop summary, mapping status distribution, and first sample insight cards. Change request update handlers and loading id remain owned by `page.tsx` and are passed through. `page.tsx` is now 2,475 lines.

Status 2026-06-05 update 7: continued. Added `_components/MappingSamplesPanel.tsx`, `_components/KeywordPlansPanel.tsx`, and `_components/RecentDecisionsPanel.tsx`, extracting the remaining lower sample cards. Keyword plan update handlers and loading id remain owned by `page.tsx` and are passed through. `page.tsx` is now 2,392 lines.

Status 2026-06-05 update 8: validation repaired. Removed the duplicate Pages Router `src/pages/404.tsx` so App Router `src/app/not-found.tsx` owns 404 handling, and gated Vercel Speed Insights to Vercel runtime only. A clean production build now completes, and production-start browser verification confirms `/login`, `/admin`, and `/admin/ad-os` load/redirect correctly with no console errors in an unauthenticated session.

Status 2026-06-05 update 9: Batch 5 started. Added `_lib/action-flags.ts` to consolidate Ad OS action/loading booleans behind one local hook while preserving existing handler behavior and safety gates. Added a focused action-flag initialization test. `page.tsx` is now 2,346 lines. Added `scripts/ensure-next-routes-js-shim.cjs` to make standard clean builds resilient to the Next 15 generated `validator.ts` import of `./routes.js`.

Status 2026-06-05 update 10: continued. Added `_lib/view-model.ts` and `_lib/view-model.test.ts` for the remaining page-level read-model helpers used by the execution-state cards and mapping distribution. Removed stale launch/readiness/action-map calculations that were left in `page.tsx` after earlier component extraction. `page.tsx` is now 2,155 lines. During full validation, `npm run type-check` also surfaced an existing upload API mismatch where V3 normalized optional tours could return `price`, `price_usd`, or `price_krw` as `null`; `src/app/api/upload/route.ts` now adapts those values to the parser-side optional-tour shape before assignment.

Status 2026-06-05 update 11: panel reconnection and runtime repair completed. Reconnected the extracted Ad OS launch, audit, staging, inventory, budget, tenant-report, generated-result, enterprise runtime, and ops queue panels in `page.tsx` instead of leaving them as unused extracted code. Expanded `_lib/view-model.ts` with launch checklist, launch wizard, completion drilldown, and tenant report helpers plus focused tests. `page.tsx` is now about 2,451 lines because the extracted panels are intentionally rendered again. Full validation also repaired product-registration/upload type adapters, restored production runtime startup by gating instrumentation imports to configured Sentry/OTel environments, and expanded `scripts/ensure-next-main-app-js-shim.cjs` so build/start guarantees the `main-app.js` shim and server chunk aliases on this Windows/non-ASCII path environment. `npm run type-check`, `npm run build`, production-start HTTP checks, and Playwright login-page rendering now pass.

Status 2026-06-05 update 12: Edge runtime warning cleanup completed. Replaced the Node `crypto` dependency in `src/lib/timing-safe.ts` with an Edge-compatible byte comparison helper and added focused coverage in `src/lib/timing-safe.test.ts`. The previous build warning that traced through `src/lib/api-auth.ts` is gone. A fresh production build completed, and post-build production-start checks confirmed `/api/v1/health`, `/login?redirect=%2Fadmin`, `/admin/ad-os`, and `/_next/static/chunks/main-app.js` respond correctly.

### Batch 5 - State Reducer Review

- After section extraction, group related loading booleans into reducer-backed state.
- Only do this after browser parity is established, because this is the first phase that can affect interaction behavior.

Expected result: `page.tsx` becomes an orchestration shell instead of a state-variable ledger.

Status 2026-06-05 update 13: Batch 5 continued. Added `_lib/result-state.ts` and `_lib/result-state.test.ts` to group Ad OS generated-result/readiness payload state behind a reducer-backed hook. The page now uses `useAdOsResultState()` for automation message, launch audit, Naver setup packet, tenant report, ops plan, keyword brain, Naver asset plan, staging smoke, operating inventory, staging validation, and admin surface QA payloads. Existing action handlers, API payloads, KPI calculations, and external-write guardrails were not changed. Focused reducer/view-model/action-flag tests, targeted ESLint, `npm run type-check`, clean `npm run build`, `.next` JSON manifest parsing, and production-start HTTP checks passed.

Status 2026-06-05 update 14: Batch 5 continued. Added `_lib/active-action-ids.ts` and `_lib/active-action-ids.test.ts` to group row-level loading ids for keyword plans, change requests, and ops queue actions. `page.tsx` now uses `useActiveActionIds()` instead of three independent action-id `useState` calls. Existing row action callbacks and API payloads remain unchanged. Focused Ad OS reducer/view-model/action-flag tests and targeted ESLint passed; `npm run type-check` had passed immediately before this final narrow cleanup.

Status 2026-06-05 update 15: Batch 5 continued. Added `_lib/page-state.ts` and `_lib/page-state.test.ts` to group summary, loading, error, budget draft, and tenant policy draft state behind `useAdOsPageState()`. Budget numeric normalization, tenant policy numeric normalization, and allowed-platform toggling moved into the reducer with focused tests. `page.tsx` no longer owns direct `useState` cells and is now 2,415 lines. Existing fetches, save handlers, KPI calculations, and external-write guardrails remain unchanged. Focused Ad OS state/view-model/action tests, targeted ESLint, `npm run type-check`, `npm run build`, `.next` JSON manifest parsing, and production-start HTTP checks passed.

Status 2026-06-05 update 16: Batch 5 continued. Added `_lib/action-runner.ts` and `_lib/action-runner.test.ts` to consolidate the repeated JSON action flow used by simple buttons. Replaced 12 simple handlers with `useAdOsJsonActionRunner()` while preserving URLs, payloads, fallback error messages, refresh behavior, and result-state updates. More complex actions with custom summaries, confirmation dialogs, or safety copy remain explicit. `page.tsx` is now 2,284 lines. Focused Ad OS action/state/view-model tests, targeted ESLint, `npm run type-check`, `npm run build`, `.next` JSON manifest parsing, and production-start HTTP checks passed. The production build also surfaced a missing upload-route import for `canUseSupplierRawDeterministicPreflight`, which was restored without changing upload behavior.

Status 2026-06-05 update 17: Batch 5 continued. Added `_lib/action-messages.ts` and `_lib/action-messages.test.ts` to extract three repeated success-message builders from the remaining complex handlers. Guarded apply, pilot setup, and publish-draft message text, number formatting, API payloads, refresh behavior, and safety copy remain unchanged. `page.tsx` is now 2,180 lines. Focused Ad OS action/state/view-model tests, targeted ESLint, `npm run type-check`, `npm run build`, `.next` JSON manifest parsing, and production-start HTTP checks passed.

Status 2026-06-05 update 18: Batch 5 continued. Extended `_lib/action-runner.ts` so shared JSON actions can derive success messages from parsed API responses, then moved guarded apply, pilot setup, and publish drafts onto the shared runner. Added fallback handling for non-JSON, empty, or non-object JSON API responses so existing button-specific fallback errors are shown instead of raw parser/type errors. `page.tsx` is now 2,147 lines. Targeted ESLint, focused action-runner/action-message tests, `npm run type-check`, `npm run build`, `.next` JSON manifest parsing, and production-start HTTP checks passed; the health endpoint needed a 15s timeout on one cold-start check.

Status 2026-06-05 update 19: Batch 5 continued. Added `_lib/readiness-runner.ts` and `_lib/readiness-runner.test.ts` to consolidate the read-only staging smoke, operating inventory, staging validation, and admin surface QA button flow. The existing fetchers, result setters, status messages, safety copy, and read-only behavior are preserved. Also hardened `_lib/fetchers.ts` so invalid JSON responses return a clear `HTTP <status>` error. `page.tsx` is now 2,137 lines. Targeted ESLint, focused fetcher/readiness/action tests, full Ad OS `_lib` tests (10 files, 37 tests), `npm run type-check`, `npm run build`, `.next` JSON manifest parsing, and production-start HTTP checks passed.

Status 2026-06-05 update 20: Batch 5 continued. Extended `_lib/action-runner.ts` with generic response typing and moved `generateNaverSetupPacket`, `runKeywordBrain`, and `createNaverAssets` onto `runJsonAction()`. Existing URLs, payloads, result-state updates, refresh behavior, success messages, and external-write safety copy are preserved; `generateNaverSetupPacket` keeps its no-refresh behavior. `runLaunchAudit` remains explicit because its message is intentionally set before refresh. `page.tsx` is now 2,129 lines. Targeted ESLint, focused action/result tests, full Ad OS `_lib` tests, `npm run type-check`, `npm run build`, `.next` JSON manifest parsing, and production-start HTTP checks passed.

Status 2026-06-05 update 21: Batch 5 continued. Moved `executeNaverGate`, `exportGoogleConversions`, `exportMetaConversions`, and `runBidOptimizer` onto `runJsonAction()`. Existing URLs, payloads, refresh behavior, fallback errors, count formatting, and operator-facing `API write 0` / upload safety copy are preserved. Direct `setActionFlag` flow for those four actions is removed. Targeted ESLint, `npm run type-check`, full Ad OS `_lib` tests, `npm run build`, `.next` JSON manifest parsing, and production-start HTTP checks passed.

Status 2026-06-05 update 22: Batch 5 continued. Tightened `_lib/action-runner.ts` generic request typing and moved `runExperimentRunner`, `applyBlogEvolution`, `runPlatformJobs`, and `runRuntimeReadiness` onto `runJsonAction()`. Existing URLs, payloads, refresh behavior, fallback errors, count formatting, and operator-facing safety copy are preserved. Direct `setActionFlag` flow for those four actions is removed. `page.tsx` is now 2,112 lines. Targeted ESLint, `npm run type-check`, full Ad OS `_lib` tests, `npm run build`, `.next` JSON manifest parsing, and production-start HTTP checks passed.

Status 2026-06-05 update 23: Batch 5 continued. Moved `loadDataQuality`, `runPortfolioPlan`, `applyApprovedPortfolio`, and `executePlatformJobsDryRun` onto `runJsonAction()`. `loadDataQuality` keeps its GET endpoint; the other three preserve their existing POST payloads. Existing refresh behavior, fallback errors, count formatting, and operator-facing `API write 0` safety language are preserved. `page.tsx` is now 2,097 lines. Targeted ESLint, `npm run type-check`, full Ad OS `_lib` tests, `npm run build`, `.next` JSON manifest parsing, and production-start HTTP checks passed.

Status 2026-06-05 update 24: Batch 5 continued. Moved `standardizeExperimentTemplates`, `checkChannelAdapters`, `runRollbackDrill`, and `createAssetGroup` onto `runJsonAction()`. Existing URLs, payloads, refresh behavior, fallback errors, count formatting, and external-write safety text are preserved. During final diff review, repaired corrupted Ad OS shell copy in the page header, channel execution state, automation policy, tenant safety policy, status pills, and operating mode cards. `page.tsx` is now 2,183 lines. Targeted ESLint, `npm run type-check`, full Ad OS `_lib` tests, `npm run build`, `.next` JSON manifest parsing, Ad OS copy-corruption scan, and production-start HTTP checks passed.

Status 2026-06-05 update 25: Batch 5 continued. Restored detailed Ad OS action result messages after the copy-repair pass, added shared message helpers, and expanded `_lib/action-runner.ts` with batch-request and row-id request runners. Moved Google/Meta conversion upload prepare/dry-run, keyword plan row updates, ops queue row actions, change request updates, tenant policy/budget saves, tenant audit export, channel packet generation, execution gate check, Naver limited pilot, and tenant workspace defaults onto shared runners where their behavior was simple enough. Existing URLs, payloads, confirmation prompts, active-row loading ids, refresh behavior, fallback errors, and external-write safety text are preserved. `page.tsx` is now 2,127 lines. Targeted ESLint, `npm run type-check`, full Ad OS `_lib` tests (10 files, 40 tests), Ad OS copy/generic-message scan, `npm run build`, and production-start HTTP checks passed.

Status 2026-06-05 update 26: Batch 5 continued. Moved the remaining direct Ad OS page API calls that use normal JSON endpoint semantics onto shared action runners: Naver paused keyword dry-run, Naver account lookups/sync, paused activation, Creative Factory drafts, conversion attribution, external publish dry-run, publisher probes, launch audit, candidate approval, kill-switch dry-run, experiment planning, and Google permission probe. Clipboard/download helpers remain explicit because they use browser APIs rather than JSON endpoints. Existing URLs, payloads, no-refresh choices, result-state updates, fallback errors, and external-write safety text are preserved. `page.tsx` is now 1,988 lines and no longer contains direct `setActionFlag()` or direct Ad OS/search-ads `fetch()` calls. Targeted ESLint, `npm run type-check`, full Ad OS `_lib` tests (10 files, 40 tests), Ad OS direct-call/copy scan, `npm run build`, `git diff --check`, and production-start HTTP checks passed.

Status 2026-06-05 update 27: Batch 5 continued. Extracted the remaining large policy and operating-state render blocks into `_components/ChannelExecutionStatePanel.tsx`, `_components/AutomationPolicyPanel.tsx`, `_components/TenantSafetyPolicyPanel.tsx`, and `_components/OperatingModesPanel.tsx`. Existing labels, status tones, policy edit inputs, checkbox behavior, save handler wiring, and safety copy are preserved; page-owned reducer state and callbacks are passed through as props. `page.tsx` is now 1,718 lines. Targeted ESLint, `npm run type-check`, full Ad OS `_lib` tests (10 files, 40 tests), Ad OS direct-call/copy scan, `npm run build`, `git diff --check`, and production-start HTTP checks passed.

Status 2026-06-05 update 28: Batch 5 continued. Reduced the prop width of `_components/BudgetOperationActionBar.tsx` and `_components/EnterpriseRuntimeActionBar.tsx` by replacing long handler/loading prop lists with typed `actions` and `loading` bundles. Button labels, ordering, icons, primary button behavior, and loading states are preserved through local typed action registries. Focused action-bar tests now use the bundle contract and still check readable labels/button count. Targeted ESLint, `npm run type-check`, Ad OS `_lib` plus action-bar tests (12 files, 43 tests), Ad OS direct-call/copy scan, `npm run build`, `git diff --check`, production-start HTTP checks, and in-app browser login-redirect smoke passed.

Status 2026-06-05 update 29: Batch 5 continued. Extracted the remaining large budget and Enterprise runtime inline sections into `_components/BudgetOperationsPanel.tsx` and `_components/EnterpriseRuntimePanel.tsx`. Existing budget guardrail controls, action bars, tenant report/launch/ops/keyword/Naver result panels, runtime external-write evidence, and operations queue wiring are preserved while `page.tsx` now only passes section-level props. Added focused render tests for both new panels. `page.tsx` is now 1,710 lines. Targeted ESLint, `npm run type-check`, Ad OS `_lib` plus action-bar and section-panel tests (14 files, 45 tests), Ad OS direct-call/copy scan, `npm run build`, `git diff --check`, production-start HTTP checks, and in-app browser login-redirect smoke passed.

Status 2026-06-05 update 30: Batch 5 continued. Tightened `LaunchActionQueuePanel` from broad `Record<string, ...>` action maps to a closed `LaunchActionKey` contract and added the missing `refresh` action used by the degraded summary fallback. Unsupported server-provided `ui_action` keys now render disabled instead of receiving an undefined click handler. Expanded launch queue tests for normal actions, Naver packet rendering, degraded refresh, and unsupported action keys. Targeted ESLint, `npm run type-check`, Ad OS `_lib` plus launch/action-bar/section-panel tests (15 files, 49 tests), Ad OS direct-call/copy scan, `npm run build`, `git diff --check`, production-start HTTP checks, and in-app browser login-redirect smoke passed.

Status 2026-06-05 update 31: Batch 5 continued. Moved `LAUNCH_ACTION_KEYS` and `LaunchActionKey` into `_lib/types.ts`, changed `Summary.launch_action_queue[].ui_action` from broad `string` to the shared key type, and updated `/api/admin/ad-os/summary` so normal and degraded fallback actions compile against the same contract as the UI. Runtime unsupported-action guarding remains for stale or malformed payloads. Targeted ESLint, `npm run type-check`, Ad OS `_lib` plus launch/action-bar/section-panel tests (15 files, 49 tests), Ad OS/API action-key scan, `npm run build`, `git diff --check`, production-start HTTP checks, and in-app browser login-redirect smoke passed.

Status 2026-06-05 update 32: Batch 5 continued. Hardened the readiness runner so stale automation messages are cleared when a readiness check starts, and added `_lib/naver-keyword-csv.ts` to centralize Naver setup packet CSV presence checks and filesystem-safe keyword CSV filenames. Page-level clipboard/download handlers still own browser APIs, but now use the shared helpers. During full type-check, malformed untracked product-registration deliverability gate files were found and restored with parse-safe English blocker messages plus tests. Targeted ESLint, `npm run type-check`, Ad OS `_lib` plus launch/action-bar/section-panel and deliverability-gate tests (17 files, 57 tests), `npm run build`, `git diff --check`, production-start HTTP checks, and in-app browser login-redirect smoke passed.

Status 2026-06-05 update 33: Batch 5 continued. Added `_lib/initial-readiness-loader.ts` to move the initial staging smoke, operating inventory, staging validation, and admin surface QA `Promise.allSettled()` flow out of `page.tsx`. The helper preserves partial-success application, fixed failure priority, and unmount skip behavior through focused tests. `page.tsx` is now 1,587 lines. While rerunning full type-check, `src/lib/itinerary-normalizer.ts` was found with a malformed function boundary around meal normalization; the syntax was repaired and itinerary tests were expanded for string meal slots, note preservation, total meal recounting, and meta flight hints. Targeted ESLint, `npm run type-check`, initial readiness loader tests, itinerary normalizer tests, focused Ad OS/product-registration tests (19 files, 67 tests), `npm run build`, `git diff --check`, production-start HTTP checks, and in-app browser login-redirect smoke passed.

## Acceptance Checks

- `npx eslint src/app/admin/ad-os/page.tsx src/app/admin/ad-os/_components src/app/admin/ad-os/_lib --max-warnings=0`
- `npm run type-check`
- Browser check: `/admin/ad-os` loads with no console errors.
- Safety text still displays no live spend/write unless explicitly enabled by existing backend state.
- No unrelated API route changes in the same PR.

## Stop Conditions

- Any KPI or finance value changes without a deliberate formula task.
- Any external-write action becomes easier to trigger or loses its safety context.
- Extraction requires changing API payload shape.
- A panel becomes visually ambiguous about dry-run vs live-write state.
