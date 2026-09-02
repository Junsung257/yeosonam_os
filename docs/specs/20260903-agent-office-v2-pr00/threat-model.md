# Agent Office V2 PR-00 threat model

Date: 2026-09-03
Scope: proposed Agent Office V2 control-plane extension on baseline `754f739569d03c65fd8e1c1573e415c389b017f2`
Method: source-backed architecture review; no penetration test, live worker, migration, or Production mutation

## 1. System model, trust boundaries, and assets

### Components and evidence

| Component | Security-relevant behavior | Repository evidence |
|---|---|---|
| Admin Office API/read model | Requires admin authorization; reads bounded Task, approval, incident, and trace sets; creates redacted display values and computes snapshot metrics | `src/app/api/admin/agent/office/route.ts:39`, `src/app/api/admin/agent/office/route.ts:150`, `src/lib/agent-office.ts:235`, `src/lib/agent-office.ts:321`, `src/lib/agent-office.ts:525` |
| Task/approval/incident ledgers | Tasks have idempotency and state; control-plane tables use service-only RLS/grants | `supabase/migrations/20260504003000_agent_tasking_core.sql:11`, `supabase/migrations/20260504003000_agent_tasking_core.sql:60`, `src/lib/agent/tasking.ts:39`, `src/lib/agent/tasking.ts:73` |
| Generic action executor | Reads approved actions, invokes a handler, then writes the outcome; no atomic claim/lease is visible around selection and execution | `src/app/api/cron/agent-executor/route.ts:66`, `src/app/api/cron/agent-executor/route.ts:87` |
| Existing action approval API | Performs validation/dry-run, executes the selected action, then updates action/packet state; packet outcome persistence is best effort | `src/app/api/agent-actions/route.ts:143`, `src/app/api/agent-actions/route.ts:221`, `src/lib/agent-action-decision-packets.ts:113` |
| Decision Packets | Stores recommendation/approval context under service-only access, but current persistence and lookup helpers degrade on errors | `supabase/migrations/20260628203000_agent_action_decision_packets.sql:4`, `supabase/migrations/20260628203000_agent_action_decision_packets.sql:30`, `src/lib/agent-action-decision-packets.ts:45`, `src/lib/agent-action-decision-packets.ts:98` |
| Inngest functions | Runtime policy fails closed for required configuration; Blog uses event idempotency, bounded concurrency, and evidence gates | `src/inngest/runtime-policy.ts:9`, `src/inngest/functions/blog-autopilot-v4.ts:79`, `src/inngest/functions/blog-autopilot-v4.ts:140` |
| LLM telemetry | Wrapper records operation/provider/model/token/timing/error metadata; raw prompts are not required by the common tracer | `src/lib/telemetry/llm-tracer.ts:48`, `src/lib/telemetry/llm-tracer.ts:71` |
| Strong domain worker patterns | Media and Product Registration implement atomic claim/lease/fencing/heartbeat/dead-letter controls; Finance includes lease and receipt/reconciliation evidence | `supabase/migrations/20260828090056_media_codex_worker_v1.sql:75`, `supabase/migrations/20260828090056_media_codex_worker_v1.sql:97`, `supabase/migrations/20260811030151_product_registration_v6_automation_core.sql:527`, `supabase/migrations/20260811030151_product_registration_v6_automation_core.sql:821`, `supabase/migrations/20260824221515_harden_clobe_sync_reconciliation_and_finalization.sql:48`, `supabase/migrations/20260824221515_harden_clobe_sync_reconciliation_and_finalization.sql:698` |

Line references identify the reviewed baseline, not a guarantee that later code is unchanged.

### Trust boundaries

1. Browser/operator → authenticated Admin API.
2. Admin API/server code → Supabase control-plane and Business SSOT.
3. Inngest transport → authenticated function handler → workflow steps.
4. Orchestrator/Manager → Role runtime → scoped tools.
5. Runtime/provider boundary → external model or subscription worker.
6. Command executor → supplier, publishing, payment, notification, or other external side effect.
7. Artifact/evidence store → Work Product/approval/reviewer.
8. External research content, Skills, MCP servers, and packages → isolated intake environment.
9. Tenant/affiliate context → shared multi-tenant infrastructure.

### Effective-resource map

