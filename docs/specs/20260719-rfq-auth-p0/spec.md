# RFQ authentication P0 specification

## Objective

Close the launch-blocking RFQ API authorization and stored-HTML boundaries without removing the public customer inquiry entry point.

## Preserved behavior

- `POST /api/rfq` remains public because `/group`, `/group-inquiry`, and `/private-tour` use it to create a customer RFQ.
- Administrators can still list and manage RFQs, bids, proposals, analysis, messages, and contracts.
- A tenant can claim an eligible RFQ and read/write only the bid and proposal owned by the tenant bound to its verified JWT.
- A customer/group can use the RFQ share token for customer-visible messages, proposal selection, and a completed contract.
- Stored message text remains text; the existing PII processing path remains in place.

## Security invariants

1. Request body/query values (`tenant_id`, `sender_type`, `sender_id`, `viewAs`) are data, never authority.
2. Tenant authority comes only from a cryptographically verified Supabase JWT `app_metadata.tenant_id`. User-editable `user_metadata` is never trusted for tenancy.
3. A bid/proposal operation must match both the path RFQ and the verified tenant's actual bid/proposal ownership.
4. Full proposal collections, bid collections, and AI analysis are administrator-only. The public share page continues to use its existing redacted server-rendered projection.
5. Customer message access requires the RFQ's non-empty share token. The server derives customer/tenant/admin visibility and sender identity.
6. Contract HTML must encode every stored string before interpolation.
7. Sensitive responses use private/no-store cache semantics.

## Proven vulnerable paths before the patch

- Anonymous `GET /api/rfq/:id/messages?viewAs=admin` passed caller-selected `viewAs` to `getRfqMessages`, removing customer/tenant visibility filters and exposing raw messages/PII.
- Anonymous `GET /api/rfq/:id/proposals`, `GET /api/rfq/:id/bid`, and `GET /api/rfq/:id/analyze` returned commercial proposal/bid data.
- `POST /api/rfq/:id/bid` trusted body `tenant_id`; proposal GET/POST/PATCH trusted path `bidId` and body `tenant_id` without binding either to the logged-in tenant.
- Message POST trusted body `sender_type` and `sender_id`, allowing a share-link caller or anonymous caller to impersonate a tenant.
- Contract generation interpolated RFQ/proposal strings directly into HTML, including `destination`, `special_requests`, inclusions, and exclusions.

## Remaining release blockers outside this patch ownership

### Tenant RFQ route binding

`src/app/api/tenant/rfqs/**` still accepts a query `tenant_id` and does not prove it equals the verified JWT tenant. That route can expose the same RFQ/customer data and must be fixed before launch.

### Database/RLS boundary

`supabase/migrations/20260519130000_rls_initplan_optimization.sql` grants `FOR ALL TO authenticated` with an always-true authenticated-role predicate on:

- `group_rfqs`
- `rfq_bids`
- `rfq_messages`
- `rfq_proposals`

Any authenticated browser client can therefore bypass the Next.js route checks. No remote or local migration is applied in this patch.

The safe forward-only sequence is:

1. Fix `/api/tenant/rfqs/**` to derive tenancy from verified `app_metadata` and the tenant-membership SSOT, never query/body values.
2. Make public creation, share, administrator, and cron RFQ operations use server-only access after route-local authorization; do not expose service-role credentials or service-only helpers to clients.
3. Add control tests for public RFQ creation, tenant marketplace reads, share reads/reactions, cron, and administrator flows.
4. Add a new migration that drops the four broad `authenticated_access` policies. Default-deny direct authenticated access to `group_rfqs` and `rfq_messages`; scope any required direct `rfq_bids`/`rfq_proposals` access to the verified tenant-membership row and matching `tenant_id`; keep server-only operations behind explicit service-role policies and grants.
5. Apply through the normal approved Supabase release path, verify policy/grant state remotely, and run production smoke tests.

Applying step 4 before steps 1-3 would break the public inquiry, share page, tenant RFQ, and cron flows; changing repository helpers to service role before fixing all route callers would turn currently weak routes into an RLS-bypassing exposure. The ordering is therefore mandatory.
