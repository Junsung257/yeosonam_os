# Blog V4 Durable Content Factory

## Problem

The current Blog V4 release candidate has strong publication gates, but generation
is still driven by a large cron route and queue-shaped demand records. It cannot
durably answer which observed demand produced which immutable research, product
snapshot, generation attempts, approval, publication, and indexing result.
Transient failures can therefore exhaust a cron window, while operators see HTTP
success without a publishable inventory.

## Decision

Build one durable workflow per content operation and preserve the existing public
eligibility, evidence, representative, DeepSeek-only, publication-controller, and
atomic publication contracts.

```text
observed demand
  -> normalized demand cluster
  -> immutable content operation
  -> durable research/generation/repair workflow
  -> approved inventory or bounded terminal disposition
  -> single publication controller
  -> public snapshot and indexing outbox
```

The factory never estimates missing demand, never stores competitor bodies, never
uses mutable package rows as commercial evidence, and never lowers a hard factual
gate to fill a quota.

## Functional Requirements

- Materialize verified GSC, Naver, customer-question, product, and editor signals
  into canonical intent clusters.
- Choose `new`, `refresh`, `commercial_companion`, or `research_backlog` before a
  content operation is created.
- Prefer a material refresh when a representative already satisfies the intent.
- Persist every operation and stage event under an idempotency key and fencing token.
- Pin a current immutable public package snapshot, revision, and hash for commercial
  operations and reject stale pointers before approval/publication.
- Start one Workflow DevKit workflow for one operation; orchestration lives in the
  workflow and Node/DB/model work lives in durable steps.
- Permit at most five DeepSeek writer attempts. Empty or truncated responses retain
  only usage/cost evidence and are never selected as content.
- Route soft quality failures to evidence-bounded repair; keep conflicts, fabricated
  experience, stale HIGH-risk facts, and missing approval fail-closed.
- Keep generation and publication readiness separate.
- Keep publication in the existing controller and atomic publication RPC.
- Enforce rollout operation/new-URL caps of `3/2`, `10/6`, and `30/18`.
- Expose a truthful Demand-to-Indexed funnel and concrete skip reasons to operators.

## Data Requirements

- New public-schema tables are service-role only, have RLS enabled, explicitly
  revoke `anon` and `authenticated`, and grant only required privileges.
- `blog_demand_clusters` is the canonical normalized demand inventory.
- `blog_demand_cluster_signals` stores observed values and provenance, never guessed
  volume.
- `blog_content_operations` is the single operation ledger.
- `blog_content_stage_events` is append-only operational evidence.
- Existing search, queue, demand-signal, generation-run, generation-attempt, public
  snapshot, representative, and indexing tables remain the domain records.

## Safety Requirements

- Default feature and publication modes remain off/draft-only.
- No production deploy, database migration apply, production environment mutation,
  push, PR, automatic merge, redirect, or deletion in this implementation.
- Workflow and cron endpoints require existing cron authentication.
- RPCs are narrow `security invoker` functions unless elevated execution is strictly
  required; any definer function pins `search_path` and validates the service role.
- Workflow retries transient failures; contract violations use `FatalError`.
- Every write is replay-safe. A stale fencing token cannot append or transition.
- Draft-only produces no publication, public snapshot, cache, sitemap, RSS, IndexNow,
  or indexing-outbox side effect.

## Daily Portfolio Contract

At `max_30`, the upper bounds are 12 new informational, 4 new commercial, 2 new
seasonal/emergency, 8 material refreshes, and 4 package-content refreshes. The total
is 30 operations and at most 18 new URLs. Empty inventory stays empty.

Rollout stages are fixed:

- `pilot_3`: 3 operations, at most 2 new URLs.
- `ramp_10`: 10 operations, at most 6 new URLs.
- `max_30`: 30 operations, at most 18 new URLs.

The effective cap is the minimum of the database rollout and environment cap.

## Non-Goals

- Replacing the existing evidence, claim, representative, public eligibility, or
  publication controller systems.
- Twelve independent AI agents or unconstrained autonomous loops.
- Publishing 30 low-quality URLs merely because 30 slots exist.
- Generating search volume, customer statements, experiences, prices, dates, or
  source claims.
- Automatically merging or redirecting public URLs.
- Using Gemini, GPT, Claude, or a generic provider fallback in the blog lane.

## Acceptance Criteria

- Missing demand creates no operation.
- Same-intent representative selects refresh instead of a new URL.
- Immutable package snapshot pinning and stale-pointer rejection are tested.
- Workflow start, retry, resume, and duplicate-start contracts are tested.
- Attempts 1 through 5 are accepted; attempt 6 is rejected.
- DeepSeek truncation and empty-output paths fail closed.
- Draft-only and reviewed-only side-effect contracts pass.
- Rollout and per-type/new-URL caps pass for all three stages.
- Public surfaces exclude review-blocked and non-representative content.
- Dashboard funnel values are derived from the operation ledger, not HTTP status.
- Targeted tests, blog contract tests, type-check, lint, migration dry-run, release
  exact-set, and production build are run and recorded honestly.