| Consumer | Effective resource and recipients | Enforcing control | V2 prerequisite |
|---|---|---|---|
| Office snapshot | Bounded global service-role rows projected to platform admins | Admin guard, server-only key, selected display redaction | Never reuse as a tenant API; create tenant-scoped queries/RLS and negative isolation tests |
| Raw Task/approval/incident APIs | Free-form context, metadata, reasons, messages, and details returned to platform admins | Admin guard and pagination | Do not use as general artifact/provider input; define field allowlists and classification |
| Inngest runtime | Five registered functions with strict event schemas and current runtime flags | Signed SDK route, Zod, retries, event-ID idempotency, keyed concurrency | Define authorized Office event producers, quotas, minimized payload, and key-readiness check |
| Provider resolution | DB policy, then cache/environment fallback, selecting provider/model/secret | Provider enum, server credential registry, low-cardinality telemetry | Persist exact resolved policy/provider/model/fallback on the Run; restricted lanes may fail closed instead of falling back |
| Work Products/Review/Command receipts | Not implemented at the baseline | None yet | Resolve immutable schema, tenant ownership, digests, storage, retention, encryption, and claim transaction |
| External runtime supply chain | Lockfile, immutable GitHub Action pins, reference-only Skill-source inventory | Repository review and CI checks | Pin adapter/processor artifacts and document SBOM, network, secret, license, and upgrade policy |

### High-value assets

- booking, product, price, settlement, ledger, refund, publication, and customer-contact truth;
- customer/supplier/employee PII and signed artifact access;
- approval authority, command arguments, idempotency/receipt state, and policy versions;
- service-role, provider, webhook, cron, MCP, and downstream API credentials;
- audit integrity across Task, Run, Work Product, Review Receipt, approval, Command, and receipt;
- operational availability and budget limits;
- public brand content and evidence-backed product claims.

### Assumptions

- Admin authentication and existing cron/webhook verification work as documented; bypass testing is outside PR-00.
- Service-role credentials remain server-side. If exposed, service-only RLS does not protect the affected database surface.
- External providers and supplier APIs may time out after accepting a request, so `unknown_outcome` is a normal failure state.
- Model output and retrieved content are untrusted input even when they cite an official-looking source.
- Threat scenarios below are design hypotheses unless explicitly identified as a source-established control gap.

## 2. Attacker stories and required controls

### TM-01 — Duplicate or stale worker executes a Command twice

**Story.** An authorized cron is invoked concurrently, a lease expires during a slow external call, or a retry begins after an ambiguous timeout. Two workers execute the same approved side effect.

**Impact.** Duplicate publication, notification, booking, charge, refund, or ledger mutation; inconsistent Task/audit state. For financial or reservation commands, severity is **critical**.

**Evidence and confidence.** The generic executor's select-then-execute flow lacks an atomic claim in the reviewed code (`agent-executor/route.ts:66-96`). This is a source-established control gap, though exploitability still requires concurrent authorized invocation or a retry/crash condition. Stronger patterns already exist in Media/Product/Finance.

**Required controls.** Do not connect Office Commands to this executor. Require atomic claim, hashed lease token, heartbeat, monotonic fencing, conditional completion, command idempotency, pre-side-effect intent receipt, provider reconciliation, and explicit `unknown_outcome`. Test concurrent claims, stale completion, and every crash window.

### TM-02 — Approval is replayed after its subject changes

**Story.** A low-risk-looking command is approved, then its arguments, artifact, evidence, tool schema, tenant, policy, or destination changes before execution. A stale approval ID is reused.

**Impact.** Unreviewed publication/payment/data access under a valid-looking approval; **critical** for money/booking/PII and **high** for public content.

**Required controls.** Canonical subject hash covering command type, normalized arguments, task/artifact/evidence hashes, tool server/version/schema, tenant, risk, policy, and expiry. Execute only if the live subject matches exactly. Any change invalidates approval. Decision Packet persistence must be fail-closed on authorization paths.

### TM-03 — Cancellation races with claim, completion, or external side effect

**Story.** An operator requests cancellation while a worker acquires a lease, finishes a command, or loses connectivity after an external effect but before recording the receipt.

**Impact.** Task UI says cancelled while a booking/charge/publication exists, or compensation runs twice; **critical/high** depending on effect.

**Required controls.** Separate cancellation Command state from Task status. Immediate cancellation is limited to queued, unleased, no-active-action, no-side-effect work. Otherwise freeze new work, inspect receipt/provider state, compensate idempotently where allowed, record Reconciliation Receipt, then set the Task terminal state.

### TM-04 — Prompt injection expands tool or delegation authority

**Story.** Supplier files, URLs, reviews, or retrieved pages instruct a Technology Scout or writer to ignore policy, fetch secrets, call a write tool, or delegate to a more privileged Role.

**Impact.** Data exfiltration, external mutation, poisoned Work Product, or policy bypass; **high**, potentially **critical** with broad tools.

