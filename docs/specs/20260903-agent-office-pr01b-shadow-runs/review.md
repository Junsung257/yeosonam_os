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

## Verification So Far

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
| pgTAP shadow ledger suite | PENDING — 61 assertions committed; local Docker service could not be started with the current host permission |
| Full repository TypeScript compile | PENDING CI — local shared dependency tree lacks existing lockfile packages; scoped compile passed |

## Pending Gate and Residual Risk

The migration has not been applied to any remote database. Before this review can
be marked complete, a fresh-dependency CI run and Local/Supabase Preview must
execute the pgTAP suite. Any SQL parse, privilege, lifecycle, or concurrency
failure is a hard stop. PR-01C remains outside this work and must not begin from
this pending state.
