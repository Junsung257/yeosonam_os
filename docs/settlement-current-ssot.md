# Settlement Current SSOT

Last updated: 2026-06-23

This is the current operating contract for payments, ledger entries, land settlements, affiliate settlements, tenant settlements, refunds, and reconciliation. Historical audits are evidence; this file is the current rulebook.

## Scope

This document owns:

- booking payment matching and manual payment commands;
- `ledger_entries` as financial evidence;
- settlement bundle creation and reversal;
- land/operator settlement pages;
- affiliate settlement drafts and approvals;
- reconciliation alerts and drift recovery.

Repeated failures belong in `docs/errors/settlement.md`.

## Source Of Truth

| Area | Current source |
|---|---|
| Ledger utilities | `src/lib/ledger-utils.ts` |
| Payment matching | `src/lib/payment-matcher.ts`, `src/lib/payment-command-resolver.ts` |
| Settlement accounting | `src/lib/settlement-accounting.ts` |
| Affiliate settlement math | `src/lib/affiliate/settlement-calc.ts` |
| Payment/settlement APIs | `/api/payments/**`, `/api/settlements/**`, `/api/tenant/settlements` |
| Admin surfaces | `/admin/payments`, `/admin/ledger`, `/admin/settlements`, `/admin/land-settlements` |
| Drift monitor | `/api/cron/ledger-reconcile` |
| Error memory | `docs/errors/settlement.md` |

## Required Invariants

- Ledger is the evidence layer. Any payment, refund, settlement, reversal, or manual adjustment must create or reference a ledger entry.
- Do not directly update `bookings.paid_amount` or `bookings.total_paid_out` from a new path. Use the established RPC/service path so ledger and booking totals remain reconcilable.
- Every ledger write must be idempotent with a stable `idempotency_key` such as `<source>:<external_id>`.
- Settlement approval must be based on reconciled booking/payment state, not UI text, exported spreadsheet totals, or inferred partner claims.
- Reversal must create compensating evidence. Do not delete historical settlement or ledger rows to "fix" a payout.
- Customer-visible payment status and internal finance status may differ, but the difference must be explicit in data, not hidden in UI-only labels.
- Drift is blocking. If ledger totals and booking totals disagree, settlement automation must pause or quarantine affected records until reconciliation evidence is created.

## State Boundary

Payment matched, booking confirmed, settlement drafted, settlement approved, and payout completed are separate states.

Correct sequence:

1. Capture or manually enter payment evidence.
2. Match payment to booking with confidence and operator evidence when needed.
3. Write ledger entry through the approved service/RPC path.
4. Reconcile booking totals from ledger evidence.
5. Generate settlement draft.
6. Approve or reverse with immutable audit evidence.
7. Export/pay only approved settlements.

No code path should mark a settlement paid from a draft-only row.

## Durable Artifact Rule

Changes to payment matching, ledger totals, settlement creation, settlement approval, reversal, payout export, or reconciliation require at least one durable artifact:

- unit/regression test for the financial invariant;
- update to this SSOT when the invariant changes;
- entry in `docs/errors/settlement.md` for a repeated mistake;
- migration plus SSOT update when schema behavior changes.

## Verification

Use the narrowest applicable checks first:

```bash
npx vitest run src/lib/ledger-utils.test.ts src/lib/payment-matcher.test.ts src/lib/payment-command-resolver.test.ts src/lib/settlement-accounting.test.ts
npx vitest run src/lib/affiliate/settlement-calc.test.ts src/lib/affiliate/settlement-approval.test.ts
npm run type-check
```

For production-facing finance work, also verify `/admin/payments/reconcile` or `/api/admin/ledger/reconcile-status` before calling the system healthy.