**Required controls.** Treat retrieved content as data; deterministic routing; per-Role allowlisted tool profile; read/write/destructive metadata; tenant/resource scoping; no generic SQL/shell/publish/payment tools; Manager cannot expand child authority; structured output validation; evidence-domain allowlists where appropriate; human approval for effects.

### TM-05 — Tenant context is omitted or confused

**Story.** A Task, artifact reference, approval, KPI drilldown, or Command is created without tenant binding, or a service-role query joins across tenants using attacker-influenced IDs.

**Impact.** Cross-tenant PII or business-data disclosure/mutation; **critical**.

**Required controls.** Tenant is required and immutable across the envelope chain; verify it independently at every DB/tool boundary; service-only tables still use explicit grants and tenant predicates; reject mixed-tenant inputs; add negative RLS/RPC tests and correlation-to-tenant consistency alerts.

### TM-06 — Artifact or evidence is swapped after review

**Story.** A mutable URL or row is changed after a reviewer evaluates it, while the Command retains only a reference ID.

**Impact.** Wrong price/product copy, malicious payload, or unsupported public claim; **high**.

**Required controls.** Immutable artifact version, content hash, size/type/classification, provenance, producer Run, retention, and access scope. Review and approval bind to hashes. Verify hash on read and before execution. Signed URLs stay short-lived and out of traces.

### TM-07 — Secrets or PII leak through trace, errors, or Work Products

**Story.** Raw prompts, tool arguments/results, internal request bodies, signed URLs, or provider errors are copied into logs and Office screens.

**Impact.** Credential compromise or privacy breach; **high/critical** depending on content.

**Required controls.** Metadata-only default telemetry; field allowlists and recursive redaction before persistence; separate short-retention restricted debug evidence; never store secrets or signed URLs; cap error payloads; detect high-risk patterns; audit readers and exports. Review existing snippets/error fields before expanding Office visibility.

### TM-08 — Lease token is replayed or stale worker wins

**Story.** A leaked/reused lease token or an old worker submits completion after a newer worker reclaimed the Run.

**Impact.** Overwrites a correct result, consumes excess budget, or authorizes downstream work from stale output; **high**.

**Required controls.** Store token hashes, rotate per claim, bind token to Run/worker/tenant/fencing generation, require unexpired lease and current fence on heartbeat/finish, use constant-time comparison where applicable, and reject/log stale completions without changing authoritative state.

### TM-09 — Budget or loop guard is bypassed through delegation

**Story.** A Manager repeatedly spawns child Tasks, retries with new IDs, or switches providers so each individual budget appears valid.

**Impact.** Spend exhaustion, queue starvation, and operator denial of service; **high**.

**Required controls.** Hierarchical budgets across objective/correlation/task/run/role/tenant/day; child allocation cannot exceed remaining parent budget; depth/fanout/turn/tool/retry/time limits; repeated-output and cycle detection; deterministic hard stop outside the model; dead-letter and human exception.

### TM-10 — External Skill/MCP/package compromises the control plane

**Story.** A popular repository, MCP server, parser, or transitive dependency is installed with broad filesystem/network/secret permissions or later changes behavior.

**Impact.** Supply-chain code execution, data exfiltration, approval bypass; **critical** if Production credentials are reachable.

**Required controls.** Reference-only default; immutable revision and schema/dependency hashes; license/maintainer/release/issue review; SBOM/vulnerability and behavior inspection; disposable network-restricted prototype with fake data and no Production secrets; narrow OAuth audience and no token passthrough; canary plus removal plan. Bulk installation remains forbidden.

### TM-11 — KPI/read-model truncation hides failure or changes a decision

**Story.** Bounded Office arrays undercount approvals, incidents, failures, or latency and present a healthy state. An operator approves rollout based on incomplete numbers.

**Impact.** Unsafe promotion or delayed incident response; **medium**, rising to **high** when it gates money/security changes.

**Evidence and confidence.** Snapshot limits and downstream period calculations are source-established. This is an integrity/design risk, not evidence of malicious exploitation.

**Required controls.** Exact versioned aggregate RPCs, freshness and partial-data indicators, drilldown/reconciliation queries, and independent readiness gates. Snapshot counts are operational hints only.

### TM-12 — Review independence is nominal

**Story.** Producer and reviewer share the same Run/session/context, or a high-risk reviewer uses the same Role/prompt and repeats the producer's unsupported assumption.

**Impact.** False assurance and unsafe promotion; **high** for product truth, finance, publication, release, or security.

