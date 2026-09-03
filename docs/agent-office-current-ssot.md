# AI Operations Office Current SSOT

> Updated: 2026-09-03
>
> Scope: Yeosonam OS의 에이전트 협업, 실행 원장, 승인, 사고, trace, 운영 화면.
> Domain-specific booking, settlement, affiliate, marketing, product-registration,
> and AI Ops SSOT still override this document for their own mutations.

## 1. Product Decision

Yeosonam OS does not operate a free-form "AI virtual office" where many agents chat
until they decide that work is complete.

The adopted model is:

```text
durable backend execution
  + correlation evidence timeline
  + human control dashboard
  + domain approval gates
```

This is intentionally a hybrid. A dashboard cannot make execution durable, a chat
thread cannot provide reliable state, and a backend without an operator surface
cannot provide accountable approval or incident handling.

## 2. Why This Fits Yeosonam

The platform already has:

- `agent_tasks`: task state machine and retry metadata;
- `agent_approvals`: human approval history;
- `agent_incidents`: policy, validation, timeout, and handoff incidents;
- `agent_trace_spans`: trace and duration records;
- `agent_actions`: proposed production actions and execution state;
- Inngest: durable marketing and billing functions;
- Jarvis specialist routing and tool execution;
- domain-specific approval and evidence gates.

Installing another general multi-agent runtime would duplicate state, traces,
retries, and approval semantics. V1 therefore improves the control plane around the
existing primitives.

## 3. Current Architecture

```text
Jarvis / QA / cron / manual / research intake
              |
              v
        agent_tasks
      /       |       \
approvals  incidents  trace_spans
      \       |       /
              v
    buildAgentOfficeSnapshot()
              |
              v
 GET /api/admin/agent/office
              |
              v
       /admin/agent-mas
```

### Workroom Identity

`correlation_id` is the V1 workroom and thread key.

- One task under one correlation is a single-agent run.
- Multiple tasks with distinct specialist roles under one correlation are an
  observed multi-agent workroom.
- The UI must not label a run multi-agent merely because an agent has many tool calls.

### Timeline

The workroom timeline merges:

- task state updates;
- approval decisions;
- incidents;
- trace spans.

It is evidence, not conversation. Free-form agent debate is not a completion signal.

## 4. V1 Operator Surface

`/admin/agent-mas` is named **AI 운영실** in the page.

It provides:

- active workrooms;
- stale workrooms whose active state has not changed for 24 hours;
- pending approvals;
- overdue approvals whose explicit expiry passed or whose request is older than
  seven days without an explicit expiry;
- failed tasks in the last 24 hours;
- seven-day done versus failed completion rate;
- observed multi-agent workrooms;
- trace P95 duration;
- workroom role and progress summary;
- workroom activity timeline;
- an observation-only approval ledger;
- bounded task and incident tables;
- source degradation warnings;
- review-only research evidence cards with redacted title/excerpt, source link,
  collector version, confidence, and explicit publication/product-fact prohibitions;
- the active safety boundary.

The source API is read-only and bounded:

- tasks: latest 240;
- approvals: latest 240;
- incidents: latest 160;
- traces: latest 320;
- workrooms returned: latest 24.

These values describe an operator snapshot, not an all-time analytics warehouse.

The pre-hardening production ledger contained old `running` tasks and pending
approvals created by request streams that ended before terminal state was persisted.
The UI must therefore display source freshness and must not equate a stored active
status with live execution. V1 does not expose approve/reject controls, and the
unused legacy decision endpoint is removed while no resumable runtime exists.
Expiry remains available through lifecycle housekeeping.

## 5. Privacy and Tenancy

- The client never receives raw `task_context`. A strict parser may project the
  bounded `ResearchSignalEnvelopeV1` review summary described above.
- `userMessage` is never promoted to a workroom title.
- Free-text titles, errors, approval reasons, and incident messages pass through the
  Korean PII redactor.
- Raw `reason` and `message` fields are removed from the snapshot response after
  redaction.
- The service-role client remains server-side.
- The current surface is platform-admin only through the existing admin guard.
- Future tenant access requires explicit `tenant_id` scoping and tenant-owned RLS;
  it must not reuse the platform-wide snapshot unchanged.

