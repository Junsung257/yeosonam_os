# Agent Office V2 PR-00 architecture decisions

Date: 2026-09-03
Status: Foundation-only GO; implementation remains split into separately reviewed PRs
Baseline: `754f739569d03c65fd8e1c1573e415c389b017f2`, delta-revalidated from `739647696b4568aded3fd765fd7db4122fa9be26`

These decisions constrain a future PR-01. They do not authorize a migration, worker, Office write, external installation, or Production Command.

## ADR-01 — Reuse existing ledgers before adding generic ones

### Context

The repository already has `agent_tasks`, `agent_actions`, approvals, incidents, traces, Decision Packets, and domain-specific lease and receipt patterns. Creating parallel Mission, Delegation, Artifact, Review, and Intervention tables before proving a semantic gap would split the audit trail.

### Decision

- Use the `REUSE / EXTEND / NEW / DEFER` rulings in `compatibility-matrix.md` as the schema gate.
- Reuse `agent_tasks` for the objective and lifecycle, `agent_actions` plus `ACTION_REGISTRY` for proposed commands, and existing approval/incident/trace ledgers.
- Permit one currently justified generic `NEW` ledger: shadow `agent_runs`.
- Require a structured Command Receipt contract before the first generic Production Command, but extend `agent_actions` or a domain receipt first; a separate generic receipt ledger remains conditional on an impossibility proof.
- Do not create a Mission table. Keep business objective fields in the Task Contract and domain references.

### Consequences and PR-01 gate

This minimizes migration and dual-write risk, but existing JSON contracts must be versioned and validated. Any later generic table requires an explicit impossibility rationale and human approval.

## ADR-02 — Task and Run are different identities

### Context

A Task is a durable business objective. A Run is one execution attempt with a runtime, actor/session, lease, cost, usage, and output identity. The current Task row cannot safely represent concurrent attempts, fencing, reviewer independence, or per-attempt budgets.

### Decision

- Keep `agent_tasks` authoritative for objective and terminal business status.
- Introduce `agent_runs` only as a shadow ledger for newly started runs.
- Do not synthesize historical runs. Legacy executions remain `legacy / unknown_run` with trace references where available.
- Require a unique run ID, task ID, attempt number, actor/session identity, runtime/provider/model snapshot, lease owner plus hashed token and fencing generation, heartbeat/expiry, budget/usage, output hash, and terminal reason.
- Promote the ledger to lease/cost authority only after shadow reconciliation demonstrates consistency.
- During Foundation it cannot drive Office KPI, automatic retry, Worker authorization, or Production Command access.
- A migration may be authored and preview-tested, but Production application requires a separate approval.

### Consequences and PR-01 gate

Office V1 remains the operational source during shadowing. PR-01 must define unique constraints, conditional state transitions, recovery, RLS/grants, and reconciliation before any worker consumes the ledger.

## ADR-03 — Runtime and Provider are separate contracts

### Context

The current provider policy is DB-first and intentionally limited to `deepseek | claude | gemini`. A Codex subscription worker is an execution environment, not simply another API provider. Collapsing these concepts would weaken current policy and the Blog DeepSeek-only contract.

### Decision

- Define Role, Task Contract, Runtime, Provider/Model, and Tool Profile as separate registry dimensions.
- Add a read-only Agent Office runtime adapter first; do not widen the existing provider union in PR-00.
- Enforce shadow mode in constructed capabilities and credentials, not as a prompt, UI label, or caller-provided flag.
- Preserve `system_ai_policies` precedence and the Blog Production DeepSeek-only lane.
- Keep Work Product and Eval contracts stable when runtime/provider changes.
- Do not make a subscription runtime the only path for time-critical Production work.

### Consequences and PR-01 gate

Some legacy direct callers remain behind a strangler boundary. A future adapter needs explicit timeout, fallback, usage, PII, and failure semantics plus shadow comparison; no broad caller migration is implied.

## ADR-04 — Business Events and three idempotency layers

### Context

Inngest event IDs prevent duplicate event delivery for their documented retention window, but that is not equivalent to business-work or side-effect idempotency. The same business request may arrive through different events, and one Task may legitimately emit multiple events.

### Decision

- `correlation_id` identifies execution causality/workroom only; it is never a Mission ID.
- `event.id` is `transport_idempotency`.
- The versioned Task Contract supplies a domain-derived `business_idempotency` key.
- Each side-effecting registered Command supplies a separate `command_idempotency` key.
- Persist the three meanings and retention policies separately even if derived from common source material.
- Continue with Inngest as the sole durable workflow engine; do not introduce a second engine.

### Consequences and PR-01 gate

Every new event requires a producer, versioned schema, consumer, replay rule, dead-letter behavior, retention, and all applicable idempotency keys. Event dedupe alone cannot authorize a side effect.

## ADR-05 — Lease, fencing, and Command Receipt

### Context

Media, Product Registration, and Finance already demonstrate stronger claim/lease/heartbeat/fencing or receipt patterns. By contrast, the current generic `agent-executor` reads approved actions and invokes them before a durable atomic claim, so it is not a safe base for Office Commands.

### Decision

