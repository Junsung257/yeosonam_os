# Finance Guided Workday UX Verification

Date: 2026-08-12

## Scope

- Make `/admin/finance` start with a guided daily settlement flow without replacing the existing expert tabs.
- Preserve all current booking decisions, allocation evidence, month-close snapshots, and audit history across deployments.
- Add stale-safe, idempotent, all-or-nothing company-transaction batch classification.
- Deduplicate tax/evidence work by booking and remove internal `PENDING` copy from the operator UI.
- Add anonymous manual finance events and stop session replay on finance pages.

## Implemented Contract

- `GET /api/admin/finance/workday` projects the current summary, pending booking reviews, receipt gaps, and previous completed departure month into seven ordered tasks.
- The workday displays three owner-facing amounts only: actual balance, protected travel cash, and safe-to-withdraw cash.
- Booking task links open the exact pending booking drawer through `focus`, then retain the existing current-fingerprint decision RPC and next-item flow.
- `save_finance_classification_batch` locks and validates 1-200 fully allocated one-line non-travel transactions before any mutation, rejects split, booking-linked, direction-invalid, duplicate, and stale rows, preserves allocation totals, stores an idempotency result, and writes audit logs.
- Existing single-row classification, split allocation, booking decision, month close, and expert overview routes remain compatible.

## Verification Evidence

- Full repository TypeScript check: passed after replacing three icons that were not declared by the repository's pinned Lucide type surface.
- Finance tests: 22 passed, including workday priority, bank-drift blocking, no-work completion, analytics privacy buckets, allocation conservation, review fingerprint integrity, and single-line-only batch RPC contracts.
- Event taxonomy audit: passed, 20 required events documented and 27 code references checked.
- Migration prefix audit: passed with no new collisions.
- ESLint: no errors on changed finance files; the only hook warning was corrected.
- Sensitive API guard, agent risk-pattern audit, direct-env secret lint, and strict PII-surface audit: passed with no new blockers.
- Migration safety checker: passed with zero issues. The function remains invoker-mode, revokes default execution, and grants only `service_role`, matching current Supabase function privilege guidance.
- Admin dashboard contract script: authenticated live checks were correctly blocked without an admin cookie rather than returning false zero values.
- Local full Next build reached generated build manifests; its static worker remained active under heavy Windows resource contention and was stopped. GitHub/Vercel clean-build checks remain the release gate.

## Data Safety

- No production finance mutation or case decision was made during this implementation.
- The migration is additive. It does not edit booking reviews, settlement periods, period items, or historical allocations at migration time.
- Workday totals are calculated from current SSOT services and are never persisted as a second ledger.
- PostHog remains a no-op until optional public ingest variables are configured; financial actions never depend on telemetry delivery.
