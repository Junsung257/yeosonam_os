# Implementation Plan: Agent Office V2 PR-00

## Approach

Use the existing repository as the primary evidence source. Classify a new primitive as `NEW` only when current ledgers cannot express its identity, lifecycle, or audit invariant without semantic overloading. Preserve domain SSOT and approval gates above all generic Agent Office concepts.

## Impact Areas

- Code: read-only inspection only.
- Data/API: future contracts documented; no schema or endpoint change.
- UI: no change. Office V2 visual work remains deferred.
- Docs/tests: one Tier 3 evidence packet and repository contract checks.

## Required SSOT

- `AGENTS.md`
- `CURRENT_STATUS.md`
- `docs/agent-workflow-current-ssot.md`
- `docs/agent-office-current-ssot.md`
- `docs/ai-ops-current-ssot.md`
- `docs/blog-autopublish-contract.md`
- `docs/settlement-current-ssot.md`
- `docs/product-registration-current-ssot.md`
- `docs/ai-agent-doc-automation.md`

`AGENTS.md` references `docs/agency-agents-adoption.md`, but that file is absent at the fixed baseline. This packet therefore uses the completed Agent Office V1 spec, current SSOTs, repository code, and official primary sources instead of inventing the missing document's contents.

## Work Sequence

1. Prove exact baseline commit and clean worktree.
2. Inventory existing tasking, approval, command, trace, workflow, runtime, provider, KPI, and domain recovery patterns.
3. Produce compatibility decisions and minimum future contracts.
4. Model approval/cancellation races and threats before any command is registered.
5. Define the first read-only eval suite.
6. Run documentation and surface checks.
7. Stop for human review.

## Data Flow

```text
repository code + migrations + current SSOT + official primary sources
  -> evidence tables
  -> compatibility decisions
  -> ADRs and risk models
  -> human PR-00 decision
```

No Production or local database data enters this flow.

## Risks And Guardrails

- Architecture by aspiration: every decision cites an existing repository surface or a proven gap.
- Duplicate control plane: Inngest, `agent_tasks`, approvals, actions, and domain SSOT remain authoritative.
- Hidden provider regression: Blog DeepSeek-only remains explicitly outside the runtime-adapter pilot.
- Approval illusion: no Office write is enabled until resumable run state, subject hashing, and a receipt boundary exist.
- KPI fiction: bounded snapshots remain operational views, never period KPI sources.
- Supply-chain drift: external projects are reference-only; no installer or code import runs in PR-00.

## PR-01 Candidate Sequence

Foundation-only human approval permits four separately reviewed PRs. Each stops after implementation, tests, and residual-risk reporting.

### PR-01A — Contract Registry

- `RoleDefinition`, `TaskDefinition`, `RuntimeProfile`, `ToolProfile`, and `CommandDefinition`.
- Work Product, Review Receipt, Runtime Result, and Reason Code schemas.
- Compatibility adapter for existing `agent_type` and `specialist_id`.
- Repository contract and operational binding are separate.
- No database migration or runtime execution.

### PR-01B — Shadow `agent_runs`

- Migration, service-only RLS/grants, atomic lease RPC, shadow writer, and reconciliation tests.
- New executions only; no inferred historical backfill.
- Local/Supabase Preview validation only. Production application requires separate approval.
- `agent_tasks` remains business-state SSOT; `agent_trace_spans` remains observation evidence.
- Runs cannot drive Office KPI, retry, Worker authorization, or Commands.

### PR-01C — Runtime/Provider Adapter

- Minimal `health()`, `start()`, optional `cancel()` Runtime interface.
- Read-only task-bound, tenant-bound, short-TTL capability profile with zero write tools.
- Wrap existing DeepSeek/Claude/Gemini policy without widening `AiProvider`.
- No `resume`, streaming, subagent orchestration, Production service role, or Blog provider change.

### PR-01D — Technology Scout Shadow Pilot

- One manually created `research.technology_scout` Task.
- Read-only official-source research, structured Work Product, independent Review, and Technology Radar candidate.
- Installation, repository edit, PR creation, publishing, external write, Production access, and Production Command remain zero.

### Command Receipt design lane

PR-01A may define the contract and tests. It must test `agent_actions` and domain-receipt extension before proposing a new table. No Side Effect Executor is connected in A–D.

No Production Command or automatic delegation is part of this sequence. Completion of one PR never authorizes the next.