## 6. Execution Rules

V1 does not create or schedule autonomous work.

When execution is added:

1. Use an event-triggered durable workflow.
2. Persist every worker as an `agent_task`.
3. Use one `correlation_id` for the objective.
4. Keep deterministic routing for known process steps.
5. Limit parallel workers to three until evals justify more.
6. Set explicit token, time, retry, and tool-call budgets.
7. Require idempotency for every side effect.
8. Wait for an approval event before production mutation.
9. Persist a versioned resumable run state before showing an actionable approval.
10. Reject malformed, concurrent, expired, or stale approval decisions.
11. Record output evidence and trace spans.
12. Stop on budget exhaustion, failed guardrail, or ambiguous domain authority.

### Request Runtime Lifecycle

- Request-scoped sources are `qa_chat`, `jarvis_v1`, and `jarvis_stream`.
- A request task and its trace must reach terminal state before the response stream
  closes. Work after stream closure is not durable on a serverless runtime.
- Every approval receives an explicit expiry. The default is seven days.
- The dedicated `agent-housekeeping` cron performs bounded, idempotent lifecycle
  cleanup at `00:07 UTC`. It imports no agent action, GSC, Instagram, or
  resource-saver code.
- The existing `agent-executor` also performs defensive housekeeping before
  non-critical GSC or Instagram work and before its resource-saver boundary.
- Operators run production housekeeping with
  `npm run agent:housekeeping:production`, which delegates to
  `vercel crons run /api/cron/agent-housekeeping`. Vercel supplies the cron
  authorization server-side.
- Do not assume `vercel env pull` exposes a sensitive production `CRON_SECRET`,
  do not send an empty bearer, and do not put the secret in a URL.
- Housekeeping expires legacy no-expiry approvals after seven days, request-scoped
  active tasks after 24 hours, tasks past explicit expiry, and trace spans left open
  for more than 24 hours.
- Housekeeping never resumes work and does not execute a production side effect.

## 7. When Multi-Agent Is Allowed

Use parallel specialists only when at least one condition is true:

- the work divides into independent research branches;
- one agent's tool/context set is too broad to route reliably;
- independent security, evidence, or policy review has measurable value;
- latency improves through real parallel work;
- a fixed eval shows higher task success than the single-agent baseline.

Do not use it for:

- deterministic booking, payment, settlement, or publication transitions;
- tasks with tightly shared context and sequential dependencies;
- work that a single specialist plus a critic already completes reliably;
- decorative role-play;
- continuous autonomous loops without an operator objective and stop condition.

## 8. Evaluation Gate

Before enabling the first multi-agent executor, compare:

| Metric | Single-agent baseline | Multi-agent candidate |
|---|---:|---:|
| Task success | required | required |
| Unsupported factual claims | required | required |
| Domain policy violations | required | required |
| Median latency | required | required |
| P95 latency | required | required |
| Input/output tokens | required | required |
| Cost per successful run | required | required |
| Human correction rate | required | required |

Adopt only when the candidate improves task success or materially reduces risk
without unacceptable cost or latency.

## 9. Next Safe Phase

The next recommended implementation is one manually triggered, read-only workflow:

```text
planner
  -> up to 3 independent evidence reviewers
  -> critic
  -> synthesizer
  -> operator-visible report
```

Candidate domains:

1. release evidence review;
2. AI prompt/eval regression review;
3. marketing evidence audit with no external publish;
4. product-registration fixture review with no DB promotion.

The first candidate must have a fixed input fixture set and a single-agent baseline
before backend execution is enabled.

## 10. External Lessons Adopted

- Anthropic: add agentic complexity only when measured; multi-agent is strong for
  breadth-first parallel research but expensive.
- OpenAI: distinguish manager/agents-as-tools from handoffs and trace every model,
  tool, guardrail, and handoff boundary. HITL approval pauses a run and resumes the
  same serialized `RunState`; a status-only row is not equivalent.
- LangChain: context engineering and capability boundaries matter more than agent
  count; durable HITL interrupts require a persisted checkpointer and thread ID,
  and side effects before an interrupt must be idempotent.
