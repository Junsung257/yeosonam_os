# AI Operations Office V1

## Problem

Yeosonam OS already records `agent_tasks`, `agent_approvals`, `agent_incidents`, and
`agent_trace_spans`, and it already runs durable background work through Inngest.
However, `/admin/agent-mas` exposes these records as separate raw JSON lists.
Operators cannot quickly answer:

- Which tasks belong to the same objective?
- Which work is active, blocked, failed, or complete?
- What evidence and trace history exist for one run?
- Does an approval unblock real work, or only change a database status?
- Is the system operating as a bounded workflow or an uncontrolled autonomous loop?

## Decision

Build a hybrid control plane:

1. Durable work remains in the backend.
2. `correlation_id` is the V1 workroom/thread boundary.
3. The thread is an evidence timeline, not a free-form agent chat room.
4. `/admin/agent-mas` becomes the human control surface.
5. Production mutations remain behind existing approval and domain gates.

No new multi-agent runtime is introduced in V1. The existing Inngest, task state
machine, approval queue, and trace ledger remain the execution foundation.

## User Outcomes

The platform administrator can:

- see active workrooms and health metrics at a glance;
- distinguish fresh activity from abandoned `running` rows;
- select a workroom and inspect tasks, approvals, incidents, and trace spans in time order;
- filter approvals, tasks, and incidents without reading raw JSON;
- inspect pending and overdue approvals without mutating them;
- understand the current operating mode and safety boundary;
- distinguish real multi-task collaboration from single-agent runs.

## Functional Requirements

- Aggregate the four agent tables in one admin-only API.
- Bound every source query and the response payload.
- Group tasks by `correlation_id`.
- Compute active workrooms, pending approvals, 24-hour failures, seven-day terminal
  completion rate, and observed multi-task workrooms.
- Mark active workrooms stale after 24 hours without an update and expose ledger
  freshness.
- Mark pending approvals overdue after their explicit expiry, or after seven days
  when no expiry was stored.
- Derive workroom status and risk deterministically.
- Redact PII from any operator-facing free-text excerpt.
- Keep the V1 dashboard observation-only until a versioned durable resume state is
  connected.
- Harden the legacy approval endpoint so malformed actions fail closed and stale or
  concurrent decisions return conflicts.
- Keep the existing raw task/approval/incident endpoints backward compatible.
- Provide loading, empty, and visible error states.
- Provide drilldown behavior from every KPI.

## Safety Requirements

- Read-only snapshot endpoint.
- Platform-admin guard through the existing admin guard.
- No service-role key in the client.
- No production database migration in V1.
- No booking, payment, settlement, PII, external publishing, or ad-spend action.
- No autonomous loop, scheduler, or automatic run creation.
- No raw customer message in workroom titles.
- No hidden failure fallback that reports healthy data.

## Non-Goals

- A general project-management system.
- A visual drag-and-drop agent builder.
- Agent-to-agent social chat or a forum.
- Bulk installation of CrewAI, AutoGen, LangGraph, AgentKit, or OpenAI Agents SDK.
- Resuming frozen tasks automatically after approval.
- Running coding agents against the repository from production.
- Replacing Jarvis, the control tower, or Inngest.

## Research Basis

- Anthropic recommends simple composable workflows first, and reports multi-agent
  research is strongest for breadth-first parallel work but can use roughly 15 times
  the tokens of chat.
- OpenAI documents manager/agents-as-tools and handoff patterns, with tracing across
  generations, tool calls, handoffs, and guardrails.
- LangChain identifies context engineering as the central multi-agent problem and
  distinguishes subagents, handoffs, routers, skills, and deterministic workflows.
- AutoGen explicitly recommends starting with one optimized agent and moving to teams
  only when a single agent is inadequate.
- Google ADK separates predictable sequential/parallel/loop workflow agents from
  model-directed routing.
- Inngest provides durable steps, retries, state persistence, event waits, and
  per-tenant concurrency, which fits the runtime already present in this repository.

Primary references:

- https://www.anthropic.com/engineering/building-effective-agents
- https://www.anthropic.com/engineering/multi-agent-research-system
- https://openai.github.io/openai-agents-js/guides/multi-agent/
- https://openai.github.io/openai-agents-js/guides/human-in-the-loop/
- https://openai.github.io/openai-agents-js/guides/tracing/
- https://docs.langchain.com/oss/javascript/langchain/multi-agent
- https://docs.langchain.com/oss/python/langgraph/interrupts
- https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html
- https://developers.googleblog.com/agent-development-kit-easy-to-build-multi-agent-applications/
- https://www.inngest.com/docs/learn/how-functions-are-executed
- https://www.inngest.com/docs/guides/handling-idempotency

## Acceptance Criteria

- Pure aggregation tests cover grouping, status/risk precedence, metrics, PII
  redaction, bounded workrooms, and missing-table fallbacks.
- The new endpoint uses `apiResponse`, `withAdminGuard`, bounded parallel queries, and
  sanitized database errors.
- `/admin/agent-mas` renders correctly at desktop and mobile widths.
- The page does not display raw task context by default.
- The dashboard contains no direct approval mutation control.
- The legacy approval endpoint rejects malformed, overdue, and concurrently resolved
  decisions.
- Type checking and focused tests pass, or unrelated pre-existing failures are
  documented with evidence.
