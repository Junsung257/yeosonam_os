# Affiliate open gate evidence — 2026-08-09

## Current state

- Branch: `affiliate-critical-remediation`
- Latest source commit: `f634eac6`
- Vercel preview build: Ready at `https://os-kbwh60ffa-zzbaa0317-4596s-projects.vercel.app`
- `AFFILIATE_AUTH_SECRET`: configured as a sensitive Vercel variable for the remediation preview branch and Production

## Verified locally

- `npm run type-check -- --pretty false` — passed
- `npm run lint` — passed with zero warnings
- `npm test -- --run` — 662 files / 5,093 tests passed
- Affiliate security/portal/content contract tests — passed

## Remaining external gates

The co-brand landing now distinguishes `data_unavailable` from a real empty product result.

1. The linked Supabase project has eight local affiliate V2 migrations pending and seven remote-only migration versions that are not present in this branch. A `db push --dry-run --linked` is therefore blocked by migration-history drift; no repair or production schema mutation was performed.
2. A temporary Supabase preview branch was created without production data for validation, but its automatic migration run failed because the repository does not contain the remote migration history. The branch was deleted immediately after the read-only test.
3. Chrome must complete an authenticated partner smoke test: invitation/OTP, catalog, publication, test click, published URL, attribution, earnings, and settlement PDF. The current preview is protected by Vercel SSO and the connected Chrome session did not have an authenticated tab.
4. Production promotion remains blocked until those three gates pass. No production data or settlement rows were changed during this audit.

## Security note

The preview deployment is protected by Vercel SSO. Browser verification must use the user's authenticated Chrome session; credentials were not entered or bypassed by the agent.
