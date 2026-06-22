# AI Ops Current SSOT

Last updated: 2026-06-23

This is the current operating contract for AI provider policy, Jarvis, RAG, QA, prompt routing, evals, model fallback, and learning-loop evidence.

## Scope

This document owns:

- AI task provider/model policy;
- Jarvis internal assistant routing and tool boundaries;
- RAG indexing, retrieval, and freshness checks;
- prompt/version behavior for AI-powered systems;
- eval and readiness gates for AI changes;
- cost, timeout, fallback, and manual-approval behavior.

Detailed provider policy operations remain in `docs/ai-policy-operations.md`. Jarvis architecture details remain in `docs/jarvis-orchestration.md`, `docs/jarvis-rag-audit-runbook.md`, and `docs/jarvis-readiness-gate.md`. Repeated failures belong in `docs/errors/ai-ops.md`.

## Source Of Truth

| Area | Current source |
|---|---|
| AI provider routing | `src/lib/ai-provider-policy.ts`, `scripts/ai-provider-switch.mjs` |
| Jarvis APIs | `/api/jarvis`, `/api/jarvis/stream`, `/api/admin/jarvis/**` |
| Jarvis orchestration | `src/lib/jarvis/orchestration/**`, `src/lib/jarvis/v2-dispatch.ts` |
| Jarvis RAG/evals | `src/lib/jarvis/rag/**`, `src/lib/jarvis/eval/**` |
| Prompt behavior | domain-specific prompt files plus active DB prompt versions when used |
| Error memory | `docs/errors/ai-ops.md` |

## Required Invariants

- DB `system_ai_policies` outranks env overrides, and env overrides outrank code defaults.
- A model/provider switch must preserve fallback behavior or explicitly document why fallback is disabled.
- AI output is not trusted just because the model is stronger. Persisted or customer-visible outputs need schema validation, quality gates, or eval coverage appropriate to the domain.
- Jarvis tool access must remain scoped by tenant, role, and approved table/tool allowlists.
- RAG answers must distinguish retrieved evidence, inferred reasoning, and missing context.
- Human-in-the-loop actions must not be auto-executed when the action mutates money, bookings, customer data, external publishing, or credentials.
- Prompt fixes for repeated failures must become an eval, regression test, deterministic gate, or error-registry entry.

## Provider And Prompt Boundary

Correct sequence for AI behavior changes:

1. Identify the task and domain owner.
2. Update DB policy, env override, or code default deliberately.
3. Keep fallback and timeout behavior explicit.
4. Run the task-specific eval or readiness gate.
5. Persist evidence of the change when behavior is customer-visible or operationally risky.

Do not treat a one-off better answer in chat as proof that an AI behavior is fixed.

## Durable Artifact Rule

Changes to AI routing, Jarvis tools, RAG indexing, prompt contracts, eval gates, provider fallback, or learning loops require at least one durable artifact:

- eval or regression test for the failure;
- update to this SSOT or a domain SSOT when the invariant changes;
- entry in `docs/errors/ai-ops.md` for repeated failures;
- audit note under `docs/audits/**` when live evidence matters.

## Verification

Use the narrowest applicable checks first:

```bash
npm run verify:jarvis-readiness
npm run eval:jarvis
npm run audit:jarvis-rag
npm run type-check
```

For blog, product registration, settlement, affiliate, or marketing AI behavior, also run that domain's SSOT verification checks.
