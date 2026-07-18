# Plan

1. Replace token-derived issuer/JWKS resolution with configured Supabase project trust.
2. Enforce access-token claims and supported algorithms for all verification paths.
3. Add forged issuer/JWKS and normal caller regressions.
4. Run focused tests, changed-file lint, full type-check, and diff checks.
