# Compatibility Matrix

## Decision Rule

- `REUSE`: current authority and lifecycle already express the concept.
- `EXTEND`: current authority remains canonical; add a versioned contract or the smallest field/link.
- `NEW`: current structures cannot preserve the concept's independent identity or audit invariant.
- `DEFER`: a generic primitive is not yet justified by measured workload or evidence.

No classification authorizes a migration in PR-00.

## Matrix

| Concept | Decision | Existing authority | Minimum future change | Why no broader change |
|---|---|---|---|---|
| Role | `EXTEND` | `agent_tasks.agent_type`, `specialist_id`; Jarvis agent types; `ACTION_REGISTRY` agent ownership | Add a versioned code-owned Role Registry mapping `role_key -> department, allowed task keys, tool profile, default risk, reviewer policy` | A role table is not needed until operators must edit roles at runtime. DB policy must not be generated from role prose. |
| Task Contract | `EXTEND` | `AgentTaskEnvelope`, `agent_tasks`, task state machine, `task_context`, `result_payload`, retry fields | Add `task_contract_version`, `task_key`, input/output schema hashes and bounded objective fields; keep `agent_tasks` authoritative | A second task table would duplicate state, retry, tenancy, and correlation. |
| Mission / Objective | `EXTEND` plus table `DEFER` | `task_context.officeObjective`, normalized intent, domain object IDs, `correlation_id` workroom grouping | Store `objective_ref`, optional future `mission_ref`, `officeObjective`, `expectedOutcome`, `businessMetricKey`, `dueAt`, and `stopConditions` in the Task Contract | `correlation_id` is technical causality, not business purpose. A Mission table is unjustified until one business objective demonstrably spans multiple correlation trees and needs its own lifecycle. |
| Business Event | `EXTEND` | typed Zod Inngest events in `src/inngest/client.ts`, cron triggers, domain outboxes | Add a code-owned event registry with schema version, producer, consumer, retention expectation, and three-layer idempotency metadata | Inngest remains the workflow engine; no event-bus abstraction or second engine. |
| Run | `NEW` | traces describe spans; tasks describe objectives; domain jobs have local run/lease fields | Add shadow-only `agent_runs` for new runs with attempt, actor/session, runtime, provider/model, budgets, lease/fencing, usage, outcome, and output hash | Neither `agent_tasks` nor trace spans can safely own lease, actor, per-attempt cost, review independence, or resumable execution identity. No synthetic legacy backfill. |
| Delegation | `EXTEND` | multiple tasks under one correlation already form a workroom; `specialist_id` identifies worker type | Add optional `parent_task_id` plus versioned `DelegationRequestV1` inside child `task_context`; enforce max depth/children/turns/tool calls | A separate delegation ledger duplicates the child task lifecycle. Promote to a table only if delegation needs independent approval or many-to-many assignment. |
| Artifact / Work Product | `EXTEND` | `agent_tasks.result_payload`, Decision Packets, domain artifacts, immutable hashes in Blog/media/product registration | Store a `WorkProductEnvelopeV1` in `result_payload` with type, producer run, schema/hash, evidence refs, assumptions, unresolved questions, confidence, and retention class | A global blob/artifact table is premature. Large binary or multi-version artifacts keep using domain/object storage ledgers; only references enter the envelope. |
| Review / Review Receipt | `EXTEND` | review can be a child `agent_task`; human approval has a separate `agent_approvals` meaning | Define reviewer tasks and `ReviewReceiptV1` in their `result_payload`; require producer/reviewer run and session inequality, with role/model separation by risk policy | Do not overload human approval as semantic review and do not create a review table before multiple review receipts per work product are proven necessary. |
| Intervention | `EXTEND` | `agent_approvals`, `agent_incidents`, `assigned_to`, `frozen`, HITL takeover, action queue | Add a closed reason-code registry and record reason plus source evidence in existing metadata/context | A generic intervention table would duplicate approval, incident, takeover, and command history. |
| Approval | `EXTEND` | `agent_approvals`, `agent_action_decision_packets`, domain approval gates | Add fail-closed approval-subject fingerprinting and expiry/concurrency checks; packet persistence must become mandatory for actionable commands | Approval stays distinct from review. Domain approval remains stronger than generic Office approval. |
| Command | `REUSE` | `agent_actions`, `ACTION_REGISTRY`, executor, domain RPCs and state machines | Introduce a versioned Command Registry view over existing action types; initially no new Office command | A second command queue would create conflicting status and approval authority. `office.cancel_task` remains unregistered. |
| Command Receipt | `EXTEND` first; separate `NEW` ledger conditional | `agent_actions`, Finance command receipts/idempotency, domain ledgers, and Decision Packets | Define `CommandReceiptV1` and test its invariants against existing storage. Extend `agent_actions` or a domain ledger when it can preserve immutability, hashes, one-time claim, uncertain outcome, and reconciliation. Add a separate generic ledger only after an impossibility proof. | Receipt semantics are mandatory before an Office command, but a new table is not. Domain receipts remain authoritative and no executor is connected in the Foundation phase. |
| KPI Definition | `EXTEND` | `buildAgentOfficeSnapshot`, bounded admin API, domain summary RPC patterns | Add a versioned code-owned KPI registry and exact aggregate RPC/query per metric, with freshness and reconciliation query | A KPI-definition table is unnecessary until non-developer runtime editing is required. Bounded arrays may render drilldowns but never calculate period totals. |
| Improvement Candidate | `DEFER` generic ledger | QA uses inactive `response_corrections`; incidents, eval runs, Blog/product learning and specs already retain domain evidence | Use domain candidate/eval artifacts first; define a generic candidate only after at least two pilots need one shared promotion lifecycle | A generic self-improvement table now would be speculative and risks becoming a second policy SSOT. Self-modifying policy remains forbidden. |

