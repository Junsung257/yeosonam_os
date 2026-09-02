# Feature Spec: Agent Office V2 PR-00

## Goal

Decide, from the repository at commit `754f739569d03c65fd8e1c1573e415c389b017f2`, which parts of an AI one-person-company control plane Yeosonam should reuse, minimally extend, create, or defer. The result must be implementation-ready evidence, not an implementation.

The retained operating model is:

```text
Business Event
  -> deterministic Inngest workflow
  -> narrowly scoped role invocation
  -> structured Work Product
  -> independent validation and approval where required
  -> registry-approved Command
  -> domain mutation plus durable receipt
```

The Agent Office is an evidence and control surface. It is not a simulated office, a free-form agent chat room, or a second workflow engine.

## Baseline And Stop Boundary

| Item | Fixed value |
|---|---|
| Repository | `Junsung257/yeosonam_os` |
| Baseline commit | `754f739569d03c65fd8e1c1573e415c389b017f2` after delta-only revalidation from `739647696b4568aded3fd765fd7db4122fa9be26` |
| Worktree | new clean worktree |
| Production change | forbidden |
| Database migration | forbidden |
| External tool, Skill, MCP, or binary install | forbidden |
| Agent worker execution | forbidden |
| Office write action | forbidden |
| First Production Command | zero |

PR-00 stops after documentation and deterministic repository checks. PR-01 is `NO-GO` until a human approves this packet.

## Success Criteria

- [x] Every proposed control-plane concept is classified `REUSE`, `EXTEND`, `NEW`, or `DEFER` against current repository evidence.
- [x] Existing lease, heartbeat, retry, receipt, decision-packet, and kill-switch patterns are compared.
- [x] Direct LLM caller candidates and the provider/runtime boundary are inventoried without changing provider policy.
- [x] Current Inngest events are inventoried with transport, business, and command idempotency kept distinct.
- [x] Agent Office KPI lineage identifies bounded-snapshot inaccuracies and defines reconciliation requirements.
- [x] Cancellation, approval invalidation, uncertain side effects, and required reconciliation are modeled.
- [x] A threat model and a 30-case `research.technology_scout` eval baseline are defined.
- [x] Ten ADRs record the narrowest adoption decisions.
- [x] A human has approved the Foundation-only PR-01A–D sequence; each PR still requires an explicit stop and separate report.

## Non-Negotiable Semantics

- `correlation_id` is an execution-causality/workroom key, not a Mission identifier.
- `event.id` is transport deduplication and does not replace business or command idempotency.
- Cancellation intent is a Command lifecycle; it must not be encoded by continuously expanding the task status enum.
- Reviewer independence always requires a distinct run and actor/session. A distinct role is mandatory for high-risk work and a default, not a database-wide constraint, for lower-risk work.
- `agent_runs`, if approved later, starts shadow-only for new execution. Synthetic legacy backfill is forbidden.

## In Scope

- Repository and migration inventory.
- Compatibility decisions and future minimum schemas.
- Read-only architecture, security, evaluation, and rollout documentation.
- Official-source validation of selected architectural assumptions.

## Out Of Scope

- Runtime, provider, UI, API, workflow, or database implementation.
- Changing Blog's DeepSeek-only publication contract.
- Registering `office.cancel_task` as a Production Command.
- Installing Paperclip, Headcount, CrewAI, LangGraph, AutoGen, another workflow engine, MCP server, or external Skill.
- Running live model evals or Production data queries.
- Designing character art or a visual-office simulation. Visual polish is a later projection over truthful operations data.
- Automatic delegation, Production Commands, `office.cancel_task`, Office V2 writes, and using `agent_runs` as KPI/retry/authorization authority.

## Human Decision: GO — Foundation Scope Only

The approval covers only:

1. repository-owned Role/Task/Runtime/Tool/Command contracts and schemas;
2. new-execution-only shadow `agent_runs`, with no historical backfill or authority promotion;
3. a minimal read-only Runtime Adapter wrapping the unchanged provider policy;
4. one manually triggered `research.technology_scout` shadow pilot producing a review-only Technology Radar candidate.

Command Receipt storage receives design approval only. Contract and tests may be defined, but no Side Effect Executor may claim or write a Production Command.

Each PR stops after its own implementation, tests, and residual-risk report. Approval of this packet does not automatically start the next PR.

## Users And Risks

- Primary audience: owner/operator, platform engineering, independent reviewer.
- Risk tier: Tier 3.
- Sensitive surfaces: AI provider policy, tenant boundaries, PII, approvals, future commands, money/booking/publication domain gates.

## Remaining Decision Gates

- [ ] Approve PR-01A implementation after this documentation PR is reviewed/merged.
- [ ] Approve every subsequent PR independently; no automatic continuation.
