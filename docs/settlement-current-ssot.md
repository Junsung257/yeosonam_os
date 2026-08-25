# Settlement Current SSOT

Last updated: 2026-08-25

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

## OpenLife Clobe Immediate Operating Profile (2026-08-24)

The currently approved production scope is intentionally narrower than the historical full-bank-ledger design below.

- One company/account is in scope: OpenLife Shinhan settlement account ending `4128`.
- Sync is operator-triggered only. `/api/cron/clobe-bank-sync` must not be registered in `vercel.json` until the owner explicitly re-enables scheduled sync.
- A new Clobe row enters the travel workflow only when its memo parses as canonical `YYMMDD_대표고객_랜드사` or that full key plus a registered trailing purpose tag such as `_환불`. The full normalized memo remains the unique settlement key, while the purpose tag is excluded from land-operator identity. Blank and non-canonical new rows are skipped; previously stored rows remain immutable audit evidence.
- One full normalized memo key owns one Clobe-created settlement booking. Multiple deposits from different counterparties may aggregate into that booking, and every counterparty name remains on the original bank row. A base key and a purpose-suffixed key are distinct keys and must not be auto-merged merely because their date, customer, and operator match.
- A similar pre-existing normal booking is review-only and is never linked automatically.
- Deposits may auto-allocate after one exact memo-key resolution. Outflows require an operator command. A simple outflow uses `지급 승인` or, when the full memo ends with the registered `_환불` purpose tag, `환불 승인`.
- One Clobe outflow always remains one immutable provider transaction. Its accounting meaning may be allocated exactly across bookings as `payout` and/or `refund`; the allocation sum must equal the provider amount with no implicit fee tolerance. Thus a `600,500원` outflow stays one `600,500원` booking outflow rather than an inferred `600,000원 + 500원` split. When the memo purpose or operator approval identifies it as a customer refund, that one allocation is `refund`. A `9,140,000원` mixed outflow may be explicitly allocated as `7,640,000원` supplier payout plus `1,500,000원` customer refund.
- Before final settlement, a provider memo correction may rename the same booking only when no other active provider transaction still uses the old key. If every row for one trip is corrected together, sync must persist all latest provider evidence first, rename the generated booking key once, and converge the remaining rows to that key in the same run. If old and new trip keys genuinely coexist, both remain unchanged and an operator review is required.
- After `settlement_confirmed_at` is set, later provider memo changes are warning-only and cannot mutate the booking or allocation automatically.
- A memo correction on a provider transaction with any booking/ledger allocation remains review-only unless it is the one safe single-booking rename command. One corrected memo must never rename the representative booking of a mixed transaction. An exact, fully conserved non-booking classification is the narrow exception below: before final settlement a canonical provider memo may reverse that classification as audit evidence, auto-allocate an inflow to the exact key booking, or release an outflow to operator review. It never auto-approves an outflow.
- Clobe cash settlement is `paid_amount - total_paid_out`; product price, receivable status, and full/partial payment classification are outside this immediate workflow.
- Final settlement changes only settlement confirmation fields. It must not change the ordinary booking lifecycle `status` or trigger customer journey/review messaging.
- A Clobe booking may change `settlement_confirmed_at`, `settlement_confirmed_by`, or `settlement_mode` only through `finalize_clobe_booking_settlement`. A DB trigger blocks general PATCH, AI bulk confirmation, and departure-month close from bypassing allocation, ledger, review-state, and immutable-snapshot checks. The owner must use the booking-level final-settlement button.
- Final settlement is blocked while any active allocation for that booking has `review`, `unmatched`, or `error`, an unresolved provider memo-change event, or a latest provider key different from the booking key. An explicit operator-approved Clobe outflow command may allocate one immutable withdrawal across multiple bookings; that command evidence is the only permitted key-mismatch exception. The current active allocation count, booking, amount, type, and idempotency lineage must exactly match the completed `match` command, so an old or reversed command cannot authorize later reallocations.
- Promoting a legacy matched deposit into an approved Clobe key owner requires matching allocation and ledger evidence in the same amount/account/booking. Allocation columns without a corresponding ledger entry are not an approved payment state.
- One bank transaction may have multiple booking allocations only through an explicit operator-approved breakdown. Fees may be included in the booking outflow when the owner chooses a single cash-out representation.
- Reopening a Clobe outflow for reallocation must reverse every active allocation and its ledger effect in one DB transaction. Partial API-loop reversal is forbidden. Any linked finalized booking blocks reversal until the operator explicitly unfinalizes it.
- Production DB evidence on 2026-08-24: `clobe_mixed_outflow_allocations` (`20260824082534`), `restrict_bank_transaction_allocation_rpc` (`20260824082545`), and `harden_clobe_settlement_command_table` (`20260824082556`) are applied. The Clobe match/reverse commands and the legacy allocation command are executable only by `service_role`; both command tables have RLS, service-role-only policies, and supporting indexes. Pre/post deployment financial aggregates were identical and both new command tables contained zero rows.

