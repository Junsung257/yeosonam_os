# RFQ authentication P0 specification

> Status: **DRAFT / MERGE-BLOCKED**. Ship only in the coordinated Phase-B release after the fixed JWT trust root and tenant membership Phase-A prerequisites are verified.

## Objective

Close the launch-blocking RFQ API authorization and stored-HTML boundaries without removing the public customer inquiry entry point.

## Preserved behavior

- `POST /api/rfq` remains public because `/group`, `/group-inquiry`, and `/private-tour` use it to create a customer RFQ.
- Administrators can still list and manage RFQs, bids, proposals, analysis, messages, and contracts.
- A tenant can claim an eligible RFQ and read/write only the bid and proposal owned by the tenant bound to its verified JWT.
- A customer/group can use the RFQ share token for customer-visible message reads, reactions, and a completed contract.
- Proposal selection is administrator-only until a separate, revocable owner-action token SSOT is designed and shipped. A share token is deliberately not an owner-action credential.
- Stored message text remains text; the existing PII processing path remains in place.

## Security invariants

1. Request body/query values (`tenant_id`, `sender_type`, `sender_id`, `viewAs`) are data, never authority.
2. Tenant authority comes only from a cryptographically verified Supabase JWT `app_metadata.tenant_id`. User-editable `user_metadata` is never trusted for tenancy.
3. A bid/proposal operation must match both the path RFQ and the verified tenant's actual bid/proposal ownership.
4. Full proposal collections, bid collections, and AI analysis are administrator-only. The public share page continues to use its existing redacted server-rendered projection.
5. Customer message reads require the RFQ's non-empty share token. Message writes require an authenticated administrator or verified tenant; share-token writes fail closed.
6. Contract HTML must encode every stored string before interpolation.
7. Sensitive responses use private/no-store cache semantics.
8. Authorized RFQ route CRUD uses the explicit service-role repository; the anonymous/browser repository is never a privileged route fallback.
9. Public creation requires exact boolean consent, strict bounded input, rate limiting, and recent-duplicate rejection before the server insert.
10. Tenant authority requires the verified JWT `sub` to resolve through service-role `tenant_memberships` to exactly one active membership and an active tenant. `app_metadata.tenant_id` is only a consistency hint.
11. RFQ timeout cron persistence uses the explicit service-role repository, never the legacy anonymous RFQ helpers.

## Proven vulnerable paths before the patch

- Anonymous `GET /api/rfq/:id/messages?viewAs=admin` passed caller-selected `viewAs` to `getRfqMessages`, removing customer/tenant visibility filters and exposing raw messages/PII.
- Anonymous `GET /api/rfq/:id/proposals`, `GET /api/rfq/:id/bid`, and `GET /api/rfq/:id/analyze` returned commercial proposal/bid data.
- `POST /api/rfq/:id/bid` trusted body `tenant_id`; proposal GET/POST/PATCH trusted path `bidId` and body `tenant_id` without binding either to the logged-in tenant.
- Message POST trusted body `sender_type` and `sender_id`, allowing a share-link caller or anonymous caller to impersonate a tenant.
- Contract generation interpolated RFQ/proposal strings directly into HTML, including `destination`, `special_requests`, inclusions, and exclusions.

## Remaining release blockers outside this patch ownership

### Paired tenant RFQ prerequisite

The tenant ownership/RLS lane is paired through commit `9d3df38c`. That commit owns `src/app/api/tenant/rfqs/**`, verified tenant membership, and the RLS migration; it must be included and verified together with this RFQ route commit before release.

This branch remains merge-blocked until the separate configured issuer/JWKS/audience trust-root fix is merged and the tenant membership schema is verified/provisioned. Deploying this code before `tenant_memberships` exists would fail closed but make tenant RFQ operations unavailable.

### Owner-action token rebuild gate

The share UI historically used the read/share token to select a winning proposal. That capability is closed at `/api/rfq/:id/select`. Customer self-selection must not be re-enabled until a dedicated owner-action token has expiration, revocation, action scope, replay protection, and audit logging. Until then, selection is an administrator operation.

### Atomic mutation gate (P1)

Bid-capacity checks and the multi-row winner selection transition are currently separate reads/writes. A forward-only database RPC/transaction is required to make capacity enforcement and winner/loser state changes atomic under concurrency. No remote database mutation was performed in this lane; this remains a P1 pre-scale gate and must be exercised through the approved Supabase release path.

Public-ingress hardening also has three explicit P1 infrastructure gates. Consent evidence needs immutable policy/version/timestamp persistence rather than only the submitted JSON snapshot. Duplicate prevention needs a database-backed idempotency key or atomic uniqueness/RPC instead of a pre-insert recent-row check. Production rate limiting needs a required shared Redis/edge backend and monitoring rather than any per-instance fallback. This lane adds no migration and performs no remote mutation.

### Database/RLS boundary

`supabase/migrations/20260519130000_rls_initplan_optimization.sql` grants `FOR ALL TO authenticated` with an always-true authenticated-role predicate on:

- `group_rfqs`
- `rfq_bids`
- `rfq_messages`
- `rfq_proposals`

Any authenticated browser client can therefore bypass the Next.js route checks. No remote or local migration is applied in this patch.

The safe forward-only sequence is:

1. Include and verify paired tenant commit `9d3df38c`, which derives tenancy from verified identity/membership rather than query/body values.
2. Keep public creation, share, administrator, and cron RFQ operations on server-only access after route-local authorization; never expose service-role credentials or service-only helpers to clients.
3. Add control tests for public RFQ creation, tenant marketplace reads, share reads/reactions, cron, and administrator flows.
4. Add a new migration that drops the four broad `authenticated_access` policies. Default-deny direct authenticated access to `group_rfqs` and `rfq_messages`; scope any required direct `rfq_bids`/`rfq_proposals` access to the verified tenant-membership row and matching `tenant_id`; keep server-only operations behind explicit service-role policies and grants.
5. Apply through the normal approved Supabase release path, verify policy/grant state remotely, and run production smoke tests.

Applying step 4 before steps 1-3 would break the public inquiry, share page, tenant RFQ, and cron flows; changing repository helpers to service role before fixing all route callers would turn currently weak routes into an RLS-bypassing exposure. The ordering is therefore mandatory.
