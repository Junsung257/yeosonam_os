# Affiliate open gate evidence — 2026-08-09

## Current state

- Branch: `affiliate-critical-remediation`
- Latest source commit: `990f7c04` plus the legacy content error-sanitization fix in the working tree
- Vercel preview build: Ready after the dynamic-route packaging fix
- `AFFILIATE_AUTH_SECRET`: configured as a sensitive Vercel variable for the remediation preview branch and Production

## Verified locally

- `npm run type-check -- --pretty false` — passed
- `npm run lint` — passed with zero warnings
- Affiliate security/portal/content contract tests — passed

## Remaining external gates

1. Supabase migrations must be applied to a non-production staging database and validated before Production.
2. Chrome must complete an authenticated partner smoke test: invitation/OTP, catalog, publication, test click, published URL, attribution, earnings, and settlement PDF.
3. Production promotion remains blocked until those two gates pass. No production data or settlement rows were changed during this audit.

## Security note

The preview deployment is protected by Vercel SSO. Browser verification must use the user's authenticated Chrome session; credentials were not entered or bypassed by the agent.
