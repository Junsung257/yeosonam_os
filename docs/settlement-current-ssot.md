# Settlement Current SSOT

Last updated: 2026-08-03

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
| Bank allocation evidence | `bank_transaction_allocations`, `ops_events`, `match_bank_transaction_allocations` |
| Manual bank memo keys | `booking_settlement_keys`, `src/lib/settlement-import/**` |
| Clobe bank sync | `/api/bank-transactions/sync-clobe`, `src/lib/settlement-import/clobe-bank-sync.ts` |
| Scheduled Clobe sync | `/api/cron/clobe-bank-sync`, `src/lib/settlement-import/clobe-sync-scheduler.ts` |
| Complete bank reality | `bank_transactions.settlement_scope`, `/api/bank-transactions/account-reality`, `src/lib/bank-account-reality.ts` |
| Admin surfaces | `/admin/payments`, `/admin/ledger`, `/admin/settlements`, `/admin/land-settlements` |
| Drift monitor | `/api/cron/ledger-reconcile` |
| Error memory | `docs/errors/settlement.md` |

## Required Invariants

- Ledger is the evidence layer. Any payment, refund, settlement, reversal, or manual adjustment must create or reference a ledger entry.
- Do not directly update `bookings.paid_amount` or `bookings.total_paid_out` from a new path. Use the established RPC/service path so ledger and booking totals remain reconcilable.
- Every ledger write must be idempotent with a stable `idempotency_key` such as `<source>:<external_id>`.
- Checkout completion must not trust customer-supplied payment, price, cost, voucher, or PII fields. `POST /api/checkout/complete` may only advance a server-created `transactions` row after a service-role-only `checkout_payment_confirmations` row proves verified payment and the amount equals `transactions.total_price`. Duplicate completion must be blocked by `checkout_completion_claims`.
- Settlement approval must be based on reconciled booking/payment state, not UI text, exported spreadsheet totals, or inferred partner claims.
- Reversal must create compensating evidence. Do not delete historical settlement or ledger rows to "fix" a payout.
- Customer-visible payment status and internal finance status may differ, but the difference must be explicit in data, not hidden in UI-only labels.
- Drift is blocking. If ledger totals and booking totals disagree, settlement automation must pause or quarantine affected records until reconciliation evidence is created.
- Bank transaction matching must go through `match_bank_transaction_allocations` for new manual/auto paths. The RPC writes allocation evidence, booking ledger updates, operational events, and audit evidence in one transaction.
- A bank transaction may be allocated to multiple bookings, but the allocated total may not exceed the transaction amount. Under-allocation is only tolerated up to 500 KRW unless a future schema explicitly accounts for the remainder.
- Overpayment converted to mileage must separate `allocated_amount` from `ledger_delta`: the bank transaction evidence keeps the full amount, while the booking ledger receives only the outstanding booking balance and the remainder is recorded as mileage.
- Matched transactions with active allocation evidence must not be soft-deleted or hard-deleted. Reverse the allocation first, then exclude if needed.
- Manual bank-statement imports must treat memo keys such as `260715_정지해_투어폰` as the booking binding key. Counterparty/depositor name is supporting evidence only because companions can pay separately.
- Bulk bank import may auto-allocate deposits after a valid travel memo key resolves to one booking. An outflow may also auto-allocate when the memo key resolves strongly to exactly one booking; ambiguous, fuzzy, or missing memo resolutions remain review/manual-confirmed.
- Non-travel rows from manual paste may still be skipped by default, but authoritative Clobe rows must never be discarded. Every Clobe account row is retained exactly once in the bank ledger as either `travel` or `non_travel`.
- `travel` rows may affect booking allocations and booking realized profit. `non_travel` rows affect actual bank balance only and must never auto-match to a booking.
- Actual bank balance, travel realized profit, and non-travel cash movement are different metrics. The reconciliation identity is `opening balance + travel net + non-travel net = actual bank balance`; do not label travel net as current bank balance.
- Provider `afterBalance` is the displayed actual balance when available. The OS must independently compute opening balance plus every inflow minus every outflow and expose a non-zero reconciliation difference as blocking financial drift.
- Company expenses, taxes, advertising, subscriptions, fees, transfers, and other non-travel transactions remain visible in the non-travel bank tab. They are excluded from booking profit, not deleted from bank reality.
- A non-travel Clobe row whose memo is later corrected to a valid travel key may move into booking settlement only before allocation, through the normal memo resolution and allocation path. If an allocated travel row loses or changes its travel key, mark it for review and do not move the allocation automatically.
- Clobe bank sync must normalize provider rows into the same bank import contract before touching `bank_transactions`.
- Clobe MCP authentication is an admin OAuth connection stored in `tenant_api_tokens` with encrypted access/refresh tokens. Do not require operators to paste a static Clobe bearer token into Vercel.
- Clobe sync dedupe order is provider transaction id first (`external_provider`, `external_transaction_id`), then local `transaction_fingerprint`.
- Provider transaction identity is unique among active bank rows. Excluded historical evidence may retain the same provider identity so an authoritative active Clobe row can replace it without deleting audit history.
- Local transaction fingerprints follow the same active-only uniqueness boundary. Excluded evidence may retain the fingerprint of its authoritative active replacement.
- When an authoritative Clobe row was initially bootstrapped from an Excel export without a provider transaction id, the first live sync may attach the provider id only to one active `clobe_mcp` row with the same minute, type, amount, counterparty, and memo. If the memo changed, a no-memo fallback is allowed only when exactly one candidate exists; ambiguous rows remain review-only and must not create a second financial allocation.
- Clobe-sourced outflows with a valid, strong one-booking memo resolution may auto-confirm as a payout through `match_bank_transaction_allocations`. Clobe outflows without that resolution must stay review/manual-confirmed.
- For the OpenLife 4128 settlement account, Clobe MCP is the authoritative bank source. Slack/SMS rows are audit-only fallback evidence and must be excluded from active settlement totals during an authoritative rebuild.
- An authoritative Clobe rebuild reverses active allocations, resets bank-derived booking totals through the ledger RPC, then re-imports Clobe rows. Excluded rows remain retained for audit and are never eligible as duplicate candidates.
- Similarity-based bank dedupe may merge only a strong candidate. A weak candidate is a review hint and must remain as its own imported transaction; one memo key may contain many legitimate rows.
- A unique Clobe row may merge a legacy Slack row only when type, amount, counterparty, and timestamp within one minute identify exactly one candidate. Ambiguous candidates remain separate for review.
- Legacy rows that already have `booking_id`/`match_status` but no active `bank_transaction_allocations` evidence must be repaired through `repair_legacy_bank_transaction_allocation`. The repair creates one allocation per source row and preserves existing booking totals, or records an explicit ledger transfer when the memo resolves to a different canonical booking.
- If Clobe memo changes after a transaction is financially matched, do not move ledger allocation automatically. Record an open `ops_events` warning for manual review.
- If Clobe memo changes before financial matching, update the stored bank transaction memo and re-run memo-key resolution through the same import path.
- `/admin/payments` must separate booking KPI periods (departure date) from the active bank ledger. Transaction tabs and their counts use the full active bank ledger unless a dedicated transaction-date filter is explicitly shown.
- `/admin/payments` must show the complete Clobe row count, actual provider balance/as-of time, full inflow/outflow totals, travel net, non-travel net, and reconciliation difference. A count of zero in booking queues must not imply that non-travel or memo-review rows do not exist.
- The non-travel memo-review queue must open only rows that require review; the full non-travel ledger remains a separate explicit view.
- Every bank and settlement timestamp shown to operators must use `Asia/Seoul` explicitly. UTC slicing and runtime-default locale formatting are prohibited on settlement screens.
- Clobe normalization failures must be reported separately from importer failures. A response with `fetched > normalized` must never be presented as `errors 0` without showing the normalization failure count.
- Scheduled Clobe sync runs daily through Vercel Cron. While active Clobe rows lack provider ids it advances from the oldest missing row in bounded 14-day windows; after backfill completes it re-syncs the latest 30 KST dates. The cron must use the same guarded sync API and import pipeline as the admin button.
- Excluded Slack/SMS and pre-rebuild Clobe rows are inactive audit evidence, not an operational error queue, and must be labeled as such in admin UI.

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
