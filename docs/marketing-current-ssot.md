# Marketing Current SSOT

Last updated: 2026-07-25

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
| Operator dashboard contract | `src/lib/marketing/operations-dashboard.ts`, `/api/admin/marketing/dashboard`, `/admin/marketing` |
| Customer traffic acquisition | `src/components/GA4Tracker.tsx`, `src/lib/ga4.ts`, GA4 Traffic acquisition report |
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
- GA4 customer acquisition data must exclude admin, localhost, and preview traffic. Production measurement remains disabled until a valid `NEXT_PUBLIC_GA4_ID` is configured.
- Campaign links must use lowercase, stable `utm_source`, `utm_medium`, and `utm_campaign` values. Do not compare channel performance using untagged social, email, or affiliate links.
- A tracking API response may say `accepted: true` only after the primary database write succeeds. Optional counters may return warnings, but a failed primary write must return a retryable 503.
- Provider spend, impressions, and clicks come from `ad_performance_snapshots`. Traffic sessions and conversion-allocated CPC must not be relabeled as provider impressions or confirmed spend.
- Zero and not-collected are different states. A successful empty query may show zero; a missing provider connection or absent provider snapshot must show `not_collected`.
- Channel state is evidence-based: `operating` requires a fresh health check, credentials, permission, campaign readiness, an external account, live publish enabled, and external API write enabled. Draft readiness is not live operation.

## Operator Dashboard Contract

The default `/admin/marketing` screen is for a non-specialist operator. It uses plain Korean and presents information in this order:

1. up to three urgent actions;
2. provider-confirmed ad spend, inquiries, marketing-attributed bookings, settlement-confirmed margin, and cost per booking;
3. channel status with a reason and one next action;
4. recorded customer funnel, content publishing status, campaigns, and reviewable recommendations;
5. advanced Ad OS, probes, and command-center tools inside a collapsed expert section.

The dashboard must always display:

- selected period and `Asia/Seoul` basis;
- dashboard collection time;
- latest first-party tracking time;
- latest provider performance date;
- a visible distinction between collected, stale, and not-collected metrics.

The following labels are prohibited on the default operator surface unless the matching evidence exists:

- `운영 중` for a draft-only or stale channel;
- `연동 완료` for a saved toggle without a verified account;
- `광고비 0원` when provider performance has never been collected;
- `전환 완료` when only the internal conversion record was saved and the provider delivery is still pending.

## Recovery And Rollout Order

Use this order when starting or repairing marketing operations:

1. Apply the pending schema reconciliation migration and verify `gbraid`/`wbraid` writes.
2. Send one consented and one non-consented traffic event; require 202 only after a database row exists.
3. Verify inquiry, booking, and settlement-confirmed margin sources independently.
4. Connect one ad provider account and run a fresh read-only health probe.
5. Import provider impressions, clicks, and spend into `ad_performance_snapshots`.
6. Confirm the dashboard changes from `수집 안 됨` to collected values without fallback estimates.
7. Test a conversion and verify internal persistence first, then provider delivery result separately.
8. Stage one campaign action, approve it, execute through the audited provider wrapper, and persist the provider result.
9. Enable scheduled refresh with a lookback window at least as long as the provider attribution window.
10. Only after the above gates pass, consider limited automation under budget caps; full automation remains a separate approval.

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
