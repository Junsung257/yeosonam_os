# Finance Settlement Center V3 Revalidation Audit

Date: 2026-08-06 KST

Status: production schema and application deployed; authenticated Chrome, database reconciliation, and runtime verification complete.

This file is historical evidence. Current operating rules remain in `docs/settlement-current-ssot.md`.

## Release Evidence

- Pull request: `#1073`
- Production application commit: `4989f16c747199952742ea8a28217eae916ae535`
- Vercel production deployment: `dpl_4Mmu8PJbR4MAnsyqcPKzoGQcefGa`
- Vercel state: `READY`
- Supabase project: `ixaxnvbmhzjvupissmly`
- Production migration: `finance_settlement_center_v3_revalidation`
- Production index replay migration: `finance_review_reviewer_index_replay`
- Allocation-conservation pull request: `#1075`
- Production allocation migration: `finance_non_travel_allocation_conservation`
- Final tax hydration pull request: `#1079`
- Final production application commit: `9cd76c4bc4c43df2a6947878da1f98e362b7cc63`
- Final Vercel production deployment: `dpl_5bTazi5aJ7nTLogTRWo7ZmCzmDr7`

## Implemented Controls

- Clobe Shinhan 4128 transactions remain the bank source of truth.
- A bank transaction can be split across booking, refund, fee, company expense, travel, tax, capital, transfer, owner draw, other income, and unassigned targets.
- Active allocations cannot exceed the source transaction amount; confirmed breakdowns must equal it exactly.
- Booking settlement requires an explicit owner review decision. Positive margin is not auto-confirmed.
- A transaction, memo, allocation, booking status, or departure-date change invalidates the prior review fingerprint.
- Monthly close requires reviewed bookings and preserves immutable legacy snapshots.
- Cancelled, invalid, and test bookings are excluded from finance and tax reporting without hard deletion.
- Legacy Slack/SMS records remain evidence only and do not participate in finance calculations.

## Production Reconciliation

Snapshot after migration and audited corrections:

| Check | Result |
|---|---:|
| Active Shinhan 4128 transactions | 465 |
| Total deposits | 156,956,220 KRW |
| Total withdrawals | 140,384,336 KRW |
| Calculated balance | 16,571,884 KRW |
| Source transactions with exact active allocations | 465 / 465 |
| Under-allocated source transactions | 0 |
| Over-allocated source transactions | 0 |
| Unallocated source amount | 0 KRW |
| Legacy periods marked for revalidation | 6 |
| Preserved legacy period items | 48 |
| Pending real bookings after BK-0126 cancellation review | 80 |
| Quarantined BK-0080 through BK-0090 tests | 11 |

The migration created 81 pending reviews containing all 48 legacy auto-confirmed items plus other active real bookings. BK-0126 was then reviewed as a customer cancellation, leaving 80 pending. This intentionally prevents unreviewed profit from becoming confirmed or spendable.

The calculated 16,571,884 KRW balance exactly matches the latest Clobe transaction's `balance_after` value.

### Allocation-conservation follow-up

The first V3 audit proved that travel allocations were exact and that no source transaction was over-allocated. A subsequent all-source check found that 186 non-travel rows had classifications but no corresponding allocation evidence, leaving 16,390,694 KRW outside the unified allocation ledger. This did not change the bank balance or booking margins, but it failed the stricter requirement that every Clobe 4128 source row be represented exactly once in the common allocation ledger.

Migration `finance_non_travel_allocation_conservation` closed that gap by adding only the missing non-travel remainder, representing unresolved rows as explicit `unassigned` allocations, and preserving exact operator-created splits. A production dry run completed inside `BEGIN ... ROLLBACK` with 188 source rows, 186 inserts, and 0 non-exact rows. The production migration then created 186 system classification lines and finished with 465 of 465 active source rows exactly allocated, 0 under-allocated rows, 0 over-allocated rows, and 0 KRW unallocated. Bank totals and all audited booking margins remained unchanged.

