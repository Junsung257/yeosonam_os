# Agent Workflow Current SSOT

> 2026-08-19 Blog V4 implementation note: 블로그 후보는 12개 독립 agent가 아니라 operation 하나당 Workflow DevKit durable workflow 하나를 사용한다. 수요·snapshot·research·brief·DeepSeek generation·평가·재작성·승인 단계를 idempotency key와 fencing token으로 이어가며, 외부 API/DB 일시 장애만 재시도하고 사실/계약 위반은 fail-closed로 종료한다. durable attempt는 최대 5개지만 AI Control Plane 활성화 후 유료 provider 호출은 Flash 1회와 Pro 1회로 제한되며 나머지는 deterministic repair/review 단계다. 공개는 workflow가 아닌 publication controller가 담당한다.

Last updated: 2026-06-27

This is the current operating contract for AI-agent development workflow in Yeosonam OS. It absorbs the useful patterns from Superpowers, Spec Kit, LazyCodex, Cline, OpenHands, Aider, ast-grep, Probe, and Agency Agents without installing their autonomous runtimes or letting them override Yeosonam domain rules.

## Source Of Truth

Yeosonam SSOT wins over generic agent workflow advice:

- `AGENTS.md` is the shortest entry point.
- `.claude/CLAUDE.md` is the deeper harness guide.
- `.cursor/rules/*.mdc` defines editor-agent rules.
- Domain SSOT files under `docs/` define current business behavior.
- `docs/ai-agent-doc-automation.md` decides whether work needs a durable artifact.
- `docs/agency-agents-adoption.md` defines how external role catalogs are tested and selectively imported.

Do not install LazyCodex, Spec Kit, Superpowers, OpenHands, Cline, Aider, Probe, or Agency Agents as part of normal Yeosonam work. Their patterns are references only unless the user explicitly asks for a separate tool pilot.

## Standard Workflow

Use this loop for meaningful work:

1. **Explore**: read `AGENTS.md`, the matching domain SSOT, relevant rules, and actual code/schema before deciding.
2. **Spec/Plan**: write down the intended behavior, risk, verification, and out-of-scope boundaries at the smallest useful level.
3. **Work**: make narrow changes that follow existing architecture and domain ownership.
4. **Evidence Review**: verify with concrete evidence before reporting completion.

Completion cannot be based on a confident status sentence. It needs at least one real evidence item: automated test output, API response, DB/schema check, screenshot/browser proof, audit log, eval, or a domain-specific readiness command.

## Work Tiers

| Tier | Trigger | Required workflow |
|---|---|---|
| Tier 0 | typo, import, single-file mechanical edit explicitly specified by the user | No spec packet. Read only the needed local context and verify narrowly. |
| Tier 1 | ordinary code or doc change with limited blast radius | Short plan in chat or final answer. Run the narrowest relevant check. |
| Tier 2 | new feature, 10+ files, cross-domain behavior, substantial UI flow, or unclear acceptance criteria | Create `docs/specs/YYYYMMDD-short-slug/` from the template before implementation. |
| Tier 3 | DB/RLS, settlement, booking state, PII, external publishing, credentials, AI provider routing, Jarvis/RAG, product-registration persistence/render contract | Tier 2 packet plus matching domain SSOT, durable artifact, and explicit human approval for risky mutations. |

For Tier 2 and Tier 3, the feature packet must contain `spec.md`, `plan.md`, `tasks.md`, and `verification.md`.

## Approved Pattern Imports

- **Superpowers**: use brainstorming, TDD, systematic debugging, code review, and verification-before-completion as workflow discipline.
- **Spec Kit**: use spec, plan, tasks, and checklist-style verification, but do not run `specify init` in this repo.
- **LazyCodex**: use evidence gates, review-work thinking, and visual QA thinking; do not use autonomous install, Stop-hook continuation, or unlimited loops by default.
- **Cline**: keep Plan and Act separate; risky edits and commands require approval.
- **OpenHands**: prefer isolated worktrees or sandboxed backends for parallel/long-running agent work.
- **Aider**: favor git-diff-sized changes, repo maps, and lint/test feedback loops.
- **ast-grep / Probe**: use structural and token-aware reading before large refactors; deterministic search beats guessing.
- **Agency Agents**: use selected role patterns only after real-task comparison. First-approved imports are multi-agent architecture, evidence QA, prompt contracts, AI FinOps, AppSec/privacy review, SEO, and paid-media auditing. Do not bulk-install the roster.

## Hard Stops

The agent must stop or ask for explicit approval before:

- mutating production money, bookings, customer data, PII, credentials, or external advertising/publishing accounts;
- applying DB migrations to a remote database;
- enabling autonomous agent loops, auto-continue hooks, scheduled agents, or headless CI agents;
- installing new global plugins, MCP servers, or agent runtimes;
- overriding a domain SSOT because a generic workflow tool suggests something different.

## Domain Examples

- **Product registration / HWP / mobile render**: Tier 3. Verification must include source-to-output evidence and mobile browser/render proof when public product readiness changes.
- **Jarvis / RAG / AI Ops**: Tier 3. A stronger model answer is not proof. Use evals, RAG audits, readiness checks, fallback evidence, or prompt/version artifacts.
- **Blog autopublish**: Tier 2 or Tier 3. Verify topic fit, editorial quality, render, images, SEO, and indexing separately.
- **Settlement / affiliate / booking / PII**: Tier 3. Planning and verification are allowed; money/customer/external mutations require approval.
- **Admin UI**: Tier 2 when substantial. Verify browser behavior, responsive layout, KPI formulas, accessibility, and visual overflow.

## Closeout Contract

For meaningful work, final reports must include:

- what changed;
- which durable artifact captured the behavior or why none was needed;
- what verification ran and its result;
- what remains manual, deferred, or approval-gated.
