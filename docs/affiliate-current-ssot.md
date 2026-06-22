# Affiliate Current SSOT

Last updated: 2026-06-23

This is the current operating contract for affiliate, influencer, referral, co-branding, attribution, and commission evidence. Historical plans and audits are not the source of truth for current behavior.

## Scope

This document owns:

- referral-code normalization and link formats;
- `aff_ref` cookie issuance and consent behavior;
- affiliate touchpoints and co-branded landing attribution;
- booking-level affiliate snapshots;
- partner dashboard read models;
- affiliate commission eligibility evidence.

Detailed attribution notes remain in `docs/affiliate-attribution.md`. Repeated failures belong in `docs/errors/affiliate.md`.

## Source Of Truth

| Area | Current source |
|---|---|
| Referral code format | `src/lib/affiliate-ref-code.ts`, `src/lib/affiliate-ref-cookie-policy.ts` |
| Session/cookie attribution | `src/lib/affiliate/session.ts`, middleware, `/api/influencer/track` |
| Affiliate DB reads | `src/lib/db/affiliate.ts`, `src/lib/affiliate/dashboard-service.ts` |
| Settlement math | `src/lib/affiliate/settlement-calc.ts` and `docs/settlement-current-ssot.md` |
| Public/partner surfaces | `/affiliate/**`, `/influencer/[code]/**`, `/with/[code]` |
| Error memory | `docs/errors/affiliate.md` |

## Required Invariants

- `?ref=CODE` and `/with/CODE` must resolve to the same normalized referral code.
- ASCII referral codes are uppercased before storage and lookup.
- `aff_ref` attribution must be recorded as evidence, not inferred later from campaign text.
- If `AFFILIATE_REF_STRICT_MARKETING_CONSENT=true`, lack of marketing consent may reduce attribution to session scope; it must not silently create a 30-day cookie.
- Booking-time commission inputs must be snapshotted. Later tier/rate changes must not rewrite historical booking economics unless an explicit recalculation job records evidence.
- Partner dashboards must read server-side filtered data. Do not expose cross-affiliate booking, customer, payment, or PII data through client-side filtering.
- Self-referral, bot traffic, suspicious repeated touchpoints, and operator-created test bookings must be excluded or marked before commission approval.

## Publish And Payout Boundary

Affiliate attribution is not the same as payable commission.

Correct sequence:

1. Capture referral/touchpoint evidence.
2. Attach eligible affiliate snapshot at booking creation or confirmed attribution recalculation.
3. Confirm booking/payment/travel status through the settlement contract.
4. Generate a settlement draft.
5. Review anomalies and self-referral flags.
6. Approve payout with immutable evidence.

No affiliate UI should display a payout as final unless the settlement state has reached the approved/payable state defined in `docs/settlement-current-ssot.md`.

## Durable Artifact Rule

Changes to affiliate attribution, partner dashboard data, referral cookies, influencer routes, or commission math require at least one durable artifact:

- unit/regression test for the rule;
- update to this SSOT when the invariant changes;
- entry in `docs/errors/affiliate.md` when it fixes a repeated mistake;
- audit note under `docs/audits/**` for one-off evidence.

Do not call affiliate work complete from a manual DB repair alone.

## Verification

Use the narrowest applicable checks first:

```bash
npx vitest run src/lib/affiliate/settlement-calc.test.ts src/lib/affiliate/dashboard-service.test.ts
npx vitest run src/app/api/affiliate-security-guards.test.ts
npm run type-check
```

For payout-related affiliate work, also run the settlement checks in `docs/settlement-current-ssot.md`.
