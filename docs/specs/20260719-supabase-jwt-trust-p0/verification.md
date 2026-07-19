# Verification

## Automated evidence

- `npx vitest run src/lib/supabase-jwt-verify.test.ts src/lib/supabase-jwt-callers.test.ts src/lib/admin-guard.test.ts`
  - PASS: 3 files, 15 tests.
- `npx eslint src/lib/supabase-jwt-verify.ts src/lib/supabase-jwt-verify.test.ts src/lib/supabase-jwt-callers.test.ts`
  - PASS: no errors or warnings.
- `npm run type-check`
  - PASS: `tsc --noEmit`.
- `git diff --check`
  - PASS.

## Covered regressions

- A forged token issuer cannot redirect JWKS discovery to attacker infrastructure.
- Configured Supabase ES256 and HS256 access tokens remain accepted.
- Wrong issuer, audience, role, subject, expiration, and unsupported algorithms are rejected.
- Existing admin authorization and actor-label callers accept a normally signed configured-project token.

## Manual / remote work

- No remote Supabase mutation or environment change was performed.
- Production environment values and live token issuance remain deployment-owner checks.
