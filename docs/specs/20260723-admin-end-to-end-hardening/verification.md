# Verification

## Required evidence

- `npm run type-check`
- accessibility lint and targeted ESLint
- relevant unit/contract tests
- admin dashboard contract audit
- representative authenticated browser routes with console, failed-request, overlay, and interaction checks
- accepted screenshots inspected for layout, hierarchy, loading/error state, and overflow
- `git diff --check`

## Manual or approval-gated

- remote migration application
- production data mutation
- payment, refund, settlement, PII, or external advertising actions

## 2026-07-23 results

- `npm run type-check`: PASS
- targeted ESLint and accessibility checks: PASS
- Vitest targeted regression suites: PASS (including the package count contract)
- `npm run build`: not verified in this Windows pass; the worker stalled before producing `BUILD_ID`
- all eight reviewed dashboard migrations applied to the linked production schema: PASS
- all reviewed admin RPCs executed as `service_role`: PASS
- admin RPC direct execution by `anon` and `authenticated`: blocked as intended
- `npx supabase db lint --local --level warning --fail-on error`: PASS (no errors)
- `npx supabase db advisors --local --type all --level error --fail-on error`: PASS (0 issues)
- product review approval rollback rehearsal: PASS; ERP product becomes `ACTIVE` while customer publication state remains unchanged
- `npm run audit:api-drift`: PASS
- `npm run audit:select-cols`: PASS
- `npm run audit:sensitive-api-guards`: PASS
- `npm run audit:agent-patterns`: PASS
- `npm run audit:migration-prefix`: no new collisions (16 historical collisions remain)
- `git diff --check`: PASS
- source-aware schema drift audit after the approved repair: attractions 0; 49 travel_packages rows contain 54 ambiguous optional-tour entries, with 60 evidence items still unresolved
- the reviewed source-backed pass updated 20 non-public packages (26 tour entries); hash-mismatched, ambiguous, or public cases remain untouched
- authenticated browser regression: PASS for dashboard loading, period filters, refresh, sidebar toggle, command palette, and cross-page links; screenshot capture timed out at the browser CDP layer
- authenticated package-list regression found and fixed a response-contract bug: `/api/packages` returns `pagination.total`, while the client previously read top-level `count`; the screen now shows the actual 100-row page total instead of `총 0건`
- the eight reviewed dashboard migrations were applied remotely in order after schema mismatches were resolved
- fixed during verification: `PUBLIC` execute leakage on dashboard/badge/capital/action RPCs, eight policy-backed tables with RLS disabled, and a product-review path that bypassed the immutable public snapshot gate

## 2026-07-23 partial-source hardening

- dashboard RPC and chart/booking-pace reads now have bounded timeouts; a missing or slow source returns an explicit `data_status` (`unavailable`/`partial`) instead of a misleading success payload
- LTV no longer turns an unavailable RPC into HTTP 500; it returns an empty, clearly labelled unavailable state so the admin screen can distinguish “no data” from “source not deployed”
- AI credits, badge counts, revenue recognition, and chart endpoints fail closed or return partial results with a status detail; the dashboard hides unavailable AI balances and shows a visible fetch warning
- warmed performance check: `npm run check:perf` PASS (6/6 endpoints within budget); full contract-audit timings remain sensitive to Windows Next dev cold compilation and are not treated as a production performance pass
- post-repair remote drift audit: 49 packages / 54 ambiguous optional-tour entries remain queued; the reviewed source-backed pass updated 20 non-public packages (26 tour entries), while hash-mismatched or ambiguous cases remain untouched
- linked migration preflight: 8/8 reviewed admin migrations are applied remotely; `npm run check:admin-dashboard-activation:ci` is ready
- remote RPC smoke checks returned successfully for dashboard, badge, tenant, LTV, operations, AI, and keyword summary functions; Supabase advisors reported no issues

## Remaining activation items

- Run the authenticated browser screenshot capture again when the browser CDP screenshot command is stable.
- Review the source evidence attached to the 49 remaining `travel_packages` drift rows before any further repair; no title/destination inference is permitted.
- `npm run repair:optional-tours-region-drift -- --json` is now source-only dry-run. It refuses writes unless `--allow-reviewed-source-repair` is explicitly supplied and never falls back to package title/destination guessing.
- `/admin/products/source-drift` and `/api/admin/products/source-drift` now provide the reviewed source-evidence queue. Approvals require an admin note, a region selection, and a non-public package; public snapshot status is never changed by this flow.
- New queue validation: `npm run type-check`, targeted ESLint, `npm run lint:a11y`, and source-drift/approval tests all pass. A fresh Windows Next production build was attempted twice but the build worker stalled before producing `BUILD_ID`; it was stopped safely and is not reported as a pass. The previously recorded baseline build remains separate from this route addition.

See [remote-activation-runbook.md](./remote-activation-runbook.md) for the exact order, SQL privilege checks, RLS checks, and post-deploy audit command.
