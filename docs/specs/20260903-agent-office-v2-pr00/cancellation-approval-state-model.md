# Cancellation, Approval, And Side-Effect State Model

## Current Constraint

The current task state machine permits transitions such as `running -> cancelled`, but a task status update does not stop a worker, undo a database write, or prove whether an external side effect occurred. Office V2 must treat cancellation as intent plus reconciliation, not as an enum shortcut.

The current `agent-executor` also reads up to ten `approved` actions and executes them without an atomic action claim/lease. A concurrent executor can observe the same approved action. Therefore no future Office Command may use this path until action claim, idempotency, receipt, and reconciliation are hardened.

## Cancellation Command Lifecycle

Logical lifecycle, represented by the existing action/approval authority plus future receipts:

```text
requested
  -> rejected
  -> expired
  -> approved

approved
  -> executing       atomic command claim

executing
  -> completed       no side effect or fully reconciled cancellation
  -> failed          known failure with no uncertain effect
  -> uncertain       worker/transport failed across a possible side effect

uncertain
  -> completed       read-after-write reconciliation proves final state
  -> failed          reconciliation proves no cancellation effect
  -> compensation_required

compensation_required
  -> completed       approved compensation and reconciliation receipt exist
```

This lifecycle does not add `cancel_requested`, `compensating`, or `reconciled` to `agent_tasks.status`.

## Immediate Cancellation Eligibility

Only this predicate permits a direct task terminal transition:

```text
task.status == queued
AND no active Run lease
AND no active Action/Command
AND no durable or external side effect
```

The update must compare the current task status and re-check the absence of an active lease/action in the same transaction or authoritative RPC. A prior read in application code is insufficient.

## Running Task Cancellation

```text
cancel request
  -> build exact Decision Packet
  -> bind task ID + active Run ID + fencing token + target hash
  -> approval if policy requires it
  -> atomically claim cancellation Command
  -> mark cooperative stop intent visible to the matching Run
  -> worker checks stop at a safe checkpoint
  -> inspect partial work and external/domain receipts
  -> compensate only through a domain-approved Command
  -> write reconciliation receipt
  -> derive final Task state
```

If the worker cannot be interrupted, the cancellation remains pending/uncertain until the Run finishes or its lease expires and reconciliation completes. The UI must say `중단 확인 중`, not `취소 완료`.

## Approval Subject Fingerprint

An actionable approval binds this canonical subject:

```text
tenant_id
action_type
command_schema_version
command_schema_hash
normalized_arguments_hash
target_object_versions
input_artifact_hashes
decision_packet_hash
policy_versions
tool_profile_version
risk_level
```

The hash is calculated server-side from canonical serialization. Approval resumes only when the current subject hash exactly equals the approved hash.

Any change to arguments, schema, target versions, artifacts, policy, tool profile, tenant, or risk invalidates the approval. The system creates a new Decision Packet and new approval request; it never edits the approved subject in place.

## Reviewer Independence

| Risk | Mandatory constraints |
|---|---|
| all | `producer_run_id != reviewer_run_id`; producer and reviewer actor/session differ |
| low/medium default | separate reviewer Run; same Role Definition is allowed only by explicit task policy |
| high/critical | different reviewer Role; clean context; no producer-edit capability; task policy may require a different prompt and model family |
| money, booking, publication, security, customer fact | domain-specific independent reviewer and human approval rules override generic policy |

## Race Analysis

| Race | Unsafe outcome | Required prevention | Required evidence/recovery |
|---|---|---|---|
| Target changes immediately before approval | operator approves stale data | transactionally read target versions and build subject hash; approval endpoint compares current hash | reject with `approval_subject_stale`; preserve old packet |
| Arguments/schema change after approval | different Command executes under old approval | immutable approved arguments/schema hash; executor revalidates immediately before claim | invalidate approval and create new request |
| Cancellation and Run lease claim occur together | cancelled Task starts anyway | one atomic RPC orders task-state and lease predicates; no app-level read-then-update | loser receives conflict; no ambiguous state |
| Worker completes as lease expires | new worker retries completed work | fencing token and owner/token comparison on finish; command idempotency survives Run expiry | stale finish rejected; reconcile receipt before retry |
| Command executes side effect, then receipt write fails | blind retry duplicates effect | provider/domain idempotency key sent before side effect; create `started` receipt/intent when domain allows | mark `uncertain`; query provider/domain by command key; never assume failure |
| Receipt is stored, then Task update fails | UI shows running despite completed effect | Task projection derives from authoritative receipt/Run; idempotent finalizer | replay finalizer updates Task without repeating Command |
| Worker stops after partial side effect | half-applied business state | side effects decomposed into registered atomic Commands; each has receipt | domain compensation or manual exception; Incident plus reconciliation receipt |
| Two executors read the same approved action | duplicate action execution | atomic `approved -> executing` claim with lease/fence and unique command key | current executor path is ineligible for Office Commands until fixed |
| Approval event arrives before `waitForEvent()` begins | workflow waits forever or times out | persist approval decision first; workflow checks durable state before entering wait, then correlates exact event | bounded wait; re-read durable approval after timeout/event |
| Decision Packet persistence fails but action remains approvable | approval has no evidence snapshot | actionable packet persistence is fail-closed; action cannot enter approval-ready state | Incident; retry packet creation without executing action |

## Command Receipt Lifecycle And Outcomes

Claim/execution lifecycle and business outcome are separate. `execution_started_at` proves the exact Command was claimed; a nullable `execution_completed_at` does not itself prove whether an external effect happened.

| Outcome | Meaning | Retry rule |
|---|---|---|
| `succeeded` | authoritative effect and hashes recorded | return stored result; never execute again |
| `failed_before_effect` | failure is known and there is proof no effect occurred | retry only if Task policy permits a new command key |
| `unknown_outcome` | effect may have occurred but acknowledgement/receipt completion is missing | automatic execution retry forbidden; query provider/domain |
| `reconciled` | read-after-write established the authoritative external/domain result | finalize or issue a new policy-approved Command according to reconciled result |
| `compensated` | inverse/repair Command receipt is linked | preserve both receipts; never erase original effect |

Receipt records are append-oriented. Reconciliation and compensation create linked evidence rather than rewriting history to look atomic. `unknown_outcome` never degrades to a generic failure merely because a timeout elapsed.

## Domain Precedence

- A generic Office cancellation cannot cancel a booking, reverse money, unpublish content, or alter customer data directly.
- It may stop an Agent Run from proposing further work.
- Domain cancellation/refund/reversal uses the domain state machine and approval authority.
- Generic Task status is updated only after the domain result is reconciled.