## New-Ledger Impossibility Tests

### `agent_runs`

Reusing `agent_tasks` fails because one task can have multiple attempts, runtimes, workers, models, leases, costs, and reviewer runs while retaining one business objective and terminal status. Reusing `agent_trace_spans` fails because a span is not a lease owner, state machine, budget authority, or resumable run record. Therefore a distinct Run identity is justified.

### Structured Office Command Receipt storage test

`agent_actions.result_log` alone is insufficient because it is unstructured and cannot prove normalized arguments, approved subject, exact effects, external receipt, or the uncertain window between side effect and acknowledgement. Decision Packets are pre-execution evidence and Finance receipts cannot become a false cross-domain authority. PR-01A therefore defines and tests the receipt contract first. Storage follows this order:

1. extend `agent_actions` when immutable structured fields and one-time claim can be enforced without corrupting its current lifecycle;
2. reuse a domain receipt when the command remains entirely within that domain;
3. propose a separate generic ledger only when the first two options fail a documented invariant.

The required contract fields are `command_key`, `command_version`, `target_type`, `target_id`, `idempotency_key`, `arguments_hash`, `schema_hash`, `artifact_hash`, `policy_version`, execution start/completion times, `outcome`, provider reference, result hash, actor, and approval ID. Outcomes include `succeeded`, `failed_before_effect`, `unknown_outcome`, `reconciled`, and `compensated`.

## `agent_runs` Minimum Future Schema

This is a design contract, not SQL:

| Field | Purpose |
|---|---|
| `id` | immutable Run ID |
| `task_id`, `attempt_number` | Task ownership and ordered attempt; unique together |
| `tenant_id` | mandatory tenant lineage when the task is tenant-scoped |
| `actor_id`, `actor_session_id` | reviewer independence and audit identity |
| `runtime_key`, `runtime_version` | Codex worker, API worker, deterministic worker, or future runtime identity |
| `provider_key`, `model_key` | nullable because deterministic runs have no provider/model |
| `role_key`, `task_contract_version`, `tool_profile_version` | immutable execution contract snapshot |
| `status` | `created`, `leased`, `starting`, `running`, `waiting_approval`, `succeeded`, `failed`, `timed_out`, `cancelled`, `orphaned` |
| `lease_owner`, `lease_token_hash`, `lease_expires_at`, `heartbeat_at`, `fencing_token` | atomic ownership and stale-worker rejection; raw lease secrets are never stored |
| `budget_json`, `policy_snapshot` | fixed token, cost, elapsed, turn, tool-call ceilings, and exact resolved policy |
| `input_hash`, `output_hash`, `error_code` | content-addressed evidence without raw prompt/PII |
| `usage` plus normalized columns | comparable input/output tokens, tool calls, elapsed time, and cost without raw content |
| `trace_id`, `legacy_trace_ref` | trace correlation; legacy rows may link but are never fabricated |
| `started_at`, `completed_at`, `created_at`, `updated_at` | lifecycle evidence |

Future table rules:

- service-role/internal worker access only;
- RLS enabled and explicit grants revoked from `anon` and `authenticated`;
- atomic claim/heartbeat/finish RPCs compare lease token hash and fencing token;
- no raw prompts, tool arguments, customer text, or model responses;
- new executions only during shadow; legacy execution remains `unknown_run` through original trace links;
- promotion to cost/lease authority requires reconciliation against current task outcomes.
- `agent_tasks` remains the business-status SSOT and `agent_trace_spans` remains existing observation evidence;
- shadow Runs cannot drive Office KPI, automatic retry, Worker authorization, or Production Command access;
- a migration may be authored in PR-01B, but applying it to Production requires separate approval.

## Baseline Delta Revalidation

The update from `739647696b4568aded3fd765fd7db4122fa9be26` to `754f739569d03c65fd8e1c1573e415c389b017f2` changes only Blog hardening surfaces. It adds no Role, Task, Run, Runtime, Provider, Command, or receipt primitive, so the matrix remains unchanged except for the human-approved extend-first Command Receipt storage ruling above. See `delta-revalidation.md`.

## Role And Runtime Separation

```text
Role: marketing.blog_editorial_reviewer
Task: blog.editorial_review
Runtime: codex_subscription_worker
Provider/Model: runtime-specific and replaceable
Tool Profile: blog-review-readonly@version
Input/Output/Eval: stable across runtime changes
```

The current `AiProvider` union remains `deepseek | claude | gemini`. A Codex Runtime Adapter is added beside that policy for Agent Office pilots; it does not widen the production provider enum or replace `system_ai_policies`. Blog's explicit DeepSeek-only contract remains stronger than any generic adapter.