## Clobe Sync Verification

- The scheduled sync completed successfully at 2026-08-06 04:14:49 KST with 129 source and 129 recognized transactions, 2 matches, and 0 errors.
- BK-0131 Lee Nayoon contains all three memo-keyed transactions: deposit 1,238,000 and withdrawals 9,100 plus 990,100 KRW. Its pending cash margin is 238,800 KRW.
- BK-0133 Lee Jiyeon was automatically created or matched from the `260824_이지연_투어코코넛` memo and currently contains the 800,000 KRW deposit.
- Both bookings remain pending owner review; synchronization did not auto-confirm their profit.

## Case Verification

| Case | Verified result |
|---|---|
| BK-0017 Kim Areumsongi | Deposit 719,000; travel withdrawal 660,100; cash margin 58,900 KRW |
| BK-0124 Changwon University | Deposit 13,550,000; travel withdrawal 11,640,500; cash margin 1,909,500 KRW |
| 9,140,000 KRW mixed transfer | Split into Changwon University 7,640,000 and Kim Doyeon refund 1,500,000 KRW |
| Kim Doyeon cancellation | Deposit 1,500,000 and refund 1,500,000; net 0 KRW |
| BK-0126 Lee Seongsun | Customer refund 600,000; bank fee 500; booking cash result 0 KRW; finance excluded |
| BK-0018 Kim Bongja | Invalid booking, finance excluded and recoverable |
| BK-0109 Hwang Jihyeon | Pending owner choice: owner draw or company travel |
| BK-0110 Park Junseong | Pending owner choice: owner draw or company travel |

## Automated Verification

- Production build passed for all pages and API routes.
- Final test suite passed: 649 files and 5,025 tests.
- TypeScript, ESLint, migration safety, dependency, security, bundle, visual-regression, and readiness checks passed.
- The migration compiled from a clean production-schema dump before production application.
- Post-DDL Supabase security advisors reported no finance-related findings.
- Post-DDL performance advisors found one missing reviewer foreign-key index. It was created concurrently and verified valid on production before the replay-safe migration `20260806041405_finance_review_reviewer_index_replay.sql` was recorded.
- Newly deployed settlement-period unused-index notices are expected until production query history accumulates.

## Final Production Verification

Authenticated Chrome verification completed against `www.yeosonam.com` after the final production alias switched to deployment `dpl_5bTazi5aJ7nTLogTRWo7ZmCzmDr7`.

- Finance home showed bank balance 16,571,884 KRW, OS balance 16,571,884 KRW, and difference 0 KRW.
- Transaction review showed 465 active Clobe rows, deposits 156,956,220 KRW, withdrawals 140,384,336 KRW, unallocated travel transactions 0, and one review-only memo candidate.
- Booking settlement showed 78 real pending reviews. BK-0017, BK-0124, BK-0109, BK-0110, BK-0131, and BK-0133 displayed the expected pending values without automatic confirmation.
- July close showed 16 pending owner reviews. Six legacy periods and 48 immutable legacy items remain marked for revalidation.
- Company expenses showed 190 rows, 34 unclassified rows, and dedicated Clobe memo values.
- Tax evidence defaulted to the KST month `2026-08`; the browser/server hydration mismatch no longer occurs.
- BK-0080 through BK-0090 were absent from normal finance and tax views. Production SQL confirmed 11 quarantined rows and zero finance-visible test rows.
- Legacy routes redirect as intended: `/admin/payments` to transaction review, `/admin/ledger` to finance home, and `/admin/tax` to tax evidence.
- Browser console warnings/errors were zero across finance home, review, bookings, periods, expenses, tax, and legacy-route navigation.
- Vercel reported no `/admin/finance` or `/api/admin/finance` runtime errors in the final verification window.
- Desktop Chrome was verified directly. The external Chrome viewport override did not change the visible window to 390 px; mobile coverage is therefore supported by the passing visual-regression gate rather than claimed as a direct manual 390 px check.
