# Agent Office V2 PR-00 review

## Decision Recorded

- [x] `GO — FOUNDATION SCOPE ONLY`: approve only PR-01A–D as bounded in `plan.md`, with a stop after every PR.
- [ ] `AMEND`: approve only after listed changes are made.
- [ ] `NO-GO`: keep Agent Office V1 read-only and do not add a runtime control plane.

This is not approval for the complete AI Office, automatic continuation, or any Production write path.

## Evidence

- [x] Baseline HEAD is `754f739569d03c65fd8e1c1573e415c389b017f2` after delta-only revalidation from `739647696b4568aded3fd765fd7db4122fa9be26`.
- [x] Initial `git status --porcelain` in the new Worktree returned no entries.
- [x] No Production, DB, worker, external install, Office write, or live model operation was performed.
- [x] Compatibility and ledger inventories are repository-backed.
- [x] Current Inngest transport dedupe is not treated as permanent business idempotency.
- [x] Blog DeepSeek-only is explicitly preserved.
- [x] `agent_runs` is shadow-only and forbids synthetic legacy backfill.
- [x] Office V2 period KPI computation is moved away from bounded snapshot arrays in the design.
- [x] Verification commands have been recorded below after execution.

## Principal Finding

Adopt the architecture principle, not another AI-company framework. Reuse the existing control plane and add only the identities that are genuinely missing.

The only currently justified new generic ledger is:

1. `agent_runs`, because a task objective and an execution attempt have different lifecycle, lease, actor, cost, and review identities.

A structured Command Receipt contract is mandatory before any generic Office Command, but storage is extend-first: `agent_actions`, then a domain receipt, then a separate ledger only after an impossibility proof. Foundation permits contract and tests only, never executor wiring.

All other concepts are reuse, minimal extension, or deferral.

## Remaining Risk

- The baseline `AGENTS.md` points to missing `docs/agency-agents-adoption.md`; this is pre-existing documentation drift and is not silently repaired in PR-00.
- The LLM telemetry audit scans files, not invocation sites, and its 30 candidates include three non-generation/comment-only matches. The runtime inventory corrects that distinction but a future strangler migration still needs call-site tests.
- Monthly billing wraps the external charge and multiple DB writes in one retriable Inngest step. The repository does not prove a local command receipt before the external charge; treat replay safety as unproven until a payment-specific review confirms the provider contract and recovery path.
- Existing Decision Packet persistence is advisory and swallows persistence errors. It cannot authorize a resumable Production Command without fail-closed subject hashing.
- The generic `agent-executor` selects approved actions and invokes handlers without a repository-visible atomic claim, lease, or fencing check. It is not an acceptable execution path for future Office Commands until separately hardened and fault-tested.
- The Technology Scout suite is specified but not executed. Live provider credentials, model spend, external downloads, and Production endpoints remain out of scope.

## PR-01 Gate

- [x] Exact baseline and clean Worktree evidence exists.
- [x] Every proposed concept is classified.
- [x] The one currently justified `NEW` ledger has an impossibility rationale; Command Receipt storage remains extend-first and conditional.
- [x] A minimum `agent_runs` schema and lease state model exist.
- [x] Runtime and Provider are separated in the target contract.
- [x] Blog DeepSeek-only remains unaffected.
- [x] KPI sources and reconciliation queries are specified.
- [x] First Production Command count is zero.
- [x] External Skill, MCP, binary, DB migration, and Production change counts are zero.
- [x] Human Foundation-only approval exists.

PR-01A may begin only after this documentation PR is reviewed/merged and explicitly handed off. PR-01B–D do not start automatically.

## Approved Foundation Scope

| Slice | Approved boundary |
|---|---|
| PR-01A | Code-owned Role/Task/Runtime/Tool/Command definitions, Work Product/Review/Runtime Result schemas, Reason Codes, and compatibility bindings; no DB or runtime execution |
| PR-01B | New-execution-only shadow `agent_runs`, RLS, atomic lease RPC, shadow writer, reconciliation tests; migration preview only and no authority promotion |
| PR-01C | Minimal read-only `AgentRuntimeAdapter` and adapters around existing DeepSeek/Claude/Gemini policy; existing `AiProvider` union and Blog contract unchanged |
| PR-01D | One manually triggered `research.technology_scout` shadow task ending at reviewed Technology Radar candidate |
| Command Receipt | Contract, invariants, storage compatibility decision, and fault tests only; no Side Effect Executor |

Explicitly excluded: automatic delegation, Production Command, `office.cancel_task`, Office V2 writes/UI, Visual Office, external installation, Production migration, Blog provider changes, and Hermes/OpenClaw/OpenMontage.

## Foundation Hard Stops

- Atomic claim/lease/fencing cannot be proven.
- Tenant binding or short-lived task-bound read scope cannot be proven.
- Shadow cannot be enforced with credentials, zero write tools, API/RLS scope, and Command Registry denial.
- Raw prompts, tool arguments, secrets, or PII enter normal traces.
- Blog DeepSeek-only or existing Provider policy would change.
- Existing user work would be overwritten or mixed into the Foundation PR.
- Decision Packet persistence is not fail-closed on a future actionable path.
- A shared administrator token is proposed as the human approver for payment, booking, refund, settlement, publication, messaging, or Production deployment.

## Verification Results

Original packet checks ran in `C:\dev\yeosonam-os-pr00-agent-office`. Delta-revalidated checks run in `C:\dev\yeosonam-os-pr00-foundation-go` on 2026-09-03.

| Check | Result |
|---|---|
| `git rev-parse origin/main` before docs commit | PASS — exact baseline `754f739569d03c65fd8e1c1573e415c389b017f2` |
| `check:agent-surfaces` for `pr00-owner` | PASS |
| `check:agent-workflow:ci` | PASS — 0 findings |
| `audit:llm-telemetry:ci` | PASS — 30 candidates, 2 traced, 28 grandfathered, 0 new violations |
| `check:harness` | PASS — 0 harness findings, surface/skill/inventory/host checks passed, risk ratchet added 0 violations, deterministic contracts 30/30, Node harness tests 29/29 |
| `test:blog-autopilot-v4` | PASS — 14 files, 69 tests |
| focused two-commit Blog delta suite | PASS — 6 files, 35 tests covering programmatic contract, research-ready queue, shadow proof, scheduler, route compatibility, and Inngest contract |
| `git diff --check` | PASS |
| external GitHub candidate links | PASS after correcting Headcount and OpenMontage references; all 30 unique repository links returned HTTP 200 |
| repository path references | PASS except the explicitly documented pre-existing missing `docs/agency-agents-adoption.md` and an intentional `src/inngest/functions/**` glob |

The clean Worktrees had no local `node_modules`. No installation was performed. Temporary verified Junctions reused existing workspace dependency trees for complete checks and were removed immediately afterward; both source dependency trees remained intact.

Final scope remains documentation-only. There is no migration, endpoint/UI/runtime change, external installation, live model/eval execution, Office write, or Production Command.
