# Spec: Migration Baseline Remediation

Last updated: 2026-07-16

## Problem

An empty local Supabase database could not apply the repository migration chain. The first migration, `20260331000000_add_conversations_intents_actions_influencers.sql`, referenced `public.customers`, but no earlier tracked migration created that table. After the baseline was restored, additional historical contract defects and duplicate migration versions also had to be corrected before the chain became replayable.

This defect predates informational-content remediation commit `7f94ab20`, but it blocked R15 verification of the fourteen informational-content migrations.

## Objective

Make the committed migration chain capable of recreating the required pre-tracking schema from an empty Supabase database without importing legacy demo data and without changing product parser/snapshot/render behavior. Where historical migrations themselves contain replay defects, make the smallest evidence-backed correction and record the deployment-history consequence.

## Required Behavior

1. A deterministic foundational migration runs before `20260331000000`.
2. It creates only schema objects that the tracked migration chain already assumes exist.
3. It contains no demo tenants, mock data, operating rows, credentials, or production-derived data.
4. It is idempotent against a legacy schema containing the same foundational objects.
5. Duplicate migration versions are normalized to unique versions without changing their domain intent.
6. Historical migrations may be minimally corrected when PostgreSQL replay proves their referenced schema or privilege contract is invalid.
7. `supabase start` and two consecutive `supabase db reset --local --no-seed` runs succeed from an empty volume.
8. A legacy upgrade simulation applies the V2 and correction tail safely without dropping, rewriting, or deleting existing rows.
9. R15 pgTAP, RLS, atomic publication, concurrency, rollback, product-boundary, and app checks pass after the migration chain succeeds.

## Safety Boundaries

- No remote Supabase connection, `--linked`, `db push`, migration repair, staging, or production mutation.
- No use of `.env.prod` or remote database URLs.
- No execution of `db/_archive/*.sql` as a whole.
- No changes to product parsing, product snapshots, product writers, product detail pages, or product landing pages.
- No migration squashing or remote migration-history mutation.
- Any historical version normalization must be reconciled explicitly against staging/production history before `db push`.
- No seed data in the foundational migration.

## Design Constraints

- The new migration version must sort before `20260331000000` because Supabase applies committed migrations lexicographically by timestamp.
- The migration is intentionally backfilled and must be idempotent for later staging review because an existing database may already contain the foundational objects.
- `CREATE TABLE IF NOT EXISTS` alone does not reconcile a differently shaped existing table. Upgrade simulation must prove the legacy shapes used by this repository are compatible.
- Foundational foreign-key columns require indexes when the baseline owns both the table and the constraint.
- Public-schema access remains governed by later existing RLS/grant migrations; the baseline must not introduce permissive browser grants.

## Acceptance Criteria

- Empty-volume migration chain: PASS.
- Empty-volume `db reset --local --no-seed`: PASS twice consecutively.
- All 374 final migrations apply in order with zero duplicate version groups.
- Legacy fixture upgrade: PASS with row preservation.
- pgTAP 77/77, zero skip.
- RLS role matrix: PASS.
- Atomic publication, idempotency, concurrency, and failure rollback: PASS.
- Information 10-case eval and product `auto_heal + product_id` boundary: PASS.
- Full tests, typecheck, lint, and build: PASS.
- R15 report updated with actual evidence.

## Out Of Scope

- Remote migration-history repair or deployment procedure execution.
- Production data backfill.
- Existing informational-post rewrite/merge/removal.
- Product-content engine changes.
