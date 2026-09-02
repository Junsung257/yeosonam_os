# Business Event Inventory

## Three Independent Idempotency Layers

| Layer | Identity | Protects | Required retention |
|---|---|---|---|
| Transport | Inngest `event.id` | duplicate delivery of the same transmitted event | transport-window specific; current Inngest documentation describes a 24-hour event-ID dedupe window |
| Business Task | `agent_tasks.idempotency_key` or domain key | the same business objective arriving through different events, retries, or channels | at least the business object's duplicate-risk horizon |
| Command Side Effect | command/action idempotency key plus receipt | duplicate database/external mutation after timeout, retry, or reconciliation | at least the legal/operational side-effect replay horizon |

The values may be derived from the same stable inputs, but their namespaces, semantics, uniqueness constraints, and retention must remain separate.

Example:

```text
transport: blog-pipeline:<queueId>:<contentVersion>
business:  blog-generate:<canonicalContentKey>:<contentVersion>
command:   blog-publish:<creativeId>:<approvedFingerprint>
```

## Current Inngest Inventory

| Producer | Event / trigger | Current schema | Consumer | Transport ID | Business idempotency | Replay assessment | Dead-letter / failure | Retention evidence |
|---|---|---|---|---|---|---|---|---|
| Inngest schedule | `daily-marketing-orchestrator`, cron `20 0 * * *` | scheduled event timestamp | `dailyMarketingFn` | platform schedule identity; child IDs are explicit | run date plus tenant in child event; downstream pipeline rules vary | orchestrator read/fan-out is replayable only while child IDs and downstream business keys remain stable | no repository `onFailure`; exhausted failures remain in Inngest/system event only | not configured in repository |
| `dailyMarketingFn` | `marketing/tenant.run` | strict `{tenantId, tenantName, runDate}` | `tenantMarketingFn` | `marketing-tenant:<tenantId>:<runDate>` | no single durable Agent Task key; downstream marketing pipeline owns domain dedupe | **conditional**: `event.id` prevents same-ID transport duplicate for its window, but a new ID can repeat pipeline/publish work | 2 retries; no repository dead-letter handler | not configured in repository |
| Inngest schedule | `monthly-billing`, cron `0 0 1 * *` | scheduled event timestamp | `monthlyBillingFn` | platform schedule identity; child IDs explicit | billing period plus tenant in child event | fan-out itself replayable; child charge is high-risk | 3 retries; no repository dead-letter handler | not configured in repository |
| `monthlyBillingFn` | `billing/charge.tenant` | strict `{tenantId, amount, billingPeriod}` | `tenantBillingFn` | `billing-tenant:<tenantId>:<billingPeriod>` | deterministic Toss `orderId = ysn-<tenant>-<YYYY-MM>`; no local command-receipt proof before external call | **unproven / block generic reuse**: the retriable charge step performs external charge, then multiple DB writes. A response loss or DB failure creates an uncertain window | 2 retries; billing history records observed response, but no generic `onFailure`/reconciliation event in this function | not configured in repository; finance/legal history must be longer than transport dedupe |
| `blog-generate` authorized cron | `blog/pipeline.requested` | strict `{queueId UUID, contentVersion, mode, requestedAt}` | `blogAutopilotV4Fn` | `createBlogPipelineEventId(queueId, contentVersion)` | queue/content version, Blog generation dedupe, generation runs, claims, publication fingerprint, indexing outbox | **bounded replayable** when the same content version and domain ledgers are preserved; changed content version is intentionally a new event | 3 retries; queue terminal/quarantine evidence exists, but no repository Inngest `onFailure` handler | not configured in repository; Blog domain artifacts have their own retention |

## Workflow Checkpoint Inventory

| Function | Steps | Keyed concurrency | Side-effect notes |
|---|---|---|---|
| `tenantMarketingFn` | marketing pipeline, winner publish | tenant ID, limit 1 | winner publication is inside a retriable step and therefore still requires domain idempotency |
| `tenantBillingFn` | subscription read, charge | tenant ID, limit 1 | keyed concurrency prevents overlap, not replay after failure; payment receipt/reconciliation remains mandatory |
| `blogAutopilotV4Fn` | research, brief, draft, verify, edit, quality, preview, publish-queue, indexing-defer, observe | queue ID, limit 1 | public publication is not executed here; scheduled controller and atomic Blog RPC remain authoritative |

## Delta Revalidation At `754f739569d03c65fd8e1c1573e415c389b017f2`

The two post-baseline Blog commits do not change `src/inngest/client.ts`, `src/inngest/index.ts`, or any registered file under `src/inngest/functions/**`. Therefore:

- typed event names and schemas are unchanged;
- registered function count remains five;
- `blog/pipeline.requested` and its queue/content-version Event ID remain unchanged;
- keyed concurrency, retry count, and absence of a repository `onFailure` handler remain unchanged;
- no Agent Office event is registered.

`blog-generate` now applies stricter publishable-candidate selection before sending the same event, and the release workflow reads back private shadow artifacts instead of treating event acceptance as success. These are producer precondition and verification changes, not Event Inventory additions.

## Event Contract Required Before Agent Execution

Every new event registry entry must declare:

```text
event_name
schema_version
producer
consumer_task_key
tenant_scope
transport_id_expression
business_idempotency_expression
command_idempotency_expression or "none"
replay_class: safe | conditional | forbidden
replay_preconditions
failure_event / dead_letter_target
retention_class
PII_class
```

`event.id` never appears as the value of `business_idempotency_expression` merely because it is available.

## Agent Workflow Event Set: Proposed, Not Registered

| Candidate | Purpose | Status |
|---|---|---|
| `office/task.requested.v1` | create or locate one idempotent Task Contract | design only |
| `office/run.requested.v1` | request a shadow Run for an existing task | design only |
| `office/work_product.completed.v1` | route a hash-addressed result to a deterministic next step | design only |
| `office/review.completed.v1` | persist review receipt and continue/stop by policy | design only |
| `office/approval.decided.v1` | resume the exact approval subject after fingerprint comparison | design only |
| `office/command.requested.v1` | request a registered command after approval | **deferred; no Production Command** |
| `office/run.failed.v1` | centralize exhausted-run failure and incident creation | design only |

These names are not added to `src/inngest/client.ts` in PR-00.

## Required Failure Handling

- Exhausted workflow retries must emit or handle a versioned failure event and create one idempotent Incident/dead-letter reference.
- A failure handler must never retry a side effect without first reading its command receipt/reconciliation state.
- Inngest run history is operational evidence, not the long-term Business SSOT.
- Keyed concurrency is capacity/overlap control, not a substitute for a lease, business idempotency, or command receipt.
- `step.waitForEvent()` must use an exact approval/task predicate and a bounded timeout; it begins listening at the wait boundary, so the workflow also checks durable approval state to avoid an event-before-wait race.

## Sources

- Repository: `src/inngest/client.ts`, `src/inngest/runtime-policy.ts`, `src/inngest/functions/**`, `src/app/api/cron/blog-generate/route.ts`.
- Official Inngest idempotency: <https://www.inngest.com/docs/guides/handling-idempotency>
- Official checkpoint/retry behavior: <https://www.inngest.com/docs/guides/error-handling>
- Official waits and event race note: <https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event>
