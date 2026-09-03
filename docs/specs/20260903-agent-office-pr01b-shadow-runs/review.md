# Review: Agent Office PR-01B

## Scope Result

- Added one new `agent_runs` ledger for new execution attempts only.
- Added seven exact-Run RPCs: create, safe read, claim, transition,
  heartbeat, complete, and expired-lease orphaning.
- Added no queue selection, automatic dispatch, retry, Task mutation, approval,
  Command, Office KPI, API, UI, Inngest workflow, or Runtime/Provider adapter.
- Limited database creation to `research.technology_scout@1.0.0`, the exact
  PR-01A Runtime/Tool profiles, their schema hash, and their numeric budgets.
- Added no historical Backfill and no Production database application.

## Safety Decisions

- `agent_tasks` remains business-state SSOT; `agent_trace_spans` remains existing
  observation evidence; `agent_runs` remains a non-authoritative shadow.
- `service_role` has no direct table privilege. Security-definer RPCs have pinned
  empty search paths and are executable only by `service_role`.
- Lease acquisition names one preselected Run ID. A high-entropy Lease Secret is
  stored only as a SHA-256 digest and is never returned. Token plus Fencing Token
  is required for all Worker mutations.
- Immutable contract identity, bounded usage, valid lifecycle edges, terminal
  immutability, tenant equality, and permanently false authority/Command/
  Production flags are database constraints or trigger checks.
- RPC receipts contain hashes and opaque references, never raw prompts, Tool
  arguments, model responses, customer data, Secrets, signed URLs, or Lease
  digests.
- Reconciliation is a pure diagnostic returning `matched`, `pending`, or
  `mismatch`. It cannot update Task/Trace state or promote a Run.

## Verification

| Check | Result |
|---|---|
| Shadow writer/reconciliation Vitest | PASS — 9/9 |
| Scoped TypeScript compile | PASS |
| New TypeScript ESLint | PASS — zero warnings |
| Migration safety checker | PASS — zero issues |
| Migration prefix audit | PASS — zero new collisions |
| Declared write-surface check | PASS |
| Agent workflow strict check | PASS — zero findings |
| LLM telemetry strict audit | PASS |
| Full repository harness | PASS — zero findings, deterministic contracts 30/30, audit tests 29/29 |
| Agent risk ratchet | PASS — new violations 0 |
| Whitespace/error-marker check | PASS |
| Isolated Supabase Preview migration | PASS — the actual PR-01B migration applied without SQL errors |
| Preview executable database assertions | PASS — 35/35, including RLS, privileges, Lease/Fencing, lifecycle, tenant boundary, and Task SSOT non-mutation |
| pgTAP shadow ledger suite in Preview | PASS — 61/61; zero `not ok` diagnostics |
| Full repository TypeScript compile | PASS — fresh-dependency GitHub CI |
| GitHub Build & Test | PASS |
| GitHub Code Quality | PASS |
| GitHub Security Scan | PASS |
| GitHub Next build and bundle budget | PASS |

## Gate Result and Residual Risk

The migration was applied only to disposable, no-production-data Supabase Preview
branches. Both branches were deleted after verification. The Production database
was not changed.

The Supabase query client warned that the minimal Preview-only `tenants` and
`agent_tasks` fixture tables had no RLS. Those two tables were deliberately
reduced test fixtures, were not part of the PR migration, and were destroyed with
the Preview. The `agent_runs` table itself passed enabled and forced RLS checks,
and the repository's real `tenants` and `agent_tasks` definitions were not
altered.

The local Docker service remained unavailable, so the committed pgTAP file was
executed directly against the isolated Preview over one reserved PostgreSQL
session. Its transaction, `plan(61)`, all assertions, `finish()`, and rollback
completed with 61 `ok` results and zero failures.

Production application remains a separate approval. Until then this PR provides
inactive schema/code only. `agent_runs` must not become a KPI, retry, authorization,
dispatch, or Command source. PR-01C remains outside this work and must not begin
automatically.
