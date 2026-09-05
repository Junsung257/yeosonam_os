# Supabase Migration Baseline Repair

Last updated: 2026-09-05

## Decision

Repair the committed migration chain in an isolated branch before creating a new
Supabase Preview branch. This is a repository repair only: no production
migration, migration-history repair, `db push`, or deployment is part of this
change.

## Evidence

The Preview branch `ai-office-preview-20260905` failed before the AI Office
migrations ran. Its first migration attempted to create
`conversations.customer_id REFERENCES customers(id)` while `public.customers`
did not exist. The branch was paused after the failure.

The repository also contained duplicate 14-digit migration prefixes. Supabase
replays committed migrations lexicographically, so a fresh database cannot
reliably distinguish those files.

## Repair included

1. Add the schema-only foundational migration
   `20260330000000_foundational_schema_baseline.sql` before the first tracked
   migration.
2. Restore the schema-only legacy objects that later tracked migrations extend:
   `raw_documents`/package parsing objects, ad landing mappings, affiliate
   content insights, and PIN attempts.
3. Rename the unapplied duplicate migration files to unique timestamp prefixes.
   The production-applied original names remain unchanged where the production
   migration history proves which file owns the original prefix.
4. Restore the missing tenant column bridge for
   `post_engagement_snapshots` before the tenant-aware analytics view migration.
5. Drop the obsolete three-argument `update_booking_ledger` overload before
   the Phase 2a migration adds the default-compatible implementation.
6. Correct the historical Band import foreign key to the repository's actual
   UUID-keyed `travel_packages` table (`products` uses `internal_code` as its
   primary key and cannot satisfy the old reference).
7. Correct the historical PII RLS policies to use UUID-safe `auth.uid()`
   comparisons (and the current `conversations.customer_id` ownership
   contract) instead of comparing UUID columns with JWT text claims.
8. Restore replay-safe performance indexes to the baseline schema contracts:
   `conversations.customer_id`, `settlements.tenant_id`, legacy card-news
   columns, and guarded optional tables instead of columns introduced later.
9. Guard the optional `products.land_operator_id` index so the foreign-key
   index migration remains replayable before that later column exists.
10. Guard internal-function privilege revocations with `to_regprocedure()` so
   optional functions do not abort a clean replay.
11. Restore the marketing RPC migration's executable dollar-quoting and
   baseline column contracts (`total_cost`, `snapshot_date`, and the original
   predictive-insight/archive fields).
12. Keep keyword-performance bootstrap rows compatible with the foundational
   `app_settings(key, value)` contract; descriptions are added only by later
   schema migrations.
13. Make the security-policy migration replay-safe by dropping its named
   policies before recreation; earlier migrations may already have created the
   same policies.
14. Guard the `brand_kits(owner_type, owner_id)` index because a pre-existing
   legacy `brand_kits` table may not have those columns even when
   `CREATE TABLE IF NOT EXISTS` skips creation.
15. Guard the legacy `blog_posts` cleanup when that optional table is absent;
   retain the baseline `content_creatives.seo_title` cleanup contract.
16. Use the immutable fixed-timezone date expression for the SEO alert dedupe
   index; a direct `timestamptz::date` cast is not indexable in PostgreSQL.
17. Restore paging indexes to the actual baseline entities: use
   `content_creatives` instead of the untracked `blog_posts`, omit absent
   `b2b_packages`/`payments`, and retain `unmatched_activities`.
18. Make the Threads-column backfill inspect `card_news` through `to_jsonb`
   before dropping optional legacy columns, so the migration works when those
   columns were never present.
19. Align the mileage challenge admin policy with the foundational
   `admin_users.user_id` identity table instead of the nonexistent `admins`
   relation.
20. Add a repository audit script that fails on duplicate prefixes, missing
   baseline files, or data-bearing statements in the foundational migration.

## Safety boundaries

- No seed/demo/production rows are introduced by the baseline or restore files.
- Existing migration SQL is changed only when hosted replay evidence identifies
  a deterministic schema/type defect; duplicate files are renamed so their
  original SQL content and domain intent remain attributable.
- No remote Supabase project is modified.
- No `supabase migration repair` is run.
- The AI Office remains observe-only and unrelated runtime/command changes are
  out of scope.

## Prefix normalization map

| Original | Repaired filename |
| --- | --- |
| `20260423000000_jarvis_v2_request_context.sql` | `20260423000001_jarvis_v2_request_context.sql` |
| `20260423010000_jarvis_v2_tenant_columns.sql` | `20260423010001_jarvis_v2_tenant_columns.sql` |
| `20260423020000_jarvis_v2_rls_policies.sql` | `20260423020001_jarvis_v2_rls_policies.sql` |
| `20260426000000_post_engagement_snapshots.sql` | `20260426000001_post_engagement_snapshots.sql` |
| `20260504250000_keyword_pool_blog_seo.sql` | `20260504250001_keyword_pool_blog_seo.sql` |
| `20260506100000_llm_prompts_revoke_anon.sql` | `20260506100002_llm_prompts_revoke_anon.sql` |
| `20260510000000_sprint4_saas_billing.sql` | `20260510000001_sprint4_saas_billing.sql` |
| `20260512000000_travel_packages_indexes.sql` | `20260512000001_travel_packages_indexes.sql` |
| `20260513000000_destination_aggregate_mv.sql` | `20260513000001_destination_aggregate_mv.sql` |
| `20260513100000_llm_semantic_cache.sql` | `20260513100001_llm_semantic_cache.sql` |
| `20260513200000_design_archetypes_and_hashtag_pool.sql` | `20260513200001_design_archetypes_and_hashtag_pool.sql` |
| `20260513200000_itinerary_data_jsonschema_check.sql` | `20260513200002_itinerary_data_jsonschema_check.sql` |
| `20260513300000_review_fixes.sql` | `20260513300001_review_fixes.sql` |
| `20260513400000_itinerary_check_immutable_wrapper.sql` | `20260513400001_itinerary_check_immutable_wrapper.sql` |
| `20260519100000_travel_packages_catalog_id.sql` | `20260519100001_travel_packages_catalog_id.sql` |
| `20260524000000_phase0_enable_rls.sql` | `20260524000001_phase0_enable_rls.sql` |
| `20260601142000_product_registration_drafts_v3.sql` | `20260601142001_product_registration_drafts_v3.sql` |

## Promotion gate

This repair is ready for a new Preview replay only after:

- the audit script passes;
- a clean environment runs two consecutive `supabase db reset --local
  --no-seed` passes;
- the migration chain reaches the end with no duplicate prefix;
- a legacy-schema upgrade fixture preserves existing rows; and
- the repaired migration names are reconciled against the target project's
  migration history before any remote push.

Until those checks pass, this branch is not Production-ready.

## Docker-free local fallback

The repository includes `.github/workflows/migration-baseline-replay.yml` for
environments where Docker Desktop cannot start. GitHub's Ubuntu runner provides
the Docker-compatible runtime required by the Supabase CLI and runs the same
audit plus two clean `db reset --local --no-seed` passes. The workflow has no
Supabase secrets and never connects to the production project.