- Reuse the strongest internal atomic-claim patterns: claim transaction, lease expiry, heartbeat, monotonic fencing generation, compare-and-set completion, retry cap, and dead-letter path.
- A Command is immutable after approval and has a domain-derived idempotency key.
- Define `CommandReceiptV1` and its fault tests before deciding storage. Prefer extending `agent_actions`, then a domain receipt; introduce a separate generic table only if neither can enforce the contract.
- Record an execution intent/receipt key before an external side effect, then finalize its outcome conditionally.
- Model `unknown_outcome` explicitly when an external effect may have occurred but receipt finalization failed.
- Receipt outcomes include `succeeded`, `failed_before_effect`, `unknown_outcome`, `reconciled`, and `compensated`.
- Do not register or execute any Production Office Command until these properties exist.

### Consequences and PR-01 gate

The first implementation must be read-only/shadow. Reusing `agent-executor` requires a separate hardening decision and tests for concurrent invocation, expired leases, stale workers, and crash windows.

## ADR-06 — Decision Packet and approval invalidation are fail-closed

### Context

Current Decision Packet persistence is useful evidence but its best-effort error handling cannot serve as the authority for a resumable high-risk command. Approval also becomes stale if its subject, arguments, tool schema, policy, or evidence changes.

### Decision

- Build a canonical approval subject from task contract version, command type, normalized arguments hash, artifact/evidence hashes, tool server/version/schema hash, policy version, tenant, risk, and expiry.
- Approval binds to the exact subject hash and approver scope.
- High-risk human approval requires an accountable interactive human identity; a shared admin/service token cannot satisfy that role.
- Any subject change invalidates approval; missing packet/receipt data blocks execution.
- Separate recommendation evidence from command authorization.
- Require a different Run and actor/session for every review; high-risk work additionally requires a different reviewer Role, and may require a different prompt/model family.

### Consequences and PR-01 gate

Convenient implicit approval reuse is rejected. PR-01 must provide deterministic canonicalization and race tests for mutation immediately before and after approval.

## ADR-07 — Tenant, PII, and artifact retention boundaries

### Context

Travel operations include booking, customer, payment, supplier, and employee information. Prompts, tool arguments, results, signed URLs, and artifacts can leak more than conventional token/latency telemetry.

### Decision

- Tenant context is mandatory on Task, Run, Command, Receipt, Work Product reference, approval, and KPI drilldown where applicable.
- Use service-only access by default for control-plane ledgers, with both RLS and explicit grants reviewed.
- Default traces contain IDs, hashes, versions, usage, timing, and result codes—not raw prompts, tool arguments, model responses, secrets, PII, or signed URLs.
- Work Products reference immutable, content-hashed artifacts with classification, retention class, access scope, and provenance.
- Redaction is a boundary control, not a substitute for least collection.

### Consequences and PR-01 gate

Debugging may require a separately authorized short-retention evidence store. PR-01 must include tenant-isolation tests, artifact swap tests, signed-URL expiry, deletion/retention behavior, and audit access.

## ADR-08 — KPI lineage precedes Office V2 visualization

### Context

The current Office snapshot intentionally bounds rows. Calculating 24-hour/7-day totals or percentiles from those arrays can silently undercount and is not an auditable business metric.

### Decision

- Every Office KPI has a stable `metric_key`, source ledger/RPC, calculation version, time window, freshness, drilldown, and reconciliation query.
- Compute period metrics in exact aggregate queries/RPCs, not bounded UI arrays.
- Separate operational snapshot counters from historical business KPIs and label freshness/partial data.
- Do not present automation rate as AI-call volume; distinguish automatic normal completion, AI-assisted, human-approved, and human-direct work.

### Consequences and PR-01 gate

Office V2 visual work waits until lineage and reconciliation are proven. A visually polished value without an exact source must be omitted or clearly marked unavailable.

## ADR-09 — Kill switches compose by most restrictive policy

### Context

The repository has global runtime controls and domain-specific kill switches. A generic Office switch must not bypass Blog, Product Registration, Ad OS, Finance, or tenant safety gates.

### Decision

- Compose global runtime, domain, role/task, tenant, command, and budget switches; the most restrictive applicable decision wins.
- A parent or Manager cannot expand a child Role's tool profile or write scope.
- Configuration ambiguity, missing credentials, missing policy, expired approval, or unknown receipt state fails closed for side effects.
- Emergency disable remains possible without model execution.

### Consequences and PR-01 gate

Operators must see the blocking source and recovery action. PR-01 needs a policy-decision trace and precedence tests, but no universal override command.

## ADR-10 — External capability supply chain is reference-first

### Context

External agents, Skills, MCP servers, binaries, and frameworks may introduce code execution, dependency, license, secret, network, and data-exfiltration risk. Most proposed benefits can be adapted as principles without installing a second control plane.

### Decision

- Intake starts with the concrete problem and an internal-capability check.
- Record official source, immutable revision, license, maintainership/release/issues, dependency and secret/network needs, tool scopes, write/destructive capability, schema hashes, and evaluation evidence.
- Use `ADOPT / TRIAL / ASSESS / HOLD / REJECT`; default to reference-only and disallow bulk installation.
- Prototype only in isolation with no Production credentials/data and promote through offline eval, shadow, canary, and human/policy approval.
- Reject a second workflow engine, a second approval ledger, generic SQL/shell/publish/payment MCPs, and wholesale AI-company frameworks for the current architecture.

### Consequences and PR-01 gate

Research can inform internal contracts without importing code. Any future installation is a separate approved change with pinning, license/security review, rollback, and owner.

## Supersession and change control

These ADRs supersede conflicting aspirational wording in the attached proposals, not repository SSOT. A later decision can replace one only by naming it, showing new repository evidence, updating the compatibility matrix and threat model, and receiving human approval.
