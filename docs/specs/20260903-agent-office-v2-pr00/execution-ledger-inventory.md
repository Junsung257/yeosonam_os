# Execution Ledger Inventory

## Summary

Yeosonam already contains most reliability primitives, but they are domain-local and intentionally different. PR-01 should extract contracts from these patterns, not copy one table wholesale or introduce a foreign control plane.

## Pattern Comparison

| Pattern | Atomicity | Lease / heartbeat | Expiry and retry | Idempotency | Partial side effect / receipt | Recovery | Reusable decision |
|---|---|---|---|---|---|---|---|
| Media Codex worker | `claim_codex_media_job_v1` uses advisory transaction lock plus `FOR UPDATE SKIP LOCKED` | owner and expiry; no heartbeat, bounded 5–90 minute lease | max two total/daily attempts; expired lease returns to queue or exhausts | row identity plus atomic claim; completion is conditional on expected owner | media asset stores result/content hash and errors; no generic external command receipt | `recoverExpiredCodexLeases()` releases or exhausts stale rows | Reuse atomic claim, owner-checked finish, content hash, daily budget. Do not reuse the no-heartbeat limit for longer agent runs. |
| Product registration V4 | conditional compare-and-update claims on upload jobs | bounded `v4_lease_expires_at`; no universal heartbeat | expired extraction/normalization work recovered; attempt count increments | job/stage identity and outbox `dedupe_key` | stage state and outbox status; domain artifacts persist | expired leases released; outbox moves to failed/dead-letter | Retain only for compatibility. New generic Run should prefer V6 fencing and atomic RPCs. |
| Product registration V6 | `claim_product_registration_v6_workflow` atomically increments fencing token; stage writes compare expected token | workflow run ID, fencing token, `v6_last_heartbeat_at` | watchdog restarts young stale work, quarantines older work, records dead letter with operation key | tenant-scoped unique operation keys; provider-call ledger hashes | stage artifacts, dead-letter rows, provider request/response hashes | watchdog policy, restart, quarantine, dead letter | Best long-run reference: fencing token, heartbeat, stale-worker rejection, operation key, watchdog. |
| Finance Clobe sync | advisory locks protect account sync and settlement commands | UUID lease token plus expiry and heartbeat RPC | expired running sync is failed before a new one begins | mandatory command idempotency key plus advisory lock and request-conflict checks | command tables store request/result JSON; immutable settlement evidence and audit events | replay returns stored result; reconciliation RPCs repair provider memo/allocation state | Best command reference: exact idempotency conflict detection, receipt/result replay, atomic reconciliation. Domain finance rules remain stronger than generic Office. |
| Blog claim / retry / Inngest | checkpointed `step.run`; queue/generation claims and atomic publication are domain-owned | Inngest run state plus queue claim leases; keyed concurrency per queue ID | function retries 3; queue attempts and quarantine/dead-letter-like terminal states are separately bounded | `event.id` plus queue ID/content version; generation dedupe and atomic publication keys | generation attempts, claim packets, quality decisions, preview evidence, publication/indexing outbox | retries resume at failed checkpoint; unsafe candidates quarantine; publication controller and outbox reconcile | Reuse checkpointed workflow and immutable evidence chain. Preserve DeepSeek-only and publication controller boundaries. |
| Agent Task state machine | compare current status in update; allowed transitions in code | no execution lease, heartbeat, actor attempt, or fencing | task retries/expiry exist; housekeeping terminalizes stale request work | optional unique task `idempotency_key` | `result_payload`, incidents, traces; not an exact command receipt | housekeeping expires stale task/approval/trace; cannot resume execution | Keep Task as objective/control state. Its missing lease and attempt identity is the reason for `agent_runs`. |
| Decision Packet | packet created before approval and linked to action | none | packet can become stale; no subject fingerprint invalidation | action identity only; multiple packets possible | pre-action dry run/evidence; persistence failures are swallowed | no durable resume; outcome update is best-effort | Reuse packet shape and evidence concepts, but actionable approval must fail closed and bind exact hashes. |
| Domain kill switches | domain-specific durable state and code gates | not applicable | explicit freeze/recovery gates | scope/version specific | state transitions and audit evidence vary by domain | manual or gated recovery | Compose domain kill switches; never replace them with one generic boolean. |

