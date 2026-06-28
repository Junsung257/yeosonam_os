# ADR-0002: Yeosonam OS Constitution

Status: Accepted
Date: 2026-06-28

## Context

Yeosonam OS already has many domain SSOT files for product registration, blog publishing, affiliate attribution, settlement, marketing, AI Ops, and agent workflow. A proposed outside prompt suggested creating 29+ separate Markdown files for an OS constitution.

That prompt had useful product discipline:

- understand the real Korean travel-agency workflow;
- keep MVP small;
- treat AI as assistance, not truth;
- define what not to build;
- include CRM, quotation, product, marketing, dashboard, and AI strategy.

But importing it directly would create document sprawl and conflict with the repo's current documentation automation rule: do not create new plan documents by default. The repo also already has working code and migrations for leads, booking tasks, customer facts, platform learning events, affiliate/settlement, RFQ, marketing, and Jarvis. The constitution therefore needs to be evidence-backed and optimized for this codebase, not generated from a generic SaaS outline.

## Decision

Create:

- `docs/yeosonam-os-constitution.md` as the top-level product constitution;
- `docs/yeosonam-os-constitution-evidence-map.md` as the local/external evidence map;
- this ADR as the architectural decision record;
- `docs/99_NEXT_STEPS.md` as the next implementation handoff.

Do not create the full 29-file sample structure. Do not propose a FastAPI backend split. Keep Next.js App Router + Supabase/PostgreSQL as the default architecture unless a future ADR proves a split is needed.

## Consequences

Positive:

- The project now has one top-level product identity and MVP boundary.
- Domain SSOT files remain focused and authoritative for their domains.
- Future agents can see why Yeosonam OS differs from generic CRM/ERP/OTA tools.
- External research is recorded without allowing external products to override local evidence.

Tradeoffs:

- The constitution is broader than a domain SSOT, so it must avoid becoming an implementation dump.
- Some dated snapshots such as `CURRENT_STATUS.md` still need periodic reconciliation with the actual manifest and migrations.
- The constitution must be updated deliberately when a domain SSOT changes a cross-domain principle.

## Alternatives Considered

1. **Create the 29 sample files.** Rejected because it would duplicate existing SSOTs and create stale-doc risk.
2. **Only update existing domain SSOTs.** Rejected because the project needed a top-level product doctrine connecting the domains.
3. **Use the existing `CURRENT_STATUS.md` as the constitution.** Rejected because it is a dated operating snapshot and not a product constitution.
4. **Switch to FastAPI backend for architecture cleanliness.** Rejected because the current repo is built around Next.js route handlers and Supabase; a split would add complexity without MVP proof.

## Verification

Run after changes:

```bash
npm run check:doc-automation
npm run check:agent-workflow
git diff --check
rg -n "yeosonam-os-constitution|ADR-0002|프로젝트 헌법" AGENTS.md docs
```

