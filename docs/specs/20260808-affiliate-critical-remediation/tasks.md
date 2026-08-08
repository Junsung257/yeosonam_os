# Tasks

## P0

- [ ] Add a current reconciliation migration for the missing application contract.
- [ ] Add a schema drift assertion covering every field written by partner application.
- [ ] Require terms and disclosure acceptance before application insert.
- [ ] Add idempotency/duplicate protection for concurrent application submission.
- [ ] Require authentication for content GET and return 401/403 correctly.
- [ ] Sanitize content API database failures.
- [ ] Remove unsupported 5%, 72-hour, direct-verification, and fan-exclusive claims.
- [ ] Add a validated canonical public origin and replace touched fallbacks.

## Authentication

- [ ] Add `affiliate_invitations` and `affiliate_sessions` with RLS and server-only grants.
- [ ] Add token version and credential rotation fields.
- [ ] Include `jti`, session ID, and token version in tokens.
- [ ] Validate server session and partner lifecycle on every authenticated request.
- [ ] Revoke session on logout and all sessions on suspension/termination/rotation.
- [ ] Remove direct legacy influencer authentication and browser token responses.
- [ ] Remove plaintext PIN writes and fallback verification.
- [ ] Document production credential rotation and verification SQL.

## Commercial Contract

- [ ] Add creator-code and discount-campaign models with separate validation.
- [ ] Centralize commission calculation and mandatory cap.
- [ ] Hold commission when policy evidence is unavailable or malformed.
- [ ] Persist policy/version/effective-date snapshots on booking evidence.

## Attribution

- [ ] Add publications and attribution decisions.
- [ ] Carry stable identifiers through touchpoint, booking, ledger, and settlement.
- [ ] Make click/conversion counters atomic.
- [ ] Clear stale sub IDs and enforce lifecycle policy on new touchpoints.

## Settlement V2

- [ ] Add ledger, runs, lines, payouts, revisions, and disputes.
- [ ] Freeze READY lines and completed payout evidence.
- [ ] Add KST period boundaries, transaction lock, and idempotency.
- [ ] Add reversal-only correction paths and immutable PDF inputs.
- [ ] Keep legacy settlements read-only until separately reconciled.

## Portal and Observability

- [ ] Add `/api/partner/catalog` using customer-visible status SSOT.
- [ ] Separate unavailable from empty catalog and metric states.
- [ ] Build canonical `/partner` routes and isolate layouts.
- [ ] Add required funnel events and metric definitions.
- [ ] Verify application-to-first-link at 320px and 200% zoom.

