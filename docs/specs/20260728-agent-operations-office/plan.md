# Plan

## Architecture

```text
Jarvis / QA / background workflows
                |
                v
agent_tasks -- agent_approvals -- agent_incidents -- agent_trace_spans
                |
                v
      agent-office snapshot builder
                |
                v
 GET /api/admin/agent/office
                |
                v
 /admin/agent-mas control surface
```

## Implementation

1. Add a pure `agent-office` projection library.
   - Define bounded row and response contracts.
   - Group by `correlation_id`.
   - Derive status, risk, metrics, role labels, safe title, and activity timeline.
2. Add a read-only admin snapshot route.
   - Query tasks, approvals, incidents, and spans in parallel.
   - Treat an unavailable optional table as a visible degraded source, not as success.
   - Return a bounded projection instead of raw payloads.
3. Rebuild `/admin/agent-mas`.
   - Overview KPIs with drilldown.
   - Workroom list and selected workroom timeline.
   - Observation-only approval queue with overdue detection.
   - Source freshness and stale-work warnings.
   - Incident and task tables.
   - Operating-model panel that states the actual safety boundary.
4. Add focused unit tests and browser verification.
5. Add the durable current-state document and update the docs index.
6. Harden the legacy approval route to fail closed on invalid, overdue, and
   concurrently resolved requests.

## Design Rules

- Quiet operations UI, not a virtual-office illustration.
- No gradients, gauges, 3D charts, nested cards, or chat theatrics.
- One accent color; severity colors only for operational meaning.
- Stable table and workroom layouts with horizontal overflow where necessary.
- Korean operator labels; technical identifiers remain monospace.
- Loading skeletons, useful empty states, and inline errors.

## Runtime Follow-Up

Actual multi-agent execution is a separate gated phase:

1. Define one high-value, read-only workflow and an eval set.
2. Prove that parallel specialist review beats a single-agent baseline.
3. Add a manually triggered Inngest function with at most three workers.
4. Persist each step as an `agent_task` under one `correlation_id`.
5. Wait for approval events before any production mutation.
6. Persist and version the resumable run state used by the approval.
7. Set token, elapsed-time, retry, and tool-call budgets.

This phase is intentionally not bundled into V1 because current evidence does not
justify autonomous production execution.
