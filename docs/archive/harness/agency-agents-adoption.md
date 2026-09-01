# Agency Agents Adoption Contract

Last updated: 2026-07-03

This document defines how Yeosonam OS uses `msitarzewski/agency-agents` and similar external agent catalogs. The goal is not to copy a popular roster. The goal is to get measurably better outputs on Yeosonam work.

## Decision

Use `agency-agents` as a challenger pattern library, not as a runtime or authority.

- Do not bulk-install the full roster into Codex, Cursor, Claude Code, or project rules.
- Do not let external agent instructions outrank Yeosonam code, tests, product behavior, or live evidence.
- Do use the best role patterns as reusable review lenses, eval prompts, and workflow gates.
- Adopt a pattern only after it improves real Yeosonam tasks without weakening safety, tenant isolation, approval gates, or verification quality.

## Highest-Value Imports

These are the only external patterns approved for first adoption:

| External pattern | Yeosonam use | Required output |
|---|---|---|
| Multi-Agent Systems Architect | Jarvis, Ad OS, product registration, automation pipelines | Agent/tool contract, failure path, HITL boundary, trace/eval requirement |
| Evidence Collector | Admin UI, product render, blog render, customer-facing flows | Screenshot/API/test/log evidence, not status-only completion |
| Prompt Engineer | Jarvis, QA, blog, product registration, marketing AI | Prompt contract, version note, happy/edge/failure eval cases |
| Autonomous Optimization Architect | AI provider policy, model fallback, cost/routing experiments | Baseline, shadow result, cost ceiling, fallback and circuit-breaker plan |
| Application Security Engineer / Data Privacy Officer | Auth, RLS, PII, payments, booking, settlement, external publishing | Threat boundary, data exposure check, approval/risk finding |
| SEO Specialist / Paid Media Auditor | Blog, content hub, Ad OS, search ads | Search/paid-media audit with data source, owner page/channel, projected impact |

Everything else remains reference material until a Yeosonam task proves it is worth adopting.

## Pilot Protocol

Use this protocol before turning an external persona into a durable project rule.

1. Pick 20-50 representative Yeosonam tasks from real work: product registration, Jarvis answers, blog SEO, admin UI, settlement/affiliate, code review, and marketing automation.
2. Run the current Yeosonam baseline and the external-pattern challenger on the same task prompt and source context.
3. Score both outputs on:
   - factual correctness against code/data/docs;
   - missing-risk detection;
   - evidence quality;
   - implementation usefulness;
   - user-facing clarity;
   - time/cost;
   - safety regressions.
4. Adopt only if the challenger wins on at least two quality dimensions and has no safety regression.
5. Convert the winning behavior into a Yeosonam-specific instruction, test, eval, checklist, or script. Do not preserve generic persona theater.

## Yeosonam Agent Pack V1

When a task needs an agent lens, use one of these project-specific roles instead of activating the full external catalog:

| Role | Trigger | Must produce |
|---|---|---|
| Agent Pipeline Architect | Multi-step AI/tool workflow changes | Topology, contracts, least-privilege tool map, failure/recovery path |
| Evidence QA | UI, render, publish, customer-visible changes | Concrete evidence list and unresolved gaps |
| Prompt Contract Engineer | Prompt/model behavior changes | Output schema, prompt version note, 3+ eval cases |
| AI FinOps Governor | Provider/model/routing/cost changes | Baseline, cost ceiling, fallback, anomaly stop condition |
| AppSec Privacy Reviewer | Auth, RLS, PII, payments, credentials, external writes | Threat boundary and blocking findings first |
| SEO Content Auditor | Blog/search/indexability work | Query/page ownership, cannibalization check, structured data/performance notes |
| Paid Media Auditor | Ad OS/search/social ads | Tracking, budget, bidding, creative, landing-page evidence |
| Minimal Change Engineer | Bug fixes and narrow implementation work | Smallest viable diff and follow-ups not included |
| Codebase Onboarding Engineer | Unfamiliar subsystem analysis | Code-grounded map and inspected-file boundary |
| Model QA Specialist | Ranking/scoring/recommendation/eval changes | Replication/eval plan, calibration/drift/fairness checks when applicable |

## Hard Boundaries

- No full-roster install into `.cursor/rules`, `.codex/agents`, `CONVENTIONS.md`, `.windsurfrules`, or global agent config as part of normal Yeosonam work.
- No new autonomous loop, background agent, scheduled agent, or external MCP/plugin install without explicit user approval.
- No automatic promotion of model/provider/prompt changes based only on a better sample answer.
- No external persona may authorize mutations to money, bookings, customer data, PII, credentials, external publishing, or ad spend.
- Any adopted pattern that changes AI/Jarvis/RAG behavior needs a durable artifact: eval, regression test, SSOT update, error entry, or audit note.

## Verification

Run the narrowest relevant check after adopting or changing these patterns:

```bash
npm run check:agent-workflow
npm run check:doc-automation
npm run eval:jarvis
npm run verify:jarvis-readiness
npm run audit:jarvis-rag
npm run type-check
```

For UI or customer-facing changes, add browser/screenshot evidence. For marketing, settlement, affiliate, product-registration, or AI behavior, also run the matching domain checks.
