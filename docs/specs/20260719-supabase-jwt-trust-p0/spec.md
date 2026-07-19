# Supabase JWT Trust P0

## Objective

Pin access-token verification to the configured Supabase project instead of trusting an unverified token issuer as the JWKS network destination.

## Security contract

- ES256/RS256 keys are loaded only from the configured project issuer JWKS URL.
- HS256 and asymmetric tokens require configured issuer, `authenticated` audience and role, expiration, and a UUID subject.
- Unsupported algorithms fail closed.
- Existing admin-guard callers continue accepting normally signed project access tokens.

## Out of scope

- Tenant membership, tenant routes, middleware policy, RLS, and migrations.
- Remote Supabase mutations or configuration changes.
