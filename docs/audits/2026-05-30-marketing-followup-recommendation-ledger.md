# Marketing Follow-up: Recommendation Ledger

Date: 2026-05-30

## Scope

This follow-up upgrades the Marketing Command Center from a stateless recommendation list to an auditable operating loop.

## Implemented

- Added `marketing_recommendations` migration for action history, statuses, evidence, expected impact, realized impact, and target rows.
- Added `src/lib/marketing/recommendation-ledger.ts` to sync current Next Best Actions into the ledger.
- Connected `/api/admin/marketing/actions` and `/api/admin/marketing/asset-groups` to attach ledger status and hide dismissed actions.
- Connected `/api/admin/marketing/actions/apply` through `action-runner.ts` so created or reused drafts mark the recommendation as applied.
- Added `/api/admin/marketing/actions/dismiss` for operator dismissal.
- Added Command Center UI states for applied actions and dismiss handling.

## Safety Behavior

The production Supabase project does not yet show the new migration in its migration list, and the local environment does not include a direct Postgres connection string. Until the migration is applied, list/read paths gracefully fall back to stateless recommendations. Dismiss requires the ledger table and returns a migration-needed error instead of corrupting state.

## Verified

- `npm run type-check`
- `.env.local` live Supabase smoke via `getMarketingAssetGroups(3)` and `syncMarketingRecommendations(...)`

Smoke result:

```json
{
  "groups": 3,
  "actions": 11,
  "ledger": 0
}
```

`ledger: 0` is expected before applying the migration.

## Remaining Activation Step

Apply `supabase/migrations/20260530090000_marketing_recommendations_ledger.sql` to the Supabase project through the Supabase CLI or dashboard SQL editor. After that, the same code path will begin persisting recommendation history automatically.
