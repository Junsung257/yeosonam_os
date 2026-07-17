# PR #749 Staging Identity Discovery

Date: 2026-07-17

## Verdict

`STAGING IDENTITY NOT VERIFIED`

This discovery was run after commit `977e023c083ec99cb18535468203674f35ee8355`.

## Current PR State

| Field | Value |
|---|---|
| Repository | `Junsung257/yeosonam_os` |
| PR | `#749` |
| Branch | `codex/public-egress-boundary-v1` |
| HEAD | `977e023c083ec99cb18535468203674f35ee8355` |
| State | Open |
| Draft | Yes |
| Mergeable | Yes |
| GitHub Actions | Passing |
| Vercel | Passing |
| Local worktree | Clean |

## GitHub Environment Discovery

The repository currently exposes these GitHub environments:

| Environment | Protection rules |
|---|---|
| `Preview` | none reported |
| `Preview - os` | none reported |
| `Preview - yeosonam-os` | none reported |
| `Production` | none reported |
| `Production - os` | none reported |
| `Production - yeosonam-os` | none reported |

No environment named `staging` was found.

Because PR #749 requires a protected GitHub environment named `staging`, the protected workflow cannot be treated as activation-ready yet.

## Local Environment Discovery

Only one local env file exists in the PR worktree:

- `.env.prod`

The no-write gate blocks this file as staging evidence because:

- environment label resolves to production
- staging DB host is missing
- explicit staging project allowlist is missing
- production project/DB denylist values are missing
- `ALLOW_NON_PROD_DB_MUTATION=true` is missing
- protected staging ACK is missing

No production or staging mutation was performed.

## Latest No-Write Gate

Command:

```bash
npm run verify:pr749-staging-data-gate -- --json --expected-head 977e023c083ec99cb18535468203674f35ee8355 --env-file=.env.prod
```

Result:

- `status`: `blocked`
- `executiveVerdict`: `STAGING IDENTITY NOT VERIFIED`
- `expectedHeadMatches`: `true`
- `workingTreeClean`: `true`
- `productionMutationPerformed`: `false`
- `stagingMutationPerformed`: `false`

Blocked identity checks:

- `explicit-non-prod-opt-in`
- `staging-db-host-present`
- `environment-label-non-production`
- `project-ref-allowlisted`
- `production-project-ref-denylisted`
- `production-db-host-denylisted`
- `db-host-separated-from-production`

## Consequence

The following requested staging tasks remain intentionally unexecuted:

- staging migration apply
- staging seed/backfill
- snapshot persistence
- proof persistence
- atomic promotion/RPC verification
- live RLS/grant/RPC security inventory
- external route positive/negative path smoke
- Admin public-review browser smoke
- 500-package regression audit

These are not skipped as success. They are blocked by missing verified staging identity.

## Required Next Operating Inputs

Create and protect a GitHub environment named `staging`, then configure:

- `STAGING_SUPABASE_PROJECT_REF`
- `STAGING_SUPABASE_URL`
- `STAGING_DATABASE_HOST`
- `STAGING_ENVIRONMENT_LABEL=staging`
- `STAGING_ENVIRONMENT_PROTECTION_ACK=protected-staging-reviewed`
- `PRODUCTION_SUPABASE_PROJECT_REF`
- `PRODUCTION_SUPABASE_URL`
- `PRODUCTION_DATABASE_HOST`
- `PRODUCTION_SERVICE_ROLE_KEY_FINGERPRINT_DENYLIST`
- `ALLOW_NON_PROD_DB_MUTATION=true`
- `STAGING_SUPABASE_SERVICE_ROLE_KEY` as a protected environment secret

After those are present, rerun the protected workflow:

`PR 749 Staging Data Gate`

Use `action=identity` first. Do not run migration or write stages until identity passes.
