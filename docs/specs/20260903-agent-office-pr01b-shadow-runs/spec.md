# Feature Spec: Agent Office PR-01B Shadow Runs

## Goal

Add a non-authoritative execution-attempt ledger for newly created Agent Office shadow runs. The ledger records bounded runtime evidence without changing the authority of `agent_tasks`, `agent_trace_spans`, approvals, commands, retries, or Office KPIs.

## In Scope

- A new `agent_runs` table for new execution attempts only.
- Service-only RLS and explicit table/function privileges.
- Exact-run creation, atomic lease, heartbeat, lifecycle transition, completion, and expired-lease orphaning RPCs.
- Hashed lease tokens plus monotonic fencing tokens.
- A TypeScript shadow writer that validates the PR-01A registries before persistence.
- Read-only reconciliation diagnostics against existing Task and Trace evidence.
- pgTAP and Vitest coverage for lifecycle, concurrency boundaries, tenant isolation, privileges, and mismatch detection.
- Local Supabase or ephemeral Preview validation only.

## Authority Boundary

```text
agent_tasks       = business task state SSOT
agent_trace_spans = existing observation evidence
agent_runs        = new-run-only, shadow execution evidence
```

`agent_runs` is not an authorization source. It cannot select work, cause retry, approve an action, execute a command, change a Task, calculate Office KPIs, or grant a Worker access.

## Non-Negotiable Invariants

- Historical backfill and inferred legacy Runs are forbidden.
- Every Run is permanently `shadow`, non-authoritative, and command-disabled.
- Raw prompts, tool arguments, model responses, customer data, secrets, signed URLs, and lease tokens are not stored.
- A Run's Task, tenant, actor, session, contract references, policy snapshot, budget, and input hash are immutable after creation.
- Lease acquisition is an exact-Run operation. There is no queue-selection or automatic dispatch RPC.
- Lease credentials are stored only as SHA-256 hashes. Every mutation after claim requires both the lease secret and current fencing token.
- A stale, expired, wrong-tenant, wrong-token, or wrong-fence caller changes zero rows.
- Terminal Runs cannot be reclaimed or rewritten.
- Task state is never changed by a Run RPC.
- No delete grant or delete RPC is provided.

## Run Lifecycle

```text
created -> leased -> starting -> running -> waiting_approval -> running
                                      |                      |
                                      +----> terminal <------+

active expired lease -> orphaned
```

Terminal states are `succeeded`, `failed`, `timed_out`, `cancelled`, and `orphaned`. Successful completion requires an output hash and forbids an error code. Failed, timed-out, cancelled, and orphaned completion requires an error code.

## Success Criteria

- [x] Table, constraints, RLS, grants, indexes, and RPC privileges are verified in pgTAP.
- [x] Two claim attempts cannot both acquire one Run.
- [x] Tenant mismatch, stale fence, wrong token, and expired lease fail closed.
- [x] Contract and task identity cannot drift after creation.
- [x] Reconciliation reports mismatches without repairing or mutating Task/Trace state.
- [x] No existing runtime, worker, provider, event, command, Office KPI, or UI imports the new writer.
- [x] No Production migration is applied.
- [x] PR-01C is not started.

## Rollback

Before any separately approved remote migration, reverting this PR removes only inactive code, tests, documentation, and an unapplied migration. After a future environment applies the migration, rollback requires a separately reviewed forward migration; existing audit rows must not be destructively dropped by this PR.
