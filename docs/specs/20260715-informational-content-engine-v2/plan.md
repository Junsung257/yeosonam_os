# Implementation Plan: Informational Content Engine V2

## Current-State Audit (M0)

Previous completion claims are not accepted without current code evidence.

| Area | Status at M0 | Evidence / gap |
|---|---|---|
| M1 safeguards | PARTIAL, uncommitted | Fallback/internal-value/high-risk/list-route changes exist, but all manual publish entrypoints and migration dry-run still require proof. |
| M2 information/product boundary | MISSING | No explicit information service dependency allowlist or import-boundary test. |
| M3 intent planner | PARTIAL, uncommitted | `blog-information-contract.ts` has intents/slots, but the required planner output and pre-writer missing-input gate are incomplete. |
| M4 evidence registry | MISSING | No separate durable informational source/evidence/claim namespace or migration. |
| M5 claim validator | PARTIAL | High-risk review policy exists; numeric/stale/official-source claim validation is absent. |
| M6 duplicate/canonical | PARTIAL | Fourteen-day slug/destination-angle checks exist; no durable representative key or canonical-only upsert policy. |
| M7 related links | PARTIAL | `topical-authority.ts` appends links, but relevance ranking and no-candidate behavior are not proven. |
| M8 CTA/CRO | MISSING | Existing blog body CTA helpers hardcode URLs/copy; no central informational selector or dedicated events. |
| M9 final render/SEO QA | PARTIAL | Render/structure gates exist; reading-time SSOT, metadata-intent, and CTA render integrity remain incomplete. |
| M10 evaluation set | MISSING | Named end-to-end fixtures and reports do not exist. |
| M11 dry-run/handoff | MISSING | No required classification report or nontechnical owner runbook. |

## Current Pipeline Map

```text
topic sources / manual drafts
  -> blog_topic_queue or content_creatives draft
  -> content brief / writer
  -> editorial, structure, image and customer-surface repair
  -> runQualityGates + evaluateBlogPublishQuality
  -> publish entrypoint
  -> content_creatives.status=published
  -> cache revalidation / publish log / indexing outbox
  -> sitemap and public routes
```

Publish-capable entrypoints requiring a shared information contract:

- `src/app/api/cron/blog-publisher/route.ts`
- `src/app/api/blog/route.ts` POST and PATCH
- `src/app/api/content-hub/publish/route.ts`
- `src/app/api/content-queue/route.ts`
- `src/app/api/cron/blog-regenerate-zero-click/route.ts` for already-public information edits

Product-specific routes such as `src/app/api/blog/mrt-hotel-ranking/route.ts` remain outside the information engine and must keep existing behavior.

## Approach

1. Stabilize and commit current P0 safeguards without mixing planner/evidence/CTA work.
2. Introduce a narrow information-only boundary facade and dependency test.
3. Expand the intent contract into a validated planner that blocks the writer on missing inputs.
4. Add additive source/evidence/claim tables and typed repository contracts.
5. Extract verifiable claims and validate freshness, coverage, authority, and human approval at every publish entrypoint.
6. Add a stable representative key and deterministic duplicate/upsert decision without changing existing public rows.
7. Rank internal links by destination, region, intent, audience, and indexability.
8. Render CTA metadata through central config/components and track dedicated events.
9. Verify final rendered surfaces, reading-time SSOT, metadata intent, canonical, and indexability.
10. Run named evaluation fixtures and produce dry-run audit/operator artifacts.

## Impact Areas

- Code: information-specific modules under `src/lib/blog-*`, shared publish-quality integration, public blog renderer, narrow APIs.
- Data/API: additive informational evidence/claim and representative-key migration; no remote application.
- UI: informational CTA hub only; no product UI.
- Docs/tests: this feature packet, domain SSOT, error registry, E2E fixtures/report, owner handoff.

## Data Flow

```text
keyword/topic + validated destination
  -> InformationalPlan
  -> SourceRegistry entries
  -> Evidence records
  -> generated draft + extracted claims
  -> ClaimValidationReport
  -> duplicate/canonical decision
  -> final render QA
  -> low-risk publish OR high-risk pending review
  -> central CTA selection at render time
  -> anonymous impression/click event
```

## Risks And Guardrails

- Product-path regression: information-only predicates and import-boundary tests; run product baselines after each shared-module change.
- Manual publish bypass: all public state transitions call one shared evaluator.
- False-negative claim extraction: conservative patterns plus intent-required facts; uncertain claims remain draft/review.
- Existing URL damage: audit and upsert recommendations are dry-run only; no redirects or public row updates.
- CTA misconfiguration: disabled by default, public-protocol allowlist, no URL in generated body.
- Dirty worktree contamination: explicit path staging only; unrelated settlement, payment, booking, attraction, archive, and package-display changes remain unstaged.

## Migration Order

1. Review-state status migration.
2. Informational source/evidence/claim schema.
3. Representative-key/canonical schema.
4. Application deployment.
5. Staging-only fixture and publish-state verification.

No migration is applied to a remote database in this goal.
