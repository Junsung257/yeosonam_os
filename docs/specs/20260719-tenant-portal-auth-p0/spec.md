# Feature Spec: tenant portal authorization P0

## Goal

Make every tenant portal read and mutation derive its tenant scope from a verified user-to-tenant membership instead of trusting a route, query-string, or request-body `tenant_id`.

## Success Criteria

- [x] Anonymous and invalid-session requests cannot enter tenant portal pages or APIs.
- [x] A tenant member can access only the tenant in their active membership.
- [x] A tenant member cannot read or mutate another tenant by changing URL, query, body, product ID, or tenant RFQ query scope.
- [x] Platform admins retain intentional preview/support access.
- [x] Tenant membership and RLS changes are forward-only and are not applied to a remote database in this worktree.
- [x] Malicious and valid request tests cover the authorization boundary.

## In Scope

- `/tenant/[tenantId]/**` portal entry and its directly called APIs.
- `/api/tenant/**`, tenant-scoped `/api/tenants/[id]`, and the middleware boundary for tenant pages.
- A server-only tenant authorization helper and tenant repository scope checks.
- A forward-only `tenant_memberships`/RLS migration for the production authorization source of truth.

## Out Of Scope

- Customer RFQ sharing, customer message authorization, and `/api/rfq/**` handlers owned by the parallel RFQ security lane.
- A tenant invitation/provisioning UI.
- Applying a migration or writing membership rows in any remote environment.
- Visual redesign of the existing tenant portal.

## Users And Risks

- Primary audience: land-agency tenant staff and platform admins.
- Risk tier: Tier 3.
- Sensitive surfaces: cross-tenant commercial data, costs, inventory, settlements, RFQ bids/proposals, DB/RLS.

## Open Questions

- [ ] Production owner must approve and apply the migration, then provision active `tenant_memberships` rows before tenant users can use the portal.
- [ ] Canonical local migration history still lacks the base `tenants`/RFQ table creation DDL even though the linked environment contains those tables. Reconcile that history separately before relying on a clean database rebuild.
