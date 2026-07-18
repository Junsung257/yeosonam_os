# Implementation Plan: tenant portal authorization P0

## Approach

Authenticate the Supabase access token server-side, allow an explicit platform-admin path, and otherwise resolve the signed-in user's active membership from a server-only table. The resolved tenant ID becomes authoritative; all caller-supplied tenant IDs are comparison inputs only and are overwritten before persistence. Queries and updates also include tenant ownership predicates so a foreign record ID cannot bypass the route guard.

## Impact Areas

- Code: tenant portal middleware, APIs/pages, `src/lib/tenant-portal-auth.ts`, and tenant DB helpers.
- Data/API: additive `tenant_memberships` table in Phase A; restrictive existing-table policies are retained only in the Phase-C proposal; no remote apply.
- UI: portal fetches consistently include the current route tenant ID; the shared login confirms a tenant redirect against DB membership instead of the admin-only session endpoint; unauthorized users are redirected or receive 401/403.
- Docs/tests: this packet plus unit/route/middleware security tests.

## Required SSOT

- `AGENTS.md`
- `CURRENT_STATUS.md`
- `.claude/CLAUDE.md`
- `.cursor/rules/db-migration-policy.mdc`
- `.cursor/rules/api-response-format.mdc`
- `docs/agent-workflow-current-ssot.md`
- Supabase Auth and RLS documentation

## Data Flow

The browser sends its HttpOnly `sb-access-token`. The route verifies the JWT, resolves `sub` to an active `(user_id, tenant_id)` membership through a service-role server client, checks the requested tenant against that membership, and passes only the resolved tenant ID to tenant-filtered repository functions. Platform admins are authorized separately by the existing admin token/email contract.

## Risks And Guardrails

- Missing membership migration or service key: fail closed with 503; never fall back to caller input or `user_metadata`.
- Stale JWT metadata: authorization does not use `user_metadata` or tenant claims; current DB membership is checked per request.
- Foreign record ID: product and inventory repository updates include tenant ownership predicates; `/api/rfq/**` route ownership is verified by the parallel RFQ lane.
- RLS policy composition: the Phase-C proposal removes permissive `authenticated_access` policies before adding ownership policies, but it must not become an executable migration until the RFQ service-role companion is deployed and verified.
- Production mutation: Phase A is additive and no migration or proposal is applied remotely from this worktree.