## Source Of Truth

| Area | Current source |
|---|---|
| Ledger utilities | `src/lib/ledger-utils.ts` |
| Payment matching | `src/lib/payment-matcher.ts`, `src/lib/payment-command-resolver.ts` |
| Settlement accounting | `src/lib/settlement-accounting.ts` |
| Affiliate settlement math | `src/lib/affiliate/settlement-calc.ts` |
| Payment/settlement APIs | `/api/payments/**`, `/api/settlements/**`, `/api/tenant/settlements` |
| Bank allocation evidence | `bank_transaction_allocations`, `ops_events`, `save_bank_transaction_breakdown` |
| Manual bank memo keys | `booking_settlement_keys`, `src/lib/settlement-import/**` |
| Clobe bank sync | `/api/bank-transactions/sync-clobe`, `src/lib/settlement-import/clobe-bank-sync.ts` |
| Scheduled Clobe sync | `/api/cron/clobe-bank-sync`, `src/lib/settlement-import/clobe-sync-scheduler.ts` |
| Complete bank reality | `bank_transactions.settlement_scope`, `/api/bank-transactions/account-reality`, `src/lib/bank-account-reality.ts` |
| Finance center | `/admin/finance`, `/api/admin/finance/workday`, `/api/admin/finance/summary`, `/api/admin/finance/periods`, `/api/admin/finance/classifications`, `/api/admin/finance/classifications/batch`, `/api/admin/finance/bookings/**`, `/api/admin/finance/transactions/**`, `/api/admin/finance/tax` |
| Booking settlement review | `booking_settlement_reviews`, `save_booking_settlement_review` |
| Month close snapshots | `settlement_periods`, `settlement_period_items`, `settlement_period_exceptions` |
| Company transaction classification | `bank_transaction_classifications`, `bank_classification_rules` |
| Legacy admin surfaces | `/admin/payments`, `/admin/ledger`, `/admin/settlements`, `/admin/land-settlements`, `/admin/tax` |
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
- A Clobe 4128 transaction may be split across bookings, refunds, fees, company expenses, company travel, tax, capital, transfers, owner draws, other income, and an explicit unassigned remainder. Active allocations may never exceed the source amount; a confirmed breakdown must equal the source amount exactly to the won.
- Every active Clobe 4128 transaction, including non-travel company rows, must have active allocation evidence whose total equals the source amount exactly to the won. A classification row alone is not sufficient reconciliation evidence.
- Non-travel classifications are mirrored to allocation targets by `sync_non_travel_classification_allocations`. `review` becomes an explicit `unassigned` target and remains blocking; system-created classification lines may follow later classification changes, but an exact operator-created split must never be overwritten.
- `bank_transactions.booking_id` is compatibility metadata only. Finance calculations use active `bank_transaction_allocations` and their `target_type` values.
- Breakdown writes must use `save_bank_transaction_breakdown`. The RPC locks the source transaction and affected bookings, replaces the active breakdown atomically, reconciles booking ledger entries, verifies exact conservation, and records idempotent audit evidence.
- Non-booking allocation targets do not write booking ledger entries. Customer refunds and bank fees can retain a booking reference for reconciliation, but only booking/customer-refund cash affects that booking's travel cash result; bank fees remain company expense.
- Overpayment converted to mileage must separate `allocated_amount` from `ledger_delta`: the bank transaction evidence keeps the full amount, while the booking ledger receives only the outstanding booking balance and the remainder is recorded as mileage.
- Matched transactions with active allocation evidence must not be soft-deleted or hard-deleted. Reverse the allocation first, then exclude if needed.
- Manual bank-statement imports must treat memo keys such as `260715_정지해_투어폰` as the booking binding key. Counterparty/depositor name is supporting evidence only because companions can pay separately.
- Canonical memo keys use `YYMMDD_대표고객_랜드사`. A safe customer/operator separator variant such as `YYMMDD_대표고객-랜드사` may bind to an existing key or unambiguous existing booking, but it must never create a placeholder booking automatically.
- Bulk bank import may auto-allocate deposits after a valid travel memo key resolves to one booking. Clobe outflows remain review-only until the operator presses `출금 승인`; ambiguous, fuzzy, or missing memo resolutions remain review/manual-confirmed.
- Under the current OpenLife operating profile, blank and non-canonical new Clobe rows are skipped from the OS travel ledger. Previously stored non-travel rows remain retained for audit and are never converted or deleted silently.
- `travel` rows may affect booking allocations and booking cash position. `non_travel` rows affect actual bank balance only and must never auto-match to a booking. The operator's final-settlement command freezes the verified cash difference as the booking's realized cash profit.
- Actual bank balance, unfinalized travel cash position, settlement-confirmed cash profit, and non-travel cash movement are different metrics. The reconciliation identity is `opening balance + travel net + non-travel net = actual bank balance`; do not label an unfinalized travel net as current bank balance or realized profit.
- A memo-created booking with no sales price may show received money and its cash position, but it has no computable customer receivable. After the operator confirms cash settlement, the OS may show `입금 - 출금` as realized cash profit without inferring receivables or payment completeness.
- Booking settlement search and status filters must reset the virtualized table to its first row. A non-zero count with a visually empty result table is a blocking operations defect.
- Provider `afterBalance` is the displayed actual balance when available. The OS must independently compute opening balance plus every inflow minus every outflow and expose a non-zero reconciliation difference as blocking financial drift.
- Company expenses, taxes, advertising, subscriptions, fees, transfers, and other non-travel transactions remain visible in the non-travel bank tab. They are excluded from booking profit, not deleted from bank reality.
- Owner-facing profit must separate settlement-confirmed travel profit, estimated tax reserve, classified operating income/expense, financing, pass-through refunds, and unclassified cash. Capital contributions, loans, transfers, and refunds must never inflate company profit.
- `Safe to withdraw` is the lower of (a) `actual bank balance - booking-by-booking travel reserve - remaining tax reserve - unclassified inflows` and (b) `after-tax settlement-snapshot profit - classified company expense`. Missing supplier cost, an unallocated/overallocated travel row, or ledger/bank drift blocks withdrawal. Unclassified inflows are fully protected until classified; unclassified outflows already reduce bank liquidity and remain in the review queue.
- Open-trip cash protection is deliberately conservative without double counting. For each open booking reserve the larger of refundable customer cash currently held and known unpaid supplier cost, then add any positive unallocated travel cash. Customer cash that will fund the same supplier payable must not be protected twice. Missing supplier cost keeps the booking blocked and the displayed shortfall is only a minimum, never an exact final liability.
- Monthly realized-profit growth uses departure month and settlement-confirmed bookings only. Raw bank deposits, customer advances, financing, and unsettled booking cash must not appear in the realized-profit series.
- Departure-month cash close is an explicit owner approval, not an automatic date transition. A close handles only the selected completed departure month. Earlier unconfirmed bookings appear in a separate prior-omission queue and never enter the selected month silently. A positive cash margin never auto-confirms a booking: every included booking must have a current `confirmed` review created through `save_booking_settlement_review`.
- Review decisions are `pending`, `confirmed`, `customer_cancelled`, `invalid_booking`, `reclassified`, `deferred`, or `superseded`. A source transaction, Clobe memo, allocation, booking state, departure date, or exclusion change invalidates the current review fingerprint and returns the booking to review.
- `customer_cancelled`, `invalid_booking`, `reclassified`, and `finance_excluded` bookings are operationally resolved but excluded from travel profit. `pending` blocks a normal close. `deferred` requires an assignee, reason, and due date and is allowed only in a conditional close.
- Existing `legacy_booking_confirmation` periods are historical estimates only. They remain immutable as audit evidence, use `needs_revalidation`, and do not contribute to safe-to-withdraw cash or realized-profit charts until owner-reviewed V3 snapshots supersede them.
- Every close creates a versioned `settlement_periods` row and immutable `settlement_period_items` snapshots containing booking deposits, withdrawals, cash margin, transaction ids, and a source fingerprint. Reopening never edits or deletes old items; the next close creates a new revision.
- A normal close cannot contain unresolved exceptions. A conditional close requires an assignee, reason, and due date for every exception. Reopening is restricted to `super_admin` and requires an audit reason.
- After every authoritative Clobe sync, completed departure-month bookings that still have no bank evidence, allocation drift, zero margin, or negative margin must be materialized in `settlement_period_exceptions` with an assignee and due date. When the underlying issue clears, an automatically created exception is resolved with system audit evidence rather than deleted.
- Resolving or waiving a settlement exception must preserve its assignee, reason, and due date unless the operator explicitly edits those fields.
- A Clobe transaction, memo, amount, or allocation change after close must create a `post_close_change` exception. It must not silently rewrite the locked snapshot or confirmed totals.
- Booking review fingerprints contain only operator-visible business evidence: booking identity/state/price/cost plus transaction and allocation business fields. Persistence timestamps such as `bank_transactions.updated_at` must never invalidate a review. A no-op Clobe refresh preserves confirmed decisions; genuine memo, amount, counterparty, transaction time, status, allocation, or booking changes invalidate them.
- The booking review API must return a live fingerprint and live allocation totals. Stored pending snapshots are cache/audit evidence, not an authority for an optimistic-concurrency click. Fingerprint-version migrations refresh current rows without changing an operator's resolved decision and preserve a pre-change immutable snapshot.
- Company transaction classification precedence is `manual confirmation > active OS rule > Clobe category > review`. New rules do not apply retroactively unless a future explicit operation sets `apply_to_existing=true`. Capital, transfers, refunds, and owner withdrawals are excluded from profit.
- `/admin/finance` opens the guided `오늘 정산하기` workday by default. The expert overview and six finance tabs remain available, but workday priority is fixed as bank sync/reconciliation, travel memo/allocation, negative-margin or changed bookings, normal booking review, company classification, month close, then evidence.
- The guided workday is a read-only projection over the same ledger, booking reviews, classifications, and period snapshots. It must never copy or persist a second finance total, and a code deployment must not reset an operator decision.
- The guided workday is scoped to one selected completed departure month. Booking review and risk counts, close blockers, and links must carry that month; future departures, prior omissions, and undated bookings remain visible as separate non-blocking counts.
- A travel transaction review row belongs to a close month by authoritative manual booking allocation first, then a valid Clobe travel-memo departure date, then its own bank transaction month only when neither anchor exists. Other-month review rows remain in the global transaction queue but cannot block the selected departure month or inflate its open-work count.
- Workday totals count unique operational records, not the sum of overlapping stage badges. A travel transaction that has both a memo issue and an allocation mismatch is one open item. The UI may also show the larger stage-display sum, but it must label that number as including overlap.
- Workday links use focused mode to place actionable rows before overview cards while preserving expert views. Booking rows default to departure date ascending within the selected close month, and every stage link identifies its blocker and completion condition.
- Clobe OAuth connection time, last successful sync, next scheduled sync, and source/recognized/new/memo-change/auto-match/review/error counts are distinct status fields. Two missed scheduled windows or any reconciliation drift makes the sync stage blocking.
- Exact negative cash margins of 500 or 1,000 won may be offered as a bank-fee split preview only when no refund or bank fee is already allocated. The operator must review and save the exact-conservation breakdown; the assistant never mutates allocation evidence automatically.
- Existing evidence status is preserved. `not_required` means no evidence check was requested, not that evidence was supplied. Finance UI must display it as `증빙 확인 요청 없음`, and deployments or queue recalculation must never rewrite it.
- The 10% tax value is a configurable conservative reserve, not an official tax amount. Confirmed locked profit and provisional unreviewed cash margin must remain separate in totals, charts, and safe-to-withdraw calculations.
- Company transaction batch confirmation must use `save_finance_classification_batch`. The RPC accepts 1-200 fully allocated one-line non-travel transactions only, rejects split or booking-linked lines, validates direction and every stale classification before any write, saves the entire batch atomically, persists an idempotency result, and records audit evidence. A partial batch success is forbidden. Split, refund-linked, or booking-linked lines remain on the individual breakdown flow.
- Finance UX telemetry is manual and anonymous. Allowed properties are coarse task/result/count/duration/viewport/month/error-code fields only. Amounts, booking/customer/transaction identifiers, account numbers, counterparties, and Clobe memo text are forbidden. Finance pages disable session replay while preserving redacted Sentry error reporting.
- Finance center loading failures must render a clear error and retain the distinction from a valid zero amount. Never replace failed finance data with `0원`.
- A non-travel Clobe row whose memo is later corrected to a canonical travel key may move into booking settlement before finalization only through `reconcile_clobe_provider_memo_allocation`. Every active allocation must be a ledger-free non-booking classification and must conserve the exact provider amount. The command reverses those rows append-only; an inflow is then allocated to the exact memo-key booking, while an outflow returns to `review` for explicit payout/refund/split approval. Any existing booking/ledger allocation, cross-tenant target, finalized booking, non-canonical memo, or amount mismatch blocks automatic reconciliation.
- Clobe bank sync must normalize provider rows into the same bank import contract before touching `bank_transactions`.
- Clobe MCP authentication is an admin OAuth connection stored in `tenant_api_tokens` with encrypted access/refresh tokens. Do not require operators to paste a static Clobe bearer token into Vercel.
- Tenant and account discovery is fail-closed: lookup errors stop the run, account comparison is digit-normalized, and the sync lease uses the same tenant/platform scope as the importer. Every normalized provider row must contain that same account number before any import starts. Legacy platform-scope rows use a platform lease rather than silently switching to the OAuth tenant.
- Clobe sync dedupe order is provider transaction id first (`external_provider`, `external_transaction_id`), then local `transaction_fingerprint`.
- Provider transaction identity is unique among active bank rows. Excluded historical evidence may retain the same provider identity so an authoritative active Clobe row can replace it without deleting audit history.
- Local transaction fingerprints follow the same active-only uniqueness boundary. Excluded evidence may retain the fingerprint of its authoritative active replacement.
- When an authoritative Clobe row was initially bootstrapped from an Excel export without a provider transaction id, the first live sync may attach the provider id only to one active `clobe_mcp` row with the same minute, type, amount, counterparty, and memo. If the memo changed, a no-memo fallback is allowed only when exactly one candidate exists; ambiguous rows remain review-only and must not create a second financial allocation.
- Clobe-sourced outflows never auto-confirm. A valid one-booking memo resolution stores only a suggested booking; the operator command confirms the payout through `match_bank_transaction_allocations`.
- For the OpenLife 4128 settlement account, Clobe MCP is the authoritative bank source. Slack/SMS rows are audit-only fallback evidence and must be excluded from active settlement totals during an authoritative rebuild.
- An authoritative Clobe rebuild reverses active allocations, resets bank-derived booking totals through the ledger RPC, then re-imports Clobe rows. Excluded rows remain retained for audit and are never eligible as duplicate candidates.
- Similarity-based bank dedupe may merge only a strong candidate. A weak candidate is a review hint and must remain as its own imported transaction; one memo key may contain many legitimate rows.
- A unique Clobe row may merge a legacy Slack row only when type, amount, counterparty, and timestamp within one minute identify exactly one candidate. Ambiguous candidates remain separate for review.
- Legacy rows that already have `booking_id`/`match_status` but no active `bank_transaction_allocations` evidence must be repaired through `repair_legacy_bank_transaction_allocation`. The repair creates one allocation per source row and preserves existing booking totals, or records an explicit ledger transfer when the memo resolves to a different canonical booking.
- If a Clobe memo changes after a transaction has a booking/ledger allocation, do not move that allocation automatically. Record an open `ops_events` warning for manual review. The only automatic reclassification is the exact ledger-free non-booking case defined above.
- The owner action count must include a travel row whose financial allocation is complete but whose `match_status` is `review`, `unmatched`, or `error`. Count each source transaction once even when both status and allocation need attention.
- If Clobe memo changes before financial matching, update the stored bank transaction memo and re-run memo-key resolution through the same import path.
- `travel deposits - travel withdrawals` is a booking-linked cash position, not realized profit. It includes customer advances held for future departures, supplier prepayments, and departed bookings still awaiting final settlement.
- A positive balance on an unconfirmed booking is customer cash held for that trip. A negative balance is company cash advanced to that booking. Neither amount may be presented as available profit.
- Realized cash profit may be shown only from immutable, current V3 month-close snapshots backed by a current confirmed booking review and review fingerprint. `settlement_confirmed_at` is compatibility metadata and cannot independently establish realized profit. Future/departure-day bookings, departed-but-unconfirmed bookings, missing-departure bookings, and unallocated travel transactions remain separate buckets that reconcile exactly to the total travel cash position.
- Finance-excluded bookings are never hard-deleted as a correction mechanism. Test data, invalid bookings, and duplicates remain recoverable and are excluded from finance, tax, evidence tasks, protected cash, and operating metrics.
- Production E2E data must use a finance-excluded test tenant or an explicitly finance-excluded booking. Tests must never create ordinary bookings in a real finance tenant.
- Company prefunding is calculated per booking from the lowest time-ordered cumulative cash balance. The current outstanding advance is the absolute value of a booking's negative current cash balance; the historical prefunding requirement is the absolute value of its lowest cumulative balance.
- `/admin/payments` must separate booking KPI periods (departure date) from the active bank ledger. Transaction tabs and their counts use the full active bank ledger unless a dedicated transaction-date filter is explicitly shown.
- `/admin/payments` must show the complete Clobe row count, actual provider balance/as-of time, full inflow/outflow totals, travel net, non-travel net, and reconciliation difference. A count of zero in booking queues must not imply that non-travel or memo-review rows do not exist.
- The non-travel memo-review queue must open only rows that require review; the full non-travel ledger remains a separate explicit view.
- Every bank and settlement timestamp shown to operators must use `Asia/Seoul` explicitly. UTC slicing and runtime-default locale formatting are prohibited on settlement screens.
- Clobe normalization failures must be reported separately from importer failures. A response with `fetched > normalized` must never be presented as `errors 0` without showing the normalization failure count.
- Clobe sync is manual-only for the current OpenLife rollout. The cron route may remain as dormant code, but no Vercel schedule may call it until the owner explicitly approves scheduled operation.
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

