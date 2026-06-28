# Marketing Current SSOT

Last updated: 2026-06-29

This is the current operating contract for marketing automation, Ad OS, campaign actions, card-news distribution, external ad-platform writes, and marketing performance dashboards. Strategy research and campaign plans are not the source of truth for current execution behavior.

## Scope

This document owns:

- marketing pipeline orchestration;
- campaign/action staging and approval;
- external ad-platform publish safeguards;
- creative/card-news generation handoff;
- marketing dashboard and system-health evidence;
- paid/owned/social channel automation boundaries.

Repeated failures belong in `docs/errors/marketing.md`.

## Source Of Truth

| Area | Current source |
|---|---|
| Marketing pipeline | `src/lib/marketing-pipeline/**` |
| Marketing OS utilities | `src/lib/marketing/**`, `src/lib/marketing-cron.ts`, `src/lib/marketing-osmu.ts` |
| External publish decisions | `src/lib/marketing-pipeline/publish-saga.ts`, `/api/admin/ad-os/**` |
| Admin surfaces | `/admin/marketing/**`, `/admin/ad-os`, `/admin/control-tower` AI operations command center |
| Runtime checks | `scripts/verify-marketing-automation-readiness.mjs`, `scripts/verify-marketing-release-readiness.mjs`, `scripts/verify-marketing-95-scorecard.mjs` |
| Error memory | `docs/errors/marketing.md` |

## Required Invariants

- Draft, staged, approved, externally published, and externally confirmed are separate states.
- Do not mark a campaign action as externally applied unless a provider result or explicit confirmation exists.
- Dry-run and readiness probes must never mutate external ad platforms.
- Missing OAuth/API tokens must produce a blocked or manual-review state, not a fake success.
- Spend-affecting changes need budget, channel, tenant, and rollback evidence before execution.
- Blog/card-news/social content can be generated without publishing; public/external publishing requires the same quality and approval boundary as the destination channel.
- Product-backed marketing drafts must only use packages whose unified `customer_open_contract` passes. `registration_evidence_pack_v1.downstream_eligibility.marketing_stage=false` means the product is repair/re-proof work, not a marketing candidate.
- Marketing dashboards must show degraded or blocked when required evidence is unavailable. Missing data is not healthy data.
- Ad OS deep scorecards must separate current evidence scores from target/post-repair scores. A ready fixture can prove the 95+ gate is reachable, but live current scores only pass when runtime summary evidence is present.
- Ad OS AI Director repair runs may persist internal score snapshots and repair queue rows only. They must not perform external ad-platform writes, live spend, or full-auto mutations.
- Control-tower Ad OS status must show current evidence gaps separately from the 95+ ready fixture; a reachable fixture is not proof that live current execution is ready.

## External Write Boundary

Correct sequence:

1. Generate recommendation or creative.
2. Validate readiness and channel constraints.
3. Stage the action internally.
4. Operator or policy approval.
5. Execute external mutation only through the audited executor/provider wrapper.
6. Persist provider result.
7. Mark action applied only after confirmation.

No route should jump from generated draft to applied external result.

## Durable Artifact Rule

Changes to marketing automation, ad-platform writes, campaign actions, channel health, card-news publish handoff, or spend logic require at least one durable artifact:

- unit/regression test for the decision boundary;
- update to this SSOT when the invariant changes;
- entry in `docs/errors/marketing.md` when it fixes a repeated mistake;
- audit note under `docs/audits/**` when evidence matters.

## Verification

Use the narrowest applicable checks first:

```bash
npm run verify:marketing-automation
npm run verify:marketing-release
npx vitest run src/lib/marketing-pipeline/marketing-pipeline.test.ts
npm run type-check
```

Before any real external spend/write, confirm the relevant provider token, dry-run output, budget guard, and provider result persistence path.
