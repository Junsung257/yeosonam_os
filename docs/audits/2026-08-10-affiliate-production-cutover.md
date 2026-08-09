# Affiliate production cutover evidence — 2026-08-10

## Scope

This record covers the V2 schema cutover, credential retirement, live domain alias, and browser smoke checks for the affiliate portal. Existing booking, commission, settlement, and payout amounts were not recalculated or backfilled.

## Database

- All eight affiliate V2 migrations were applied to the linked Supabase project after a rollback dry-run passed.
- Migration history was repaired for versions `20260808133613`, `20260808135026`, `20260808141133`, `20260808141909`, `20260808143735`, `20260808145303`, `20260808150100`, and `20260808232441`.
- Post-cutover checks: 7 affiliate rows, 0 plaintext `portal_pin` rows, 0 `pin_hash` rows, 0 active sessions, and 7 credential-rotation audit rows.
- Legacy credentials were retired in one transaction. `token_version` was incremented, sessions were revoked, and no PIN values were written to the audit log.

## Deployment

- The Ready remediation preview artifact `os-6fs8cyxzu-zzbaa0317-4596s-projects.vercel.app` was assigned to `www.yeosonam.com` using a Vercel alias.
- The live domain now serves the canonical `/partner` portal. The old token-only partner page is no longer returned.
- Two CLI production attempts were left blocked by Vercel commit-email collaboration checks; they are not serving traffic. The live alias uses the already-built, tested preview artifact.

## Chrome smoke checks

Verified in the authenticated Chrome session:

1. `https://www.yeosonam.com/partner` renders the session-only partner portal and redirects unauthenticated visitors to the one-time invitation explanation.
2. `/partner-apply` renders the application form with required policy and disclosure checkboxes.
3. `/partner/activate` without an invitation shows the safe “activation information required” state.
4. `/api/partner/auth/session` returns `SESSION_REQUIRED` without a session.
5. `/api/partner/catalog` returns `SESSION_REQUIRED` without a session.
6. `/api/influencer/content?code=DEMO` returns an authentication error rather than exposing content.

## Not executed against production

- No real partner application, approval, invitation delivery, booking, commission, settlement, payout, or refund was created.
- Full authenticated partner E2E still requires a dedicated staging project or an operator-provided test affiliate/invitation; using a live financial tenant for synthetic transactions would contaminate production records.
