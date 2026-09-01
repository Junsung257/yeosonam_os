# Implementation Plan: Blog Autopilot V4 completion

## Approach

Reuse current evidence, queue, DeepSeek, quality, public renderer, and Inngest contracts. Add focused SEO operations services and adapters behind deterministic readiness gates. Do not install a second blog generator or copy restricted `codex-seo` code.

## Impact Areas

- Code: `.agents/skills`, `src/lib/blog-*`, Inngest functions, protected cron routes, and the publisher compatibility entrypoint.
- Data/API: append-only SEO audit, source benchmark, and semantic benchmark evidence; no public API response changes.
- UI: existing `/admin/blog` consumes the same operations summary.
- Docs/tests: blog SSOT, runbook, Promptfoo, unit/integration tests, and release evidence.

## Required SSOT

- `AGENTS.md`
- `docs/blog-autopublish-contract.md`
- `docs/blog-ops-runbook.md`
- `docs/agent-workflow-current-ssot.md`

## Data Flow

Demand and queue candidate → immutable source/brief → DeepSeek draft and bounded repair → deterministic/evidence/style/SEO checks → authenticated real-render preview → atomic publication and indexing outbox → D+1/3/7 search lifecycle → weekly technical/performance observation and 7/28/56-day learning evidence.

## Risks And Guardrails

- Duplicate public posts: stable queue/content-version event ID and atomic publication ownership.
- Weak external extraction: benchmark-gated adapters, SSRF protection, immutable snapshots, and current extractor fallback.
- False SEO conclusions: provider observations remain separate from derived classifications and prompt changes require reviewed evidence.
- Unsafe launch: default draft-only, explicit environment flags, shadow/canary rollout, and durable freeze/rollback.
