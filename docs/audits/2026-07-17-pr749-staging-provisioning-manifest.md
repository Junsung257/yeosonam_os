# PR #749 Staging Provisioning Manifest

Date: 2026-07-17

## Verdict

`STAGING PROVISIONING READY - STAGING IDENTITY NOT VERIFIED`

No staging Supabase identity is currently verified in this worktree. This manifest tells an operator how to provision the protected staging path without exposing secrets or mutating production.

## Required GitHub Environment

Create a protected GitHub environment named `staging`.

Required protection:

- Required reviewer before workflow can access staging secrets.
- Branch restriction to `codex/public-egress-boundary-v1` or an approved PR #749 ref.
- No production secrets in this environment.
- Artifact retention at least 14 days for staging gate evidence.

## Non-Secret Variables

Set these as environment variables on the protected `staging` environment:

| Name | Required value / rule |
|---|---|
| `STAGING_SUPABASE_PROJECT_REF` | Staging project ref only. Must not equal production. |
| `STAGING_SUPABASE_URL` | Staging API URL, for example `https://<staging-ref>.supabase.co`. |
| `STAGING_DATABASE_HOST` | Staging DB host only. Must not equal production DB host. |
| `STAGING_ENVIRONMENT_LABEL` | `staging` |
| `PRODUCTION_SUPABASE_PROJECT_REF` | Production project ref for denylist comparison only. |
| `PRODUCTION_SUPABASE_URL` | Production API URL for denylist comparison only. |
| `PRODUCTION_DATABASE_HOST` | Production DB host for denylist comparison only. |
| `ALLOW_NON_PROD_DB_MUTATION` | `true` only after staging identity has been reviewed. |
| `EXPECTED_PR_NUMBER` | `749` |
| `STAGING_ENVIRONMENT_PROTECTION_ACK` | `protected-staging-reviewed`; set only on the protected `staging` environment after required reviewers/branch restrictions exist. |
| `PRODUCTION_SERVICE_ROLE_KEY_FINGERPRINT_DENYLIST` | SHA-256 fingerprint prefix of production service credential, not the key itself. |

## Required Secrets

Set these only on the protected `staging` environment:

| Secret | Rule |
|---|---|
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Staging-only service role key. Must not be a placeholder and must not match the production credential fingerprint denylist. |
| `STAGING_DATABASE_PASSWORD` | Staging DB password, if migration/inventory jobs require direct DB access. |
| `STAGING_SUPABASE_ACCESS_TOKEN` | Staging-scoped Supabase CLI token if CLI migration is used. |
| `STAGING_VERCEL_TOKEN` | Only if a staging/preview deployment action needs it. |

Never store production DB URL, production service-role key, production access token, or production connection string in the `staging` environment.

## Provisioning Runbook

1. Create a Supabase project dedicated to staging in the same region family as production unless cost/latency policy says otherwise.
2. Record the staging project ref, API host, DB host, and database name.
3. Confirm all three differ from production.
4. Create or verify a Vercel preview/staging environment that is not production.
5. Create GitHub protected environment `staging`.
6. Add required reviewers and branch restrictions.
7. Add the non-secret variables and staging-only secrets above. Set `STAGING_ENVIRONMENT_PROTECTION_ACK=protected-staging-reviewed` only after protection is active.
8. Run workflow `PR 749 Staging Data Gate` with `action=identity`, `allow_mutation=false`.
9. After identity passes, rerun with `allow_mutation=true` only for the exact current PR HEAD.
10. Run inventory before migration. Stop if migration history, checksum, schema drift, or destructive SQL is unexpected.
11. Apply migrations only to staging.
12. Generate snapshots, proofs, promotion tests, route text dumps, admin smoke evidence, and 500-package audit evidence.
13. Upload `pr749-staging-gate-evidence.json` as workflow artifact and validate it with `npm run verify:pr749-staging-evidence -- --require-pass`.

## Cleanup / Cost Control

- Fixture data must be removable by deterministic cleanup keys.
- Historical quarantine evidence should be preserved; staging fixtures may be removed after review unless `retain_fixtures=true`.
- If the staging project is temporary, record deletion owner and deletion date before creation.

## Current Blocker

The only safe current verdict is:

`STAGING IDENTITY NOT VERIFIED`

No remote migration, seed, proof write, publish decision, or snapshot promotion has been performed by this PR gate.
