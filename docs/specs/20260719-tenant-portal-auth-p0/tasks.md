# Tasks: tenant portal authorization P0

- [x] Confirm Tier 3, SSOT, actual portal call graph, schema, and current permissive RLS evidence.
- [x] Add malicious/valid authorization tests first.
- [x] Add the verified membership-based tenant authorization helper.
- [x] Scope tenant portal pages and APIs to the resolved tenant.
- [x] Route tenant portal logins through membership confirmation while preserving the admin login path and safe-redirect protections.
- [x] Add record-level tenant predicates for products and inventory; add RFQ table RLS defense in depth without editing the parallel lane's `/api/rfq/**` files.
- [x] Generate and review a forward-only membership/RLS migration without remote apply.
- [x] Run focused tests, lint, type-check, migration-list, and diff checks.
- [x] Record verification and approval-gated rollout steps.

## Parallel Candidates

- [x] None; route, repository, and migration behavior share one authorization contract.

## Commit Boundary

- Commit group: security backend + DB proposal + tests/docs.