## Source Evidence

| Pattern | Primary repository evidence |
|---|---|
| Media | `supabase/migrations/20260828090056_media_codex_worker_v1.sql`; `src/lib/media-generation/persistence.ts`; `scripts/codex-media-job.mjs` |
| Product V4 | `src/lib/product-registration-v4/jobs.ts`; `src/lib/product-registration-v4/outbox-worker.ts` |
| Product V6 | `supabase/migrations/20260811030151_product_registration_v6_automation_core.sql`; `src/app/api/cron/product-registration-v6-watchdog/route.ts`; `src/lib/product-registration-v6/watchdog-policy.ts`; `src/lib/product-registration-v6/provider-call-ledger.ts` |
| Finance | `supabase/migrations/20260824221515_harden_clobe_sync_reconciliation_and_finalization.sql`; `docs/settlement-current-ssot.md` |
| Blog | `src/inngest/functions/blog-autopilot-v4.ts`; `src/app/api/cron/blog-generate/route.ts`; `docs/blog-autopublish-contract.md` |
| Agent task | `supabase/migrations/20260504003000_agent_tasking_core.sql`; `supabase/migrations/20260530103000_agent_tasking_open_ready.sql`; `src/lib/agent/task-machine.ts`; `src/lib/agent/tasking.ts` |
| Decision Packet | `supabase/migrations/20260628203000_agent_action_decision_packets.sql`; `src/lib/agent-action-decision-packets.ts`; `src/lib/agent-action-registry.ts` |
| Kill switches | `product_registration_v5_kill_switches`; Blog publication rollout state; Ad OS tenant policy/kill-switch routes and domain SSOTs |

## Target Run Lease State

```text
created
  -> leased        atomic claim; increment fencing token
  -> timed_out     never claimed before task expiry

leased
  -> starting      owner begins startup with matching token/fence
  -> timed_out     lease deadline passes before start

starting
  -> running       Runtime accepts the bounded input
  -> failed        startup fails before work begins
  -> timed_out     startup exceeds deadline

running
  -> running       heartbeat extends bounded lease with matching token/fence
  -> waiting_approval  durable exact-subject approval wait; no write authority
  -> succeeded     output hash and usage recorded atomically
  -> failed        terminal error and evidence recorded
  -> cancelled     cooperative stop before side effect, or after reconciliation
  -> timed_out     elapsed/task deadline reached
  -> orphaned      watchdog observes stale heartbeat or lost owner; old worker loses authority

waiting_approval
  -> running       exact approval subject resumes with a valid lease/fence
  -> cancelled     cancellation reconciled before any effect
  -> timed_out     approval wait expires
  -> orphaned      owner/lease evidence is lost

timed_out | orphaned
  -> no transition
  -> a new Run row may be created for the same Task if retry policy allows
```

Rules:

- A lease is capability evidence, not a human-readable worker name.
- Store only a lease-token hash. Compare the submitted token and fencing token in one atomic RPC.
- Heartbeat never renews past the Task budget or expiry.
- A stale worker cannot finish after a newer fencing token exists.
- Retry creates another Run row; it does not rewrite the prior Run into a fictional success.
- Task terminal state is derived only after the authoritative Run outcome and any required reconciliation are durable.

## Shadow Introduction

```text
migration approved later
  -> record new execution attempts only
  -> compare Run outcome to current Task/trace outcome
  -> surface mismatches as shadow incidents
  -> allow read-only diagnostic drilldown, but no Office KPI calculation
  -> promote lease/cost authority only after reconciliation passes
```

During Foundation, a Run cannot decide retry, Worker authority, Task terminal state, or Command access. `agent_tasks` and existing domain ledgers remain authoritative.

Legacy traces remain linked as legacy evidence with `unknown_run`. Creating inferred historical Runs is forbidden because it would convert guesses into audit facts.

## Gaps That Must Block A Production Command

- no required Decision Packet persistence;
- no normalized command schema and argument hash;
- no approval-subject fingerprint and invalidation rule;
- no generic exact-effect receipt;
- no uncertain outcome/reconciliation state;
- no cross-domain compensation contract;
- no atomic relation between Run completion and command receipt;
- no tenant-scoped command permission proof.

These gaps are reasons to keep the first Production Command count at zero, not reasons to add a broad SQL or shell tool.
