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
- [x] Pin JWT signature verification to the configured Supabase issuer/JWKS and validate issuer, audience, algorithm, role, expiry, and subject.
- [x] Allow valid tenant S2S admin tokens through middleware while rejecting invalid/missing credentials at the existing boundary.
- [x] Move existing-table RLS replacement into a non-executable Phase-C proposal.
- [x] Keep Phase A purely additive by deferring the existing Jarvis function privilege change to Phase C.
- [x] Keep all RFQ tables route-only in Phase C with no authenticated membership policy.
- [x] Record RFQ service-role companion commits `03e16701` and `653eba11`.
- [ ] Record the RFQ follow-up that proves cron uses service-role persistence and tenant actor actions require active membership/tenant status.
- [ ] Clear draft/merge-blocked status only after the integration owner verifies the tenant/RFQ commit pair together.
- [x] Rerun the repository-wide type-check after the RFQ follow-up checker releases the single-checker slot.

## Parallel Candidates

- [x] None; route, repository, and migration behavior share one authorization contract.

## Commit Boundary

- Commit group: security backend + additive Phase-A DB migration + held Phase-C proposal + tests/docs.
