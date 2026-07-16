# PR #749 Staging Identity Gate Evidence

Date: 2026-07-17

## Verdict

`STAGING IDENTITY NOT VERIFIED`

No staging write, migration, seed/backfill, proof persistence, or promotion RPC verification was executed.

## Evidence

- PR: #749
- Branch: `codex/public-egress-boundary-v1`
- HEAD: `20b9daacb50b002bd9d3e137931c68688ea38d3a`
- PR state: open, Draft
- GitHub Actions / Vercel for HEAD: success
- Worktree: clean before adding this guard

## Why Writes Are Blocked

The only local environment file found for this worktree was `.env.prod`.

Observed non-secret identity signals:

- `VERCEL_ENV=production`
- `NEXT_PUBLIC_SUPABASE_URL` host: `ixaxnvbmhzjvupissmly.supabase.co`
- `SUPABASE_URL` host: `ixaxnvbmhzjvupissmly.supabase.co`
- The project ref `ixaxnvbmhzjvupissmly` is documented in this repo as the production Supabase ref.
- `SUPABASE_SERVICE_ROLE_KEY` is a placeholder, so staging read inventory cannot run through the API.
- No explicit write guard values were present:
  - `EXPECTED_STAGING_PROJECT_REF`
  - `EXPECTED_STAGING_DB_HOST`
  - `PRODUCTION_PROJECT_REF_DENYLIST`
  - `PRODUCTION_DB_HOST_DENYLIST`
  - `ALLOW_NON_PROD_DB_MUTATION=true`

## Guard Added

Added `scripts/verify-staging-identity-gate.mjs` and `npm run verify:staging-identity`.

The guard fails closed unless all of the following are true:

- explicit non-production mutation opt-in is present: `ALLOW_NON_PROD_DB_MUTATION=true`
- staging project ref is present
- staging API host is present
- staging DB host is present
- environment label is present and not production/prod
- staging project ref is explicitly allowlisted
- production project ref denylist exists
- production DB host denylist exists
- staging project ref differs from production and is not denylisted
- staging API host differs from production API host
- staging DB host differs from production DB host and is not denylisted

The guard reports only non-secret identity evidence and never prints service keys, tokens, passwords, or JWTs.

## Verification

Commands:

```bash
npm run verify:staging-identity -- --self-test --json
npm run verify:staging-identity -- --json --env-file=.env.prod
node scripts/verify-readiness-contracts.mjs --json
```

Expected result:

- self-test passes
- `.env.prod` is blocked
- readiness contracts include the staging identity gate self-test

## Next Required Input

To proceed with the real staging data gate, provide a non-production environment with:

- `STAGING_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `EXPECTED_STAGING_PROJECT_REF`
- `EXPECTED_STAGING_DB_HOST`
- `STAGING_PROJECT_REF_ALLOWLIST`
- `PRODUCTION_PROJECT_REF_DENYLIST`
- `PRODUCTION_DB_HOST_DENYLIST`
- `ALLOW_NON_PROD_DB_MUTATION=true`
- non-placeholder staging service credentials through the approved secret channel

Only after this guard passes should staging migration, inventory, snapshot/proof generation, promotion RPC checks, external route checks, and the 500-package audit be executed.
