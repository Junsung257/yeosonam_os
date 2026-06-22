# Ad OS Agent Operating Manual

Updated: 2026-06-22

## Operating Model

Ad OS absorbs the useful parts of Superpowers, Oh My Claude Code, and BKIT as internal operating rules instead of requiring an external Claude Code plugin.

- Oh My Claude Code principle: split advertising work into explicit roles.
- Superpowers principle: use a repeatable debug loop when performance drops.
- BKIT principle: preserve campaign context, decisions, evidence, and report-ready summaries.

## AI Ad Team Roles

- Campaign planner: turns products, keyword candidates, budgets, and completion audit evidence into safe campaign drafts.
- Performance analyst: diagnoses ROAS, CPA, CTR, CVR, search terms, landing/CTA facts, and budget pacing before spend changes.
- Copywriter: generates and reviews hooks, headlines, card/news copy, and ad creative variants.
- Client reporter: packages tenant report, audit export, completion audit, incidents, and next actions into advertiser-facing reporting.

Every marketing pipeline agent result must carry:

- `role`
- `input_summary`
- `evidence`
- `decision`
- `next_action`
- `needs_human_approval`

The same contract is also stored under `data.agent_contract` when the agent returns object data.

## ROAS Debug Loop

When ROAS, CPA, CTR, or CVR changes materially, Ad OS must diagnose in this order:

1. Check campaign and date range evidence.
2. Compare ROAS, CPA, CTR/CTA proxy, CVR, spend, and margin facts.
3. Inspect search-term candidates and negative keyword opportunities.
4. Check landing/CTA learning evidence.
5. Check budget guardrails and automation level.
6. Produce hypotheses with priority, evidence, immediate action, hold reason, and human approval requirement.

The operator entry point is `/api/admin/ad-os/agent-diagnostics`. It can run the internal evidence loop through `learning-harvest`, `search-term-growth`, `optimize-performance`, and `budget-pacing`, then persist the diagnostic into Campaign Memory and `ad_os_decision_logs`. External ad platform write remains gated by kill switch, budget guardrails, approval, live-spend preflight, and adapter execution gates.

## Campaign Memory

Campaign memory is the tenant-facing context package used for planning and reporting. It includes:

- campaign purpose
- budget guardrails
- approval rule
- learning state
- report state
- failed or blocked tests
- next tests

Memory is persisted in `ad_os_campaign_memories` with RLS enabled and service-role-only access. The current memory payload is derived from the Ad OS summary, learning loop, completion audit, agency reporting, channel budgets, diagnostic hypotheses, and AI ad team role decisions.

## Readiness Targets

- Jarvis readiness: target 97/100 or higher when live RAG audit evidence is available.
- Marketing automation readiness: target all static checks passing.
- Ad OS practical operating score: target 89/100 before live paid execution.
- Reporting/documentation score: target 90/100 once tenant report and audit export evidence are visible.