**Required controls.** Always different Run and actor/session; high-risk work also uses a distinct reviewer Role and, where warranted, prompt/model family. Reviewer receives the Work Product and evidence—not unrestricted producer conversation—and emits a structured Review Receipt.

### TM-13 — “Shadow” label still has live capabilities

**Story.** A Run is marked `shadow` in a prompt, row, or UI, but the process still holds the service-role client, publishing/payment credentials, or mutating domain adapters.

**Impact.** Production mutation before rollout approval; **critical**.

**Required controls.** Enforce mode during capability construction and state transition: separate read-only/scoped credentials, no side-effect adapter registration, database invariant preventing shadow command claims, and an audit test that attempts every denied write. A caller-controlled flag is not a control.

### TM-14 — Shared admin token creates a false human-review trail

**Story.** A server or caller using a shared `ADMIN_API_TOKEN` submits a high-risk approval or supplies an arbitrary reviewer label, producing a record that appears to be an accountable human decision.

**Impact.** Loss of non-repudiation and automated privilege escalation; **critical** for money, booking, PII, release, or public mutation.

**Required controls.** Derive reviewer identity server-side from an interactive, verified human subject; do not accept caller-provided attribution. Shared tokens may perform explicitly classified machine operations but cannot satisfy a high-risk human approval. Bind subject, authentication method, time, scope, and approval hash in the receipt.

### TM-15 — Provider fallback changes data destination or review behavior

**Story.** DB policy resolution fails and the existing cache/environment fallback selects a different provider/model with different residency, retention, or output behavior, while the Run appears to follow the original policy.

**Impact.** Sensitive data reaches an unintended provider or the result is not reproducible; **high**, potentially **critical** for restricted data.

**Required controls.** Resolve and persist the provider/model/policy source/fallback before the call. Classify allowed fallback chains per Task and data class; restricted lanes fail closed. Review receipts bind the exact provider/model/prompt/policy versions.

## 3. Severity calibration and priority

Severity combines plausible business impact with the strength of the boundary crossed; it is not a probability claim.

| Severity | Meaning in Yeosonam | Examples |
|---|---|---|
| Critical | Unauthorized/duplicate money, booking, refund, ledger, tenant/PII, or Production credential effect | TM-01 financial command, TM-02 high-risk approval replay, TM-05, TM-10 with Production reach |
| High | Public brand mutation, evidence corruption, durable control-plane bypass, material cost/availability loss | TM-03 non-financial effect, TM-04, TM-06–09, TM-12, TM-15 |
| Medium | Misleading operation or contained failure without direct sensitive mutation | TM-11, bounded low-risk draft errors |
| Low | Cosmetic or fully reversible issue with no policy/data boundary crossed | Visual-only status discrepancy with exact underlying drilldown |

PR-01 must first address these architectural blockers:

1. atomic Run claim/lease/fencing and crash-window semantics;
2. exact-subject approval and structured Command Receipt;
3. tenant/PII/artifact contracts and negative isolation tests;
4. hierarchical budget/loop guard and layered kill switches;
5. exact KPI lineage before Office V2 decision surfaces.

## 4. Residual risk and validation plan

The design reduces authority and makes ambiguous outcomes visible; it cannot make model output, providers, suppliers, or operators infallible. High-risk mutation retains human approval and domain reconciliation even after good eval results.

Before enabling any write path:

- run concurrency and property tests for claim, heartbeat, expiry, fencing, idempotency, cancellation, and approval invalidation;
- inject faults before/after external calls and each receipt/state write;
- execute tenant-crossing and artifact-swap negative tests;
- test prompt injection against actual scoped tools with fake secrets/data;
- verify logs/traces/Office responses for PII/secret/signed-URL leakage;
- replay real historical cases, then shadow and canary the exact Task Contract;
- obtain separate security and domain-owner approval for financial, booking, publishing, migration, or customer-contact Commands.

Independent source review confirmed that `agent_runs`, Work Product/Review receipts, and generic Command receipts are absent at this baseline, and that no Agent Office V2 Inngest function is registered. It also confirmed that the current Office/raw ledger surfaces are platform-admin/service-role paths rather than reusable tenant APIs. These are prerequisites, not implemented protections.

Open design questions that must be answered before a write-capable phase are: who may create/view/cancel/review each Run class; whether and how shadow authority can ever be promoted; exact envelope canonicalization; artifact backend/ACL/encryption/retention; interactive-human requirements by risk; authorized event producers; append-only/tamper-evidence expectations; and the pinned provenance/network/secret scope of every new adapter.

No security control in this document authorizes PR-01. The human approval box in `review.md` remains open.