- AutoGen: optimize one agent first and use a team only when it is inadequate.
- Google ADK: separate predictable workflow agents from model-directed routing.
- Inngest: durable steps, retries, waits, and keyed concurrency belong in the backend,
  not in a browser thread. Event/function idempotency is still required because
  duplicate delivery is otherwise valid behavior.

The references and decision comparison are preserved in
`docs/specs/20260728-agent-operations-office/spec.md`.

## 11. Foundation Contract Registry

PR-01A adds repository-owned contracts under `src/lib/agent/contracts` without
adding a worker or a second control plane.

- The initial Role and Task are both `research.technology_scout@1.0.0`.
- Repository definitions and operational bindings are separate. The initial
  binding is `contract_only` with execution disabled.
- The compatibility adapter maps this Role to existing
  `agent_type=system` and `specialist_id=research.technology_scout`; it does not
  reinterpret other legacy tasks.
- The initial Tool Profile contains zero tools, credentials, network hosts,
  Commands, writes, destructive operations, or Production access.
- Existing `ACTION_REGISTRY` rows are compatibility-only views. The new Office
  Command Registry is empty, including no `office.cancel_task`.
- Work Product, Review Receipt, Runtime Result, Reason Code, and design-only
  Command Receipt schemas are strict and versioned. Schema references carry a
  generated JSON Schema hash so semantic drift requires an explicit contract
  version review.
- No API, migration, Inngest function, Runtime Adapter, or Provider change is
  part of PR-01A. PR-01B remains separately gated.

## 12. Shadow Run Ledger Foundation

PR-01B adds `agent_runs` for newly created execution attempts only. It is an
audit shadow, not a second task engine.

- `agent_tasks` remains the business-state SSOT and `agent_trace_spans` remains
  existing execution-observation evidence.
- `agent_runs` is permanently `shadow`, non-authoritative, command-disabled,
  Production-disabled, and limited to public-classification input contracts.
- No historical row is backfilled or inferred from legacy Trace/Action data.
- Only the PR-01A `research.technology_scout` legacy binding can create a Run.
  Adding another role requires a reviewed database migration.
- Run creation serializes attempt allocation by locking the exact Task. Claiming
  requires a preselected Run ID; there is no dequeue, dispatch, or worker-choice
  query.
- The raw Lease Secret is never persisted. Its SHA-256 digest and a monotonically
  incremented Fencing Token protect heartbeat, transition, and completion calls.
- Direct table privileges are denied even to `service_role`. Service-only,
  pinned-search-path RPCs expose safe JSON that excludes the Lease digest.
- Task/Trace reconciliation is diagnostic only. A result can be matched,
  pending, or mismatched, but it never repairs Task state or promotes the Run.
- Office KPI, retry decisions, worker authorization, approvals, and Commands do
  not read this ledger in PR-01B.
- The migration is verified only in Local/Preview Supabase. Applying it to the
  Production database requires a separate approval.

## 13. Inactive Read-only Runtime Boundary

PR-01C adds an implementation boundary for the Codex subscription Runtime. The
operational binding remains disabled; a later Preview-only manual caller may
exercise the adapter only under the separate Shadow Pilot gates below.

- `AgentRuntimeAdapter` is limited to `health`, `start`, and Runtime-only
  `cancel`; cancellation uses App Server `turn/interrupt` and cannot update a
  Task.
- The Codex child uses stdio JSONL, an ephemeral thread, ChatGPT subscription
  authentication, `approvalPolicy` set to `never`, read-only sandboxing, disabled
  network, a restricted readable root, and disabled optional Tool/Skill/Plugin/
  App surfaces.
- The child environment is allowlisted. Supabase, Provider, Vercel, payment,
  publication, booking, customer, and arbitrary inherited secrets are excluded.
- Start requires a host-verified short-lived capability bound to the exact Run,
  Task, tenant, Role, public data class, and readable roots. The capability
  secret never enters the child protocol or artifact callbacks.
- Input evidence must arrive through exact opaque Artifact references with a
  matching SHA-256 content hash. URLs alone cannot qualify as evidence while
  network access is disabled.
