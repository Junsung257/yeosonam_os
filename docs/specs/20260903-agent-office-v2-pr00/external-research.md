# Agent Office V2 PR-00 external research

Researched: 2026-09-03
Scope: official documentation and source repositories; no package, Skill, MCP, binary, or model was installed or executed.

## Conclusion

The research supports the selected architecture but does not justify replacing the repository's control plane. The strongest pattern is a deterministic durable workflow calling narrowly scoped workers, exchanging versioned artifacts, and allowing only validated, approved, idempotent commands to mutate business state.

The practical adoption split is:

- directly keep or extend: Inngest, existing Supabase ledgers and RLS, OpenTelemetry-shaped metadata, Promptfoo, Playwright/Axe, current domain kill switches;
- adapt as internal design patterns: OpenAI/Anthropic agent guidance, Paperclip atomic-task/budget ideas, Headcount role/write-surface boundaries, MCP authorization rules;
- isolated trial only after a concrete need: Context7, Crawl4AI, Docling, OpenMontage;
- assess only in a disposable security lab: AgentShield and Strix;
- reject now: wholesale AI-company frameworks, a second control plane/workflow engine/approval ledger, and broad SQL/shell/publish/payment MCPs.

## Primary-source findings and local effect

| Source | Evidence used | Local decision |
|---|---|---|
| [OpenAI, A practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/) | Start with the simplest workable orchestration; add multi-agent complexity only when tool/instruction complexity warrants it; apply guardrails and human intervention to high-risk or repeated failure paths. | Keep deterministic routing as default. Call a Manager only for ambiguous routing, conflict, partial recovery, resource trade-offs, or executive options. |
| [Anthropic, Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | Evaluate final environment state and combine deterministic, semantic, and human grading; account for nondeterminism with repeated trials. | Technology Scout baseline uses real repository cases, contract checks, evidence/license grading, human calibration, and three trials. |
| [Inngest, Handling idempotency](https://www.inngest.com/docs/guides/handling-idempotency) | Event IDs provide transport deduplication for a documented window; function-level idempotency and concurrency have different purposes. | Preserve separate transport, business-task, and command-side-effect keys. Do not treat `event.id` as permanent business idempotency. |
| [Inngest, Multi-step functions](https://www.inngest.com/docs/learn/inngest-steps) and [Retries](https://www.inngest.com/docs/features/inngest-functions/error-retries/retries) | Steps are durable checkpoints and retry independently. | Continue using one workflow engine; put durable boundaries around externally visible work and make each retriable step replay-safe. |
| [Inngest, `waitForEvent`](https://www.inngest.com/docs/reference/functions/step-wait-for-event) | A workflow can suspend without continuously occupying execution while waiting for a correlated event. | Suitable for exact-subject human approval, provided expiry, correlation, invalidation, and resume checks fail closed. |
| [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) | Common operation/provider/model/token/tool attributes improve portability; prompt, input, output, and tool content can be sensitive. | Record identifiers, hashes, versions, usage, latency, and result codes by default. Keep raw content out of standard traces. |
| [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) | HTTP authorization is OAuth-based, tokens must be audience-bound, and token passthrough is forbidden. | If a Yeosonam MCP is ever exposed, validate resource audience and mint/use downstream credentials separately. Narrow read tools precede any command tool. |
| [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) | RLS policies and database privileges are distinct controls; service/backend access still needs intentional design. | New control-plane ledgers default to service-only access with explicit RLS, grants, tenant tests, and no assumption that RLS alone is sufficient. |
| [Supabase platform changes](https://supabase.com/changelog) | Current platform defaults around Data API exposure are evolving. | Declare schema exposure and grants explicitly in migrations; never rely on dashboard-era defaults. |

## Open-source pattern review

This table is a technology-radar decision, not permission to install.

| Candidate | Useful idea | Main mismatch/risk | Decision |
|---|---|---|---|
| [Paperclip](https://github.com/paperclipai/paperclip) | Atomic tasks, role/budget visibility, hard-stop concepts | Would duplicate Yeosonam Task, approval, trace, and workflow control planes | `REJECT` wholesale; `ASSESS` UI/contract patterns only |
| [Headcount](https://github.com/cbrock84/headcount) | Explicit role charters and exclusive write surfaces | Large role/skill catalog encourages premature bulk installation and file-based policy duplication | `REJECT` bulk install; `ASSESS` write-surface convention |
| [OpenAI Agents SDK JS](https://github.com/openai/openai-agents-js) | Provider tool/agent primitives and tracing patterns | A framework runtime is not a substitute for Business SSOT or Inngest durability | `ASSESS`; no control-plane replacement |
| [LangGraph](https://github.com/langchain-ai/langgraph), [CrewAI](https://github.com/crewAIInc/crewAI), [AutoGen](https://github.com/microsoft/autogen), [Google ADK](https://github.com/google/adk-python) | Orchestration, specialist, and state-machine reference implementations | Adds parallel orchestration abstractions, operational surface, and dependency risk | `REJECT` as Production control plane; reference documentation only |
| [Temporal TypeScript SDK](https://github.com/temporalio/sdk-typescript), [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) | Durable workflow design patterns | A second workflow engine creates dual retry/idempotency/operations semantics | `REJECT` while Inngest remains adequate |
| [Context7](https://github.com/upstash/context7) | Version-aware official library documentation retrieval | External server, content trust, network, and prompt-injection boundary | `TRIAL` only for read-only engineering research with provenance |
| [Crawl4AI](https://github.com/unclecode/crawl4ai), [Docling](https://github.com/docling-project/docling) | Web/document extraction for official-source research | Parser attack surface, untrusted content, resource use, license/data retention | `TRIAL` in isolated workers after a benchmark proves need |
| [OpenMontage](https://github.com/tjebastin/openmontage) | Media-production worker patterns | Heavy dependencies and untrusted media execution | `HOLD`; existing media control plane first |
| [AgentShield](https://github.com/agentshield-ai/agentshield), [Strix](https://github.com/usestrix/strix) | Intake scanning and isolated offensive testing ideas | Scanner claims are not proof; testing tools can execute risky payloads | `ASSESS` in disposable, credential-free lab only |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Research/runtime implementation reference | Another autonomous runtime and tool surface | `HOLD`; only after Runtime Adapter and eval contracts mature |
| [OpenClaw](https://github.com/openclaw/openclaw) | Possible operator-facing agent/runtime patterns | New runtime, auth, and remote-action surface | `HOLD`; a future mobile entry must begin read-only |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) and [MCP Servers](https://github.com/modelcontextprotocol/servers) | Standardized narrow tools and schemas | Generic servers often exceed least privilege and can widen secret/network reach | `ASSESS` protocol; `REJECT` generic Production servers |

## Better implementation method than importing a framework

1. Freeze the exact repository baseline and classify every proposed concept against existing ledgers.
2. Introduce a shadow Run identity and read-only Runtime Adapter; preserve current provider and domain contracts.
3. Define versioned Task, Delegation, Work Product, Review Receipt, and Command envelopes in code before new generic tables.
4. Reuse internal atomic-claim/fencing patterns; define the receipt contract first, extend existing/domain storage where it satisfies the invariants, and propose a generic ledger only after an impossibility proof.
5. Establish exact KPI lineage and failure-derived eval cases before building the visual office.
6. Pilot low-risk, read-only roles in shadow mode. Promote task by task through replay, offline eval, shadow, canary, and approval.
7. Add Visual Office only when its counters reconcile to authoritative ledgers and its controls map to registered, policy-checked actions.

## Claims deliberately not made

- Repository popularity, release recency, license, or vendor claims alone do not establish Production fitness.
- The candidate dispositions are time-bounded hypotheses for this repository and must be rechecked at intake.
- A successful content-quality eval does not authorize publishing, payment, reservation, PII, migration, or security-policy changes.
- No proposed design can be called a “perfect autonomous company”; the achievable target is an auditable, bounded operating system that fails safely and makes human exceptions legible.
