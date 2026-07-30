# Admin End-to-End Hardening

## Objective

Audit the full admin operating path from database reads and API contracts through frontend state and operator actions, then implement the highest-impact safe fixes.

## In scope

- `/admin` navigation and high-frequency operational routes
- dashboard KPI/query/API contracts
- admin authentication and tenant-scoping boundaries
- loading, empty, error, refresh, filtering, and action feedback states
- browser behavior, accessibility, responsiveness, and avoidable client work
- regression tests and reusable audit checks

## Constraints

- Preserve unrelated work already present in the working tree.
- Do not mutate production bookings, payments, settlements, PII, credentials, or ad spend.
- Do not apply database migrations to a remote database without explicit approval.
- Recognized revenue remains departure-date based; new bookings remain creation-date based, in KST.
- Prefer narrow changes in existing architecture over broad rewrites.

## Success criteria

- High-impact broken or misleading flows found in the audit are fixed or explicitly approval-gated.
- Frontend fetch contracts match API response shapes and failures are visible and recoverable.
- Dashboard data remains source-backed, tenant-safe, and independently testable.
- Type checks, targeted tests/lint, admin contract audits, and representative browser flows pass.
