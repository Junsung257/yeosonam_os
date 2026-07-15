# Feature Spec: Informational Content Engine V2

## Goal

Make every informational blog candidate pass a destination- and search-intent-specific planning, evidence, claim, duplicate, link, CTA, render, review, and publish contract before it can become public. Product-backed content remains on its existing evidence/snapshot path without interface or behavior changes.

Authoritative requirements:

- `docs/blog-autopublish-contract.md`
- 2026-07-15 informational-content audit supplied by the owner
- 2026-07-15 Goal Mode execution specification supplied by the owner

## Success Criteria

- [ ] Information generation has no product inventory, active-product, booking, consultation, or internal-price dependency.
- [ ] Deterministic fallback cannot be published, indexed, revalidated, or counted as public.
- [ ] A validated planner exists for each supported intent before the writer runs.
- [ ] Source, evidence, and claims are durable and publish-time verifiable.
- [ ] Numeric, time, percentage, climate, customs, visa, insurance, and policy claims fail closed without current evidence.
- [ ] High-risk information requires official evidence and human approval.
- [ ] The representative key `destination + intent + audience + locale` prevents new public duplicates and drives canonical selection.
- [ ] Related links meet explicit destination/intent relevance.
- [ ] Informational CTAs come from central typed settings, are hidden when invalid/disabled, and emit impression/click events without PII.
- [ ] Final rendered output passes structure, metadata-intent, reading-time, canonical, indexability, and CTA-integrity QA.
- [ ] Evaluation fixtures cover every named sample and emit machine-readable plus human-readable results.
- [ ] Existing public posts are only audited in dry-run mode.
- [ ] Product parsers, evidence, snapshots, product pages, product landing, and product prompts are unchanged.
- [ ] No push, PR, deployment, or remote DB migration occurs.

## In Scope

- Information candidate routing, planner, evidence and claim contracts.
- Information-only duplicate/upsert decision and related-link ranking.
- Reusable destination, SEO metadata, grammar/surface, duplicate, internal-link, render-QA, and publication-state modules.
- Central informational CTA configuration, selection, rendering, and analytics.
- Additive local/test migrations, fixtures, dry-run audit, and operator documentation.

## Out Of Scope

- Land-operator source parsing and any product registration behavior.
- Product evidence or final product snapshot structure.
- Product sales-copy generation, product detail/landing pages, prices, departures, airlines, hotels, itinerary, inclusions/exclusions, options, shopping, guide fees, availability, scarcity, or booking CTA.
- Existing public-post rewrite, merge, delete, redirect, or republish.
- Push, PR, deployment, staging mutation, production mutation, remote secrets, or remote DB access.

## Users And Risks

- Primary audience: blog readers and content operators.
- Risk tier: Tier 3 because the system controls external publishing and adds DB contracts.
- Sensitive surfaces: external publishing, indexability, policy information, analytics. No PII is required.

## Open Questions

- Official Naver Cafe and deal-room URLs are not yet proven. They must remain disabled until an operator supplies one unambiguous public URL.