## 2026-08-23 실제 DB 권한 게이트

연결된 활성 Supabase DB read-only 감사에서 다음 P0가 확인됐다.

- `match_bank_transaction_allocations`가 anon/authenticated에 EXECUTE 가능했다.
- `bookings_access`가 public ALL이며 인증 여부만으로 tenant 조건을 우회할 수 있었다.
- `vouchers.authenticated_access`가 tenant 조건 없이 authenticated ALL이었다.
- `settlements`와 `sms_payments`에도 브라우저 역할의 전체 table privilege가 남아 있었다.
- 브라우저 역할에 booking 금액·상태와 voucher status UPDATE privilege가 남아 있었다.

따라서 `20260823111632_finance_rbac_command_hardening.sql` 적용 및 권한 negative test 완료 전에는 재무·정산·확정서 무인 자동화를 활성화하지 않는다. 운영 DB에 migration이 적용되지 않았다는 사실과 코드에 migration 파일이 존재한다는 사실을 반드시 분리해 보고한다.

서버 cron/API/DB 계층에서 `bookings`, `bank_transactions`, `settlements`, `sms_payments`, `vouchers`를 읽거나 변경할 때는 anon client를 사용하지 않는다. 브라우저·public surface의 읽기는 별도 공개 projection/API 계약으로만 허용하고, 서버 운영 경로는 `supabaseAdmin` 또는 service-role Command RPC를 사용한다.

## Verification

Use the narrowest applicable checks first:

```bash
npx vitest run src/lib/ledger-utils.test.ts src/lib/payment-matcher.test.ts src/lib/payment-command-resolver.test.ts src/lib/settlement-accounting.test.ts
npx vitest run src/lib/affiliate/settlement-calc.test.ts src/lib/affiliate/settlement-approval.test.ts
npm run type-check
```

For production-facing finance work, also verify `/admin/payments/reconcile` or `/api/admin/ledger/reconcile-status` before calling the system healthy.