- Any command, file change, Tool, MCP, Skill, App, browser, image, permission,
  model reroute, subagent activity, unknown server request, or non-allowlisted
  item type fails closed and interrupts the turn. Turn-scoped events must match
  the exact active thread and turn.
- The Runtime deadline starts before App Server startup, and observed input or
  output token usage above the registered budget interrupts the turn and cannot
  produce a successful Artifact.
- Successful output must pass the registered Technology Radar payload schema
  and an injected content-addressed shadow Artifact sink. The Preview-only
  manual pilot route wires this adapter to the existing `agent_tasks.result_payload`
  field with an explicit `shadowOnly` marker; it is disabled in Production,
  requires `AGENT_OFFICE_SHADOW_PILOT_ENABLED=1`, and never performs dispatch,
  Commands, publication, or external writes.
- The existing Provider-policy wrapper returns only Provider, model, fallback,
  timeout, and policy source. It never returns credentials and accepts only the
  Technology Scout task. `AiProvider` and the Blog DeepSeek-only lane are
  unchanged.

## 15. Preview-only Technology Scout execution

The first operational caller is deliberately one manual, one-case route:
`POST /api/admin/agent/office/pilot/shadow`. It is not a queue or a Cron.

- The route is platform-admin protected and accepts only one of the 30 pinned
  fixture case IDs; arbitrary URLs, prompts, tenants, or Tool profiles are not
  accepted.
- It checks the deployment environment, Preview Supabase configuration, and the
  presence of `public.agent_runs` before inserting anything. Production and an
  unconfigured Preview fail closed before a Task write.
- The sequence is `agent_tasks` (queued → running → done/failed) → create/claim
  shadow Run → lease transitions → read-only Codex Runtime → content-addressed
  result → Run completion → Task completion. A duplicate business idempotency key
  returns `duplicate` without starting a second Run.
- The child receives only an ephemeral read-only capability, allowlisted public
  fixture artifacts, no tools, no MCP/Skill/App/browser/shell surfaces, and an
  allowlisted environment. The raw capability token and raw model prompt are not
  persisted.
- The Admin Pilot panel shows the execution lock, a Preview-only trigger, and
  recent shadow result metadata. `agent_runs` remains excluded from KPI,
  retry, authorization, approval, and Command authority.
- Enabling the Preview toggle is a separate operator action after applying the
  migration to a non-Production Supabase project. No Production migration or
  external installation is implied by this route.

## 14. Technology Scout Foundation Preflight

PR-01D captures 30 immutable public official-source fixtures and adds an offline
contract and acceptance evaluator. It does not activate the Runtime binding or
claim that a live Scout ran.

- Repository, commit, README blob, license blob, and release evidence are pinned;
  mutable branch names are not decision-bearing evidence.
- The offline corpus produces strict Task inputs, content-addressed public
  evidence, Technology Radar Work Products, and independent deterministic
  contract Review Receipts. These receipts are not human review evidence.
- Contract fixtures pass 30/30. They are baselines, not agent output and not
  automatic Technology Radar decisions.
- Community evidence cannot support a decision, and revision, license, Artifact,
  or Work Product hash drift fails the contract.
- Pilot acceptance is conjunctive: 20 live official-source cases, three
  independent identical-input trials, zero hard-gate violations, complete
  reproducibility/evidence, and human review for every result are all required.
- The official current App Server documents restricted readable roots, but the
  locally installed `codex-cli 0.151.0-alpha.7.2` generated schema lacks that
  read-only policy field. `CODEX_RESTRICTED_READ_ROOTS_UNSUPPORTED` therefore
  blocks every live turn until a separately reviewed compatible Runtime or
  equivalent OS sandbox is attested.
- No package, Skill, MCP, Plugin, binary, Production migration, model call,
  external write, Command, automatic delegation, Office write, or Blog Provider
  change is part of this preflight.
- The repository binding remains `contract_only` with execution disabled.
  A real Technology Scout turn remains part of the separately approved PR-01D
  pilot and requires a compatible restricted-read App Server protocol.
