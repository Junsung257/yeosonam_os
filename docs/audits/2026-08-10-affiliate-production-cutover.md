# Affiliate production cutover evidence — 2026-08-10

## Scope

This record covers the V2 schema cutover, credential retirement, live domain alias, browser smoke checks, and a disposable synthetic partner E2E. Existing booking, commission, settlement, and payout amounts were not recalculated or backfilled.

## Database

- All eight affiliate V2 migrations were applied to the linked Supabase project after a rollback dry-run passed.
- Migration history was repaired for versions `20260808133613`, `20260808135026`, `20260808141133`, `20260808141909`, `20260808143735`, `20260808145303`, `20260808150100`, and `20260808232441`.
- Post-cutover checks: 7 affiliate rows, 0 plaintext `portal_pin` rows, 0 `pin_hash` rows, 0 active sessions, and 7 credential-rotation audit rows.
- Legacy credentials were retired in one transaction. `token_version` was incremented, sessions were revoked, and no PIN values were written to the audit log.
- The synthetic E2E used deterministic IDs `00000000-0000-4000-8000-000000000810` (affiliate), `00000000-0000-4000-8000-000000000811` (package), and `00000000-0000-4000-8000-000000000812` (invitation). Cleanup verification returned zero rows for every ID, zero active sessions, and zero legacy PIN credentials.

## Deployment

- The remediation artifact was promoted to formal Production as `os-7cbb1gv1a-zzbaa0317-4596s-projects.vercel.app` and is assigned to `www.yeosonam.com`, `yeosonam.com`, and the project production alias. It includes the partner middleware fixes below.
- The live domain now serves the canonical `/partner` portal. The old token-only partner page is no longer returned.
- `AFFILIATE_AUTH_SECRET` was rotated to a new sensitive value and applied to both the production and `affiliate-critical-remediation` preview environments before the synthetic activation run. The raw value was not committed and its temporary file was deleted after cleanup.
- Production Solapi settings were connected as encrypted Vercel variables from the existing project configuration (`SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `KAKAO_CHANNEL_ID`, and `KAKAO_SENDER_NUMBER`). A read-only `GET /messages/v4/list?limit=1` credential check returned HTTP 200; no message was sent. The production deployment was rebuilt after the change.
- A middleware defect was fixed: `/partner/*` and `/api/partner/*` now reach route-local partner-session authorization, while activation and OTP endpoints remain reachable before a session exists. This prevents stale administrator refresh cookies from returning the generic `token expired` response.

## Chrome smoke checks

Verified in the authenticated Chrome session:

1. `https://www.yeosonam.com/partner` renders the session-only partner portal and redirects unauthenticated visitors to the one-time invitation explanation.
2. `/partner-apply` renders the application form with required policy and disclosure checkboxes.
3. `/partner/activate` without an invitation shows the safe “activation information required” state.
4. `/api/partner/auth/session` returns `SESSION_REQUIRED` without a session.
5. `/api/partner/catalog` returns `SESSION_REQUIRED` without a session.
6. `/api/influencer/content?code=DEMO` returns an authentication error rather than exposing content.

## Synthetic partner E2E

The disposable sample was created and exercised against `www.yeosonam.com` with a known OTP (`123456`) and then removed.

1. Activation API issued an HTTP-only `partner_session` (`200`).
2. Partner session endpoint returned the seeded affiliate (`200`).
3. Partner catalog returned the synthetic product as `state=ready` and sellable (`200`).
4. Publication creation returned `201`; replaying the same `Idempotency-Key` returned the same publication (`200`, idempotent replay).
5. `/go/{publication_id}` returned a tracking redirect (`302`) to `/api/influencer/track`.
6. Tracking returned a redirect to the exact synthetic package (`302`), created one accepted touchpoint, and incremented the publication click counter atomically to `1`.
7. Logout returned `200`; reuse of the partner session returned `401`.
8. Funnel evidence contained three events (session creation, publication creation, accepted touchpoint).

The Chrome tab was used to verify the live activation page and the OTP delivery path before the production Solapi configuration was connected. The authenticated API E2E above used the same live origin and seeded invitation to verify the remaining session/catalog/publication/tracking contract without exposing or sending a real message. A real-phone OTP send was intentionally not executed; the provider credentials were validated through the read-only API check above.

## Verification commands

- `npm test -- --testTimeout=15000`: 662 test files, 5,095 tests passed.
- `npm run type-check`: passed.
- `npm run lint`: passed with zero warnings.

## Not executed against production

- No real partner application, approval, invitation delivery, booking, commission, settlement, payout, or refund was created.
- Booking-to-settlement financial writes remain intentionally unexecuted in production. They require a disposable staging database or an explicit operator-approved financial fixture because those writes create customer, booking, ledger, tax, and payout evidence that should not be deleted from a live tenant.
